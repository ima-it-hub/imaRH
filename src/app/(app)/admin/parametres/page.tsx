"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageShell } from "@/components/PageShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  Card,
  Field,
  Modal,
  PrimaryButton,
  SecondaryButton,
  inputClass,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";

type WorkplaceDraft = {
  name: string;
  description: string;
  workStart: string;
  workEnd: string;
  lateToleranceMinutes: string;
  requiredWorkMinutes: string;
  thursdayRequiredWorkMinutes: string;
  thursdayWorkEnd: string;
};

type SettingsDraft = {
  workingDaysPerMonth: string;
  primeObjectiveWeightPercent: string;
  primeRecoveryWeightPercent: string;
  primeEvaluationWeightPercent: string;
};

function timeInputValue(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeParts(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return { hour: hour ?? Number.NaN, minute: minute ?? Number.NaN };
}

export default function AdminParametresPage() {
  const { token } = useAuth();
  const settings = useQuery(api.settings.get, token ? { token } : "skip");
  const update = useMutation(api.settings.update);
  const workplaces = useQuery(
    api.workplaces.list,
    token ? { token } : "skip"
  );
  const createWorkplace = useMutation(api.workplaces.create);
  const updateWorkplace = useMutation(api.workplaces.update);
  const removeWorkplace = useMutation(api.workplaces.remove);
  const cleanLegacyOvertime = useMutation(
    api.overtimeMigration.cleanLegacyOvertimeBatch
  );

  const [newWorkplaceName, setNewWorkplaceName] = useState("");
  const [newWorkplaceDescription, setNewWorkplaceDescription] = useState("");
  const [newWorkplaceOpen, setNewWorkplaceOpen] = useState(false);
  const [expandedWorkplaceId, setExpandedWorkplaceId] =
    useState<Id<"workplaces"> | null>(null);
  const [workplaceDraftOverrides, setWorkplaceDraftOverrides] = useState<
    Record<string, WorkplaceDraft>
  >({});
  const [workplaceBusy, setWorkplaceBusy] = useState(false);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [settingsDraftOverrides, setSettingsDraftOverrides] =
    useState<Partial<SettingsDraft>>({});
  const settingsDraft: SettingsDraft = {
    workingDaysPerMonth: String(settings?.workingDaysPerMonth ?? 26),
    primeObjectiveWeightPercent: String(
      settings?.primeObjectiveWeightPercent ?? 80
    ),
    primeRecoveryWeightPercent: String(
      settings?.primeRecoveryWeightPercent ?? 10
    ),
    primeEvaluationWeightPercent: String(
      settings?.primeEvaluationWeightPercent ?? 10
    ),
    ...settingsDraftOverrides,
  };
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const workplaceDrafts: Record<string, WorkplaceDraft> = {};
  if (settings && workplaces) {
    for (const workplace of workplaces) {
      workplaceDrafts[workplace._id] = {
        name: workplace.name,
        description: workplace.description ?? "",
        workStart: timeInputValue(
          workplace.workStartHour ?? settings.workStartHour,
          workplace.workStartMinute ?? settings.workStartMinute
        ),
        workEnd: timeInputValue(
          workplace.workEndHour ?? settings.workEndHour ?? 17,
          workplace.workEndMinute ?? settings.workEndMinute ?? 0
        ),
        lateToleranceMinutes: String(
          workplace.lateToleranceMinutes ?? settings.lateToleranceMinutes
        ),
        requiredWorkMinutes: String(
          workplace.requiredWorkMinutes ?? settings.requiredWorkMinutes ?? 480
        ),
        thursdayRequiredWorkMinutes: String(
          workplace.thursdayRequiredWorkMinutes ??
            settings.thursdayRequiredWorkMinutes ??
            240
        ),
        thursdayWorkEnd: timeInputValue(
          workplace.thursdayWorkEndHour ?? settings.thursdayWorkEndHour ?? 12,
          workplace.thursdayWorkEndMinute ?? settings.thursdayWorkEndMinute ?? 30
        ),
      };
    }
  }
  Object.assign(workplaceDrafts, workplaceDraftOverrides);

  function updateSettingsDraft(field: keyof SettingsDraft, value: string) {
    setSettingsDraftOverrides((draft) => ({ ...draft, [field]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError("");
    try {
      await update({
        token,
        workingDaysPerMonth: Number(settingsDraft.workingDaysPerMonth),
        primeObjectiveWeightPercent: Number(
          settingsDraft.primeObjectiveWeightPercent
        ),
        primeRecoveryWeightPercent: Number(
          settingsDraft.primeRecoveryWeightPercent
        ),
        primeEvaluationWeightPercent: Number(
          settingsDraft.primeEvaluationWeightPercent
        ),
      });
      setMsg("Paramètres enregistrés");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    }
  }

  function updateWorkplaceDraft(
    workplaceId: Id<"workplaces">,
    field: keyof WorkplaceDraft,
    value: string
  ) {
    setWorkplaceDraftOverrides((drafts) => {
      const draft = workplaceDrafts[workplaceId];
      if (!draft) return drafts;
      return { ...drafts, [workplaceId]: { ...draft, [field]: value } };
    });
  }

  async function onCreateWorkplace(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token || !settings) return;
    setError("");
    setMsg("");
    setWorkplaceBusy(true);
    try {
      const row = await createWorkplace({
        token,
        name: newWorkplaceName,
        description: newWorkplaceDescription,
        schedule: {
          workStartHour: settings.workStartHour,
          workStartMinute: settings.workStartMinute,
          workEndHour: settings.workEndHour ?? 17,
          workEndMinute: settings.workEndMinute ?? 0,
          lateToleranceMinutes: settings.lateToleranceMinutes,
          requiredWorkMinutes: settings.requiredWorkMinutes ?? 480,
          thursdayRequiredWorkMinutes:
            settings.thursdayRequiredWorkMinutes ?? 240,
          thursdayWorkEndHour: settings.thursdayWorkEndHour ?? 12,
          thursdayWorkEndMinute: settings.thursdayWorkEndMinute ?? 30,
        },
      });
      setNewWorkplaceName("");
      setNewWorkplaceDescription("");
      if (row) setExpandedWorkplaceId(row._id);
      setNewWorkplaceOpen(false);
      setMsg("Lieu et horaires créés");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setWorkplaceBusy(false);
    }
  }

  async function onSaveWorkplace(
    e: FormEvent<HTMLFormElement>,
    workplaceId: Id<"workplaces">
  ) {
    e.preventDefault();
    if (!token) return;
    const draft = workplaceDrafts[workplaceId];
    if (!draft) return;

    const start = timeParts(draft.workStart);
    const end = timeParts(draft.workEnd);
    const thursdayEnd = timeParts(draft.thursdayWorkEnd);
    setError("");
    setMsg("");
    setWorkplaceBusy(true);
    try {
      await updateWorkplace({
        token,
        workplaceId,
        name: draft.name,
        description: draft.description,
        schedule: {
          workStartHour: start.hour,
          workStartMinute: start.minute,
          workEndHour: end.hour,
          workEndMinute: end.minute,
          lateToleranceMinutes: Number(draft.lateToleranceMinutes),
          requiredWorkMinutes: Number(draft.requiredWorkMinutes),
          thursdayRequiredWorkMinutes: Number(
            draft.thursdayRequiredWorkMinutes
          ),
          thursdayWorkEndHour: thursdayEnd.hour,
          thursdayWorkEndMinute: thursdayEnd.minute,
        },
      });
      setMsg("Lieu et horaires enregistrés");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setWorkplaceBusy(false);
    }
  }

  async function onDeleteWorkplace(workplaceId: Id<"workplaces">) {
    if (!token) return;
    const workplace = workplaces?.find((row) => row._id === workplaceId);
    if (!workplace || !confirm(`Supprimer le lieu « ${workplace.name} » ?`)) {
      return;
    }

    setError("");
    setMsg("");
    setWorkplaceBusy(true);
    try {
      await removeWorkplace({ token, workplaceId });
      setWorkplaceDraftOverrides((drafts) => {
        const remaining = { ...drafts };
        delete remaining[workplaceId];
        return remaining;
      });
      if (expandedWorkplaceId === workplaceId) setExpandedWorkplaceId(null);
      setMsg("Lieu supprimé");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setWorkplaceBusy(false);
    }
  }

  async function onCleanLegacyOvertime() {
    if (
      !token ||
      !window.confirm(
        "Supprimer définitivement l'historique des heures supplémentaires et les primes associées ?"
      )
    ) {
      return;
    }

    setMigrationBusy(true);
    setError("");
    setMsg("");
    let overtimeCursor: string | null = null;
    let attendanceCursor: string | null = null;
    let notificationCursor: string | null = null;
    let overtimeDone = false;
    let attendanceDone = false;
    let notificationDone = false;
    let removedRecords = 0;
    let removedBonuses = 0;
    let updatedAttendances = 0;
    let removedNotifications = 0;

    try {
      while (!overtimeDone || !attendanceDone || !notificationDone) {
        const result: Awaited<ReturnType<typeof cleanLegacyOvertime>> =
          await cleanLegacyOvertime({
            token,
            overtimeCursor,
            overtimeDone,
            attendanceCursor,
            attendanceDone,
            notificationCursor,
            notificationDone,
          });
        overtimeCursor = result.overtimeCursor;
        overtimeDone = result.overtimeDone;
        attendanceCursor = result.attendanceCursor;
        attendanceDone = result.attendanceDone;
        notificationCursor = result.notificationCursor;
        notificationDone = result.notificationDone;
        removedRecords += result.removedRecords;
        removedBonuses += result.removedBonuses;
        updatedAttendances += result.updatedAttendances;
        removedNotifications += result.removedNotifications;
      }

      setMsg(
        `Nettoyage terminé : ${removedRecords} historique(s), ${removedBonuses} prime(s), ${removedNotifications} notification(s) supprimé(s), ${updatedAttendances} pointage(s) mis à jour.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setMigrationBusy(false);
    }
  }

  const weightSum =
    (Number(settingsDraft.primeObjectiveWeightPercent) || 0) +
    (Number(settingsDraft.primeRecoveryWeightPercent) || 0) +
    (Number(settingsDraft.primeEvaluationWeightPercent) || 0);

  return (
    <RequireAuth role="admin">
      <PageShell
        title="Paramètres RH"
        description="Gestion des lieux de travail, horaires et paramètres de calcul des primes."
      >
        <form onSubmit={onSubmit} className="space-y-6">
          <Card className="max-w-lg">
            <h2 className="mb-1 font-semibold text-zinc-900">
              Calcul des primes (%)
            </h2>
            <p className="mb-4 text-sm text-zinc-500">
              Parts de la prime de base dérivée (réalisation × % employé). Si
              l&apos;employé dépasse l&apos;objectif / recouvrement, la part
              correspondante augmente proportionnellement.
            </p>
            <div className="space-y-2">
              <Field label="Part objectif (%)">
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={settingsDraft.primeObjectiveWeightPercent}
                  onChange={(e) =>
                    updateSettingsDraft(
                      "primeObjectiveWeightPercent",
                      e.target.value
                    )
                  }
                />
              </Field>
              <Field label="Part recouvrement (%)">
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={settingsDraft.primeRecoveryWeightPercent}
                  onChange={(e) =>
                    updateSettingsDraft(
                      "primeRecoveryWeightPercent",
                      e.target.value
                    )
                  }
                />
              </Field>
              <Field label="Part évaluation manager (%)">
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={settingsDraft.primeEvaluationWeightPercent}
                  onChange={(e) =>
                    updateSettingsDraft(
                      "primeEvaluationWeightPercent",
                      e.target.value
                    )
                  }
                />
              </Field>
              <p className="text-xs text-zinc-500">
                Total actuel : {weightSum}% (défaut recommandé 80 + 10 + 10 =
                100).
              </p>
              <Field label="Jours ouvrés / mois (pour le calcul DZD)">
                <input
                  type="number"
                  min={1}
                  max={31}
                  className={inputClass}
                  value={settingsDraft.workingDaysPerMonth}
                  onChange={(e) =>
                    updateSettingsDraft("workingDaysPerMonth", e.target.value)
                  }
                />
              </Field>
            </div>
          </Card>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {msg ? <p className="text-sm text-emerald-600">{msg}</p> : null}
          <PrimaryButton type="submit">Enregistrer</PrimaryButton>
        </form>

        <section className="mt-8 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">
              Lieux de travail
            </h2>
            <p className="text-sm text-zinc-500">
              Définissez les horaires, la durée de travail et la tolérance de
              retard pour chaque lieu.
            </p>
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {msg ? <p className="text-sm text-emerald-600">{msg}</p> : null}

          <div className="max-w-lg space-y-2">
            <PrimaryButton
              type="button"
              onClick={() => {
                setError("");
                setNewWorkplaceOpen(true);
              }}
            >
              Ajouter un lieu
            </PrimaryButton>

            <Modal
              open={newWorkplaceOpen}
              onClose={() => {
                if (!workplaceBusy) setNewWorkplaceOpen(false);
              }}
              title="Nouveau lieu de travail"
            >
              <form onSubmit={onCreateWorkplace} className="space-y-3">
                <Field label="Nom">
                  <input
                    required
                    className={inputClass}
                    value={newWorkplaceName}
                    onChange={(e) => setNewWorkplaceName(e.target.value)}
                  />
                </Field>
                <Field label="Description">
                  <input
                    className={inputClass}
                    value={newWorkplaceDescription}
                    onChange={(e) =>
                      setNewWorkplaceDescription(e.target.value)
                    }
                  />
                </Field>
                <p className="text-xs text-zinc-500">
                  Le nouvel espace reprend les horaires par défaut. Vous pourrez
                  ensuite les personnaliser.
                </p>
                {error ? <p className="text-sm text-red-600">{error}</p> : null}
                <PrimaryButton
                  type="submit"
                  disabled={workplaceBusy || !settings}
                  className="w-full"
                >
                  Créer le lieu
                </PrimaryButton>
              </form>
            </Modal>

            {workplaces === undefined ? (
              <Card>
                <p className="text-sm text-zinc-500">
                  Chargement des lieux de travail…
                </p>
              </Card>
            ) : workplaces.length === 0 ? (
              <Card>
                <p className="text-sm text-zinc-500">
                  Aucun lieu de travail. Créez-en un pour définir ses horaires.
                </p>
              </Card>
            ) : (
              workplaces.map((workplace) => {
                const draft = workplaceDrafts[workplace._id];
                if (!draft) return null;

                const isExpanded = expandedWorkplaceId === workplace._id;
                return (
                  <Card key={workplace._id} className="p-0">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() =>
                          setExpandedWorkplaceId(
                            isExpanded ? null : workplace._id
                          )
                        }
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-zinc-900">
                            {workplace.name}
                          </span>
                          <span className="block text-xs text-zinc-500">
                            {workplace.departmentCount} dép. ·{" "}
                            {workplace.employeeCount} coll.
                            {!isExpanded
                              ? ` · ${draft.workStart}–${draft.workEnd}`
                              : ""}
                          </span>
                        </span>
                        <ChevronDown
                          aria-hidden="true"
                          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                      <SecondaryButton
                        type="button"
                        disabled={workplaceBusy}
                        onClick={() => void onDeleteWorkplace(workplace._id)}
                        className="px-3 py-1.5 text-xs"
                      >
                        Supprimer
                      </SecondaryButton>
                    </div>

                    {isExpanded ? (
                      <form
                        onSubmit={(e) =>
                          void onSaveWorkplace(e, workplace._id)
                        }
                        className="space-y-3 border-t border-zinc-100 p-4"
                      >
                      <Field label="Nom">
                        <input
                          required
                          className={inputClass}
                          value={draft.name}
                          onChange={(e) =>
                            updateWorkplaceDraft(
                              workplace._id,
                              "name",
                              e.target.value
                            )
                          }
                        />
                      </Field>
                      <Field label="Description">
                        <input
                          className={inputClass}
                          value={draft.description}
                          onChange={(e) =>
                            updateWorkplaceDraft(
                              workplace._id,
                              "description",
                              e.target.value
                            )
                          }
                        />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Début de journée">
                          <input
                            required
                            type="time"
                            className={inputClass}
                            value={draft.workStart}
                            onChange={(e) =>
                              updateWorkplaceDraft(
                                workplace._id,
                                "workStart",
                                e.target.value
                              )
                            }
                          />
                        </Field>
                        <Field label="Fin de journée">
                          <input
                            required
                            type="time"
                            className={inputClass}
                            value={draft.workEnd}
                            onChange={(e) =>
                              updateWorkplaceDraft(
                                workplace._id,
                                "workEnd",
                                e.target.value
                              )
                            }
                          />
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Durée obligatoire (minutes)">
                          <input
                            required
                            type="number"
                            min={1}
                            className={inputClass}
                            value={draft.requiredWorkMinutes}
                            onChange={(e) =>
                              updateWorkplaceDraft(
                                workplace._id,
                                "requiredWorkMinutes",
                                e.target.value
                              )
                            }
                          />
                        </Field>
                        <Field label="Tolérance de retard (minutes)">
                          <input
                            required
                            type="number"
                            min={0}
                            className={inputClass}
                            value={draft.lateToleranceMinutes}
                            onChange={(e) =>
                              updateWorkplaceDraft(
                                workplace._id,
                                "lateToleranceMinutes",
                                e.target.value
                              )
                            }
                          />
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Jeudi — durée (minutes)">
                          <input
                            required
                            type="number"
                            min={1}
                            className={inputClass}
                            value={draft.thursdayRequiredWorkMinutes}
                            onChange={(e) =>
                              updateWorkplaceDraft(
                                workplace._id,
                                "thursdayRequiredWorkMinutes",
                                e.target.value
                              )
                            }
                          />
                        </Field>
                        <Field label="Jeudi — heure de sortie">
                          <input
                            required
                            type="time"
                            className={inputClass}
                            value={draft.thursdayWorkEnd}
                            onChange={(e) =>
                              updateWorkplaceDraft(
                                workplace._id,
                                "thursdayWorkEnd",
                                e.target.value
                              )
                            }
                          />
                        </Field>
                      </div>
                      <PrimaryButton
                        type="submit"
                        disabled={workplaceBusy}
                        className="w-full"
                      >
                        Enregistrer les horaires
                      </PrimaryButton>
                      </form>
                    ) : null}
                  </Card>
                );
              })
            )}
          </div>
        </section>

        <Card className="mt-8 max-w-lg">
          <h2 className="font-semibold text-zinc-900">
            Nettoyage des anciennes données
          </h2>
          <p className="my-2 text-sm text-zinc-500">
            Supprime l&apos;historique des heures supplémentaires, les primes qui
            y sont liées, leurs notifications et les anciennes valeurs de
            pointage.
          </p>
          <SecondaryButton
            type="button"
            disabled={migrationBusy || !token}
            onClick={onCleanLegacyOvertime}
          >
            {migrationBusy
              ? "Nettoyage en cours…"
              : "Supprimer les anciennes données"}
          </SecondaryButton>
        </Card>
      </PageShell>
    </RequireAuth>
  );
}
