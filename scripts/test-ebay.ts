import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
if(process.env.MARKETPLACE_TEST_BUILD!=="1"||process.env.VERCEL||!process.env.TEST_EBAY_SECRET)throw new Error("Isolated eBay tests required.");
const access=new Map<string,string>(),refresh=new Map<string,string>();
let exchanges=0,refreshes=0,identities=0;
createServer(async(req,res)=>{
  const path=new URL(req.url??"/","http://127.0.0.1:4313").pathname;
  const send=(body:unknown,status=200)=>{res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(body));};
  if(path==="/health")return send({ok:true});
  if(req.headers["x-test-secret"]!==process.env.TEST_EBAY_SECRET)return send({},403);
  if(path==="/stats")return send({exchanges,refreshes,identities});
  if(req.method!=="POST")return send({},405);
  let body="";for await(const c of req){body+=c;if(body.length>20000)return send({},413);}
  if(path==="/identity/v1/oauth2/token"){
    if(req.headers.authorization!=="Basic "+Buffer.from("fake-client:fake-secret").toString("base64"))return send({},401);
    const form=new URLSearchParams(body),grant=form.get("grant_type");let seller:string|undefined;
    if(grant==="authorization_code"){
      if(form.get("redirect_uri")!=="fake-sandbox-runame")return send({},400);
      seller=["seller-a","seller-b"].includes(form.get("code")??"")?form.get("code")!:undefined;exchanges++;
    }else if(grant==="refresh_token"){seller=refresh.get(form.get("refresh_token")??"");refreshes++;}
    if(!seller)return send({error:"invalid_grant"},400);
    const token="fake-access-"+randomUUID();access.set(token,seller);
    if(grant==="refresh_token")return send({access_token:token,expires_in:7200,token_type:"User Access Token"});
    const renewal="fake-refresh-"+randomUUID();refresh.set(renewal,seller);
    return send({access_token:token,expires_in:7200,token_type:"User Access Token",refresh_token:renewal,refresh_token_expires_in:47304000});
  }
  if(path==="/ws/api.dll"){
    const seller=access.get(String(req.headers["x-ebay-api-iaf-token"]));identities++;
    if(!seller||req.headers["x-ebay-api-call-name"]!=="GetUser"||/<UserID>/.test(body))return send({},403);
    res.writeHead(200,{"Content-Type":"text/xml"});return res.end(`<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><User><EIASToken>stable-opaque-${seller}-identifier</EIASToken><UserID>TESTUSER_${seller}</UserID></User></GetUserResponse>`);
  }
  send({},404);
}).listen(4313,"127.0.0.1");
