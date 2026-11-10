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
  associatedAgentCode: string;
  workStart: string;
  workEnd: string;
  lateToleranceMinutes: string;
  breakMinutes: string;
  requiredWorkMinutes: string;
  thursdayRequiredWorkMinutes: string;
  thursdayWorkEnd: string;
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
  const workplaces = useQuery(
    api.workplaces.list,
    token ? { token } : "skip"
  );
  const createWorkplace = useMutation(api.workplaces.create);
  const updateWorkplace = useMutation(api.workplaces.update);
  const removeWorkplace = useMutation(api.workplaces.remove);

  const [newWorkplaceName, setNewWorkplaceName] = useState("");
  const [newWorkplaceDescription, setNewWorkplaceDescription] = useState("");
  const [newWorkplaceAssociatedAgentCode, setNewWorkplaceAssociatedAgentCode] =
    useState("");
  const [newWorkplaceOpen, setNewWorkplaceOpen] = useState(false);
  const [expandedWorkplaceId, setExpandedWorkplaceId] =
    useState<Id<"workplaces"> | null>(null);
  const [workplaceDraftOverrides, setWorkplaceDraftOverrides] = useState<
    Record<string, WorkplaceDraft>
  >({});
  const [workplaceBusy, setWorkplaceBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const workplaceDrafts: Record<string, WorkplaceDraft> = {};
  if (settings && workplaces) {
    for (const workplace of workplaces) {
      workplaceDrafts[workplace._id] = {
        name: workplace.name,
        description: workplace.description ?? "",
        associatedAgentCode: workplace.associatedAgentCode ?? "",
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
        breakMinutes: String(workplace.breakMinutes ?? 0),
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
        associatedAgentCode: newWorkplaceAssociatedAgentCode,
        schedule: {
          workStartHour: settings.workStartHour,
          workStartMinute: settings.workStartMinute,
          workEndHour: settings.workEndHour ?? 17,
          workEndMinute: settings.workEndMinute ?? 0,
          lateToleranceMinutes: settings.lateToleranceMinutes,
          breakMinutes: 0,
          requiredWorkMinutes: settings.requiredWorkMinutes ?? 480,
          thursdayRequiredWorkMinutes:
            settings.thursdayRequiredWorkMinutes ?? 240,
          thursdayWorkEndHour: settings.thursdayWorkEndHour ?? 12,
          thursdayWorkEndMinute: settings.thursdayWorkEndMinute ?? 30,
        },
      });
      setNewWorkplaceName("");
      setNewWorkplaceDescription("");
      setNewWorkplaceAssociatedAgentCode("");
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
        associatedAgentCode: draft.associatedAgentCode,
        schedule: {
          workStartHour: start.hour,
          workStartMinute: start.minute,
          workEndHour: end.hour,
          workEndMinute: end.minute,
          lateToleranceMinutes: Number(draft.lateToleranceMinutes),
          breakMinutes: Number(draft.breakMinutes),
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

  return (
    <RequireAuth page="admin-parametres">
      <PageShell
        title="Paramètres RH"
        description="Gestion des lieux de travail et de leurs horaires."
      >
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
                <Field label="Code AssociatedAgent (Silwan)">
                  <input
                    className={inputClass}
                    value={newWorkplaceAssociatedAgentCode}
                    onChange={(e) =>
                      setNewWorkplaceAssociatedAgentCode(e.target.value)
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
                      <Field label="Code AssociatedAgent (Silwan)">
                        <input
                          className={inputClass}
                          value={draft.associatedAgentCode}
                          onChange={(e) =>
                            updateWorkplaceDraft(
                              workplace._id,
                              "associatedAgentCode",
                              e.target.value
                            )
                          }
                        />
                      </Field>
                      <div className="grid grid-cols-3 gap-3">
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
                        <Field label="Pause (minutes)">
                          <input
                            required
                            type="number"
                            min={0}
                            className={inputClass}
                            value={draft.breakMinutes}
                            onChange={(e) =>
                              updateWorkplaceDraft(
                                workplace._id,
                                "breakMinutes",
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

      </PageShell>
    </RequireAuth>
  );
}
