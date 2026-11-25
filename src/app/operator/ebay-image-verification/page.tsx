import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { localImageOperatorApi } from "../../../../scripts/local-image-operator-runtime";
import { LocalImageOperatorPanel } from "../../../features/ebay/LocalImageOperatorPanel";
import type { LocalOperatorResponse } from "../../../application/localImageOperator";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export default async function LocalImageOperatorPage() {
  const h=new Headers(await headers());
  const response=await localImageOperatorApi(new Request("https://127.0.0.1:3000/api/operator/ebay-image-verification",{headers:h}));
  if(response.status===404)notFound();
  if(response.status===401)redirect("/sign-in");
  if(!response.ok)return <main><h1>Local image diagnostic stopped</h1><p>Its status could not be verified. Do not start another attempt.</p></main>;
  const body=await response.json() as LocalOperatorResponse;
  return <main><h1>Local Sandbox image diagnostic</h1><LocalImageOperatorPanel initialState={body.state}/></main>;
}
