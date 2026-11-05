import { test, expect } from "@playwright/test";
import { createTestAuth } from "../src/test/auth";
const {pool,auth}=createTestAuth();
test.use({trace:"off"});
let owner:string;
test.beforeEach(async({context})=>{const h=(await auth.$context).test;const user=await h.saveUser(h.createUser());owner=user.id;await context.addCookies(await h.getCookies({userId:owner}));});
test.afterEach(async()=>{await(await auth.$context).test.deleteUser(owner);});
test.afterAll(()=>pool.end());
test("explicit fake OAuth connection, reload, refresh, disconnect and browser privacy; passive navigation calls no provider",async({page,context,request})=>{
  const stats=async()=>await(await request.get("http://127.0.0.1:4313/stats",{headers:{"x-test-secret":process.env.TEST_EBAY_SECRET!}})).json() as {exchanges:number;refreshes:number;identities:number};
  const before=await stats();await page.goto("/settings/integrations/ebay");await expect(page.getByText("Not connected",{exact:true})).toBeVisible();await page.reload();expect(await stats()).toEqual(before);
  await page.route("https://auth.sandbox.ebay.com/oauth2/authorize?**",async route=>{
    const url=new URL(route.request().url());expect(url.searchParams.get("redirect_uri")).toBe("fake-sandbox-runame");
    await route.fulfill({status:302,headers:{location:`http://127.0.0.1:3100/api/integrations/ebay/callback?state=${url.searchParams.get("state")}&code=seller-a`},body:""});
  });
  const bodies:string[]=[];page.on("response",r=>{if(r.url().startsWith("http://127.0.0.1:3100/settings/integrations/ebay"))void r.text().then(t=>bodies.push(t)).catch(()=>undefined);});
  await page.getByRole("button",{name:"Connect eBay Sandbox",exact:true}).click();await expect(page.getByText("Connected",{exact:true})).toBeVisible();await expect(page.getByText("Verified seller: TESTUSER_seller-a")).toBeVisible();
  expect(page.url()).not.toMatch(/code=|state=/);const connected=await stats();expect(connected.exchanges-before.exchanges).toBe(1);
  await page.reload();expect(await stats()).toEqual(connected);
  const stored=await page.evaluate(()=>({local:Object.values(localStorage),session:Object.values(sessionStorage),cookie:document.cookie}));
  expect(JSON.stringify(stored)).not.toMatch(/fake-access|fake-refresh|ciphertext|authTag|seller-a|Bearer/);expect(stored.cookie).not.toContain("session_token");
  expect(bodies.join(" ")).not.toMatch(/fake-access|fake-refresh|ciphertext|leaseToken/);
  const row=await pool.query("SELECT access, refresh, seller_id FROM ebay_connections WHERE owner_id=$1",[owner]);
  expect(row.rows).toHaveLength(1);expect(JSON.stringify(row.rows[0])).not.toMatch(/fake-access|fake-refresh/);
  await pool.query("UPDATE ebay_connections SET access_expires_at=now()-interval '1 minute' WHERE owner_id=$1",[owner]);
  await page.getByRole("button",{name:"Check eBay authorization",exact:true}).click();await expect(page.getByRole("status").last()).toContainText("Authorization checked");expect((await stats()).refreshes-connected.refreshes).toBe(1);
  const foreign=await context.browser()!.newContext();try{
    const h=(await auth.$context).test,user=await h.saveUser(h.createUser());
    try{await foreign.addCookies(await h.getCookies({userId:user.id}));const p=await foreign.newPage();await p.goto("http://127.0.0.1:3100/settings/integrations/ebay");await expect(p.getByText("Not connected",{exact:true})).toBeVisible();await expect(p.getByText(/TESTUSER_seller-a/)).toHaveCount(0);}finally{await h.deleteUser(user.id);}
  }finally{await foreign.close();}
  await page.getByRole("button",{name:"Disconnect eBay",exact:true}).click();await expect(page.getByText("Not connected",{exact:true})).toBeVisible();
  expect((await pool.query("SELECT access,refresh FROM ebay_connections WHERE owner_id=$1",[owner])).rows[0]).toEqual({access:null,refresh:null});
});
test("fake denied consent cannot persist a connection and callback replay fails",async({page})=>{
  let callback="";
  await page.route("https://auth.sandbox.ebay.com/oauth2/authorize?**",async route=>{const url=new URL(route.request().url());callback=`http://127.0.0.1:3100/api/integrations/ebay/declined?state=${url.searchParams.get("state")}`;await route.fulfill({status:302,headers:{location:callback},body:""});});
  await page.goto("/settings/integrations/ebay");await page.getByRole("button",{name:"Connect eBay Sandbox",exact:true}).click();await expect(page.getByText("Authorization was cancelled.",{exact:true})).toBeVisible();await expect(page.getByText("Not connected",{exact:true})).toBeVisible();
  const result=await page.request.get(callback,{maxRedirects:0});expect(result.headers().location).toContain("result=failed");
});
