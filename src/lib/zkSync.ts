import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

export type ZkPunch = {
  userId: string;
  timestamp: string;
  punchType?: number;
};

export async function forwardZkPunches(punches: ZkPunch[]) {
  const syncSecret = process.env.SYNC_SECRET;
  if (!syncSecret) {
    throw new Error("SYNC_SECRET non configuré sur le serveur");
  }
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL manquant");
  }
  if (punches.length === 0) {
    return { success: true, processed: 0, skipped: 0, unmatched: 0, errors: [] };
  }

  const client = new ConvexHttpClient(convexUrl);
  return await client.mutation(api.attendance.syncFromZk, {
    syncSecret,
    punches,
  });
}

/** Parse ADMS ATTLOG body lines: PIN\\tYYYY-MM-DD HH:mm:ss\\t... */
export function parseAttLogBody(body: string): ZkPunch[] {
  const punches: ZkPunch[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.toUpperCase() === "ATTLOG") continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const userId = parts[0]?.trim();
    const whenRaw = parts[1]?.trim();
    if (!userId || !whenRaw) continue;

    // Device sends local wall time without TZ — treat as Africa/Algiers (UTC+1)
    const normalized = whenRaw.includes("T")
      ? whenRaw
      : whenRaw.replace(" ", "T");
    const withOffset = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)
      ? normalized
      : `${normalized}+01:00`;
    const when = new Date(withOffset);
    if (!Number.isFinite(when.getTime())) continue;

    const status = Number(parts[2]);
    punches.push({
      userId,
      timestamp: when.toISOString(),
      punchType: Number.isFinite(status) ? status : undefined,
    });
  }
  return punches;
}

export function admsPlain(text: string, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function isAllowedZkDevice(sn: string | null) {
  const allowed = (process.env.ZK_DEVICE_SN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0) return true; // open until SN configured
  if (!sn) return false;
  return allowed.includes(sn.trim());
}
