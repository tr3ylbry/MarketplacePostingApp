import type { ReadStream, WriteStream } from "node:tty";

export const REHEARSAL_TEXT = "MARKETPLACE POSTING ASSISTANT";
export const MAX_PRIVATE_INPUT = 4096;
export class PrivateInputError extends Error {
  constructor(readonly code: "tty" | "cancelled" | "eof" | "input" | "format" | "too-long") {
    super("Private input unavailable.");
  }
}

// Owner-controlled native paste only. Never read a clipboard or echo input.
// Invalid pastes remain hidden until a separate Enter/Ctrl+C, so their trailing
// lines cannot accidentally be handed back to the shell as commands.
export function readPrivateInput(prompt: string, input: ReadStream = process.stdin,
  output: WriteStream = process.stdout): Promise<string> {
  if (!input.isTTY || !output.isTTY) return Promise.reject(new PrivateInputError("tty"));
  const raw = input.isRaw, flowing = input.readableFlowing === true;
  return new Promise((resolve, reject) => {
    let value = "", escape = "", pasted = false, done = false;
    let failure: PrivateInputError | undefined;
    const fail = (code: "format" | "too-long") => {
      failure ??= new PrivateInputError(code); value = "";
    };
    const finish = (error?: PrivateInputError) => {
      if (done) return; done = true;
      input.off("data", data); input.off("end", eof); input.off("close", eof); input.off("error", ioError);
      output.off("error", ioError);
      for (const signal of signals) process.off(signal, interrupted);
      try { input.setRawMode(raw); if (!flowing) input.pause(); }
      catch { error ??= new PrivateInputError("input"); }
      // Disable the bracketed-paste mode enabled by this prompt, including errors.
      try { output.write("\x1b[?2004l\n"); } catch { error ??= new PrivateInputError("input"); }
      if (error) { value = ""; reject(error); } else resolve(value);
    };
    const eof = () => finish(new PrivateInputError("eof"));
    const ioError = () => finish(new PrivateInputError("input"));
    const interrupted = () => finish(new PrivateInputError("cancelled"));
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    const data = (chunk: Buffer | string) => {
      // Raw terminal input is ASCII; do not decode/strip arbitrary controls.
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const submit = bytes.length === 1 && (bytes[0] === 13 || bytes[0] === 10);
      for (const byte of bytes) {
        if (done) return;
        if (byte === 3 || byte === 4) {
          if (pasted) { fail("format"); escape = ""; continue; }
          if (byte === 3) interrupted(); else eof();
          return;
        }
        const char = String.fromCharCode(byte);
        if (escape || byte === 27) {
          escape += char;
          if (escape === "\x1b[200~" && !pasted) { pasted = true; escape = ""; }
          else if (escape === "\x1b[201~" && pasted) { pasted = false; escape = ""; }
          else if (!"\x1b[200~".startsWith(escape) && !"\x1b[201~".startsWith(escape)) {
            fail("format"); escape = "";
          }
          continue;
        }
        if ((byte === 13 || byte === 10) && !pasted && submit) {
          finish(failure ?? (!value ? new PrivateInputError("format") : undefined)); return;
        }
        if ((byte === 127 || byte === 8) && !pasted && !failure) { value = value.slice(0, -1); continue; }
        if (byte < 33 || byte > 126) {
          // Spaces are legitimate only for the fixed harmless rehearsal text.
          if (byte !== 32) { fail("format"); continue; }
        }
        if (!failure) {
          if (value.length >= MAX_PRIVATE_INPUT) fail("too-long"); else value += char;
        }
      }
    };
    try {
      input.setRawMode(true);
      input.on("data", data); input.once("end", eof); input.once("close", eof); input.once("error", ioError);
      output.once("error", ioError);
      for (const signal of signals) process.once(signal, interrupted);
      output.write("\x1b[?2004h" + prompt);
      input.resume();
    } catch { finish(new PrivateInputError("input")); }
  });
}

export function localSessionCookie(value: string): string {
  // One HTTPS cookie name=value pair, not a shell command, raw value, complete
  // Cookie/Set-Cookie header, other cookie or an HTTP-origin session alias.
  if (value.length > MAX_PRIVATE_INPUT ||
    !/^__Secure-better-auth\.session_token=[A-Za-z0-9_%+./=-]{20,2048}$/.test(value)) {
    throw new PrivateInputError("format");
  }
  return value;
}
