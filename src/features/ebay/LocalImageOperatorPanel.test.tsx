import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import type { LocalOperatorView } from "../../application/localImageOperator";
import { isSandboxAuthorizationUrl, LOCAL_IMAGE_OPERATOR_ENDPOINT, LocalImageOperatorPanel } from "./LocalImageOperatorPanel";

const fetchMock = vi.fn();
function state(change: Partial<LocalOperatorView> = {}): LocalOperatorView {
  return { phase: "armed", revision: 0, canConsent: true, canPrepare: false, canRun: false, canCancel: false, canCleanup: false,
    message: "Only the approved generated image may be used.", budget: { exchange: false, identity: false, post: false, get: false, ceiling: 4 },
    reportText: null, retainUntil: null, cleanupNotBefore: null, associated: false, ...change };
}
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const ready = () => state({ phase: "ready", canConsent: false, canRun: true, revision: 3 });
const running = () => state({ phase: "running", canConsent: false, canCancel: true, revision: 4, message: "Work is still unsettled." });
const settled = () => state({ phase: "settled", canConsent: false, canCleanup: true, revision: 6, message: "The single diagnostic settled." });
function confirm() { fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the next action/ })); }

beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("renders all server controls inert and makes no passive call before or after hydration", () => {
  expect(renderToString(<LocalImageOperatorPanel initialState={ready()} />)).toContain('disabled=""');
  render(<LocalImageOperatorPanel initialState={ready()} />);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Run one image diagnostic" })).toBeDisabled();
  expect(screen.getByText(/Normal photo transfer, usable-media admission and Inventory writes remain unavailable/)).toBeVisible();
  expect(screen.getByText(/Maximum-image profile: retrieves only the fresh response’s maxDimensionImageUrl/)).toBeVisible();
});

it("supports keyboard confirmation, posts only the exact action/revision and returns focus to status", async () => {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(response({ state: settled() }));
  render(<LocalImageOperatorPanel initialState={ready()} />);
  await user.tab(); expect(screen.getByRole("checkbox")).toHaveFocus();
  await user.keyboard(" "); await user.tab();
  expect(screen.getByRole("button", { name: "Run one image diagnostic" })).toHaveFocus();
  await user.keyboard("{Enter}");
  await screen.findByText(/Diagnostic work settled/);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(LOCAL_IMAGE_OPERATOR_ENDPOINT);
  expect(JSON.parse(init.body)).toEqual({ action: "run", revision: 3, confirmed: true });
  expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { "content-type": "application/json", accept: "application/json" } });
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("status")).toHaveFocus();
});

it("prevents duplicate starts while the first request remains unresolved", async () => {
  const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise);
  render(<LocalImageOperatorPanel initialState={ready()} />); confirm();
  const button = screen.getByRole("button", { name: "Run one image diagnostic" });
  fireEvent.click(button); fireEvent.click(button);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Starting the diagnostic…" })).toBeDisabled();
  await act(async () => pending.resolve(response({ state: settled() })));
});

it("requires a new confirmation after preparing the fixture instead of automatically running it", async () => {
  fetchMock.mockResolvedValueOnce(response({ state: ready() }));
  render(<LocalImageOperatorPanel initialState={state({ phase: "connected", revision: 2, canConsent: false, canPrepare: true })} />);
  confirm(); fireEvent.click(screen.getByRole("button", { name: "Prepare generated test image" }));
  await screen.findByText(/Ready for the single diagnostic/);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "prepare-fixture", revision: 2, confirmed: true });
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Run one image diagnostic" })).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not turn unknown history or positive-looking flags into retry permission", () => {
  render(<LocalImageOperatorPanel initialState={state({ phase: "unknown", canConsent: true, canPrepare: true, canRun: true })} />);
  for (const label of ["Authorize eBay Sandbox", "Prepare generated test image", "Run one image diagnostic", "Cancel diagnostic", "Clean up local test fixture"]) expect(screen.getByRole("button", { name: label })).toBeDisabled();
  expect(screen.getByText(/Outcome unknown — do not retry/)).toBeVisible(); expect(fetchMock).not.toHaveBeenCalled();
});

