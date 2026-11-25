import { z } from "zod";

export const LOCAL_IMAGE_OPERATOR_ORIGIN = "https://127.0.0.1:3000";
export const localOperatorAction = z.enum(["consent", "prepare-fixture", "run", "cancel", "cleanup"]);
export type LocalOperatorAction = z.infer<typeof localOperatorAction>;
export const localOperatorRequest = z.strictObject({
  action: localOperatorAction,
  revision: z.number().int().min(0).max(2_147_483_646),
  confirmed: z.literal(true),
});
export type LocalOperatorPhase = "armed" | "consent-pending" | "connected" | "fixture-preparing" | "ready" | "running" | "settled" | "stopped" | "unknown" | "cleanup-queued";
export interface LocalOperatorView {
  phase: LocalOperatorPhase;
  revision: number;
  canConsent: boolean;
  canPrepare: boolean;
  canRun: boolean;
  canCancel: boolean;
  canCleanup: boolean;
  message: string;
  budget: { exchange: boolean | null; identity: boolean | null; post: boolean | null; get: boolean | null; ceiling: 4 };
  // Server-produced bounded/redacted JSON, never an arbitrary error or body.
  reportText: string | null;
  retainUntil: string | null;
  cleanupNotBefore: string | null;
  associated: false;
}
export type LocalOperatorResponse = { state: LocalOperatorView; authorizationUrl?: string };

export class LocalOperatorError extends Error {
  constructor(readonly code: "disabled" | "origin" | "auth" | "conflict" | "context" | "expired" | "unavailable") {
    super("The local diagnostic is unavailable or stopped. No retry is permitted.");
  }
}
