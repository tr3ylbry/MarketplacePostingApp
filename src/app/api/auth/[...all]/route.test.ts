const { handler } = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("../../../../auth/server", () => ({ getAuth: () => ({ handler }) }));
import { GET, POST } from "./route";

it("contains unexpected provider/database failures without leaking details", async () => {
  handler.mockRejectedValue(new Error("private SQL and OAuth token"));
  for (const method of [GET, POST]) {
    const response = await method(new Request("http://localhost/api/auth/get-session"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ message: "Authentication is temporarily unavailable." });
  }
});
