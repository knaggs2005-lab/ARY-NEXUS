import { after } from "next/server";
import { handle } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
async function route(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return handle(request, (await params).path, after);
}
export { route as GET, route as POST, route as PATCH, route as DELETE };
