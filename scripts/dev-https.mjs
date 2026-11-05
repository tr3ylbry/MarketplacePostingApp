import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { spawn } from "node:child_process";
import { config } from "dotenv";
import process from "node:process";
import console from "node:console";

// This command never generates certificates or changes trust. That is an
// explicit operator step, separate from starting the loopback development app.
config({ path: ".env.https.local", quiet: true });
const directory = join(homedir(), ".local/share/marketplace-posting-app/tls");
const key = join(directory, "127.0.0.1-key.pem"), cert = join(directory, "127.0.0.1.pem");
try {
  const certificate = new X509Certificate(readFileSync(cert));
  if ((statSync(directory).mode & 0o077) || (statSync(key).mode & 0o077) || !certificate.checkIP("127.0.0.1") || !certificate.checkPrivateKey(createPrivateKey(readFileSync(key))) || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) throw new Error();
} catch { console.error("Configure the approved, trusted 127.0.0.1 certificate outside Git before running dev:https. See docs/ebay-oauth.md."); process.exit(1); }
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3000", "--experimental-https", "--experimental-https-key", key, "--experimental-https-cert", cert], { stdio: "inherit", env: { ...process.env, BETTER_AUTH_URL: "https://127.0.0.1:3000" } });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => process.exit(code ?? 1));
