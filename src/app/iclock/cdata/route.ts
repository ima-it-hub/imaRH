import type { NextRequest } from "next/server";
import {
  admsPlain,
  forwardZkPunches,
  isAllowedZkDevice,
  parseAttLogBody,
} from "@/lib/zkSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ZKTeco ADMS / iClock push protocol.
 * Device → cloud (no LAN agent required when Cloud Server is configured).
 */
export async function GET(req: NextRequest) {
  const sn = req.nextUrl.searchParams.get("SN") || "";
  if (!isAllowedZkDevice(sn)) {
    return admsPlain("ERROR", 403);
  }

  // Handshake / options response expected by ZK firmware
  const body = [
    `GET OPTION FROM: ${sn}`,
    "Stamp:9999",
    "OpStamp:9999",
    "ErrorDelay:60",
    "Delay:30",
    "TransTimes:00:00;14:05",
    "TransInterval:1",
    "TransFlag:1111000000",
    "TimeZone:1",
    "Realtime:1",
    "Encrypt:0",
  ].join("\n");

  return admsPlain(body);
}

export async function POST(req: NextRequest) {
  const sn = req.nextUrl.searchParams.get("SN") || "";
  if (!isAllowedZkDevice(sn)) {
    return admsPlain("ERROR", 403);
  }

  const table = (req.nextUrl.searchParams.get("table") || "").toUpperCase();
  const raw = await req.text();

  // Attendance push
  if (table === "ATTLOG" || raw.includes("\t")) {
    try {
      const punches = parseAttLogBody(raw);
      if (punches.length > 0) {
        await forwardZkPunches(punches);
      }
    } catch (err) {
      console.error("[iclock/cdata] ATTLOG sync failed", err);
      // Still ACK so the device does not flood retries forever
    }
    return admsPlain("OK");
  }

  // OPERLOG / other tables — acknowledge
  return admsPlain("OK");
}
