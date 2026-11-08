import { leaveStatusLabel, moneyDZD } from "@/lib/format";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function printDocument(title: string, bodyHtml: string) {
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #18181b;
      margin: 24px;
      font-size: 12px;
      background: #fff;
    }
    h1 { font-size: 16px; margin: 0 0 4px; }
    .meta { color: #71717a; margin-bottom: 16px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    th, td {
      border: 1px solid #d4d4d8;
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f4f4f5;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tr.total td {
      background: #fafafa;
      font-weight: 700;
      border-top: 2px solid #18181b;
    }
    .foot { margin-top: 18px; color: #a1a1aa; font-size: 10px; }
    @media print {
      body { margin: 12px; }
    }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;

  // Hidden iframe avoids blank popup windows (noopener / pop-up blockers).
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDoc = frameWindow?.document;
  if (!frameWindow || !frameDoc) {
    document.body.removeChild(iframe);
    throw new Error("Impossible de préparer l'impression.");
  }

  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();

  const cleanup = () => {
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  };

  const runPrint = () => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } finally {
      // Give the print dialog time to open before removing the iframe
      window.setTimeout(cleanup, 1000);
    }
  };

  // Wait until the iframe document is ready
  if (frameDoc.readyState === "complete") {
    window.setTimeout(runPrint, 250);
  } else {
    iframe.onload = () => window.setTimeout(runPrint, 250);
  }
}

type MonthKey = string;

type MonthRow = {
  key: MonthKey;
  label: string;
  year: number;
  month: number;
  salary: number;
  prime: number;
  availablePrime: number;
  reduction: number;
  retraits: number;
  solde: number;
};

function monthKey(year: number, month: number): MonthKey {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthLabel(year: number, month: number) {
  const name = new Date(year, month - 1, 1).toLocaleString("fr-DZ", {
    month: "long",
  });
  return `${name} ${year}`;
}

function periodFromTs(ts: number) {
  const d = new Date(ts);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function buildFinanceMonthRows(args: {
  salaries: Array<{
    month: number;
    year: number;
    baseSalary: number;
    netPay?: number;
  }>;
  bonuses: Array<{
    amount: number;
    attributedAt: number;
    month?: number;
    year?: number;
  }>;
  lateDeductions?: Array<{
    month: number;
    year: number;
    amount: number;
  }>;
  orders: Array<{
    amount: number;
    status: string;
    requestedAt: number;
  }>;
}): MonthRow[] {
  const map = new Map<MonthKey, MonthRow>();

  function ensure(year: number, month: number) {
    const key = monthKey(year, month);
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        label: monthLabel(year, month),
        year,
        month,
        salary: 0,
        prime: 0,
        availablePrime: 0,
        reduction: 0,
        retraits: 0,
        solde: 0,
      };
      map.set(key, row);
    }
    return row;
  }

  for (const s of args.salaries) {
    const row = ensure(s.year, s.month);
    row.salary += s.netPay ?? s.baseSalary;
  }

  for (const deduction of args.lateDeductions ?? []) {
    const row = ensure(deduction.year, deduction.month);
    row.reduction += deduction.amount;
  }

  const now = new Date();
  const currentPeriod = now.getFullYear() * 12 + now.getMonth();
  for (const b of args.bonuses) {
    const period =
      b.year && b.month
        ? { year: b.year, month: b.month }
        : periodFromTs(b.attributedAt);
    const row = ensure(period.year, period.month);
    row.prime += b.amount;

    const releasePeriod = period.year * 12 + period.month - 1 + 3;
    if (releasePeriod <= currentPeriod) {
      const releaseYear = Math.floor(releasePeriod / 12);
      const releaseMonth = (releasePeriod % 12) + 1;
      ensure(releaseYear, releaseMonth).availablePrime += b.amount;
    }
  }

  ensure(now.getFullYear(), now.getMonth() + 1);

  for (const o of args.orders) {
    if (!["DEMANDE", "VALIDE", "PAYE"].includes(o.status)) continue;
    const period = periodFromTs(o.requestedAt);
    const row = ensure(period.year, period.month);
    row.retraits += o.amount;
  }

  const rows = Array.from(map.values()).sort((a, b) =>
    a.year === b.year ? a.month - b.month : a.year - b.year
  );

  // Running available balance: each line accumulates net from all prior months
  let runningSolde = 0;
  for (const row of rows) {
    const monthNet =
      row.salary + row.availablePrime - row.reduction - row.retraits;
    runningSolde += monthNet;
    row.solde = runningSolde;
  }

  return rows;
}

