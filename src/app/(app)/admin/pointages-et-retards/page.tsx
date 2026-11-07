"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageShell } from "@/components/PageShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Badge, Card, PrimaryButton, inputClass } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  formatTime,
  moneyDZD,
  statusBadgeClass,
  todayISOLocal,
} from "@/lib/format";

export default function AdminPointagesPage() {
  const { token } = useAuth();
  const [date, setDate] = useState(todayISOLocal());
  const rows = useQuery(
    api.attendance.listByDate,
    token ? { token, date } : "skip"
  );
  const adjust = useMutation(api.attendance.adjustLateMinutes);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  async function save(attendanceId: Id<"attendances">, currentLate: number) {
    if (!token) return;
    const value = Number(drafts[attendanceId] ?? String(currentLate));
    await adjust({ token, attendanceId, lateMinutes: value });
    setMsg("Retard mis à jour — déduction solde recalculée");
  }

  return (
    <RequireAuth role="admin">
      <PageShell
        title="Pointages & Retards"
        description="Temps travaillé vs durée obligatoire. Vous pouvez corriger les minutes de retard (la déduction DZD se recalcule)."
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            type="date"
            className={inputClass + " max-w-xs"}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {msg ? <p className="text-sm text-emerald-600">{msg}</p> : null}
        </div>

        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="pb-3 text-left">Employé</th>
                  <th className="pb-3 text-left">Scans</th>
                  <th className="pb-3 text-left">Travaillé</th>
                  <th className="pb-3 text-left">Requis</th>
                  <th className="pb-3 text-left">Retard</th>
                  <th className="pb-3 text-left">Déduction</th>
                  <th className="pb-3 text-left">Statut</th>
                  <th className="pb-3 text-left">Ajuster</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((row) => (
                  <tr key={row._id} className="border-t border-zinc-100">
                    <td className="py-3 pr-3">
                      <p className="font-medium">{row.employee.name}</p>
                      <p className="text-xs text-zinc-500">
                        {formatTime(row.clockInAt)}
                        {row.clockOutAt ? ` → ${formatTime(row.clockOutAt)}` : " · en cours"}
                      </p>
                    </td>
                    <td className="py-3">{row.scans?.length ?? 0}</td>
                    <td className="py-3">{row.workedMinutes ?? 0} min</td>
                    <td className="py-3">{row.requiredMinutes ?? 480} min</td>
                    <td className="py-3">
                      {row.lateMinutes} min
                      {row.lateAdjustedByAdmin ? (
                        <span className="ml-1 text-xs text-zinc-400">(admin)</span>
                      ) : null}
                    </td>
                    <td className="py-3 font-medium text-[#0088E8]">
                      {moneyDZD(row.delayAmount ?? 0)}
                    </td>
                    <td className="py-3">
                      <Badge className={statusBadgeClass(row.status)}>
                        {row.status}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          className="w-20 rounded-lg border border-zinc-200 px-2 py-1"
                          defaultValue={row.lateMinutes}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [row._id]: e.target.value,
                            }))
                          }
                        />
                        <PrimaryButton
                          type="button"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => save(row._id, row.lateMinutes)}
                        >
                          OK
                        </PrimaryButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows?.length ? (
              <p className="py-6 text-sm text-zinc-500">
                Aucun pointage pour cette date.
              </p>
            ) : null}
          </div>
        </Card>
      </PageShell>
    </RequireAuth>
  );
}
