// @vitest-environment node
import { assertOfflineGuards } from "../../test/offlinePrototypeGuards";
import { inspectImageAddressSet } from "./imageAddressSetPolicy";
const now = Date.parse("2026-11-23T00:00:00Z"), a = { address: "1.1.1.1", family: 4 };
it("enforces offline/private guards", assertOfflineGuards);
it.each([1,16])("accepts %i fully checked candidates as facts only", count => {
  const value = inspectImageAddressSet(Array.from({ length: count }, () => ({ ...a })), now);
  expect(value).toMatchObject({ candidate: a, reason: "candidate", networkAuthorized: false });
  expect(Object.isFrozen(value)).toBe(true); expect(Object.isFrozen(value.candidate)).toBe(true);
});
it.each([0,1,15])("refuses the entire set with a bad member at %i", at => {
  const input = Array.from({ length:16 }, () => ({ ...a })); input[at] = { address: "127.0.0.1", family:4 };
  expect(inspectImageAddressSet(input,now).candidate).toBeNull();
});
it.each([null,{},[],new Array(1),[{...a,extra:true}],[{address:"1.1.1.1",family:6}],[{address:"01.1.1.1",family:4}],[{address:"x".repeat(46),family:4}],[{address:"2001:db8::1",family:6}],[{address:"::ffff:1.1.1.1",family:6}]])("refuses malformed or uncovered set %#", input => {
  expect(inspectImageAddressSet(input,now).candidate).toBeNull();
});
it("refuses oversized input before touching any elements", () => {
  const a = new Array(17); Object.defineProperty(a,0,{ get(){throw Error("must not traverse");} });
  expect(inspectImageAddressSet(a,now).reason).toBe("invalid-set");
});
it("canonicalizes IPv6 and copies selected facts", () => {
  const input = [{ address:"2001:4860:4860:0:0:0:0:8888",family:6 }];
  const v = inspectImageAddressSet(input,now); input[0].address="127.0.0.1";
  expect(v.candidate).toEqual({address:"2001:4860:4860::8888",family:6});
});
it.each([NaN,Infinity,now+0.5,Date.parse("2027-02-20T20:31:27.970Z"),0])("refuses invalid/stale time %#", at => { expect(inspectImageAddressSet([a],at).candidate).toBeNull(); });
it("counts duplicates against the raw cap", () => { expect(inspectImageAddressSet(Array(17).fill(a),now).candidate).toBeNull(); });
