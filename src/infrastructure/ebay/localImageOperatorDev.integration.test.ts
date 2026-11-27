import { createHash, randomBytes, randomUUID, X509Certificate } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, cp, symlink, realpath, rm, chmod, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { totalmem } from "node:os";
import { createServer } from "node:net";
import { request } from "node:https";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { authOptions } from "../../auth/options";
import { disposableVerificationDatabase } from "../../test/disposableVerificationDatabase";
import { DrizzleLocalImageOperatorRepository } from "../repositories/drizzleLocalImageOperatorRepository";
import { PHOTO_RECIPE } from "../storage/photoDerivative/transformPhoto";
import { IMAGE_COMPARISON_RECIPE } from "../storage/diagnosticImageDecode";
import { ebayConfig } from "./config";
import * as schema from "../db/schema";

vi.mock("server-only", () => ({}));
const sourceRoot = process.cwd(), origin = "https://127.0.0.1:3000";
const endpoint = "/api/operator/ebay-image-verification";
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const cleanEnvironment = (): NodeJS.ProcessEnv => ({ PATH: process.env.PATH, LANG: "C", NODE_ENV: "development", CI: "1",
  NEXT_TELEMETRY_DISABLED: "1", NEXT_DISABLE_UPDATE_CHECK: "1", NEXT_TRACE_UPLOAD_DISABLED: "1",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" });
function git(root: string, args: string[]) {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: root, env: cleanEnvironment(), encoding: "utf8", timeout: 15_000, maxBuffer: 8_388_608, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
async function requireFreePort() {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", (error: NodeJS.ErrnoException) => reject(new Error(`Synthetic Next loopback prerequisite unavailable (${["EADDRINUSE", "EACCES", "EPERM"].includes(error.code ?? "") ? error.code : "unknown"}); no existing process was changed.`)));
    probe.listen({ host: "127.0.0.1", port: 3000, exclusive: true }, () => probe.close(error => error ? reject(new Error("Port probe cleanup failed.")) : resolve()));
  });
}
function commonParent(a: string, b: string) {
  let parent = a;
  while (b !== parent && !b.startsWith(parent + "/")) parent = dirname(parent);
  return parent;
}
type WireResult = { status: number; headers: Record<string, string | string[] | undefined>; text: string };
function localGet(ca: Buffer, path: string, cookie?: string): Promise<WireResult> {
  return new Promise((resolve, reject) => {
    const req = request(origin + path, { ca, rejectUnauthorized: true, agent: false, timeout: 5_000,
      headers: { accept: "application/json", ...(cookie ? { cookie } : {}) } }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", chunk => { size += chunk.length; if (size > 32_768) req.destroy(new Error("Bounded local response exceeded.")); else chunks.push(Buffer.from(chunk)); });
      response.once("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, text: Buffer.concat(chunks).toString("utf8") }));
      response.once("error", () => reject(new Error("Synthetic local response unavailable.")));
    });
    req.once("timeout", () => req.destroy(new Error("Synthetic local request deadline.")));
    req.once("error", () => reject(new Error("Synthetic loopback TLS request unavailable.")));
    req.end();
  });
}
async function stopOwnedChild(child: ChildProcess | undefined, settled: Promise<void> | undefined) {
  if (!child || !settled || !child.pid) return;
  const kill = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } };
  kill("SIGTERM");
  const stopped = await Promise.race([settled.then(() => true), pause(5_000).then(() => false)]);
  if (!stopped) { kill("SIGKILL"); if (!await Promise.race([settled.then(() => true), pause(5_000).then(() => false)])) throw new Error("Owned Next process did not settle; cleanup incomplete."); }
}
async function databaseSnapshot(pool: Awaited<ReturnType<typeof disposableVerificationDatabase>>["pool"]) {
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const snapshot: Record<string, string> = {};
  for (const { tablename } of tables) {
    const rows = await pool.query('SELECT coalesce(jsonb_agg(v ORDER BY v::text),\'[]\') AS rows FROM (SELECT to_jsonb(t) AS v FROM "' + tablename.replaceAll('"', '""') + '" t) q');
    snapshot[tablename] = createHash("sha256").update(JSON.stringify(rows.rows[0].rows)).digest("hex");
  }
  return snapshot;
}

