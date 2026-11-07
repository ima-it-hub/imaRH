# ZKTeco → GIALCO RH

There are **two** ways to get fingerprints into the cloud app.

## Option A — Cloud push (ADMS) · recommended “online”

The K50 Pro calls your Render app directly. **No PC agent required.**

1. Deploy the web app (with `/iclock/*` routes).
2. On the device: **Menu → Comm. → Cloud Server Setting** (or ADMS):

| Setting | Value |
|--------|--------|
| Enable Domain Name | ON |
| Server Address | `gialco-rh.onrender.com` |
| Server Port | `443` |
| HTTPS / SSL | **ON** (try this first on Render) |
| Enable Proxy | OFF |

If your firmware only works with HTTP port 80 / HTTPS OFF, Render cannot serve that — use Option B, or put a small VPS with port 80 in front.

3. Optional Render env: `ZK_DEVICE_SN=YourSerialNumber` (comma-separated if several).
4. Restart the terminal. Within ~1 minute it should handshake `GET /iclock/cdata`.

## Option B — LAN sync agent (pull)

Use when ADMS/Cloud Server is unavailable. A PC on the **same LAN** as `191.164.16.102` polls TCP 4370 and POSTs to:

`POST https://gialco-rh.onrender.com/api/attendance/sync`

```bash
cd zk-sync-agent
cp env.example .env
npm install
npm start
```

### Keep the agent running on Windows (auto-start)

```powershell
cd D:\development\RH_GIALCO\zk-sync-agent
powershell -ExecutionPolicy Bypass -File .\install-windows-service.ps1
```

This registers a Task Scheduler job that starts at logon and restarts on failure.

## Secrets

| Where | Variable |
|-------|----------|
| Render | `SYNC_SECRET` |
| Convex production | `ZK_SYNC_SECRET` (same value) |
| Agent `.env` (Option B) | `SYNC_SECRET` |
| Render (optional) | `ZK_DEVICE_SN` |

## Employee mapping

Enroll on the K50 → note User ID → set **ID ZKTeco** on Admin → Employés.
