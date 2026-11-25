"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { LocalOperatorAction, LocalOperatorResponse, LocalOperatorView } from "../../application/localImageOperator";

export const LOCAL_IMAGE_OPERATOR_ENDPOINT = "/api/operator/ebay-image-verification";
const RESPONSE_BYTES = 32_768;
const POLL_INTERVAL_MS = 2_000;
const MAX_STATUS_POLLS = 30;
const flag = z.boolean().nullable();
const viewSchema = z.strictObject({
  phase: z.enum(["armed", "consent-pending", "connected", "fixture-preparing", "ready", "running", "settled", "stopped", "unknown", "cleanup-queued"]),
  revision: z.number().int().min(0).max(2_147_483_646),
  canConsent: z.boolean(), canPrepare: z.boolean(), canRun: z.boolean(), canCancel: z.boolean(), canCleanup: z.boolean(),
  message: z.string().max(500),
  budget: z.strictObject({ exchange: flag, identity: flag, post: flag, get: flag, ceiling: z.literal(4) }),
  reportText: z.string().max(16_384).nullable(), retainUntil: z.string().max(100).nullable(), cleanupNotBefore: z.string().max(100).nullable(),
  associated: z.literal(false),
});
const responseSchema = z.strictObject({ state: viewSchema, authorizationUrl: z.string().max(4_096).optional() });

export function isSandboxAuthorizationUrl(raw: string) {
  try {
    if (!/^https:\/\/auth\.sandbox\.ebay\.com\/oauth2\/authorize(?:\?|$)/.test(raw) ||
      Array.from(raw).some(char => char.charCodeAt(0) <= 0x20 || char.charCodeAt(0) === 0x7f || char === "\\")) return false;
    const url = new URL(raw);
    return url.origin === "https://auth.sandbox.ebay.com" && url.pathname === "/oauth2/authorize" &&
      !url.username && !url.password && !url.port && !url.hash;
  } catch { return false; }
}

async function readResponse(response: Response, signal: AbortSignal): Promise<LocalOperatorResponse> {
  if (!response.ok || !response.body || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") ?? "")) {
    void response.body?.cancel().catch(() => {}); throw new Error();
  }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > RESPONSE_BYTES)) {
    void response.body.cancel().catch(() => {}); throw new Error();
  }
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    let bytes = 0, text = "";
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > RESPONSE_BYTES) throw new Error();
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return responseSchema.parse(JSON.parse(text));
  } finally {
    signal.removeEventListener("abort", cancel); cancel(); reader.releaseLock();
  }
}

const actionLabels: Record<LocalOperatorAction, string> = {
  consent: "Authorize eBay Sandbox", "prepare-fixture": "Prepare generated test image", run: "Run one image diagnostic",
  cancel: "Cancel diagnostic", cleanup: "Clean up local test fixture",
};
const phaseLabels: Record<LocalOperatorView["phase"], string> = {
  armed: "Ready for authorization", "consent-pending": "Authorization started", connected: "Seller authorization verified",
  "fixture-preparing": "Preparing the generated image", ready: "Ready for the single diagnostic", running: "Diagnostic in progress",
  settled: "Diagnostic work settled", stopped: "Diagnostic stopped", unknown: "Outcome unknown — do not retry", "cleanup-queued": "Local cleanup queued",
};
function budgetLabel(value: boolean | null) { return value === null ? "Unknown" : value ? "Consumed" : "Not consumed"; }

