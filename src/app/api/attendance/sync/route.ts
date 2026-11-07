import { NextRequest, NextResponse } from "next/server";
import { forwardZkPunches, type ZkPunch } from "@/lib/zkSync";

export async function POST(req: NextRequest) {
  const expected = process.env.SYNC_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "SYNC_SECRET non configuré sur le serveur" },
      { status: 500 }
    );
  }

  const token = req.headers.get("x-sync-token");
  if (!token || token !== expected) {
    return NextResponse.json(
      { error: "Unauthorized sync source" },
      { status: 401 }
    );
  }

  let body: { punches?: Array<Partial<ZkPunch> & { userId?: string | number }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const punches = (Array.isArray(body.punches) ? body.punches : [])
    .map((p) => ({
      userId: String(p.userId ?? "").trim(),
      timestamp: String(p.timestamp ?? ""),
      punchType: typeof p.punchType === "number" ? p.punchType : undefined,
    }))
    .filter((p) => p.userId && p.timestamp);

  try {
    const result = await forwardZkPunches(punches);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
