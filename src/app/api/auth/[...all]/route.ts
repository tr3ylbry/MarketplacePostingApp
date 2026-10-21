import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "../../../../auth/server";

// Lazy initialization keeps build-time rendering independent of secrets/DB.
async function handle(request: Request) {
  try {
    return await toNextJsHandler(getAuth()).GET(request);
  } catch {
    // Unexpected DB/provider errors must not expose SQL, tokens or credentials.
    return Response.json({ message: "Authentication is temporarily unavailable." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
export const GET = handle;
export const POST = handle;
