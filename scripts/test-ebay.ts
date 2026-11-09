import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { metadataFixture } from "../src/test/ebay/metadataFixtures";
import { readinessFixture } from "../src/test/ebay/readinessFixtures";
import { EBAY_SCOPES, EBAY_READINESS_SCOPES } from "../src/application/ebayConnection";
if(process.env.MARKETPLACE_TEST_BUILD!=="1"||process.env.VERCEL||!process.env.TEST_EBAY_SECRET)throw new Error("Isolated eBay tests required.");
const access=new Map<string,string>(),refresh=new Map<string,string>();
let exchanges=0,refreshes=0,identities=0;
let applicationTokens=0,metadataReads=0;
let readinessReads=0,mutations=0;
const applications=new Set<string>();
const scopes=new Map<string,readonly string[]>();
createServer(async(req,res)=>{
  const path=new URL(req.url??"/","http://127.0.0.1:4313").pathname;
  const send=(body:unknown,status=200)=>{res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(body));};
  if(path==="/health")return send({ok:true});
  if(req.headers["x-test-secret"]!==process.env.TEST_EBAY_SECRET)return send({},403);
  if(path==="/stats")return send({exchanges,refreshes,identities,applicationTokens,metadataReads,readinessReads,mutations});
  if(req.method==="GET"){
    if(path.startsWith("/sell/account/v1/")||path==="/sell/inventory/v1/location"){
      const token=String(req.headers.authorization).replace(/^Bearer /,""),seller=access.get(token);
      if(!seller)return send({},401);
      const required=path.startsWith("/sell/account/")?EBAY_READINESS_SCOPES[1]:EBAY_READINESS_SCOPES[2];
      if(!scopes.get(token)?.includes(required))return send({},403);
      readinessReads++;const data=readinessFixture(path,new URL(req.url??"/","http://127.0.0.1:4313").searchParams,seller==="seller-b");
      return send(data??{},data===undefined?404:200);
    }
    if(!applications.has(String(req.headers.authorization).replace(/^Bearer /,"")))return send({},401);
    metadataReads++;
    const data=metadataFixture(path,new URL(req.url??"/","http://127.0.0.1:4313").searchParams);
    return send(data??{},data===undefined?404:200);
  }
  if(req.method!=="POST"){mutations++;return send({},405);}
  let body="";for await(const c of req){body+=c;if(body.length>20000)return send({},413);}
  if(path==="/identity/v1/oauth2/token"){
    if(req.headers.authorization!=="Basic "+Buffer.from("fake-client:fake-secret").toString("base64"))return send({},401);
    const form=new URLSearchParams(body),grant=form.get("grant_type");let seller:string|undefined,permissions:readonly string[]=EBAY_SCOPES;
    if(grant==="client_credentials"){
      if(form.get("scope")!=="https://api.ebay.com/oauth/api_scope")return send({},403);
      applicationTokens++;const token="fake-application-"+randomUUID();applications.add(token);
      return send({access_token:token,expires_in:7200,token_type:"Application Access Token"});
    }
    if(grant==="authorization_code"){
      if(form.get("redirect_uri")!=="fake-sandbox-runame")return send({},400);
      const code=form.get("code")??"";
      seller=["seller-a","seller-b","seller-a-readiness","seller-b-readiness"].includes(code)?code.replace(/-readiness$/,""):undefined;
      permissions=code.endsWith("-readiness")?EBAY_READINESS_SCOPES:EBAY_SCOPES;exchanges++;
    }else if(grant==="refresh_token"){const token=form.get("refresh_token")??"";seller=refresh.get(token);permissions=scopes.get(token)??EBAY_SCOPES;refreshes++;}
    if(!seller)return send({error:"invalid_grant"},400);
    const token="fake-access-"+randomUUID();access.set(token,seller);scopes.set(token,permissions);
    if(grant==="refresh_token")return send({access_token:token,expires_in:7200,token_type:"User Access Token",scope:permissions.join(" ")});
    const renewal="fake-refresh-"+randomUUID();refresh.set(renewal,seller);scopes.set(renewal,permissions);
    return send({access_token:token,expires_in:7200,token_type:"User Access Token",scope:permissions.join(" "),refresh_token:renewal,refresh_token_expires_in:47304000});
  }
  if(path==="/ws/api.dll"){
    const seller=access.get(String(req.headers["x-ebay-api-iaf-token"]));identities++;
    if(!seller||req.headers["x-ebay-api-call-name"]!=="GetUser"||/<UserID>/.test(body))return send({},403);
    res.writeHead(200,{"Content-Type":"text/xml"});return res.end(`<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><User><EIASToken>stable-opaque-${seller}-identifier</EIASToken><UserID>TESTUSER_${seller}</UserID></User></GetUserResponse>`);
  }
  mutations++;send({},404);
}).listen(4313,"127.0.0.1");
