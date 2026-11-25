// @vitest-environment node
import { createHash } from "node:crypto";
import type { LocalImageOperatorActivation } from "../infrastructure/repositories/drizzleLocalImageOperatorRepository";
import type { LocalOperatorActor } from "../application/localImageOperatorHttp";
import type { EbayConnection, ConnectedValues } from "../application/ebayConnection";
import { EBAY_DISCOVERY_SCOPES } from "../application/ebayConnection";
import { LocalOperatorError } from "../application/localImageOperator";
import { mediaSessionHash } from "../application/ebayRealMedia";
import { localImageOperatorApi, localImageOperatorCallback } from "../../scripts/local-image-operator-runtime";
import type { LocalOperatorRegistry } from "../application/localImageOperatorRegistry";

const mock = vi.hoisted(() => ({
  enabled: true, sourceValid: true, actor: null as LocalOperatorActor | null, row: null as LocalImageOperatorActivation | null,
  connection: null as EbayConnection | null, state: "s".repeat(43), consumed: false, retention: null as string | null,
  events: [] as string[], pool: { on: vi.fn(), end: vi.fn(async () => {}) },
  db: { execute: vi.fn(async () => ({ rows: [{ name: "local_image_operator_activations" }] })) },
  ordinaryDatabase: vi.fn(), openPool: vi.fn(), reader: vi.fn(), closeReader: vi.fn(async () => {}), source: vi.fn(), journal: vi.fn(async () => {}),
  constructClient: vi.fn(), exchange: vi.fn(), identity: vi.fn(), refresh: vi.fn(), cipher: vi.fn(),
  run: vi.fn(), fixture: vi.fn(), methods: {} as Record<string, ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>>,
  context: { id: "00000000-0000-4000-8000-000000000001", head: "a".repeat(40), tree: "b".repeat(40), root: "/synthetic-reviewed-root" },
}));
vi.mock("dotenv", () => { throw Error("Private configuration forbidden"); });
vi.mock("node:dns", () => { throw Error("DNS forbidden"); });
vi.mock("@vercel/blob", () => { throw Error("Blob forbidden"); });
vi.mock("../infrastructure/db/client", () => ({ getDatabase: () => { mock.ordinaryDatabase(); return mock.db; } }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => mock.db }));
vi.mock("../../scripts/local-session", () => ({ LOCAL_ORIGIN: "https://127.0.0.1:3000", localDatabase: () => new URL("postgresql://synthetic@127.0.0.1/synthetic_test"),
  openLocalDatabasePool: (...args: unknown[]) => { mock.openPool(...args); return mock.pool; },
  openLocalSessionReader: () => ({ sessionFromHeaders: mock.reader, close: mock.closeReader }),
}));
vi.mock("../../scripts/local-image-operator-source", () => ({
  localOperatorContext: () => mock.enabled ? mock.context : null,
  assertLocalOperatorSource: () => { mock.source(); if (!mock.sourceValid) throw new LocalOperatorError("context"); },
}));
vi.mock("../../scripts/image-verification-context", () => ({ assertVerificationJournal: mock.journal }));
vi.mock("../../scripts/image-verification-runtime", () => ({ runVerificationOperatorWithHeaders: mock.run }));
vi.mock("../../scripts/local-image-operator-fixture", () => ({ createLocalOperatorFixturePreparer: () => mock.fixture }));
vi.mock("../infrastructure/storage/photoDerivative/transformPhoto", () => ({ PHOTO_RECIPE: "synthetic-derivative-v1" }));
vi.mock("../infrastructure/storage/diagnosticImageDecode", () => ({ IMAGE_COMPARISON_RECIPE: "synthetic-comparison-v1" }));
vi.mock("../infrastructure/ebay/config", () => ({ ebayConfig: () => ({ clientId: "synthetic-app", clientSecret: "synthetic-secret", ruName: "synthetic-runame", origin: "https://127.0.0.1:3000", fingerprint: "c".repeat(64) }) }));
vi.mock("../infrastructure/ebay/ebayClient", () => ({ EbayClient: class {
  constructor() { mock.constructClient(); }
  exchange(...args: unknown[]) { return mock.exchange(...args); }
  identity(...args: unknown[]) { return mock.identity(...args); }
  refresh(...args: unknown[]) { return mock.refresh(...args); }
} }));
vi.mock("../infrastructure/ebay/tokenCipher", () => ({ EbayTokenCipher: class {
  constructor() { mock.cipher(); }
  encrypt() { return { ciphertext: "synthetic-encrypted", iv: "synthetic-iv", tag: "synthetic-tag", keyVersion: 1 }; }
  decrypt() { throw Error("Refresh/decrypt forbidden in composition test"); }
} }));
vi.mock("../infrastructure/repositories/drizzleLocalImageOperatorRepository", () => ({ DrizzleLocalImageOperatorRepository: class {
  activation(...args: unknown[]) { return mock.methods.activation(...args); }
  byStateHash(...args: unknown[]) { return mock.methods.byStateHash(...args); }
  fixtureRetentionUntil(...args: unknown[]) { return mock.methods.fixtureRetentionUntil(...args); }
  consentRepository(...args: unknown[]) { return mock.methods.consentRepository(...args); }
  consumeCallbackIntent(...args: unknown[]) { return mock.methods.consumeCallbackIntent(...args); }
  beginFixture(...args: unknown[]) { return mock.methods.beginFixture(...args); }
  pinFixtureContent(...args: unknown[]) { return mock.methods.pinFixtureContent(...args); }
  authorizeFixture(...args: unknown[]) { return mock.methods.authorizeFixture(...args); }
  finalizeFixture(...args: unknown[]) { return mock.methods.finalizeFixture(...args); }
  claimRun(...args: unknown[]) { return mock.methods.claimRun(...args); }
  requestCancel(...args: unknown[]) { return mock.methods.requestCancel(...args); }
  settle(...args: unknown[]) { return mock.methods.settle(...args); }
  stop(...args: unknown[]) { return mock.methods.stop(...args); }
  beginCleanup(...args: unknown[]) { return mock.methods.beginCleanup(...args); }
  recordCleanup(...args: unknown[]) { return mock.methods.recordCleanup(...args); }
} }));
const origin = "https://127.0.0.1:3000", api = origin + "/api/operator/ebay-image-verification";
const env: NodeJS.ProcessEnv = { NODE_ENV: "development", BETTER_AUTH_URL: origin, EBAY_ENVIRONMENT: "sandbox", EBAY_CREDENTIAL_ENCRYPTION_KEY: "synthetic-key", LOCAL_IMAGE_OPERATOR_ID: mock.context.id };
const registryKey = Symbol.for("marketplace.local-image-operator.work.v1");
const globals = globalThis as typeof globalThis & { [registryKey]?: LocalOperatorRegistry };
const registry = () => globals[registryKey]!;
const future = () => new Date(Date.now() + 3_600_000).toISOString();
const copy = () => ({ ...mock.row! });
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const request = (action?: string, revision = mock.row!.revision, headers: Record<string, string> = {}) => new Request(api, { method: action ? "POST" : "GET", headers: { host: "127.0.0.1:3000", cookie: "synthetic-cookie", ...(action ? { origin, "content-type": "application/json", "sec-fetch-site": "same-origin" } : {}), ...headers }, ...(action ? { body: JSON.stringify({ action, revision, confirmed: true }) } : {}) });
const callback = (query = `state=${mock.state}&code=synthetic-code`, path: "callback" | "declined" = "callback", init: RequestInit = {}) => new Request(`${origin}/api/integrations/ebay/${path}?${query}`, { headers: { host: "127.0.0.1:3000", cookie: "synthetic-cookie" }, ...init });
function change(values: Partial<LocalImageOperatorActivation>) { mock.row = { ...mock.row!, ...values, revision: mock.row!.revision + 1 }; return copy(); }
function ready() { Object.assign(mock.row!, { phase: "ready", revision: 7, sessionHash: mediaSessionHash(mock.actor!.ownerId, mock.actor!.id), consentStartedAt: new Date().toISOString(), exchangeIntentAt: new Date().toISOString(), identityIntentAt: new Date().toISOString(), connectedVersion: "connected-version", listingId: "listing-synthetic", imageId: "image-synthetic", listingVersion: new Date().toISOString(), sourceDigest: "f".repeat(64), derivativeDigest: "e".repeat(64) }); }
function pending() { Object.assign(mock.row!, { phase: "consent-pending", revision: 1, consentStartedAt: new Date().toISOString(), consentStateHash: sha(mock.state), consentVersion: "consent-version", sessionHash: mediaSessionHash(mock.actor!.ownerId, mock.actor!.id) }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function completion(kind: "fixture" | "run") { await registry().get(mock.context.id, kind)!.completion; }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn(() => { throw Error("External networking forbidden"); }));
  delete globals[registryKey]; mock.enabled = true; mock.sourceValid = true; mock.consumed = false; mock.retention = null; mock.events = [];
  mock.actor = { ownerId: "owner-synthetic", id: "session-synthetic", expiresAt: future() };
  mock.row = { id: mock.context.id, ownerId: mock.actor.ownerId, reviewedHead: mock.context.head, reviewedTree: mock.context.tree, configHash: "c".repeat(64), sellerKey: "d".repeat(64), connectionId: "connection-synthetic", initialConnectionVersion: "initial-version", derivativeRecipe: "synthetic-derivative-v1", comparisonRecipe: "synthetic-comparison-v1", phase: "armed", revision: 0,
    expiresAt: future(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), reviewDueAt: future(), dispositionDueAt: future(), sessionHash: null, consentStateHash: null, consentVersion: null, connectedVersion: null, consentStartedAt: null, exchangeIntentAt: null, identityIntentAt: null, fixtureStartedAt: null, listingId: null, imageId: null, listingVersion: null, sourceDigest: null, derivativeDigest: null, runStartedAt: null, runnerId: null, cancelRequestedAt: null, settledAt: null, stoppedAt: null, cleanupStartedAt: null, cleanupSessionHash: null, cleanupNotBefore: null };
  mock.connection = { ownerId: mock.actor.ownerId, environment: "sandbox", id: mock.row.connectionId, version: "consent-version", configHash: mock.row.configHash, status: "connected", sellerId: mock.row.sellerKey, sellerLabel: "Synthetic seller", access: { ciphertext: "old-encrypted", iv: "iv", tag: "tag", keyVersion: 1 }, refresh: { ciphertext: "old-refresh-encrypted", iv: "iv", tag: "tag", keyVersion: 1 }, accessExpiresAt: future(), refreshExpiresAt: future(), scopes: [...EBAY_DISCOVERY_SCOPES], connectedAt: new Date().toISOString(), leaseToken: null, leaseUntil: null };
  mock.reader.mockImplementation(async () => mock.actor); mock.exchange.mockImplementation(async () => { mock.events.push("exchange-call"); return { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresIn: 3600, refreshExpiresIn: 86400, scopes: [...EBAY_DISCOVERY_SCOPES] }; });
  mock.identity.mockImplementation(async () => { mock.events.push("identity-call"); return { sellerId: mock.row!.sellerKey, label: "Synthetic seller", source: "trading-get-user" }; }); mock.refresh.mockImplementation(async () => { throw Error("Refresh forbidden"); });
  mock.fixture.mockImplementation(async () => ({ imageId: "image-synthetic", listingVersion: new Date().toISOString() }));
  mock.run.mockImplementation(async () => ({ exitCode: 0, report: { associated: false, operationSettled: true } }));
  mock.methods = {
    activation: vi.fn(async (activation: string, owner: string) => mock.row?.id === activation && mock.row.ownerId === owner ? copy() : null),
    byStateHash: vi.fn(async (hash: string) => hash === mock.row?.consentStateHash ? copy() : null),
    fixtureRetentionUntil: vi.fn(async () => mock.retention),
    consentRepository: vi.fn((_id: string, _actor: LocalOperatorActor, revision: number) => ({
      connection: vi.fn(async () => mock.connection),
      begin: vi.fn(async (_owner: string, _session: string, _config: string, state: string, _at: string, _expires: string, scopes: readonly string[]) => {
        mock.events.push("consent-commit"); if (mock.row!.phase !== "armed" || mock.row!.revision !== revision) throw new LocalOperatorError("conflict");
        expect(scopes).toEqual(EBAY_DISCOVERY_SCOPES); change({ phase: "consent-pending", consentStartedAt: new Date().toISOString(), consentStateHash: state, consentVersion: "consent-version", sessionHash: mediaSessionHash(mock.actor!.ownerId, mock.actor!.id) });
      }),
      consume: vi.fn(async () => { mock.events.push("state-consume"); if (mock.consumed) throw new LocalOperatorError("conflict"); mock.consumed = true; return { ...mock.connection!, requestedScopes: [...EBAY_DISCOVERY_SCOPES] }; }),
      connect: vi.fn(async (_owner: string, _version: string, values: ConnectedValues) => { mock.events.push("credentials-connect"); mock.connection = { ...mock.connection!, ...values }; change({ phase: "connected", connectedVersion: "connected-version" }); }),
      invalidate: vi.fn(async () => { throw Error("Existing connected credentials must not be invalidated"); }),
    })),
    consumeCallbackIntent: vi.fn(async (_id: string, _actor: LocalOperatorActor, _state: string, kind: "exchange" | "identity") => {
      if (Date.parse(mock.row!.expiresAt) <= Date.now() || mock.row!.phase !== "consent-pending") throw new LocalOperatorError("expired");
      const field = kind === "exchange" ? "exchangeIntentAt" : "identityIntentAt";
      if (mock.row![field]) throw new LocalOperatorError("conflict"); mock.events.push(kind + "-commit"); return change({ [field]: new Date().toISOString() });
    }),
    beginFixture: vi.fn(async (_id: string, _actor: LocalOperatorActor, revision: number, listingId: string) => { if (mock.row!.phase !== "connected" || mock.row!.revision !== revision) throw new LocalOperatorError("conflict"); mock.events.push("fixture-commit"); return change({ phase: "fixture-preparing", fixtureStartedAt: new Date().toISOString(), listingId }); }),
    pinFixtureContent: vi.fn(async (_id: string, _actor: LocalOperatorActor, _rev: number, values: Partial<LocalImageOperatorActivation>) => change(values)),
    authorizeFixture: vi.fn(async () => copy()),
    finalizeFixture: vi.fn(async (_id: string, _actor: LocalOperatorActor, _revision: number, values: Partial<LocalImageOperatorActivation>) => change({ phase: "ready", ...values })),
    claimRun: vi.fn(async (_id: string, _actor: LocalOperatorActor, revision: number, runnerId: string) => { if (mock.row!.phase !== "ready" || mock.row!.revision !== revision) throw new LocalOperatorError("conflict"); mock.events.push("run-commit"); return change({ phase: "running", runStartedAt: new Date().toISOString(), runnerId }); }),
    requestCancel: vi.fn(async () => { mock.events.push("cancel-commit"); return change({ cancelRequestedAt: new Date().toISOString() }); }),
    settle: vi.fn(async () => { mock.events.push("settled-commit"); return change({ phase: "settled", settledAt: new Date().toISOString() }); }),
    stop: vi.fn(async () => { mock.events.push("stop-commit"); return change({ phase: "stopped", stoppedAt: new Date().toISOString() }); }),
    beginCleanup: vi.fn(async () => { if (!mock.retention || Date.parse(mock.retention) > Date.now()) throw new LocalOperatorError("context"); mock.events.push("cleanup-commit"); return change({ cleanupStartedAt: new Date().toISOString() }); }),
    recordCleanup: vi.fn(async (_id: string, _owner: string, at: string) => change({ phase: "cleanup-queued", cleanupNotBefore: at })),
  } as unknown as typeof mock.methods;
});
afterEach(async () => {
  for (const kind of ["run", "fixture"] as const) { const work = globals[registryKey]?.get(mock.context.id, kind); if (work && !work.settled) { work.controller.abort(); await work.completion; } }
  expect(mock.refresh).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); delete globals[registryKey];
});