it.each(["cleanup", "cancel"] as const)("honors server-authorized %s for unknown history without enabling positive actions", async action => {
  fetchMock.mockResolvedValueOnce(response({ state: state({ phase: "stopped", revision: 8, canConsent: false }) }));
  render(<LocalImageOperatorPanel initialState={state({ phase: "unknown", revision: 7, canConsent: true, canPrepare: true, canRun: true, canCleanup: action === "cleanup", canCancel: action === "cancel" })} />);
  confirm();
  for (const label of ["Authorize eBay Sandbox", "Prepare generated test image", "Run one image diagnostic"]) expect(screen.getByRole("button", { name: label })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: action === "cleanup" ? "Clean up local test fixture" : "Cancel diagnostic" }));
  await screen.findByText(/Diagnostic stopped/);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action, revision: 7, confirmed: true });
});

it("withholds raw action errors and permits read-only status recovery without repeating a start", async () => {
  fetchMock.mockResolvedValueOnce(response({ error: "synthetic-secret raw-provider-body" }, 503));
  render(<LocalImageOperatorPanel initialState={ready()} />); confirm();
  fireEvent.click(screen.getByRole("button", { name: "Run one image diagnostic" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This action could not be confirmed. Do not repeat it.");
  expect(screen.queryByText(/synthetic-secret/)).not.toBeInTheDocument();
  fetchMock.mockResolvedValueOnce(response({ state: ready() }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole("button", { name: "Refresh status" })).toBeEnabled());
  expect(fetchMock.mock.calls[1][1].method).toBe("GET"); expect(fetchMock.mock.calls[1][1].body).toBeUndefined();
  confirm(); expect(screen.getByRole("button", { name: "Run one image diagnostic" })).toBeDisabled();
});

it("allows a fresh read-only status check to recover a failed status read", async () => {
  fetchMock.mockResolvedValueOnce(response({}, 503));
  render(<LocalImageOperatorPanel initialState={ready()} />);
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Status could not be verified");
  confirm(); expect(screen.getByRole("button", { name: "Run one image diagnostic" })).toBeDisabled();
  fetchMock.mockResolvedValueOnce(response({ state: ready() }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Run one image diagnostic" })).toBeEnabled();
  expect(fetchMock.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
});

it("keeps cancellation available through a pending start without cancelling or repeating that request", async () => {
  vi.useFakeTimers();
  const start = deferred<Response>();
  fetchMock.mockReturnValueOnce(start.promise).mockResolvedValueOnce(response({ state: running() }))
    .mockResolvedValueOnce(response({ state: state({ ...running(), revision: 5, canCancel: false, message: "Cancellation requested; waiting for settlement." }) }));
  render(<LocalImageOperatorPanel initialState={ready()} />); confirm();
  fireEvent.click(screen.getByRole("button", { name: "Run one image diagnostic" }));
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  confirm(); fireEvent.click(screen.getByRole("button", { name: "Cancel diagnostic" }));
  await act(async () => {});
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ action: "cancel", revision: 4, confirmed: true });
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
  expect(screen.getByText(/Cancellation requested; waiting for settlement/)).toBeVisible();
  await act(async () => start.resolve(response({ state: settled() })));
  expect(screen.getByText(/Diagnostic work settled/)).toBeVisible();
});

it("does not describe an unacknowledged cancellation as settled", async () => {
  fetchMock.mockRejectedValueOnce(new Error("synthetic raw error that must not be displayed"));
  render(<LocalImageOperatorPanel initialState={running()} />); confirm();
  fireEvent.click(screen.getByRole("button", { name: "Cancel diagnostic" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Cancellation could not be confirmed. Work may still be unsettled.");
  expect(screen.queryByText(/synthetic raw error/)).not.toBeInTheDocument();
  expect(screen.getByText(/Diagnostic in progress/)).toBeVisible();
  confirm(); expect(screen.getByRole("button", { name: "Cancel diagnostic" })).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValueOnce(response({ state: running() }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Cancel diagnostic" })).toBeEnabled();
});

it("submits guarded cleanup only after confirmation and never repeats it automatically", async () => {
  const queued = state({ phase: "cleanup-queued", revision: 7, canConsent: false, cleanupNotBefore: "2099-01-01T00:00:00.000Z" });
  fetchMock.mockResolvedValueOnce(response({ state: queued }));
  render(<LocalImageOperatorPanel initialState={settled()} />);
  expect(screen.getByRole("button", { name: "Clean up local test fixture" })).toBeDisabled();
  confirm(); fireEvent.click(screen.getByRole("button", { name: "Clean up local test fixture" }));
  await screen.findByText(/Local cleanup queued/);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "cleanup", revision: 6, confirmed: true });
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Clean up local test fixture" })).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("bounds automatic read-only polling and never retries a provider action", async () => {
  vi.useFakeTimers(); fetchMock.mockImplementation(() => Promise.resolve(response({ state: running() })));
  render(<LocalImageOperatorPanel initialState={running()} />);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(fetchMock).toHaveBeenCalledTimes(30);
  expect(screen.getByRole("alert")).toHaveTextContent("Automatic status checks stopped");
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(fetchMock).toHaveBeenCalledTimes(30);
  expect(fetchMock.mock.calls.every(([url, init]) => url === LOCAL_IMAGE_OPERATOR_ENDPOINT && init.method === "GET")).toBe(true);
});

it("cleans up its polling timer and aborts only owned pending fetches on unmount", async () => {
  vi.useFakeTimers(); const pending = deferred<Response>(); fetchMock.mockReturnValueOnce(pending.promise);
  const view = render(<LocalImageOperatorPanel initialState={running()} />);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  const signal = fetchMock.mock.calls[0][1].signal; expect(signal.aborted).toBe(false);
  view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response({ state: running() })));
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not let a late older status response restore cancellation or rewind the revision", async () => {
  const oldStatus = deferred<Response>(); fetchMock.mockReturnValueOnce(oldStatus.promise)
    .mockResolvedValueOnce(response({ state: state({ ...running(), revision: 5, canCancel: false, message: "Cancellation recorded." }) }));
  render(<LocalImageOperatorPanel initialState={running()} />);
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  confirm(); fireEvent.click(screen.getByRole("button", { name: "Cancel diagnostic" }));
  await screen.findByText(/Cancellation recorded/);
  await act(async () => oldStatus.resolve(response({ state: running() })));
  expect(screen.getByText(/Cancellation recorded/)).toBeVisible();
  confirm(); expect(screen.getByRole("button", { name: "Cancel diagnostic" })).toBeDisabled();
});

it.each([
  { state: { ...settled(), associated: true } },
  { state: { ...settled(), unexpected: "synthetic-credential" } },
  { state: { ...settled(), reportText: "x".repeat(16_385) } },
  { state: settled(), authorizationUrl: "https://auth.sandbox.ebay.com/oauth2/authorize?state=synthetic" },
])("fails closed on an invalid non-consent response without displaying its contents", async value => {
  fetchMock.mockResolvedValueOnce(response(value)); render(<LocalImageOperatorPanel initialState={ready()} />); confirm();
  fireEvent.click(screen.getByRole("button", { name: "Run one image diagnostic" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Do not repeat it");
  expect(screen.queryByText(/synthetic-credential/)).not.toBeInTheDocument();
});

it("refuses oversized responses before obtaining a reader", async () => {
  const oversized = new Response("{}", { headers: { "content-type": "application/json", "content-length": "32769" } });
  const getReader = vi.spyOn(oversized.body!, "getReader"); fetchMock.mockResolvedValueOnce(oversized);
  render(<LocalImageOperatorPanel initialState={ready()} />); confirm(); fireEvent.click(screen.getByRole("button", { name: "Run one image diagnostic" }));
  await screen.findByRole("alert"); expect(getReader).not.toHaveBeenCalled();
});

it("renders a sanitized report as text and distinguishes queued cleanup from physical deletion", () => {
  render(<LocalImageOperatorPanel initialState={state({ phase: "cleanup-queued", canConsent: false, reportText: '<img src="https://synthetic.invalid/never-load">', cleanupNotBefore: "2099-01-01T00:00:00.000Z", budget: { exchange: true, identity: true, post: true, get: null, ceiling: 4 } })} />);
  fireEvent.click(screen.getByText("Sanitized diagnostic report"));
  expect(screen.getByText('<img src="https://synthetic.invalid/never-load">')).toBeVisible();
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getByText(/Physical deletion and remote erasure are not confirmed/)).toBeVisible();
  expect(screen.getByText("Unknown")).toBeVisible(); expect(fetchMock).not.toHaveBeenCalled();
});

it("uses no browser storage or cookie-export mechanism", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  Object.defineProperty(document, "cookie", { configurable: true, get() { throw new Error("Forbidden cookie access"); }, set() { throw new Error("Forbidden cookie write"); } });
  const reads = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Forbidden storage read"); });
  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Forbidden storage write"); });
  try {
    fetchMock.mockResolvedValueOnce(response({ state: ready() }));
    render(<LocalImageOperatorPanel initialState={state({ phase: "connected", canConsent: false, canPrepare: true })} />);
    confirm(); fireEvent.click(screen.getByRole("button", { name: "Prepare generated test image" }));
    await screen.findByText(/Ready for the single diagnostic/);
    expect(reads).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "content-type": "application/json", accept: "application/json" });
  } finally {
    if (descriptor) Object.defineProperty(document, "cookie", descriptor); else Reflect.deleteProperty(document, "cookie");
  }
});

it.each([
  ["https://auth.sandbox.ebay.com/oauth2/authorize?state=synthetic&redirect_uri=synthetic", true],
  ["https://auth.sandbox.ebay.com/oauth2/authorize", true],
  ["http://auth.sandbox.ebay.com/oauth2/authorize", false],
  ["https://auth.ebay.com/oauth2/authorize", false],
  ["https://auth.sandbox.ebay.com.evil.invalid/oauth2/authorize", false],
  ["https://auth.sandbox.ebay.com:443/oauth2/authorize", false],
  ["https://user@auth.sandbox.ebay.com/oauth2/authorize", false],
  ["https://auth.sandbox.ebay.com/oauth2/authorize#fragment", false],
  ["https://auth.sandbox.ebay.com/oauth2/authorize/extra", false],
  ["https://auth.sandbox.ebay.com/oauth2/authorize?state=synthetic\n", false],
  ["https://auth.sandbox.ebay.com\\evil.invalid/oauth2/authorize", false],
])("validates only the exact Sandbox authorization destination: %s", (url, expected) => {
  expect(isSandboxAuthorizationUrl(url as string)).toBe(expected);
});

it("rejects a consent response aimed at another destination without navigating", async () => {
  fetchMock.mockResolvedValueOnce(response({ state: state({ phase: "consent-pending", revision: 1, canConsent: false }), authorizationUrl: "https://synthetic.invalid/never-visit" }));
  render(<LocalImageOperatorPanel initialState={state()} />); confirm(); fireEvent.click(screen.getByRole("button", { name: "Authorize eBay Sandbox" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Do not repeat it");
  expect(window.location.href).not.toContain("synthetic.invalid"); expect(fetchMock).toHaveBeenCalledTimes(1);
});
