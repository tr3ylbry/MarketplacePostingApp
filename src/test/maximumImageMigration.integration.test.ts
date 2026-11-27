import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableVerificationDatabase } from "./disposableVerificationDatabase";
import { listingFixture } from "./fixtures";
import { EBAY_DISCOVERY_SCOPES } from "../application/ebayConnection";
import { IMAGE_VERIFICATION_POLICY, MAXIMUM_IMAGE_VERIFICATION_POLICY } from "../application/ebayImageVerificationPersistence";
import { mediaSessionHash, realMediaDigest } from "../application/ebayRealMedia";
import { DrizzleListingRepository } from "../infrastructure/repositories/drizzleListingRepository";
import { DrizzleEbayRealMediaRepository } from "../infrastructure/repositories/drizzleEbayRealMediaRepository";
import { DrizzleEbayImageVerificationRepository } from "../infrastructure/repositories/drizzleEbayImageVerificationRepository";
import * as schema from "../infrastructure/db/schema";

vi.mock("dotenv", () => { throw Error("Private environment forbidden."); });
vi.mock("@vercel/blob", () => { throw Error("Provider construction forbidden."); });

it("upgrades populated primary history from 0013 without rewriting it, then repeats all 15 migrations safely", async () => {
  const folder=await mkdtemp(join(tmpdir(),"marketplace-maximum-migration-"));
  let isolated: Awaited<ReturnType<typeof disposableVerificationDatabase>> | undefined;
  try {
    const journal=JSON.parse(await readFile("drizzle/meta/_journal.json","utf8"));
    expect(journal.entries).toHaveLength(15);
    const old={...journal,entries:journal.entries.slice(0,14)};
    await mkdir(join(folder,"meta")); await writeFile(join(folder,"meta/_journal.json"),JSON.stringify(old));
    for(const entry of old.entries) await copyFile("drizzle/"+entry.tag+".sql",join(folder,entry.tag+".sql"));
    isolated=await disposableVerificationDatabase(folder); const {db,pool}=isolated;
    const owner=randomUUID(),session=randomUUID(),image=randomUUID(),config=realMediaDigest("synthetic-config");
    await db.insert(schema.users).values({id:owner,name:"Synthetic",email:owner+"@example.invalid"});
    await db.insert(schema.sessions).values({id:session,userId:owner,token:randomUUID(),expiresAt:new Date(Date.now()+3_600_000)});
    await db.insert(schema.ebayConnections).values({ownerId:owner,id:randomUUID(),version:randomUUID(),configHash:config,status:"connected",sellerId:realMediaDigest(owner),sellerLabel:"Synthetic",
      scopes:[...EBAY_DISCOVERY_SCOPES],access:{ciphertext:"synthetic",iv:"synthetic",tag:"synthetic",keyVersion:1},refresh:{ciphertext:"synthetic",iv:"synthetic",tag:"synthetic",keyVersion:1},
      connectedAt:sql`clock_timestamp()`,accessExpiresAt:sql`clock_timestamp()+interval '1 hour'`,refreshExpiresAt:sql`clock_timestamp()+interval '1 day'`});
    const listing=await new DrizzleListingRepository(db).create(owner,listingFixture());
    await db.insert(schema.listingImages).values({id:image,listingId:listing.id,storageProvider:"vercel-blob",pathname:"synthetic-owned/"+image,originalFilename:"synthetic.png",contentType:"image/png",byteSize:17,order:0,uploadedAt:sql`clock_timestamp()`});
    const media=new DrizzleEbayRealMediaRepository(db), verification=new DrizzleEbayImageVerificationRepository(db);
    const binding=await media.snapshot(owner,listing.id,image),guard={binding,sessionId:session,leaseDeadline:new Date(Date.now()+30_000).toISOString()};
    const parent=await media.claim({ownerId:owner,listingId:listing.id,imageId:image,listingVersion:binding.listingVersion,configHash:config,recipe:"synthetic-v1",operation:"capture-only",
      actionHash:realMediaDigest(randomUUID()),sessionHash:mediaSessionHash(owner,session)},guard);
    const reserved=await verification.reserveVerification({parent,guard,actionHash:realMediaDigest(randomUUID()),sourceDigest:realMediaDigest("source"),derivativeDigest:realMediaDigest("derivative"),reviewUntil:new Date(Date.now()+20_000).toISOString(),policy:IMAGE_VERIFICATION_POLICY});
    const snapshot=async()=> (await pool.query("SELECT row_to_json(v)::text AS value FROM ebay_image_verifications v WHERE id=$1",[reserved.id])).rows[0].value;
    const before=await snapshot();
    const priorJournal=(await pool.query("SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows;
    expect(priorJournal).toHaveLength(14);
    await migrate(db,{migrationsFolder:"drizzle"});
    const after=(await pool.query("SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows;
    expect(after.slice(0,14)).toEqual(priorJournal); expect(after).toHaveLength(15);
    const committed=readMigrationFiles({migrationsFolder:"drizzle"});
    expect(after.map(x=>({hash:x.hash,when:Number(x.created_at)}))).toEqual(committed.map(x=>({hash:x.hash,when:x.folderMillis})));
    expect(await snapshot()).toBe(before);
    await migrate(db,{migrationsFolder:"drizzle"}); expect(await snapshot()).toBe(before);
    expect(await verification.status(owner,reserved.id)).toMatchObject({phase:"prepared",hasOutcome:false,detached:false,associated:false});
    await expect(verification.reserveVerification({parent,guard,actionHash:realMediaDigest(randomUUID()),sourceDigest:realMediaDigest("source"),derivativeDigest:realMediaDigest("derivative"),reviewUntil:new Date(Date.now()+20_000).toISOString(),policy:MAXIMUM_IMAGE_VERIFICATION_POLICY})).rejects.toThrow();
    await verification.closePrepared(reserved,"cancelled");
    expect(await verification.status(owner,reserved.id)).toMatchObject({phase:"closed",associated:false});
  } finally { if(isolated) await isolated.close(); await rm(folder,{recursive:true,force:true}); }
},30_000);
