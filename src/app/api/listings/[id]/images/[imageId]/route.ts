import { getAuth } from "../../../../../../auth/server";
import { imageService } from "../../../../../../application/server";
import { ImageOperationError } from "../../../../../../application/imageStorage";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  try {
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session) return new Response("Authentication required.", { status: 401, headers });
    const { id, imageId } = await params;
    const url = await imageService().read(session.user.id, id, imageId);
    return new Response(null, { status: 307, headers: { ...headers, Location: url } });
  } catch (error) {
    if (error instanceof ImageOperationError) return new Response("Image not found.", { status: 404, headers });
    return new Response("Image temporarily unavailable.", { status: 503, headers });
  }
}
