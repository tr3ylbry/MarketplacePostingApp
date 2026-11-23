// @vitest-environment node
import { assertOfflineGuards } from "../../test/offlinePrototypeGuards";
import { diagnosticEnvelope } from "./diagnosticImageWorkflow";
import { verificationEnvelope } from "../../application/ebayImageVerificationPersistence";
import type { DownloadReason } from "./imageDownloadPolicy";
vi.mock("server-only", () => ({}));
it("blocks private/provider/DB access", assertOfflineGuards);
it.each(["retrieved", "policy", "context", "clock", "deadline", "cancelled", "busy", "dns", "address", "tls", "peer", "headers", "status", "body", "transport"] as DownloadReason[])("maps only known bounded %s facts", reason => {
  const result = diagnosticEnvelope({ outcome: reason === "retrieved" ? "retrieved" : "refused", reason, bytes: 4, mime: "image/png", exceeded: false,
    unverified: true, associated: false, settlement: reason === "cancelled" ? "unsettled" : "settled" });
  expect(verificationEnvelope(result)).toEqual(result);
  expect(result.httpStatus).toBe(reason === "retrieved" ? 200 : null);
  expect(result.event).toBe(reason === "retrieved" ? "response" : reason === "cancelled" ? "cancelled" : "failure");
  expect(Object.keys(result).sort()).toEqual(["bytes", "event", "exceeded", "httpStatus", "mime", "reason", "settlement", "version"]);
});
it("does not claim an unsettled cancellation when actual settlement is already known", () => {
  expect(diagnosticEnvelope({ outcome: "refused", reason: "cancelled", bytes: 0, mime: null, exceeded: false, unverified: true, associated: false, settlement: "settled" }))
    .toMatchObject({ event: "failure", reason: "cancelled", settlement: "settled", httpStatus: null });
});
