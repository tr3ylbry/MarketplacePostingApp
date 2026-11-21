import { Readable, Writable } from "node:stream";
import type { ReadStream, WriteStream } from "node:tty";

// Test streams only. Real PTY tests separately exercise the OS terminal driver.
export function privateTerminal(initialRaw = false) {
  let text = "";
  const input = Object.assign(new Readable({ read() {} }), {
    isTTY: true, isRaw: initialRaw,
    setRawMode(value: boolean) { this.isRaw = value; return this; },
  });
  const output = Object.assign(new Writable({ write(chunk, _encoding, done) { text += chunk.toString(); done(); } }), { isTTY: true });
  return {
    terminal: { input: input as unknown as ReadStream, output: output as unknown as WriteStream },
    input, output, text: () => text,
    send: (s: string) => input.emit("data", Buffer.from(s)),
    submit: () => input.emit("data", Buffer.from("\r")),
  };
}