export function printFinanceHistory(args: {
  employeeName: string;
  salaries: Array<{
    month: number;
    year: number;
    baseSalary: number;
    netPay?: number;
  }>;
  bonuses: Array<{
    amount: number;
    attributedAt: number;
    month?: number;
    year?: number;
  }>;
  lateDeductions?: Array<{
    month: number;
    year: number;
    amount: number;
  }>;
  orders: Array<{
    amount: number;
    status: string;
    requestedAt: number;
  }>;
}) {
  const rows = buildFinanceMonthRows(args);
  const totals = rows.reduce(
    (acc, row) => ({
      salary: acc.salary + row.salary,
      prime: acc.prime + row.prime,
      reduction: acc.reduction + row.reduction,
      retraits: acc.retraits + row.retraits,
    }),
    { salary: 0, prime: 0, reduction: 0, retraits: 0 }
  );
  const finalSolde = rows.length > 0 ? rows[rows.length - 1].solde : 0;

  const bodyRows =
    rows.length === 0
      ? `<tr><td colspan="6">Aucune donnée financière.</td></tr>`
      : rows
          .map(
            (row) => `<tr>
              <td>${escapeHtml(row.label)}</td>
              <td class="num">${escapeHtml(moneyDZD(row.salary))}</td>
              <td class="num">${escapeHtml(moneyDZD(row.prime))}</td>
              <td class="num">${escapeHtml(`-${moneyDZD(row.reduction)}`)}</td>
              <td class="num">${escapeHtml(moneyDZD(row.retraits))}</td>
              <td class="num">${escapeHtml(moneyDZD(row.solde))}</td>
            </tr>`
          )
          .join("");

  const totalRow =
    rows.length === 0
      ? ""
      : `<tr class="total">
          <td>Total</td>
          <td class="num">${escapeHtml(moneyDZD(totals.salary))}</td>
          <td class="num">${escapeHtml(moneyDZD(totals.prime))}</td>
          <td class="num">${escapeHtml(`-${moneyDZD(totals.reduction)}`)}</td>
          <td class="num">${escapeHtml(moneyDZD(totals.retraits))}</td>
          <td class="num">${escapeHtml(moneyDZD(finalSolde))}</td>
        </tr>`;

  const generated = new Date().toLocaleString("fr-DZ");
  const html = `
    <h1>Historique financier</h1>
    <p class="meta">Généré le ${escapeHtml(generated)}</p>
    <table>
      <thead>
        <tr>
          <th>Mois</th>
          <th class="num">Salaire</th>
          <th class="num">Prime</th>
          <th class="num">Retards</th>
          <th class="num">Retraits</th>
          <th class="num">Solde disponible</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
        ${totalRow}
      </tbody>
    </table>
    <p class="foot">Solde disponible = cumul (Salaire + primes devenues disponibles après 3 mois − Retards validés − Retraits)</p>
  `;

  printDocument("Historique financier", html);
}

export function printLeaveHistory(args: {
  employeeName: string;
  balance: number;
  quota: number;
  leaves: Array<{
    type: string;
    days: number;
    status: string;
    startDate: string;
    endDate: string;
    reason: string;
    adminResponse?: string;
  }>;
}) {
  const generated = new Date().toLocaleString("fr-DZ");
  const totalDays = args.leaves.reduce((sum, l) => sum + l.days, 0);
  const approvedDays = args.leaves
    .filter((l) => l.status === "APPROUVE")
    .reduce((sum, l) => sum + l.days, 0);

  const bodyRows =
    args.leaves.length === 0
      ? `<tr><td colspan="6">Aucune demande de congé.</td></tr>`
      : args.leaves
          .map(
            (leave) => `<tr>
              <td>${escapeHtml(leave.type)}</td>
              <td>${escapeHtml(leave.startDate)}</td>
              <td>${escapeHtml(leave.endDate)}</td>
              <td class="num">${leave.days}</td>
              <td>${escapeHtml(leaveStatusLabel(leave.status))}</td>
              <td>${escapeHtml(leave.reason)}${
                leave.adminResponse
                  ? `<br/><span style="color:#71717a">Réponse : ${escapeHtml(leave.adminResponse)}</span>`
                  : ""
              }</td>
            </tr>`
          )
          .join("");

  const html = `
    <h1>Historique des congés</h1>
    <p class="meta">Généré le ${escapeHtml(generated)}</p>
    <p class="meta">Solde actuel : <strong>${args.balance} / ${args.quota} jours</strong></p>
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Début</th>
          <th>Fin</th>
          <th class="num">Jours</th>
          <th>Statut</th>
          <th>Motif</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
        <tr class="total">
          <td colspan="3">Total</td>
          <td class="num">${totalDays}</td>
          <td colspan="2">Approuvés : ${approvedDays} j · Solde restant : ${args.balance} / ${args.quota}</td>
        </tr>
      </tbody>
    </table>
  `;

  printDocument("Historique des congés", html);
}

/** @deprecated kept for older imports */
export const downloadFinanceHistoryPdf = printFinanceHistory;
/** @deprecated kept for older imports */
export const downloadLeaveHistoryPdf = printLeaveHistory;
