import { randomBytes, randomUUID, createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import { DrizzleEbayConnectionRepository } from "./drizzleEbayConnectionRepository";
import { createEbayConnectionService } from "../../application/ebayConnectionService";
import { EBAY_SCOPES, EbayError, type EbayGateway, type EbayTokens } from "../../application/ebayConnection";
import { EbayTokenCipher } from "../ebay/tokenCipher";
import { testDatabaseUrl } from "../../test/testDatabase";
const pool=new Pool({connectionString:testDatabaseUrl()}), db=drizzle(pool,{schema}), repo=new DrizzleEbayConnectionRepository(db);
const cipher=new EbayTokenCipher(randomBytes(32).toString("hex"));
const config={clientId:"fake-client",clientSecret:"fake-secret",ruName:"fake-runame",origin:"https://127.0.0.1:3000",fingerprint:"test-config"};
let owner:string, other:string, session:string, now:Date;
const transactionContext = new AsyncLocalStorage<boolean>();
const seller=(name:string)=>({sellerId:createHash("sha256").update(name).digest("hex"),label:name,source:"trading-get-user" as const});
const issued=(label="seller-a"):EbayTokens=>({accessToken:`fake-access-${label}`,expiresIn:120,refreshToken:`fake-refresh-${label}`,refreshExpiresIn:6000});
const gateway={
  exchange:vi.fn(async()=>{expect(transactionContext.getStore()).not.toBe(true);return issued();}),
  refresh:vi.fn(async()=>{expect(transactionContext.getStore()).not.toBe(true);return issued();}),
  identity:vi.fn(async()=>{expect(transactionContext.getStore()).not.toBe(true);return seller("seller-a");}),
} satisfies EbayGateway;
const service=()=>createEbayConnectionService(repo,gateway,cipher,config,()=>now);
const state=async(user=owner,sid=session)=>new URL(await service().begin(user,sid)).searchParams.get("state")!;
const connect=async()=>{const s=await state();await service().complete(owner,session,s,"fake-code");return s;};
beforeAll(async()=>{await migrate(db,{migrationsFolder:"drizzle"});});
beforeEach(async()=>{
  vi.restoreAllMocks();vi.clearAllMocks();owner=randomUUID();other=randomUUID();session=randomUUID();now=new Date();
  gateway.exchange.mockImplementation(async()=>{expect(transactionContext.getStore()).not.toBe(true);return issued();});
  gateway.refresh.mockImplementation(async()=>{expect(transactionContext.getStore()).not.toBe(true);return issued();});
  gateway.identity.mockImplementation(async()=>{expect(transactionContext.getStore()).not.toBe(true);return seller("seller-a");});
  const original=db.transaction.bind(db);vi.spyOn(db,"transaction").mockImplementation((...args)=>transactionContext.run(true,()=>original(...args)));
  await db.insert(schema.users).values([owner,other].map(id=>({id,name:"eBay test",email:`${id}@example.test`})));
});
afterEach(async()=>{vi.restoreAllMocks();await db.delete(schema.users).where(inArray(schema.users.id,[owner,other]));});
afterAll(()=>pool.end());
it("migrates existing tables safely and constrains connection rows to Sandbox",async()=>{
  expect(await repo.connection(owner)).toBeNull();await state();const row=(await repo.connection(owner))!;
  expect(row).toMatchObject({environment:"sandbox",status:"disconnected",access:null,refresh:null});
  await expect(db.update(schema.ebayConnections).set({environment:"production"}).where(eq(schema.ebayConnections.ownerId,owner))).rejects.toThrow();
});
it("creates random state bound to exact RuName, owner, session and config without storing raw state",async()=>{
  const s=await state(), rows=await db.select().from(schema.ebayOauthStates).where(eq(schema.ebayOauthStates.ownerId,owner));
  expect(s).toHaveLength(43);expect(rows[0].hash).not.toBe(s);expect(rows[0].sessionHash).not.toBe(session);
  const url=new URL(await service().begin(owner,session));expect(url.origin).toBe("https://auth.sandbox.ebay.com");expect(url.searchParams.get("redirect_uri")).toBe(config.ruName);expect(url.searchParams.get("scope")).toBe(EBAY_SCOPES[0]);expect(url.searchParams.get("state")).not.toBe(s);
});
it("rejects replay with atomic consumption, including simultaneous callbacks",async()=>{
  const s=await state();const results=await Promise.allSettled([service().complete(owner,session,s,"code"),service().complete(owner,session,s,"code")]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(gateway.exchange).toHaveBeenCalledTimes(1);
});
it("rejects unknown, expired, foreign-session and foreign-owner state before provider calls",async()=>{
  const s=await state();
  for(const [user,sid,value]of[[owner,"wrong-session",s],[other,session,s],[owner,session,"x".repeat(43)]])await expect(service().complete(user,sid,value,"code")).rejects.toThrow();
  now=new Date(now.getTime()+601000);await expect(service().complete(owner,session,s,"code")).rejects.toThrow();expect(gateway.exchange).not.toHaveBeenCalled();
});
it("rejects a changed client/RuName config fingerprint without exchanging code",async()=>{
  const s=await state();const changed=createEbayConnectionService(repo,gateway,cipher,{...config,fingerprint:"changed"},()=>now);
  await expect(changed.complete(owner,session,s,"code")).rejects.toThrow();expect(gateway.exchange).not.toHaveBeenCalled();
});
it("consumes a denied authorization without credentials and prevents later replay",async()=>{
  const s=await state();expect(await service().complete(owner,session,s,null,true)).toBe("denied");
  await expect(service().complete(owner,session,s,"code")).rejects.toThrow();expect(gateway.exchange).not.toHaveBeenCalled();expect((await repo.connection(owner))?.access).toBeNull();
});
it("persists independent encrypted tokens and safe metadata only",async()=>{
  await connect();const row=(await repo.connection(owner))!, status=await service().status(owner);
  expect(row.access!.iv).not.toBe(row.refresh!.iv);expect(JSON.stringify(row)).not.toMatch(/fake-access|fake-refresh/);
  expect(status.state).toBe("connected");expect(JSON.stringify(status)).not.toMatch(/ciphertext|fake-access|fake-refresh|sellerId|leaseToken/);
});
it("rejects missing or excessive granted scopes and partial token responses",async()=>{
  for(const response of [{...issued(),scopes:[]},{...issued(),scopes:[...EBAY_SCOPES,"unrelated"]},{...issued(),refreshToken:undefined}]){
    gateway.exchange.mockResolvedValueOnce(response);await expect(service().complete(owner,session,await state(),"code")).rejects.toThrow();expect((await repo.connection(owner))?.status).toBe("disconnected");
  }
});
it("keeps invalid authorization codes from persisting an active connection",async()=>{
  gateway.exchange.mockRejectedValueOnce(new EbayError("auth"));const s=await state();await expect(service().complete(owner,session,s,"expired-code")).rejects.toThrow();expect((await repo.connection(owner))?.access).toBeNull();
});
it("fails closed on unverified/mocked identity without storing partial active credentials",async()=>{
  gateway.identity.mockRejectedValueOnce(new EbayError("identity"));await expect(connect()).rejects.toThrow();expect((await service().status(owner)).state).toBe("identity-unverified");expect((await repo.connection(owner))?.refresh).toBeNull();
});
it("keeps two owners isolated and refuses duplicate seller binding across owners",async()=>{
  await connect();const s=await state(other,"other-session");await expect(service().complete(other,"other-session",s,"code")).rejects.toThrow();
  gateway.identity.mockResolvedValueOnce(seller("seller-b"));await service().complete(other,"other-session",await state(other,"other-session"),"code");
  expect((await service().status(other)).sellerLabel).toBe("seller-b");await service().disconnect(other);expect((await service().status(owner)).state).toBe("connected");
});
it("requires explicit disconnect before switching an existing seller identity",async()=>{
  await connect();gateway.identity.mockResolvedValueOnce(seller("seller-b"));await expect(service().complete(owner,session,await state(),"code")).rejects.toThrow();expect((await repo.connection(owner))?.sellerId).toBe(seller("seller-a").sellerId);
  await service().disconnect(owner);gateway.identity.mockResolvedValueOnce(seller("seller-b"));await service().complete(owner,session,await state(),"code");expect((await service().status(owner)).sellerLabel).toBe("seller-b");
});
it("disconnect fences a callback already exchanging its authorization code",async()=>{
  const s=await state();gateway.exchange.mockImplementationOnce(async()=>{await service().disconnect(owner);return issued();});
  await expect(service().complete(owner,session,s,"code")).rejects.toThrow();expect((await service().status(owner)).state).toBe("not-connected");
});
it("new authorization supersedes old pending state without allowing stale callback commits",async()=>{
  const old=await state();await state();await expect(service().complete(owner,session,old,"code")).rejects.toThrow();expect(gateway.exchange).not.toHaveBeenCalled();
});
it("does not contact providers on status renders or when a cached access token is usable",async()=>{
  await connect();vi.clearAllMocks();expect(await service().accessToken(owner)).toBe("fake-access-seller-a");await service().status(owner);expect(gateway.refresh).not.toHaveBeenCalled();expect(gateway.identity).not.toHaveBeenCalled();
});
it("refreshes expired access and safely rotates tokens without wrapping network I/O in a transaction",async()=>{
  await connect();const old=(await repo.connection(owner))!;now=new Date(now.getTime()+121000);gateway.refresh.mockResolvedValueOnce({...issued(),accessToken:"new-access",refreshToken:"rotated-refresh"});
  expect(await service().accessToken(owner)).toBe("new-access");const row=(await repo.connection(owner))!;expect(row.version).not.toBe(old.version);expect(row.refresh).not.toEqual(old.refresh);expect(row.leaseToken).toBeNull();
});
it("preserves old refresh token and its original expiry when no replacement is returned",async()=>{
  await connect();const old=(await repo.connection(owner))!;now=new Date(now.getTime()+121000);gateway.refresh.mockResolvedValueOnce({accessToken:"new-access",expiresIn:120});await service().accessToken(owner);
  const row=(await repo.connection(owner))!;expect(row.refresh).toEqual(old.refresh);expect(row.refreshExpiresAt).toBe(old.refreshExpiresAt);
});
it("only one concurrent refresh may hold the lease",async()=>{
  await connect();now=new Date(now.getTime()+121000);let release!:()=>void, entered!:()=>void;
  const started=new Promise<void>(r=>entered=r), gate=new Promise<void>(r=>release=r);
  gateway.refresh.mockImplementationOnce(async()=>{entered();await gate;return issued();});const first=service().accessToken(owner);await started;
  await expect(service().accessToken(owner)).rejects.toThrow("another operation");release();await first;expect(gateway.refresh).toHaveBeenCalledTimes(1);
});
it("an in-flight refresh cannot resurrect disconnected credentials",async()=>{
  await connect();now=new Date(now.getTime()+121000);gateway.refresh.mockImplementationOnce(async()=>{await service().disconnect(owner);return issued();});
  await expect(service().accessToken(owner)).rejects.toThrow();expect((await repo.connection(owner))?.access).toBeNull();expect((await service().status(owner)).state).toBe("not-connected");
});
it("a stale refresh cannot overwrite a newer reconnect",async()=>{
  await connect();now=new Date(now.getTime()+121000);gateway.refresh.mockImplementationOnce(async()=>{await service().complete(owner,session,await state(),"new-code");return {...issued(),accessToken:"stale"};});
  await expect(service().accessToken(owner)).rejects.toThrow();expect(await service().accessToken(owner)).toBe("fake-access-seller-a");
});
it.each(["auth","unavailable"] as const)("requires reconnect after %s refresh failure without retrying",async code=>{
  await connect();now=new Date(now.getTime()+121000);gateway.refresh.mockRejectedValueOnce(new EbayError(code));await expect(service().accessToken(owner)).rejects.toThrow();expect((await service().status(owner)).state).toBe("reconnect");expect((await repo.connection(owner))?.refresh).toBeNull();expect(gateway.refresh).toHaveBeenCalledTimes(1);
});
it("expired refresh tokens never go to the provider",async()=>{
  await connect();now=new Date(now.getTime()+6001000);await expect(service().accessToken(owner)).rejects.toThrow();expect(gateway.refresh).not.toHaveBeenCalled();expect((await service().status(owner)).state).toBe("reconnect");
});
it("identity mismatch during refresh invalidates the connection",async()=>{
  await connect();now=new Date(now.getTime()+121000);gateway.identity.mockResolvedValueOnce(seller("seller-b"));await expect(service().accessToken(owner)).rejects.toThrow();expect((await service().status(owner)).state).toBe("identity-unverified");
});
it("tampered ciphertext fails before provider use and does not return credentials",async()=>{
  await connect();const row=(await repo.connection(owner))!;await db.update(schema.ebayConnections).set({access:{...row.access!,tag:"00".repeat(16)}}).where(eq(schema.ebayConnections.ownerId,owner));
  await expect(service().accessToken(owner)).rejects.toThrow();expect(gateway.refresh).not.toHaveBeenCalled();
  expect((await service().status(owner)).state).toBe("reconnect");
  expect((await repo.connection(owner))?.access).toBeNull();
});
it("does not extend token expiry by time spent exchanging and verifying identity", async () => {
  const before = now.getTime();
  gateway.exchange.mockImplementationOnce(async () => {
    now = new Date(now.getTime() + 10000);
    return issued();
  });
  gateway.identity.mockImplementationOnce(async () => {
    now = new Date(now.getTime() + 10000);
    return seller("seller-a");
  });
  await connect();
  expect((await repo.connection(owner))?.accessExpiresAt).toBe(new Date(before + 120000).toISOString());
});
it("does not refresh if the durable lease claim fails", async () => {
  await connect();
  now = new Date(now.getTime() + 121000);
  vi.spyOn(repo, "claim").mockRejectedValueOnce(new Error("Synthetic database failure"));
  await expect(service().accessToken(owner)).rejects.toThrow();
  expect(gateway.refresh).not.toHaveBeenCalled();
});
it("a stale expired refresh lease cannot invalidate its replacement", async () => {
  await connect();
  now = new Date(now.getTime() + 121000);
  let releaseFirst!: () => void, releaseSecond!: () => void;
  let firstEntered!: () => void, secondEntered!: () => void;
  const firstStarted = new Promise<void>(resolve => firstEntered = resolve);
  const secondStarted = new Promise<void>(resolve => secondEntered = resolve);
  const firstGate = new Promise<void>(resolve => releaseFirst = resolve);
  const secondGate = new Promise<void>(resolve => releaseSecond = resolve);
  gateway.refresh.mockImplementationOnce(async () => {
    firstEntered(); await firstGate; return issued();
  }).mockImplementationOnce(async () => {
    secondEntered(); await secondGate; return { ...issued(), accessToken: "replacement-access" };
  });
  const first = service().accessToken(owner);
  // Attach rejection handling before releasing either network operation.
  const firstResult = expect(first).rejects.toThrow();
  await firstStarted;
  now = new Date(now.getTime() + 91000);
  const second = service().accessToken(owner);
  await secondStarted;
  releaseFirst(); await firstResult;
  expect((await repo.connection(owner))?.leaseToken).not.toBeNull();
  releaseSecond();
  expect(await second).toBe("replacement-access");
  expect((await service().status(owner)).state).toBe("connected");
});
