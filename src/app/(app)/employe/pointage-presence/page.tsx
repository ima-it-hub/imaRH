"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { PageShell } from "@/components/PageShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Badge, Card, StatCard } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatTime, statusBadgeClass } from "@/lib/format";

export default function PointagePresencePage() {
  const { token } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const rows = useQuery(
    api.attendance.myMonth,
    token ? { token, year, month } : "skip"
  );

  const totalLate = useMemo(
    () => (rows ?? []).reduce((sum, r) => sum + r.lateMinutes, 0),
    [rows]
  );

  const byDate = useMemo(() => {
    const map = new Map<string, NonNullable<typeof rows>[number]>();
    for (const row of rows ?? []) map.set(row.date, row);
    return map;
  }, [rows]);

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();

  return (
    <RequireAuth role="employee" page="pointage-presence">
      <PageShell
        title="Pointage & Présence"
        description="Historique des entrées/sorties et cumul des retards."
      >
        <div className="mb-6 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500">Mois</span>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="rounded-xl border border-zinc-200 px-3 py-2"
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(2000, i, 1).toLocaleString("fr-DZ", {
                    month: "long",
                  })}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500">Année</span>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-28 rounded-xl border border-zinc-200 px-3 py-2"
            />
          </label>
          <StatCard label="Retard cumulé" value={`${totalLate} min`} />
        </div>

        <Card className="mb-6">
          <h2 className="mb-4 font-semibold text-zinc-900">Calendrier mensuel</h2>
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium text-zinc-500">
            {["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-2">
            {Array.from({ length: firstWeekday }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const row = byDate.get(date);
              const color = !row
                ? "bg-zinc-50 text-zinc-400"
                : row.status === "late"
                  ? "bg-amber-50 text-amber-800 border-amber-200"
                  : row.status === "leave"
                    ? "bg-sky-50 text-sky-800 border-sky-200"
                    : "bg-emerald-50 text-emerald-800 border-emerald-200";
              return (
                <div
                  key={date}
                  className={`rounded-xl border px-1 py-2 text-center ${color}`}
                >
                  <div className="text-sm font-semibold">{day}</div>
                  <div className="text-[10px]">
                    {row
                      ? row.status === "late"
                        ? `+${row.lateMinutes}m`
                        : row.status
                      : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold text-zinc-900">Récapitulatif</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 pr-4">Date</th>
                  <th className="pb-3 pr-4">Entrée</th>
                  <th className="pb-3 pr-4">Sortie</th>
                  <th className="pb-3 pr-4">Retard</th>
                  <th className="pb-3">Statut</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((row) => (
                  <tr key={row._id} className="border-t border-zinc-100">
                    <td className="py-3 pr-4">{row.date}</td>
                    <td className="py-3 pr-4">{formatTime(row.clockInAt)}</td>
                    <td className="py-3 pr-4">{formatTime(row.clockOutAt)}</td>
                    <td className="py-3 pr-4">{row.lateMinutes} min</td>
                    <td className="py-3">
                      <Badge className={statusBadgeClass(row.status)}>
                        {row.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows?.length ? (
              <p className="py-6 text-sm text-zinc-500">
                Aucun pointage pour cette période.
              </p>
            ) : null}
          </div>
        </Card>
      </PageShell>
    </RequireAuth>
  );
}