it("stays disabled without constructing auth, SQL or provider clients", async () => {
  mock.enabled = false; expect((await localImageOperatorApi(request(), env)).status).toBe(404);
  expect(mock.reader).not.toHaveBeenCalled(); expect(mock.openPool).not.toHaveBeenCalled(); expect(mock.constructClient).not.toHaveBeenCalled(); expect(mock.cipher).not.toHaveBeenCalled();
});
it("reads authenticated status only and does not disclose private context", async () => {
  const response = await localImageOperatorApi(request(), env); expect(response.status).toBe(200);
  const text = await response.text(); expect(JSON.parse(text).state).toMatchObject({ phase: "armed", canConsent: true, associated: false });
  expect(text).not.toMatch(/owner-synthetic|session-synthetic|sellerKey|ciphertext|synthetic-cookie|connection-synthetic/);
  expect(mock.methods.activation).toHaveBeenCalledWith(mock.context.id, mock.actor!.ownerId);
  expect(mock.reader).toHaveBeenCalledOnce(); expect(mock.closeReader).toHaveBeenCalledOnce(); expect(mock.journal).toHaveBeenCalledWith(mock.db, "synthetic_test", mock.context.root);
  expect(mock.methods.consentRepository).not.toHaveBeenCalled(); expect(mock.constructClient).not.toHaveBeenCalled(); expect(mock.cipher).not.toHaveBeenCalled();
});
it.each(["foreign-origin", "forwarded-host", "fetch-site", "content-type"])("rejects %s before authentication or mutation", async kind => {
  const headers: Record<string, string> = kind === "foreign-origin" ? { origin: "https://foreign.invalid" } : kind === "forwarded-host" ? { "x-forwarded-host": "foreign.invalid" } : kind === "fetch-site" ? { "sec-fetch-site": "cross-site" } : { "content-type": "text/plain" };
  expect((await localImageOperatorApi(request("consent", 0, headers), env)).status).toBe(403); expect(mock.reader).not.toHaveBeenCalled(); expect(mock.openPool).not.toHaveBeenCalled(); expect(mock.constructClient).not.toHaveBeenCalled();
});
it("rejects unauthenticated and foreign-owner status without constructing a provider", async () => {
  const actor = mock.actor!; mock.actor = null; expect((await localImageOperatorApi(request(), env)).status).toBe(401);
  mock.actor = { ...actor, ownerId: "other-owner" }; expect((await localImageOperatorApi(request(), env)).status).toBe(409); expect(mock.constructClient).not.toHaveBeenCalled();
});
it("uses normal consent generation with exact reviewed scopes and one durable begin", async () => {
  const response = await localImageOperatorApi(request("consent"), env); expect(response.status).toBe(200);
  const result = await response.json(), url = new URL(result.authorizationUrl);
  expect(url.origin + url.pathname).toBe("https://auth.sandbox.ebay.com/oauth2/authorize"); expect(url.searchParams.get("scope")).toBe(EBAY_DISCOVERY_SCOPES.join(" ")); expect(url.searchParams.get("redirect_uri")).toBe("synthetic-runame");
  expect(result.state).toMatchObject({ phase: "consent-pending", budget: { exchange: false, identity: false } });
  expect(mock.constructClient).not.toHaveBeenCalled(); expect(mock.exchange).not.toHaveBeenCalled(); expect(mock.identity).not.toHaveBeenCalled();
  expect((await localImageOperatorApi(request("consent", 0), env)).status).toBe(409); expect(mock.events).toEqual(["consent-commit"]);
});
it("commits fixture allowance before asynchronous preparation and refuses a second start", async () => {
  mock.row!.phase = "connected"; const waiting = deferred<{ imageId: string; listingVersion: string }>();
  mock.fixture.mockImplementation(async () => { mock.events.push("fixture-storage"); return waiting.promise; });
  const response = await localImageOperatorApi(request("prepare-fixture"), env); expect(response.status).toBe(200);
  await vi.waitFor(() => expect(mock.fixture).toHaveBeenCalledOnce()); expect(mock.events.slice(0, 2)).toEqual(["fixture-commit", "fixture-storage"]);
  expect((await localImageOperatorApi(request("prepare-fixture", mock.row!.revision), env)).status).toBe(409);
  waiting.resolve({ imageId: "image-synthetic", listingVersion: new Date().toISOString() }); await completion("fixture");
  expect(mock.methods.finalizeFixture).toHaveBeenCalledOnce(); expect(mock.run).not.toHaveBeenCalled();
});
it("commits one run before async work and does not mark cancellation settled early", async () => {
  ready(); const waiting = deferred<{ exitCode: number; report: { operationSettled: boolean; associated: false } }>(); let signal!: AbortSignal;
  mock.run.mockImplementation(async (...args: unknown[]) => { signal = args[3] as AbortSignal; mock.events.push("run-start"); return waiting.promise; });
  expect((await localImageOperatorApi(request("run"), env)).status).toBe(200); await vi.waitFor(() => expect(mock.run).toHaveBeenCalledOnce());
  expect(mock.events.slice(0, 2)).toEqual(["run-commit", "run-start"]); expect(mock.run.mock.calls[0][2]).toBeInstanceOf(Headers); expect(mock.run.mock.calls[0][5]).toBe(mock.context.root);
  expect((await localImageOperatorApi(request("run", mock.row!.revision), env)).status).toBe(409);
  expect((await localImageOperatorApi(request("cancel"), env)).status).toBe(200); expect(signal.aborted).toBe(true); expect(mock.methods.settle).not.toHaveBeenCalled(); expect(registry().get(mock.context.id, "run")!.settled).toBe(false);
  waiting.resolve({ exitCode: 1, report: { operationSettled: true, associated: false } }); await completion("run");
  expect(mock.methods.settle).toHaveBeenCalledOnce(); expect(mock.events.indexOf("cancel-commit")).toBeLessThan(mock.events.indexOf("settled-commit"));
  expect((mock.run.mock.calls[0][2] as Headers).has("cookie")).toBe(false);
});
it("treats durable started work with missing registry as unknown without restarting", async () => {
  ready(); mock.row!.phase = "running"; mock.row!.runStartedAt = new Date().toISOString(); mock.row!.runnerId = "old-runner";
  const response = await localImageOperatorApi(request(), env); expect((await response.json()).state).toMatchObject({ phase: "unknown", canRun: false, canCancel: false, budget: { post: null, get: null } }); expect(mock.run).not.toHaveBeenCalled();
  expect((await localImageOperatorApi(request("run"), env)).status).toBe(409); expect(mock.run).not.toHaveBeenCalled();
});
it("uses persisted retention for cleanup presentation and guards local cleanup composition", async () => {
  ready(); mock.row!.phase = "settled"; mock.row!.settledAt = new Date().toISOString(); mock.retention = future();
  expect((await (await localImageOperatorApi(request(), env)).json()).state.canCleanup).toBe(false);
  expect((await localImageOperatorApi(request("cleanup"), env)).status).toBe(409); expect(mock.run).not.toHaveBeenCalled();
  mock.retention = new Date(Date.now() - 1000).toISOString(); const at = future();
  mock.run.mockResolvedValue({ exitCode: 0, report: { cleanup: { status: "queued", notBefore: at } } });
  const response = await localImageOperatorApi(request("cleanup"), env); expect((await response.json()).state).toMatchObject({ phase: "cleanup-queued", cleanupNotBefore: at });
  expect(mock.run.mock.calls[0][0]).toMatchObject({ mode: "cleanup-fixture" }); expect(mock.methods.recordCleanup).toHaveBeenCalledWith(mock.context.id, mock.actor!.ownerId, at); expect(mock.exchange).not.toHaveBeenCalled();
});
it.each(["HEAD", "host", "forwarded", "duplicate"])("rejects callback %s before SQL, state or exchange", async kind => {
  pending(); const request = kind === "HEAD" ? callback(undefined, "callback", { method: "HEAD" }) : kind === "host" ? new Request(`https://foreign.invalid/api/integrations/ebay/callback?state=${mock.state}`, { headers: { host: "foreign.invalid" } }) : kind === "forwarded" ? callback(undefined, "callback", { headers: { host: "127.0.0.1:3000", "x-forwarded-proto": "http" } }) : callback(`state=${mock.state}&state=${mock.state}`);
  const response = await localImageOperatorCallback(request, "callback", env); expect(response!.status).toBe(kind === "HEAD" ? 405 : 400);
  expect(mock.openPool).not.toHaveBeenCalled(); expect(mock.reader).not.toHaveBeenCalled(); expect(mock.methods.stop).not.toHaveBeenCalled(); expect(mock.exchange).not.toHaveBeenCalled();
});
it.each(["expired", "launcher-lost", "source-changed"])("never falls back from recognized %s operator state or spends another slot", async kind => {
  pending(); if (kind === "expired") mock.row!.expiresAt = new Date(Date.now() - 1).toISOString(); if (kind === "launcher-lost") mock.enabled = false; if (kind === "source-changed") mock.sourceValid = false;
  const response = await localImageOperatorCallback(callback(), "callback", env); expect(response).not.toBeNull(); expect(response!.status).toBe(kind === "expired" ? 303 : 409); expect(mock.exchange).not.toHaveBeenCalled(); expect(mock.identity).not.toHaveBeenCalled(); expect(mock.connection!.access!.ciphertext).toBe("old-encrypted");
});
it("commits exchange/identity allowances before calls and connects only after verified completion", async () => {
  pending(); const response = await localImageOperatorCallback(callback(), "callback", env); expect(response!.status).toBe(303); expect(response!.headers.get("location")).toBe(origin + "/operator/ebay-image-verification");
  expect(mock.events).toEqual(["state-consume", "exchange-commit", "exchange-call", "identity-commit", "identity-call", "credentials-connect"]); expect(mock.exchange).toHaveBeenCalledOnce(); expect(mock.identity).toHaveBeenCalledOnce(); expect(mock.row!.phase).toBe("connected");
  const replay = await localImageOperatorCallback(callback(), "callback", env); expect(replay).not.toBeNull(); expect(mock.exchange).toHaveBeenCalledOnce(); expect(mock.identity).toHaveBeenCalledOnce();
});
it.each(["exchange", "identity", "wrong-seller"])("stops %s failure while preserving existing encrypted credentials", async kind => {
  pending(); const before = { ...mock.connection! };
  if (kind === "exchange") mock.exchange.mockRejectedValue(new Error("synthetic failure"));
  if (kind === "identity") mock.identity.mockRejectedValue(new Error("synthetic failure"));
  if (kind === "wrong-seller") mock.identity.mockResolvedValue({ sellerId: "e".repeat(64), label: "Synthetic other seller", source: "trading-get-user" });
  const response = await localImageOperatorCallback(callback(), "callback", env); expect(response!.status).toBe(303); expect(mock.methods.stop).toHaveBeenCalledOnce(); expect(mock.connection).toEqual(before); expect(mock.events).not.toContain("credentials-connect"); expect(mock.row!.phase).toBe("stopped");
});
it("handles stateful and missing-state cancellation without exchange or credentials", async () => {
  pending(); const before = { ...mock.connection! }; expect((await localImageOperatorCallback(callback(`state=${mock.state}`, "declined"), "declined", env))!.status).toBe(303); expect(mock.consumed).toBe(true); expect(mock.exchange).not.toHaveBeenCalled(); expect(mock.identity).not.toHaveBeenCalled(); expect(mock.connection).toEqual(before);
  pending(); expect((await localImageOperatorCallback(callback("", "declined"), "declined", env))!.status).toBe(303); expect(mock.connection).toEqual(before); expect(mock.constructClient).toHaveBeenCalledOnce();
});