// Written only into the disposable synthetic checkout, before its commit. No
// production alias, test-build flag or private environment file is used.
const guardSource = `import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import {syncBuiltinESMExports} from "node:module";
const root=globalThis as typeof globalThis & {__syntheticNextGuard?:boolean};
export function forbiddenProvider():never { fs.appendFileSync(process.env.SYNTHETIC_NEXT_PROVIDER_MARKER!,"1"); throw Error("Synthetic provider boundary was reached."); }
function allowed(args:unknown[]) {const first=args[0];if(Array.isArray(first))return allowed(first);const options=first&&typeof first==="object"?first as {host?:string;hostname?:string;path?:string}:null;
 if(options?.path||typeof first==="string")return;const host=options?.host??options?.hostname??(typeof args[1]==="string"?args[1]:"localhost");
 if(!["127.0.0.1","localhost","::1"].includes(host))forbiddenProvider();}
if(!root.__syntheticNextGuard){root.__syntheticNextGuard=true;
 const connect=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args:unknown[]){allowed(args);return Reflect.apply(connect,this,args);} as typeof connect;
 const secure=tls.connect;tls.connect=function(...args:unknown[]){allowed(args);return Reflect.apply(secure,this,args);} as typeof secure;
 const lookup=dns.lookup;dns.lookup=function(hostname:string,...args:unknown[]){if(!["127.0.0.1","localhost","::1"].includes(hostname))forbiddenProvider();return Reflect.apply(lookup,this,[hostname,...args]);} as typeof lookup;
 globalThis.fetch=async()=>forbiddenProvider();syncBuiltinESMExports();}
`;
async function syntheticSource(root: string, dependencies: string) {
  const names = git(sourceRoot, ["ls-files", "-z"]).split("\0").filter(Boolean);
  for (const name of names) {
    if (name.startsWith("/") || name.split("/").includes("..")) throw new Error("Unexpected tracked source entry.");
    if (/(^|\/)\.env(?:\.|$)/.test(name)) continue;
    const target = join(root, name); await mkdir(dirname(target), { recursive: true });
    await cp(join(sourceRoot, name), target, { dereference: false });
  }
  await symlink(dependencies, join(root, "node_modules"), "dir");
  const configPath = join(root, "next.config.ts"), config = await readFile(configPath, "utf8");
  if (!config.includes("export default nextConfig;")) throw new Error("Synthetic Turbopack setup requires review.");
  const turboRoot = commonParent(await realpath(root), dependencies);
  if (turboRoot !== await realpath(sourceRoot)) throw new Error("Synthetic Turbopack root must stay inside the test checkout.");
  await writeFile(configPath, config.replace("export default nextConfig;", `nextConfig.turbopack = { ...nextConfig.turbopack, root: ${JSON.stringify(turboRoot)} };\nexport default nextConfig;`));
  await mkdir(join(root, "src/test"), { recursive: true });
  await writeFile(join(root, "src/test/syntheticNextGuards.ts"), guardSource);
  await writeFile(join(root, "src/instrumentation.ts"), 'export async function register(){if(process.env.NEXT_RUNTIME==="nodejs")await import("./test/syntheticNextGuards");}\n');
  const shim = 'import {forbiddenProvider} from "../../test/syntheticNextGuards";\n';
  await writeFile(join(root, "src/infrastructure/ebay/ebayClient.ts"), shim + 'export class EbayClient { constructor(){forbiddenProvider();} }\n');
  await writeFile(join(root, "src/infrastructure/ebay/captureClient.ts"), shim + 'export const SANDBOX_CAPTURE_URL="https://synthetic.invalid/disabled";export function createCaptureClient(){return forbiddenProvider();}\n');
  await writeFile(join(root, "src/infrastructure/storage/captureSource.ts"), shim + 'export function captureSource(){return forbiddenProvider();}\n');
  await writeFile(join(root, "src/infrastructure/storage/vercelBlobImageStorage.ts"), shim + 'export class VercelBlobImageStorage {constructor(){forbiddenProvider();}} export const imageStorage=new Proxy({}, {get(){return forbiddenProvider();}});\n');
  await writeFile(join(root, "src/infrastructure/ebay/imageDownloader.ts"), shim + 'export function startImageDownload(){return forbiddenProvider();}\n');
  const probe = join(root, "src/app/api/synthetic-next-context/route.ts"); await mkdir(dirname(probe), { recursive: true });
  await writeFile(probe, 'import "../../../test/syntheticNextGuards";export const runtime="nodejs";export const dynamic="force-dynamic";export function GET(){return Response.json({nodeOptions:process.env.NODE_OPTIONS??null,dev:process.env.__NEXT_DEV_SERVER==="1",worker:process.env.NEXT_PRIVATE_WORKER==="1",testBuild:process.env.MARKETPLACE_TEST_BUILD??null});}\n');
  git(root, ["init", "--quiet"]); git(root, ["config", "user.name", "Synthetic test"]); git(root, ["config", "user.email", "synthetic@invalid.test"]);
  git(root, ["add", "--all"]); git(root, ["commit", "--quiet", "-m", "Synthetic real Next dev activation regression"]);
  return { head: git(root, ["rev-parse", "HEAD"]), tree: git(root, ["rev-parse", "HEAD^{tree}"]) };
}

