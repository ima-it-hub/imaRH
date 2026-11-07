import type { NextRequest } from "next/server";
import { admsPlain, isAllowedZkDevice } from "@/lib/zkSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Device polls for pending remote commands — none queued. */
export async function GET(req: NextRequest) {
  const sn = req.nextUrl.searchParams.get("SN") || "";
  if (!isAllowedZkDevice(sn)) {
    return admsPlain("ERROR", 403);
  }
  return admsPlain("OK");
}
