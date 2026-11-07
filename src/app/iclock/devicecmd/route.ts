import type { NextRequest } from "next/server";
import { admsPlain, isAllowedZkDevice } from "@/lib/zkSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Device reports command execution result. */
export async function POST(req: NextRequest) {
  const sn = req.nextUrl.searchParams.get("SN") || "";
  if (!isAllowedZkDevice(sn)) {
    return admsPlain("ERROR", 403);
  }
  await req.text();
  return admsPlain("OK");
}
