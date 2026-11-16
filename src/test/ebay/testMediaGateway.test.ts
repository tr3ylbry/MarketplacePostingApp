// @vitest-environment node
import { mediaResponse, testMediaGateway, MAX_MEDIA_RESPONSE_BYTES } from "./testMediaGateway";
import { mediaRuntime } from "../../infrastructure/ebay/mediaRuntime";

const id = "fake_" + "a".repeat(32), other = "fake_" + "b".repeat(32);
const location = "http://127.0.0.1:4313/commerce/media/v1_beta/image/" + id;
const imageUrl = "http://127.0.0.1:4313/eps/" + id + ".png";
const now = new Date("2026-11-16T00:00:00Z"), expiry = "2026-11-16T01:00:00.000Z";
const body = { imageUrl, expirationDate: expiry };
const response = (data: unknown = body, headers: Record<string, string> = {}, status = 201) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", location, ...headers } });
const parse = (r: Response) => mediaResponse(r, AbortSignal.timeout(1000), now);
afterEach(() => vi.unstubAllEnvs());

it("uses the complete 201 JSON body and Location, without a getImage dependency", async () => {
  expect(await parse(response())).toEqual({ complete: true, imageId: id, imageUrl, expiresAt: expiry, responseStatus: 201, reason: "complete" });
});
it.each(["https://apim.sandbox.ebay.com/commerce/media/v1_beta/image/" + id, "http://evil.test/image/" + id,
  "http://user:password@127.0.0.1:4313/commerce/media/v1_beta/image/" + id, location + "?signed=private", location + "#fragment",
  location + ", " + location, location.replace(id, "%66ake_" + "a".repeat(32)), location.replace("/image/", "/other/../image/"), "", "x".repeat(513)])("rejects a non-fixture, ambiguous or noncanonical Location %s", async value => {
  const parsed = await parse(response(body, { location: value })); expect(parsed.complete).toBe(false); expect(parsed.imageId).toBeNull();
});
it("keeps partial trusted evidence and refuses a conflicting Location/body", async () => {
  expect(await parse(response({}, {}))).toMatchObject({ complete: false, imageId: id, imageUrl: null });
  expect(await parse(response(body, { location: "" }))).toMatchObject({ complete: false, imageId: null, imageUrl, expiresAt: expiry });
  expect(await parse(response(body, { location: location.replace(id, other) }))).toMatchObject({ complete: false, imageId: other, imageUrl: null });
});
it.each([{ ...body, imageUrl: "https://i.ebayimg.com/unknown.png" }, { ...body, imageUrl: imageUrl + "?token=private" },
  { ...body, expirationDate: "not-a-date" }, { ...body, maxDimensionImageUrl: "https://evil.test/picture" }, { ...body, account: { private: "raw profile" } }])("does not accept unsupported success fields or real-host guesses", async value => {
  expect((await parse(response(value))).complete).toBe(false);
});
it("preserves returned past expiry as evidence without treating it as reusable or erased", async () => {
  expect(await parse(response({ ...body, expirationDate: "2020-01-01T00:00:00Z" }))).toMatchObject({ complete: false, reason: "expired", expiresAt: "2020-01-01T00:00:00.000Z" });
});
it.each([400, 401, 403, 404, 429, 500, 502])("treats HTTP %s as fenced uncertainty, never a permission to POST again", async status => {
  expect(await parse(response({ error: "private response" }, {}, status))).toEqual({ complete: false, imageId: id, imageUrl: null, expiresAt: null, responseStatus: status, reason: "http" });
});
it("bounds streamed bodies, cancels them and never returns raw errors or oversized content", async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_MEDIA_RESPONSE_BYTES + 1)); }, cancel });
  const result = await parse(new Response(stream, { status: 201, headers: { location, "content-type": "application/json" } }));
  expect(result).toMatchObject({ complete: false, imageId: id }); expect(cancel).toHaveBeenCalled();
  expect(await parse(new Response("{malformed private body", { status: 201, headers: { location, "content-type": "application/json" } }))).toMatchObject({ complete: false, imageId: id });
  expect(await parse(response(body, { "content-length": String(MAX_MEDIA_RESPONSE_BYTES + 1) }))).toMatchObject({ complete: false, imageId: id });
  expect(await parse(response(body, { "content-type": "text/html" }))).toMatchObject({ complete: false, imageId: id });
});
it("retains known Location when response streaming is cancelled", async () => {
  const control = new AbortController(), cancel = vi.fn();
  const stream = new ReadableStream({ cancel });
  const pending = mediaResponse(new Response(stream, { status: 201, headers: { location, "content-type": "application/json" } }), control.signal, now);
  control.abort(); expect(await pending).toMatchObject({ complete: false, imageId: id }); expect(cancel).toHaveBeenCalled();
});
it("pins one loopback multipart request, constrains the file and disables redirects/caching", async () => {
  vi.stubEnv("MARKETPLACE_TEST_BUILD", "1"); vi.stubEnv("VERCEL", ""); vi.stubEnv("TEST_DATABASE_URL", "postgresql://127.0.0.1/disposable_test"); vi.stubEnv("TEST_EBAY_SECRET", "ephemeral-test-secret");
  vi.stubEnv("DATABASE_URL", "postgresql://127.0.0.1/disposable_test");
  const transport = vi.fn(async (_input, init) => {
    expect(init.method).toBe("POST"); expect(init.redirect).toBe("error"); expect(init.cache).toBe("no-store");
    const file = init.body.get("image"); expect(file.name).toBe("fixture.png"); expect(file.type).toBe("image/png");
    expect(Buffer.from(await file.arrayBuffer())).toEqual(Buffer.from("synthetic"));
    return response({ ...body, expirationDate: "2099-01-01T00:00:00Z" });
  });
  expect((await testMediaGateway(transport).create(Buffer.from("synthetic"), AbortSignal.timeout(1000))).complete).toBe(true);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][0]).toBe("http://127.0.0.1:4313/commerce/media/v1_beta/image/create_image_from_file");
});
it("does not retry after a transport failure and keeps error text out of the result", async () => {
  vi.stubEnv("MARKETPLACE_TEST_BUILD", "1"); vi.stubEnv("VERCEL", ""); vi.stubEnv("TEST_DATABASE_URL", "postgresql://127.0.0.1/disposable_test"); vi.stubEnv("TEST_EBAY_SECRET", "test-secret");
  vi.stubEnv("DATABASE_URL", "postgresql://127.0.0.1/disposable_test");
  const transport = vi.fn().mockRejectedValue(new Error("Bearer private-token; raw private response"));
  expect(await testMediaGateway(transport).create(Buffer.from("synthetic"), AbortSignal.timeout(1000))).toEqual({ complete: false, imageId: null, imageUrl: null, expiresAt: null, responseStatus: null, reason: "transport" });
  expect(transport).toHaveBeenCalledTimes(1);
});
it.each(["normal", "remote-db", "wrong-db", "development-db", "vercel", "no-secret"])("refuses the %s test environment before any request; normal runtime is always disabled", async kind => {
  vi.stubEnv("MARKETPLACE_TEST_BUILD", kind === "normal" ? "0" : "1"); vi.stubEnv("VERCEL", kind === "vercel" ? "1" : "");
  vi.stubEnv("TEST_DATABASE_URL", kind === "remote-db" ? "postgresql://remote.test/name_test" : kind === "wrong-db" ? "postgresql://127.0.0.1/development" : "postgresql://127.0.0.1/disposable_test");
  vi.stubEnv("TEST_EBAY_SECRET", kind === "no-secret" ? "" : "test-secret");
  vi.stubEnv("DATABASE_URL", kind === "development-db" ? "postgresql://127.0.0.1/development" : process.env.TEST_DATABASE_URL);
  const transport = vi.fn(); await expect(testMediaGateway(transport).create(Buffer.from("fixture"), AbortSignal.timeout(1000))).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled(); expect(mediaRuntime()).toEqual({ enabled: false });
});