it("serves the real Next dev-fork operator as 401 without a session and armed/200 with a genuine signed session, with no writes or provider construction", async () => {
  if (process.versions.node.split(".")[0] !== "24") throw new Error("Node 24 is required.");
  await requireFreePort();
  let isolated: Awaited<ReturnType<typeof disposableVerificationDatabase>> | undefined, temporary: string | undefined;
  let child: ChildProcess | undefined, settled: Promise<void> | undefined;
  try {
    isolated = await disposableVerificationDatabase();
    expect((await isolated.pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(15);
    const results = join(sourceRoot, "test-results"); await mkdir(results, { recursive: true });
    temporary = await mkdtemp(join(results, "next-dev-")); await chmod(temporary, 0o700);
    const root = join(temporary, "app"), key = join(temporary, "key.pem"), certificate = join(temporary, "cert.pem"); await mkdir(root);
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", certificate,
      "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"],
    { env: cleanEnvironment(), timeout: 15_000, maxBuffer: 65_536, stdio: ["ignore", "pipe", "pipe"] });
    await chmod(key, 0o600); const ca = await readFile(certificate); expect(new X509Certificate(ca).checkIP("127.0.0.1")).toBe("127.0.0.1");
    const pins = await syntheticSource(root, await realpath(resolve(sourceRoot, "node_modules"))), id = randomUUID();
    const env: NodeJS.ProcessEnv = { ...cleanEnvironment(), DATABASE_URL: isolated.pool.options.connectionString!, BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), GITHUB_CLIENT_ID: "synthetic-client", GITHUB_CLIENT_SECRET: "synthetic-secret",
      EBAY_ENVIRONMENT: "sandbox", EBAY_SANDBOX_CLIENT_ID: "synthetic-client", EBAY_SANDBOX_CLIENT_SECRET: "synthetic-secret", EBAY_SANDBOX_RUNAME: "synthetic-runame",
      VERCEL_BLOB_RETRIES: "0", LOCAL_IMAGE_OPERATOR_ID: id, LOCAL_IMAGE_OPERATOR_HEAD: pins.head, LOCAL_IMAGE_OPERATOR_TREE: pins.tree, LOCAL_IMAGE_OPERATOR_ROOT: root,
      SYNTHETIC_NEXT_PROVIDER_MARKER: join(temporary, "provider-attempts") };
    const auth = betterAuth({ ...authOptions(isolated.db, env), plugins: [testUtils()] }), test = (await auth.$context).test;
    const user = await test.saveUser(test.createUser()), login = await test.login({ userId: user.id }), cookie = login.headers.get("cookie")!;
    expect(cookie.startsWith("__Secure-better-auth.session_token=")).toBe(true);
    const connectionId = randomUUID(), version = randomUUID(), seller = createHash("sha256").update(randomUUID()).digest("hex"), configHash = ebayConfig(env).fingerprint;
    const envelope = { ciphertext: "synthetic", iv: "synthetic", tag: "synthetic", keyVersion: 1 as const }, future = new Date(Date.now() + 3_600_000).toISOString();
    await isolated.db.insert(schema.ebayConnections).values({ id: connectionId, version, ownerId: user.id, configHash, status: "connected", sellerId: seller, sellerLabel: "Synthetic seller",
      access: envelope, refresh: envelope, accessExpiresAt: future, refreshExpiresAt: future, connectedAt: new Date().toISOString(), scopes: ["https://api.ebay.com/oauth/api_scope"] });
    await new DrizzleLocalImageOperatorRepository(isolated.db).arm({ id, ownerId: user.id, connectionId, initialConnectionVersion: version, sellerKey: seller, configHash,
      reviewedHead: pins.head, reviewedTree: pins.tree, derivativeRecipe: PHOTO_RECIPE, comparisonRecipe: IMAGE_COMPARISON_RECIPE, expiresAt: future });
    const before = await databaseSnapshot(isolated.pool);
    const args = ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3000", "--experimental-https", "--experimental-https-key", key, "--experimental-https-cert", certificate];
    child = spawn(process.execPath, args, { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let outputBytes = 0, processError = false, outputExceeded = false;
    const output = (chunk: Buffer) => { outputBytes += chunk.byteLength; if (outputBytes > 262_144) { outputExceeded = true; child?.kill("SIGTERM"); } };
    child.stdout!.on("data", output); child.stderr!.on("data", output);
    settled = new Promise<void>(resolve => { child!.once("error", () => { processError = true; resolve(); }); child!.once("close", () => resolve()); });
    let probe: WireResult | undefined; const until = Date.now() + 70_000;
    while (Date.now() < until && child.exitCode === null && !processError && !outputExceeded) {
      try { const result = await localGet(ca, "/api/synthetic-next-context"); if (result.status === 200) { probe = result; break; } } catch { /* Bounded wait for this owned TLS listener only. */ }
      await pause(200);
    }
    if (!probe) throw new Error("Synthetic real Next dev startup failed or exceeded its bounded deadline; raw child output withheld.");
    expect(JSON.parse(probe.text)).toEqual({ nodeOptions: `--max-old-space-size=${Math.floor(Math.floor(totalmem() / 1024 / 1024) * 0.5)} --enable-source-maps`, dev: true, worker: true, testBuild: null });
    const unsigned = await localGet(ca, endpoint); expect(unsigned.status).toBe(401); expect(unsigned.headers["set-cookie"]).toBeUndefined();
    const authenticated = await localGet(ca, endpoint, cookie);
    expect(authenticated.status).toBe(200); expect(authenticated.headers["set-cookie"]).toBeUndefined();
    expect(JSON.parse(authenticated.text)).toMatchObject({ state: { phase: "armed", revision: 0, canConsent: true, associated: false, budget: { exchange: false, identity: false, post: false, get: false, ceiling: 4 } } });
    expect(authenticated.text).not.toContain(user.id); expect(authenticated.text).not.toContain(login.session.id); expect(authenticated.text).not.toContain(seller);
    expect(await databaseSnapshot(isolated.pool)).toEqual(before);
    await expect(access(env.SYNTHETIC_NEXT_PROVIDER_MARKER!)).rejects.toMatchObject({ code: "ENOENT" });
    expect(git(root, ["status", "--porcelain", "--untracked-files=no"])).toBe("");
  } finally {
    await stopOwnedChild(child, settled);
    if (isolated) await isolated.close();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}, 110_000);
