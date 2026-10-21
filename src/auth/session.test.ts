const { session, redirect } = vi.hoisted(() => ({ session: vi.fn(), redirect: vi.fn(() => { throw new Error("redirect:/sign-in"); }) }));
vi.mock("server-only", () => ({}));
vi.mock("./server", () => ({ getAuth: () => ({ api: { getSession: session } }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect }));
import { requireUser } from "./session";

it("denies absent and migration-holder sessions; returns only identity from verified sessions", async () => {
  session.mockResolvedValue(null);
  await expect(requireUser()).rejects.toThrow("redirect:/sign-in");
  session.mockResolvedValue({ user: { id: "legacy-unclaimed", name: "Holder" } });
  await expect(requireUser()).rejects.toThrow("redirect:/sign-in");
  session.mockResolvedValue({ user: { id: "internal-user", name: "User", email: "private@example.test" } });
  expect(await requireUser()).toEqual({ id: "internal-user", name: "User" });
  session.mockRejectedValue(new Error("private database credentials"));
  await expect(requireUser()).rejects.toThrow("Authentication is temporarily unavailable.");
});
