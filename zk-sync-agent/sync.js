/**
 * Local sync daemon for ZKTeco K50 Pro → GIALCO RH (Render).
 * Run on a PC on the same LAN as the device (TCP 4370).
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const Zkteco = require("zkteco-js");

const DEVICE_IP = process.env.DEVICE_IP || "191.164.16.102";
const DEVICE_PORT = Number(process.env.DEVICE_PORT || 4370);
const CLOUD_API_URL =
  process.env.CLOUD_API_URL ||
  "https://gialco-rh.onrender.com/api/attendance/sync";
const SYNC_SECRET = process.env.SYNC_SECRET || "";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15000);
/** Large attendance buffers need a longer TCP timeout */
const INACTIVITY_MS = Number(process.env.DEVICE_TIMEOUT_MS || 30000);
const CONNECTION_MS = Number(process.env.DEVICE_CONNECTION_MS || 15000);

// Keep state outside the Next.js repo so writing it does not trigger HMR reloads
const STATE_DIR = path.join(
  process.env.LOCALAPPDATA || process.env.HOME || __dirname,
  "gialco-zk-sync"
);
const STATE_FILE = path.join(STATE_DIR, "sync-state.json");

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.lastProcessedTimestamp) {
      return new Date(parsed.lastProcessedTimestamp);
    }
  } catch {
    // first run
  }
  // On first start, only pull the last 24h to avoid flooding historical logs
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

function saveState(lastProcessedTimestamp) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      { lastProcessedTimestamp: lastProcessedTimestamp.toISOString() },
      null,
      2
    )
  );
}

let lastProcessedTimestamp = loadState();
let running = false;

/** zkteco-js returns snake_case: record_time, user_id */
function punchTime(log) {
  const raw =
    log.record_time ||
    log.recordTime ||
    log.timestamp ||
    log.time ||
    log.attTime ||
    null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

function deviceUserId(log) {
  const id =
    log.user_id ??
    log.deviceUserId ??
    log.userId ??
    log.uid ??
    log.userSn ??
    log.id ??
    "";
  return String(id).trim();
}

async function pollDevice() {
  if (running) return;
  running = true;

  if (!SYNC_SECRET || SYNC_SECRET === "change_me_zk_sync_secret") {
    console.error(
      "SYNC_SECRET manquant — copiez env.example vers .env et définissez la même clé que sur Render."
    );
    running = false;
    return;
  }

  const zk = new Zkteco(DEVICE_IP, DEVICE_PORT, INACTIVITY_MS, CONNECTION_MS);

  try {
    await zk.createSocket();
    console.log(
      `[${new Date().toISOString()}] Connecté à ZKTeco K50 Pro (${DEVICE_IP}:${DEVICE_PORT})`
    );

    const logs = await zk.getAttendances();
    const rows = Array.isArray(logs?.data)
      ? logs.data
      : Array.isArray(logs)
        ? logs
        : [];

    let skippedParse = 0;
    let skippedOld = 0;
    const newLogs = [];
    for (const log of rows) {
      const when = punchTime(log);
      const userId = deviceUserId(log);
      if (!when || !userId) {
        skippedParse += 1;
        continue;
      }
      if (when > lastProcessedTimestamp) {
        newLogs.push({
          userId,
          timestamp: when.toISOString(),
          punchType:
            typeof log.punch === "number"
              ? log.punch
              : typeof log.state === "number"
                ? log.state
                : typeof log.type === "number"
                  ? log.type
                  : undefined,
          _when: when,
        });
      } else {
        skippedOld += 1;
      }
    }

    newLogs.sort((a, b) => a._when - b._when);

    console.log(
      `Logs appareil: ${rows.length} · nouveaux: ${newLogs.length} · trop anciens: ${skippedOld} · illisibles: ${skippedParse} · depuis ${lastProcessedTimestamp.toISOString()}`
    );

    if (newLogs.length === 0) {
      console.log("Aucun nouveau pointage.");
    } else {
      console.log(
        `Envoi de ${newLogs.length} pointage(s) vers ${CLOUD_API_URL}…`
      );
      console.log(
        "Aperçu:",
        newLogs
          .slice(0, 3)
          .map((p) => `${p.userId}@${p.timestamp}`)
          .join(", ")
      );

      const payload = {
        punches: newLogs.map(({ userId, timestamp, punchType }) => ({
          userId,
          timestamp,
          punchType,
        })),
      };

      const response = await axios.post(CLOUD_API_URL, payload, {
        headers: {
          "Content-Type": "application/json",
          "x-sync-token": SYNC_SECRET,
        },
        timeout: 60000,
      });

      if (response.status >= 200 && response.status < 300) {
        lastProcessedTimestamp = newLogs[newLogs.length - 1]._when;
        saveState(lastProcessedTimestamp);
        console.log("Sync OK:", response.data);
      } else {
        console.error("Réponse inattendue:", response.status, response.data);
      }
    }

    if (typeof zk.disconnect === "function") {
      await zk.disconnect();
    }
  } catch (err) {
    console.error("Sync Error:", err.message || err);
    try {
      if (typeof zk.disconnect === "function") await zk.disconnect();
    } catch {
      // ignore
    }
  } finally {
    running = false;
  }
}

console.log("GIALCO ZK sync agent démarré");
console.log(`  Device : ${DEVICE_IP}:${DEVICE_PORT}`);
console.log(`  API    : ${CLOUD_API_URL}`);
console.log(`  Poll   : ${POLL_INTERVAL_MS} ms`);
console.log(`  Depuis : ${lastProcessedTimestamp.toISOString()}`);

pollDevice();
setInterval(pollDevice, POLL_INTERVAL_MS);
