// @vitest-environment node
import { readPrivateInput, localSessionCookie, MAX_PRIVATE_INPUT, REHEARSAL_TEXT } from "../../scripts/private-tty-input";
import { captureOptions } from "../../scripts/capture-options";
import { privateTerminal } from "./privateTerminal";
import { spawnSync } from "node:child_process";

const cookie = "__Secure-better-auth.session_token=" + "a".repeat(32) + "." + "b".repeat(43) + "%3D";

it.each([cookie, REHEARSAL_TEXT])("keeps native-style input hidden and restores prior terminal settings", async value => {
  const t = privateTerminal(true), pending = readPrivateInput("Hidden: ", t.terminal.input, t.terminal.output);
  expect(t.input.isRaw).toBe(true);
  t.send(value); t.submit();
  expect(await pending).toBe(value);
  expect(t.text()).not.toContain(value);
  expect(t.input.isRaw).toBe(true);
  expect(t.input.listenerCount("data")).toBe(0);
});

it("recognizes split bracketed-paste frames without stripping arbitrary controls", async () => {
  const t = privateTerminal(), pending = readPrivateInput("Hidden: ", t.terminal.input, t.terminal.output);
  for (const chunk of ["\x1b[2", "00~", cookie.slice(0, 22), cookie.slice(22), "\x1b[20", "1~"]) t.send(chunk);
  t.submit(); expect(await pending).toBe(cookie); expect(t.input.isRaw).toBe(false);
});

it("allows intentional backspace before submission", async () => {
  const t = privateTerminal(), pending = readPrivateInput("Hidden: ", t.terminal.input, t.terminal.output);
  t.send("wrong\x7f\x7f\x7f\x7f\x7f" + cookie); t.submit(); expect(await pending).toBe(cookie);
});

it.each([
  ["", "format"], ["\x1b[200~node command\nsecond command\x1b[201~", "format"],
  [cookie + "\nnode command", "format"], [cookie + "\0", "format"],
  [cookie + "\x1b[31m", "format"], ["a".repeat(MAX_PRIVATE_INPUT + 1), "too-long"],
])("rejects malformed/oversized pastes without returning their contents", async (value, code) => {
  const t = privateTerminal(), pending = readPrivateInput("Hidden: ", t.terminal.input, t.terminal.output);
  const rejected = expect(pending).rejects.toMatchObject({ code });
  t.send(value); expect(t.input.isRaw).toBe(true); t.submit(); await rejected;
  expect(t.input.isRaw).toBe(false); expect(t.text()).not.toContain("node command");
});

it.each(["cancel", "ctrl-d", "end", "close", "error", "output-error", "signal"])("restores terminal state on %s", async event => {
  const t = privateTerminal(), pending = readPrivateInput("Hidden: ", t.terminal.input, t.terminal.output);
  const rejected = expect(pending).rejects.toThrow("Private input unavailable.");
  t.send("private-test-input");
  if (event === "cancel") t.send("\x03");
  else if (event === "ctrl-d") t.send("\x04");
  else if (event === "signal") process.emit("SIGTERM");
  else if (event === "output-error") t.output.emit("error", Error("synthetic"));
  else t.input.emit(event, Error("synthetic"));
  await rejected; expect(t.input.isRaw).toBe(false);
  expect(t.input.listenerCount("data")).toBe(0); expect(t.text()).not.toContain("private-test-input");
});

it("rejects non-TTY and raw-mode setup failure without echoing", async () => {
  const t = privateTerminal(); t.input.isTTY = false;
  await expect(readPrivateInput("Hidden: ", t.terminal.input, t.terminal.output)).rejects.toMatchObject({ code: "tty" });
  t.input.isTTY = true;
  t.input.setRawMode = () => { throw Error("synthetic"); };
  await expect(readPrivateInput("Hidden: ", t.terminal.input, t.terminal.output)).rejects.toMatchObject({ code: "input" });
});

it.each(["", "node scripts/ebay-capture-discovery.ts --check-session", cookie + "; other=cookie",
  cookie.replace("__Secure-", ""), "Cookie: " + cookie, cookie + " ", cookie + "\r\n", "x".repeat(5000)])("rejects non-cookie/command input", value => {
  expect(() => localSessionCookie(value)).toThrow("Private input unavailable.");
});
it("passes exactly one secure cookie pair unchanged to Better Auth", () => expect(localSessionCookie(cookie)).toBe(cookie));

it.each([
  ["--check-session", "--approve-media-consent"], ["--check-session", "--approve-one-create"],
  ["--check-session", "--fixture", "/tmp/no"], ["--check-session", "--rehearse-input"],
  ["--check-session", "--seller-key", "a".repeat(64)], ["--help", "--check-session"],
  ["--rehearse-input", "--reviewed-head", "a".repeat(40)], ["--approve-media-consent"],
  ["--fixture", "/tmp/no", "--approve-one-create"], [],
].map(args => ({ args })))("rejects conflicting/incomplete modes before any input or authorization: $args", ({ args }) => {
  expect(() => captureOptions(args)).toThrow();
});
it("accepts local modes without credentials or provider identifiers", () => {
  expect(captureOptions(["--check-session"]).mode).toBe("check-session");
  expect(captureOptions(["--rehearse-input"]).mode).toBe("rehearse-input");
});
it("retains explicit real-mode reviewed-head and seller bindings", () => {
  expect(captureOptions(["--approve-media-consent", "--reviewed-head", "a".repeat(40), "--seller-key", "b".repeat(64)]).mode).toBe("approve-media-consent");
});

it("exercises no-echo, bracketed paste and restoration through real OS PTYs", () => {
  const r = spawnSync("python3", ["src/test/fixtures/private-tty.py", process.execPath], { encoding: "utf8", timeout: 60000 });
  expect(r.status, r.stderr).toBe(0);
  expect(JSON.parse(r.stdout)).toEqual({ cases: 9, noEcho: true, restored: true });
}, 65000);
