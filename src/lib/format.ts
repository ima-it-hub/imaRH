/** Business timezone for IMA Plomberie (Algeria, UTC+1, no DST). */
export const APP_TIMEZONE = "Africa/Algiers";

export function moneyDZD(value: number) {
  return `${value.toLocaleString("fr-DZ")} DZD`;
}

export function formatTime(ts?: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("fr-DZ", {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(value?: string | number | null) {
  if (!value) return "—";
  const d = typeof value === "number" ? new Date(value) : new Date(value);
  return d.toLocaleDateString("fr-DZ", { timeZone: APP_TIMEZONE });
}

/** Local calendar date YYYY-MM-DD in Algeria. */
export function todayISOLocal(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
}

/** Add calendar days to a YYYY-MM-DD date (timezone-safe via noon UTC). */
export function addDaysISO(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Earliest annual-leave start: 15 full days of notice
 * (e.g. 18 Oct → first selectable day 3 Nov).
 */
export function annualLeaveMinStartISO(date = new Date()) {
  return addDaysISO(todayISOLocal(date), 16);
}

export function leaveStatusLabel(status: string) {
  switch (status) {
    case "EN_ATTENTE":
      return "En attente";
    case "APPROUVE":
      return "Approuvé (à clôturer)";
    case "REFUSE":
      return "Refusé";
    case "CLOTURE":
      return "Clôturé";
    default:
      return status;
  }
}

export function paymentStatusLabel(status: string) {
  switch (status) {
    case "DEMANDE":
      return "Demande";
    case "VALIDE":
      return "Validé";
    case "PAYE":
      return "Payé";
    case "REJETE":
      return "Rejeté";
    default:
      return status;
  }
}

export function statusBadgeClass(status: string) {
  if (["APPROUVE", "CLOTURE", "PAYE", "VALIDE", "present"].includes(status)) {
    return "bg-emerald-50 text-emerald-700";
  }
  if (["EN_ATTENTE", "DEMANDE", "late", "working"].includes(status)) {
    return "bg-amber-50 text-amber-700";
  }
  if (["REFUSE", "REJETE", "absent"].includes(status)) {
    return "bg-red-50 text-red-700";
  }
  return "bg-zinc-100 text-zinc-600";
}
