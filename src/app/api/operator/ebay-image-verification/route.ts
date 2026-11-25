import { localImageOperatorApi } from "../../../../../scripts/local-image-operator-runtime";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const GET=(request:Request)=>localImageOperatorApi(request);
export const POST=(request:Request)=>localImageOperatorApi(request);
