// @vitest-environment node
import { imageVerificationOptions } from "../../scripts/image-verification-options";

const uuid="11111111-1111-4111-8111-111111111111",hash="a".repeat(64);
const common=["--reviewed-head","b".repeat(40),"--database","synthetic_test","--listing",uuid,"--image",uuid,
  "--listing-version","2026-11-23T00:00:00.000Z","--seller-key",hash,"--connection-version",uuid,"--source-digest",hash,"--derivative-digest",hash];
it.each(["--help","--rehearse-input"])("accepts harmless %s alone",mode=>expect(imageVerificationOptions([mode]).mode).toBe(mode.slice(2)));
it("keeps fixture output explicit, absolute and mutually exclusive",()=>{
  expect(imageVerificationOptions(["--fixture","/synthetic/generated.png"])).toEqual({mode:"fixture",output:"/synthetic/generated.png"});
  expect(()=>imageVerificationOptions(["--fixture","relative.png"])).toThrow();
});
it.each(["--approve-one-post-one-get","--cleanup-fixture"])("requires all exact bindings for %s",mode=>{
  const args=[mode,...common,...(mode.includes("post")?["--comparison-recipe","generated-rgb-marker-v1;test"]:[])];
  expect(imageVerificationOptions(args)).toMatchObject({mode:mode.slice(2),pins:{head:"b".repeat(40),database:"synthetic_test",sourceDigest:hash}});
  for(let n=1;n<common.length;n+=2){const missing=[...args];missing.splice(missing.indexOf(common[n-1]),2);expect(()=>imageVerificationOptions(missing)).toThrow();}
});
it.each([[],["--help","--rehearse-input"],["--help","--reviewed-head","b".repeat(40)],["--approve-one-post-one-get"],
  ["--cleanup-fixture",...common,"--comparison-recipe","generated-rgb-marker-v1;test"],
  ["--fixture","/synthetic/x.png","--help"],["--approve-media-consent"],["--approve-one-post-one-get",...common,"--comparison-recipe","x"],
  ["--help","--unknown"],["--fixture","/synthetic/\nprivate.png"]].map(args=>({args})))("rejects incomplete, conflicting or unexpected flags %#",({args})=>{
  expect(()=>imageVerificationOptions(args)).toThrow();
});
it.each([["--reviewed-head","main"],["--database","postgresql://remote.invalid"],["--listing","another-owner"],["--source-digest","https://invalid.test/capability"],
  ["--listing-version","2026-02-30T00:00:00.000Z"],["--listing-version","2026-11-23T00:00:00Z"]])("rejects malformed %s binding",(key,value)=>{
  const args=["--cleanup-fixture",...common];args[args.indexOf(key)+1]=value;expect(()=>imageVerificationOptions(args)).toThrow();
});
