import { describe,it,expect,vi } from "vitest";
import { createLocalOperatorRegistry } from "./localImageOperatorRegistry";
describe("process-local work owns settlement without granting replay",()=>{
  it("starts once, stays reserved after settlement and never retries",async()=>{const r=createLocalOperatorRegistry(),f=vi.fn(async()=>"safe");const w=r.start("a","run",f);expect(()=>r.start("a","run",f)).toThrow();await w.completion;expect(w.settled).toBe(true);expect(w.result).toBe("safe");expect(()=>r.start("a","run",f)).toThrow();expect(f).toHaveBeenCalledTimes(1);});
  it("retains capacity until cancelled work actually settles",async()=>{let settle!:()=>void;const r=createLocalOperatorRegistry();const w=r.start("a","run",async signal=>{await new Promise<void>(resolve=>{settle=resolve;});expect(signal.aborted).toBe(true);return null;});await Promise.resolve();w.controller.abort();expect(w.settled).toBe(false);expect(()=>r.start("a","run",async()=>null)).toThrow();settle();await w.completion;expect(w.settled).toBe(true);});
  it("a new process cannot claim work is settled",()=>{expect(createLocalOperatorRegistry().get("a","run")).toBeUndefined();});
  it("does not retain raw failure details or oversize reports",async()=>{const r=createLocalOperatorRegistry();const a=r.start("a","fixture",async()=>{throw Error("private");});await a.completion;expect(a.result).toBeNull();const b=r.start("a","run",async()=>"x".repeat(32_769));await b.completion;expect(b.result).toBeNull();});
  it("has a fixed two-entry bound",()=>{const r=createLocalOperatorRegistry();r.start("a","fixture",async()=>null);r.start("a","run",async()=>null);expect(()=>r.start("b","run",async()=>null)).toThrow();});
});