it("preserves an inactive ordinary callback with supported hosted database/query configuration", async () => {
  mock.enabled = false; pending(); mock.row!.consentStateHash = sha("different-state");
  const hosted = { ...env, LOCAL_IMAGE_OPERATOR_ID: undefined, DATABASE_URL: "postgresql://synthetic:synthetic@database.synthetic.invalid/app?sslmode=require" };
  const response = await localImageOperatorCallback(callback(), "callback", hosted);
  expect(response).toBeNull(); expect(mock.ordinaryDatabase).toHaveBeenCalledOnce(); expect(mock.openPool).not.toHaveBeenCalled();
  expect(mock.db.execute).toHaveBeenCalledOnce(); expect(mock.methods.byStateHash).toHaveBeenCalledWith(sha(mock.state));
  expect(mock.methods.stop).not.toHaveBeenCalled(); expect(mock.methods.consumeCallbackIntent).not.toHaveBeenCalled();
  expect(mock.reader).not.toHaveBeenCalled(); expect(mock.constructClient).not.toHaveBeenCalled(); expect(mock.exchange).not.toHaveBeenCalled();
});
it("refuses a recognized inactive operator callback using the ordinary hosted database probe without exchange", async () => {
  mock.enabled = false; pending(); const before = copy();
  const hosted = { ...env, LOCAL_IMAGE_OPERATOR_ID: undefined, DATABASE_URL: "postgresql://synthetic:synthetic@database.synthetic.invalid/app?sslmode=require" };
  const response = await localImageOperatorCallback(callback(), "callback", hosted);
  expect(response!.status).toBe(409); expect(mock.ordinaryDatabase).toHaveBeenCalledOnce(); expect(mock.openPool).not.toHaveBeenCalled();
  expect(mock.methods.byStateHash).toHaveBeenCalledWith(sha(mock.state)); expect(mock.row).toEqual(before);
  expect(mock.methods.stop).not.toHaveBeenCalled(); expect(mock.methods.consumeCallbackIntent).not.toHaveBeenCalled();
  expect(mock.reader).not.toHaveBeenCalled(); expect(mock.constructClient).not.toHaveBeenCalled(); expect(mock.exchange).not.toHaveBeenCalled();
});