export function LocalImageOperatorPanel({ initialState }: { initialState: LocalOperatorView }) {
  const [state, setState] = useState(initialState), current = useRef(initialState);
  const [hydrated, setHydrated] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<LocalOperatorAction | null>(null), pendingRef = useRef<LocalOperatorAction | null>(null);
  const [cancelling, setCancelling] = useState(false), cancellingRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false), statusRequest = useRef<AbortController | null>(null);
  const [error, setError] = useState(""), [statusUnverified, setStatusUnverified] = useState(false), [actionUncertain, setActionUncertain] = useState(false);
  const mounted = useRef(false), requests = useRef(new Set<AbortController>());
  const statusElement = useRef<HTMLParagraphElement>(null), focusStatus = useRef(false);
  useEffect(() => {
    mounted.current = true; setHydrated(true);
    const activeRequests = requests.current;
    return () => { mounted.current = false; for (const controller of activeRequests) controller.abort(); activeRequests.clear(); };
  }, []);
  useEffect(() => {
    if (focusStatus.current) { focusStatus.current = false; statusElement.current?.focus(); }
  }, [state, error]);
  const applyState = useCallback((next: LocalOperatorView) => {
    if (!mounted.current || next.revision < current.current.revision) return;
    current.current = next; setState(next);
  }, []);

  const refresh = useCallback(async (automatic = false) => {
    if (!mounted.current || statusRequest.current) return;
    const controller = new AbortController(); statusRequest.current = controller; requests.current.add(controller);
    if (!automatic) setRefreshing(true);
    try {
      const response = await fetch(LOCAL_IMAGE_OPERATOR_ENDPOINT, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { accept: "application/json" }, signal: controller.signal });
      const data = await readResponse(response, controller.signal);
      if (data.authorizationUrl !== undefined) throw new Error();
      applyState(data.state);
      if (mounted.current) { setStatusUnverified(false); setError(""); }
      return true;
    } catch {
      if (mounted.current && !controller.signal.aborted) {
        setStatusUnverified(true); setError("Status could not be verified. Refresh status only; no diagnostic action will be retried.");
      }
      return false;
    } finally {
      requests.current.delete(controller); if (statusRequest.current === controller) statusRequest.current = null;
      if (mounted.current && !automatic) setRefreshing(false);
    }
  }, [applyState]);
  const polling = state.phase === "running" || state.phase === "fixture-preparing" || pending === "run" || pending === "prepare-fixture";
  useEffect(() => {
    if (!polling) return;
    let disposed = false, count = 0, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (disposed || !mounted.current) return;
      const okay = await refresh(true);
      if (disposed || !mounted.current || !okay) return;
      count += 1;
      if (count < MAX_STATUS_POLLS) timer = setTimeout(poll, POLL_INTERVAL_MS);
      else { setStatusUnverified(true); setError("Automatic status checks stopped. Work may still be unsettled; use Refresh status without starting another diagnostic."); }
    };
    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => { disposed = true; clearTimeout(timer); statusRequest.current?.abort(); };
  }, [polling, refresh]);

  async function perform(action: LocalOperatorAction) {
    const view = current.current;
    const allowed = { consent: view.canConsent, "prepare-fixture": view.canPrepare, run: view.canRun, cancel: view.canCancel, cleanup: view.canCleanup }[action];
    const positiveAction = action === "consent" || action === "prepare-fixture" || action === "run";
    if (!hydrated || !confirmed || !allowed || statusUnverified || positiveAction && (view.phase === "unknown" || actionUncertain) ||
      action === "cancel" && cancellingRef.current || action !== "cancel" && (pendingRef.current || cancellingRef.current)) return;
    if (action === "cancel") { cancellingRef.current = true; setCancelling(true); }
    else { pendingRef.current = action; setPending(action); }
    setConfirmed(false); setError("");
    const controller = new AbortController(); requests.current.add(controller);
    try {
      const response = await fetch(LOCAL_IMAGE_OPERATOR_ENDPOINT, {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        headers: { "content-type": "application/json", accept: "application/json" }, signal: controller.signal,
        body: JSON.stringify({ action, revision: view.revision, confirmed: true }),
      });
      const data = await readResponse(response, controller.signal);
      if (action === "consent") {
        if (!data.authorizationUrl || !isSandboxAuthorizationUrl(data.authorizationUrl)) throw new Error();
      } else if (data.authorizationUrl !== undefined) throw new Error();
      if (!mounted.current) return;
      if (data.state.revision < current.current.revision) {
        if (data.authorizationUrl !== undefined) throw new Error();
        return;
      }
      focusStatus.current = true; applyState(data.state);
      if (action === "consent") window.location.assign(data.authorizationUrl!);
    } catch {
      if (mounted.current && !controller.signal.aborted) {
        focusStatus.current = true; setActionUncertain(true); setStatusUnverified(true);
        setError(action === "cancel" ? "Cancellation could not be confirmed. Work may still be unsettled. Refresh status only."
          : "This action could not be confirmed. Do not repeat it. Refresh status for the recorded outcome.");
      }
    } finally {
      requests.current.delete(controller);
      if (action === "cancel") { cancellingRef.current = false; if (mounted.current) setCancelling(false); }
      else { pendingRef.current = null; if (mounted.current) setPending(null); }
    }
  }

  const unknown = state.phase === "unknown", busy = pending !== null || cancelling;
  const actionDisabled = !hydrated || !confirmed || statusUnverified || unknown || pending !== null || cancelling || actionUncertain;
  return <section className="panel" aria-labelledby="local-image-operator-title" aria-busy={busy}>
    <h2 id="local-image-operator-title">Approved image diagnostic — SANDBOX</h2>
    <p>Local development only. This single diagnostic uses a generated test image. It does not publish a listing or create usable media.</p>
    <p ref={statusElement} tabIndex={-1} role="status">{phaseLabels[state.phase]}. {state.message}</p>
    <p>The four-slot limit includes failed and uncertain requests. Consumed slots cannot be reused; there is no refresh, retry or alternate image.</p>
    <dl aria-label="Request allowance">
      <dt>Authorization-code exchange</dt><dd>{budgetLabel(state.budget.exchange)}</dd>
      <dt>Seller identity check</dt><dd>{budgetLabel(state.budget.identity)}</dd>
      <dt>Image creation</dt><dd>{budgetLabel(state.budget.post)}</dd>
      <dt>Anonymous image retrieval</dt><dd>{budgetLabel(state.budget.get)}</dd>
    </dl>
    <label><input type="checkbox" checked={confirmed} disabled={!hydrated || cancelling || unknown && !state.canCancel && !state.canCleanup} onChange={event => setConfirmed(event.target.checked)} /> I confirm the next action is within this approved single Sandbox diagnostic.</label>
    <div>
      <button disabled={actionDisabled || !state.canConsent} onClick={() => void perform("consent")}>{actionLabels.consent}</button>{" "}
      <button disabled={actionDisabled || !state.canPrepare} onClick={() => void perform("prepare-fixture")}>{actionLabels["prepare-fixture"]}</button>{" "}
      <button disabled={actionDisabled || !state.canRun} onClick={() => void perform("run")}>{pending === "run" ? "Starting the diagnostic…" : actionLabels.run}</button>{" "}
      <button className="secondary-button" disabled={!hydrated || !confirmed || statusUnverified || !state.canCancel || cancelling} onClick={() => void perform("cancel")}>{cancelling ? "Requesting cancellation…" : actionLabels.cancel}</button>{" "}
      <button className="secondary-button" disabled={!hydrated || !confirmed || statusUnverified || pending !== null || cancelling || !state.canCleanup} onClick={() => void perform("cleanup")}>{actionLabels.cleanup}</button>{" "}
      <button className="secondary-button" disabled={!hydrated || refreshing} onClick={() => void refresh()}>Refresh status</button>
    </div>
    {pending ? <p role="status">{actionLabels[pending]} requested. Wait for the recorded outcome; do not submit it again.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {state.retainUntil ? <p>Private source retained until {state.retainUntil}. Cleanup cannot shorten that deadline.</p> : null}
    {state.cleanupNotBefore ? <p>Private object cleanup queued no earlier than {state.cleanupNotBefore}. Physical deletion and remote erasure are not confirmed.</p> : null}
    <p>Every result remains unknown and unassociated. Normal photo transfer, usable-media admission and Inventory writes remain unavailable. Cancellation is not proof of settlement.</p>
    {state.reportText ? <details><summary>Sanitized diagnostic report</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{state.reportText}</pre></details> : null}
  </section>;
}
