"use client";

import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { EmployeeBarcode } from "@/components/EmployeeBarcode";
import { PageShell } from "@/components/PageShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  Badge,
  Card,
  Field,
  PrimaryButton,
  SecondaryButton,
  inputClass,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { APP_PAGES } from "@/lib/pages";
import { formatDate, moneyDZD, todayISOLocal } from "@/lib/format";

const APP_TZ = "Africa/Algiers";

function hireDateInputValue(ms?: number | null) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: APP_TZ });
}

function hireDateToTimestamp(isoDate: string) {
  if (!isoDate) return undefined;
  return new Date(`${isoDate}T12:00:00+01:00`).getTime();
}

export default function AdminEmployesPage() {
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "employee">("employee");
  const [departmentId, setDepartmentId] = useState("");
  const [workplaceId, setWorkplaceId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [baseSalary, setBaseSalary] = useState("85000");
  const [baseBonus, setBaseBonus] = useState("10000");
  const [annualLeaveQuota, setAnnualLeaveQuota] = useState("30");
  const [hireDate, setHireDate] = useState(todayISOLocal());
  const [zktecoUserId, setZktecoUserId] = useState("");

  const users = useQuery(api.users.list, token ? { token } : "skip");
  const workplaces = useQuery(
    api.workplaces.listOptions,
    token ? { token } : "skip"
  );
  const departments = useQuery(
    api.departments.listOptions,
    token
      ? {
          token,
          workplaceId: workplaceId
            ? (workplaceId as Id<"workplaces">)
            : undefined,
        }
      : "skip"
  );
  const allDepartments = useQuery(
    api.departments.listOptions,
    token ? { token } : "skip"
  );
  const managers = useQuery(api.users.listManagers, token ? { token } : "skip");
  const createUser = useMutation(api.users.create);
  const updatePages = useMutation(api.users.updatePages);
  const setActive = useMutation(api.users.setActive);
  const resign = useMutation(api.users.resign);
  const updateEmployee = useMutation(api.users.updateEmployee);
  const ensureBarcodes = useMutation(api.users.ensureBarcodes);
  const [allowedPages, setAllowedPages] = useState<string[]>(
    APP_PAGES.map((p) => p.key)
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<Id<"users"> | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users ?? []).filter((u) => {
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q) ||
        (u.workplace ?? "").toLowerCase().includes(q)
      );
    });
  }, [users, search]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (password.trim().length < 4) {
      setError("Le mot de passe doit contenir au moins 4 caractères");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (role === "employee" && !managerId) {
        setError("Sélectionnez un manager pour l'employé");
        setBusy(false);
        return;
      }
      if (role === "employee" && !departmentId) {
        setError("Sélectionnez un département");
        setBusy(false);
        return;
      }
      if (role === "employee" && !workplaceId) {
        setError("Sélectionnez un lieu de travail");
        setBusy(false);
        return;
      }
      await createUser({
        token,
        firstName,
        lastName,
        username,
        email: email || undefined,
        password,
        role,
        allowedPages: role === "admin" ? [] : allowedPages,
        departmentId: departmentId
          ? (departmentId as Id<"departments">)
          : undefined,
        workplaceId: workplaceId
          ? (workplaceId as Id<"workplaces">)
          : undefined,
        managerId:
          role === "employee" && managerId
            ? (managerId as Id<"users">)
            : undefined,
        baseSalary: Number(baseSalary) || 0,
        baseBonus: role === "employee" ? Number(baseBonus) || 0 : 0,
        annualLeaveQuota: Number(annualLeaveQuota) || 30,
        hireDate: hireDateToTimestamp(hireDate),
        zktecoUserId:
          role === "employee" && zktecoUserId.trim()
            ? zktecoUserId.trim()
            : undefined,
      });
      setSuccess("Collaborateur créé");
      setFirstName("");
      setLastName("");
      setUsername("");
      setEmail("");
      setPassword("");
      setDepartmentId("");
      setWorkplaceId("");
      setManagerId("");
      setBaseBonus("10000");
      setHireDate(todayISOLocal());
      setZktecoUserId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function onTogglePage(
    userId: Id<"users">,
    current: string[],
    pageKey: string
  ) {
    if (!token) return;
    const next = current.includes(pageKey)
      ? current.filter((p) => p !== pageKey)
      : [...current, pageKey];
    await updatePages({ token, userId, allowedPages: next });
  }

  return (
    <RequireAuth role="admin">
      <PageShell
        title="Gestion des collaborateurs"
        description="Création, accès aux pages, salaires et activation des comptes."
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            className={inputClass + " max-w-md"}
            placeholder="Rechercher un employé…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <SecondaryButton
            type="button"
            onClick={async () => {
              if (!token) return;
              try {
                const result = await ensureBarcodes({ token });
                setSuccess(
                  result.created > 0
                    ? `${result.created} code-barres généré(s)`
                    : "Tous les employés ont déjà un code-barres"
                );
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Erreur code-barres"
                );
              }
            }}
          >
            Générer codes-barres manquants
          </SecondaryButton>
        </div>

        <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
          <Card>
            <h2 className="font-semibold text-zinc-900">Ajouter un employé</h2>
            <form onSubmit={onCreate} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Prénom">
                  <input
                    required
                    className={inputClass}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </Field>
                <Field label="Nom">
                  <input
                    required
                    className={inputClass}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Nom d'utilisateur">
                <input
                  required
                  minLength={3}
                  className={inputClass}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ex. a.benali"
                />
              </Field>
              <Field label="E-mail (optionnel)">
                <input
                  type="email"
                  className={inputClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Mot de passe">
                <input
                  required
                  type="password"
                  minLength={4}
                  className={inputClass}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="Rôle">
                <select
                  className={inputClass}
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as "admin" | "employee")
                  }
                >
                  <option value="employee">Employé</option>
                  <option value="admin">Admin / RH</option>
                </select>
              </Field>
              <Field label="Lieu de travail">
                <select
                  className={inputClass}
                  value={workplaceId}
                  onChange={(e) => {
                    setWorkplaceId(e.target.value);
                    setDepartmentId("");
                  }}
                  required={role === "employee"}
                >
                  <option value="">Choisir…</option>
                  {(workplaces ?? []).map((w) => (
                    <option key={w._id} value={w._id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Département">
                <select
                  className={inputClass}
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  required={role === "employee"}
                  disabled={!workplaceId}
                >
                  <option value="">
                    {workplaceId
                      ? "Choisir…"
                      : "Choisir un lieu de travail d'abord"}
                  </option>
                  {(departments ?? []).map((d) => (
                    <option key={d._id} value={d._id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              {role === "employee" ? (
                <>
                  <Field label="Manager">
                    <select
                      required
                      className={inputClass}
                      value={managerId}
                      onChange={(e) => setManagerId(e.target.value)}
                    >
                      <option value="">Choisir…</option>
                      {(managers ?? []).map((m) => (
                        <option key={m._id} value={m._id}>
                          {m.name} ({m.role})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Prime de base (DZD)">
                    <input
                      required
                      type="number"
                      min={1}
                      className={inputClass}
                      value={baseBonus}
                      onChange={(e) => setBaseBonus(e.target.value)}
                    />
                  </Field>
                </>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Salaire de base">
                  <input
                    type="number"
                    className={inputClass}
                    value={baseSalary}
                    onChange={(e) => setBaseSalary(e.target.value)}
                  />
                </Field>
                <Field label="Quota congés">
                  <input
                    type="number"
                    className={inputClass}
                    value={annualLeaveQuota}
                    onChange={(e) => setAnnualLeaveQuota(e.target.value)}
                  />
                </Field>
              </div>
              {role === "employee" ? (
                <>
                  <Field label="Date d'embauche">
                    <input
                      type="date"
                      required
                      className={inputClass}
                      value={hireDate}
                      onChange={(e) => setHireDate(e.target.value)}
                    />
                  </Field>
                  <Field label="ID ZKTeco (empreinte)">
                    <input
                      className={inputClass}
                      value={zktecoUserId}
                      onChange={(e) => setZktecoUserId(e.target.value)}
                      placeholder="ex. 1 — ID machine K50 Pro"
                    />
                  </Field>
                </>
              ) : null}

              {role === "employee" ? (
                <div className="rounded-xl bg-zinc-50 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase text-zinc-500">
                    Pages visibles
                  </p>
                  <div className="space-y-2">
                    {APP_PAGES.map((page) => (
                      <label
                        key={page.key}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="accent-[#0088E8]"
                          checked={allowedPages.includes(page.key)}
                          onChange={() =>
                            setAllowedPages((prev) =>
                              prev.includes(page.key)
                                ? prev.filter((p) => p !== page.key)
                                : [...prev, page.key]
                            )
                          }
                        />
                        {page.label}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              {success ? (
                <p className="text-sm text-emerald-600">{success}</p>
              ) : null}
              <PrimaryButton type="submit" disabled={busy} className="w-full">
                Créer
              </PrimaryButton>
            </form>
          </Card>

          <div className="space-y-3">
            {filtered.map((u) => {
              const expanded = expandedId === u._id;
              return (
                <div
                  key={u._id}
                  className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
                >
                  <div className="flex items-start gap-3 px-5 py-4">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId((id) => (id === u._id ? null : u._id))
                      }
                      className="min-w-0 flex-1 text-left transition hover:opacity-80"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-zinc-900">{u.name}</h3>
                        <Badge
                          className={
                            u.role === "admin"
                              ? "bg-[#0088E8]/10 text-[#0088E8]"
                              : "bg-zinc-100 text-zinc-600"
                          }
                        >
                          {u.role}
                        </Badge>
                        {u.resignedAt ? (
                          <Badge className="bg-red-50 text-red-700">
                            démission
                          </Badge>
                        ) : !u.isActive ? (
                          <Badge className="bg-amber-50 text-amber-700">
                            inactif
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-zinc-500">
                        @{u.username || "—"}
                        {u.email ? ` · ${u.email}` : ""}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {u.department || "Sans département"}
                        {u.workplace ? ` · ${u.workplace}` : ""} ·{" "}
                        {moneyDZD(u.baseSalary)} ·{" "}
                        Prime base {moneyDZD(u.baseBonus)}{" "}
                        · Solde congés {u.annualLeaveBalance}/
                        {u.annualLeaveQuota}
                        {u.hireDate
                          ? ` · Embauche ${formatDate(u.hireDate)}`
                          : ""}
                      </p>
                      {u.managerName ? (
                        <p className="text-xs text-zinc-400">
                          Manager : {u.managerName}
                        </p>
                      ) : null}
                      {!expanded ? (
                        <p className="mt-1 text-xs text-zinc-400">
                          {u.role === "admin"
                            ? "Accès complet au back-office RH"
                            : "Cliquer pour voir badge, pages et fiche"}
                        </p>
                      ) : null}
                    </button>

                    <div className="flex shrink-0 items-center gap-2">
                      {u.role === "employee" && !u.resignedAt ? (
                        <SecondaryButton
                          type="button"
                          className="border-red-200 text-red-700 hover:bg-red-50"
                          onClick={async () => {
                            if (!token) return;
                            if (
                              !confirm(
                                `Enregistrer la démission de ${u.name} ? Le compte sera désactivé.`
                              )
                            ) {
                              return;
                            }
                            try {
                              await resign({ token, userId: u._id });
                              setSuccess(`Démission enregistrée : ${u.name}`);
                            } catch (err) {
                              setError(
                                err instanceof Error ? err.message : "Erreur"
                              );
                            }
                          }}
                        >
                          Démission
                        </SecondaryButton>
                      ) : null}
                      {!u.resignedAt ? (
                        <SecondaryButton
                          type="button"
                          onClick={() => {
                            if (!token) return;
                            void setActive({
                              token,
                              userId: u._id,
                              isActive: !u.isActive,
                            });
                          }}
                        >
                          {u.isActive ? "Désactiver" : "Activer"}
                        </SecondaryButton>
                      ) : null}
                      <button
                        type="button"
                        aria-label={expanded ? "Réduire" : "Développer"}
                        onClick={() =>
                          setExpandedId((id) => (id === u._id ? null : u._id))
                        }
                        className="rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
                      >
                        <ChevronDown
                          className={`h-5 w-5 transition-transform ${
                            expanded ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {expanded ? (
                    <div className="border-t border-zinc-100 px-5 pb-5 pt-4">
                      {u.role === "employee" ? (
                        <>
                          <div>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                              Badge pointage
                            </p>
                            <EmployeeBarcode value={u.barcode} name={u.name} />
                          </div>

                          <div className="mt-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                              Pages visibles
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {APP_PAGES.map((page) => {
                                const checked = u.allowedPages.includes(
                                  page.key
                                );
                                return (
                                  <label
                                    key={page.key}
                                    className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                                      checked
                                        ? "border-[#0088E8]/30 bg-[#0088E8]/5"
                                        : "border-zinc-200 bg-zinc-50"
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="accent-[#0088E8]"
                                      checked={checked}
                                      onChange={() =>
                                        onTogglePage(
                                          u._id,
                                          u.allowedPages,
                                          page.key
                                        )
                                      }
                                    />
                                    {page.label}
                                  </label>
                                );
                              })}
                            </div>
                          </div>

                          <EmployeeQuickEdit
                            user={u}
                            token={token!}
                            departments={allDepartments ?? []}
                            workplaces={workplaces ?? []}
                            managers={(managers ?? []).filter(
                              (m) => m._id !== u._id
                            )}
                            onSave={updateEmployee}
                          />
                        </>
                      ) : (
                        <p className="text-sm text-zinc-500">
                          Accès complet au back-office RH.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </PageShell>
    </RequireAuth>
  );
}

function EmployeeQuickEdit({
  user,
  token,
  departments,
  workplaces,
  managers,
  onSave,
}: {
  user: {
    _id: Id<"users">;
    firstName: string;
    lastName: string;
    department: string;
    departmentId: Id<"departments"> | null;
    workplaceId?: Id<"workplaces"> | null;
    managerId: Id<"users"> | null;
    phone: string;
    baseSalary: number;
    baseBonus: number;
    annualLeaveQuota: number;
    annualLeaveBalance: number;
    hireDate?: number | null;
    zktecoUserId?: string;
  };
  token: string;
  departments: {
    _id: Id<"departments">;
    name: string;
    workplaceId?: Id<"workplaces"> | null;
  }[];
  workplaces: {
    _id: Id<"workplaces">;
    name: string;
  }[];
  managers: { _id: Id<"users">; name: string; role: string }[];
  onSave: (args: {
    token: string;
    userId: Id<"users">;
    firstName: string;
    lastName: string;
    departmentId?: Id<"departments">;
    workplaceId?: Id<"workplaces">;
    managerId?: Id<"users">;
    phone: string;
    baseSalary: number;
    baseBonus: number;
    annualLeaveQuota: number;
    annualLeaveBalance: number;
    hireDate?: number;
    zktecoUserId?: string;
  }) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    firstName: user.firstName,
    lastName: user.lastName,
    departmentId: user.departmentId ?? "",
    workplaceId: user.workplaceId ?? "",
    managerId: user.managerId ?? "",
    phone: user.phone,
    baseSalary: user.baseSalary,
    baseBonus: user.baseBonus,
    annualLeaveQuota: user.annualLeaveQuota,
    annualLeaveBalance: user.annualLeaveBalance,
    hireDate: hireDateInputValue(user.hireDate),
    zktecoUserId: user.zktecoUserId ?? "",
  });
  const [msg, setMsg] = useState("");

  const departmentsForWorkplace = departments.filter(
    (d) =>
      !form.workplaceId ||
      d.workplaceId === (form.workplaceId as Id<"workplaces">)
  );

  return (
    <div className="mt-4 border-t border-zinc-100 pt-4">
      <SecondaryButton type="button" onClick={() => setOpen((v) => !v)}>
        {open ? "Fermer la fiche" : "Modifier la fiche"}
      </SecondaryButton>
      {open ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Field label="Prénom">
            <input
              className={inputClass}
              value={form.firstName}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, firstName: e.target.value }))
              }
            />
          </Field>
          <Field label="Nom">
            <input
              className={inputClass}
              value={form.lastName}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, lastName: e.target.value }))
              }
            />
          </Field>
          <Field label="Lieu de travail">
            <select
              className={inputClass}
              value={form.workplaceId}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  workplaceId: e.target.value,
                  departmentId: "",
                }))
              }
            >
              <option value="">Choisir…</option>
              {workplaces.map((w) => (
                <option key={w._id} value={w._id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Département">
            <select
              className={inputClass}
              value={form.departmentId}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, departmentId: e.target.value }))
              }
            >
              <option value="">Choisir…</option>
              {departmentsForWorkplace.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Manager">
            <select
              className={inputClass}
              value={form.managerId}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, managerId: e.target.value }))
              }
            >
              <option value="">Choisir…</option>
              {managers.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Téléphone">
            <input
              className={inputClass}
              value={form.phone}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, phone: e.target.value }))
              }
            />
          </Field>
          <Field label="Salaire de base">
            <input
              type="number"
              className={inputClass}
              value={form.baseSalary}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  baseSalary: Number(e.target.value),
                }))
              }
            />
          </Field>
          <Field label="Prime de base (DZD)">
            <input
              required
              type="number"
              min={1}
              className={inputClass}
              value={form.baseBonus}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  baseBonus: Number(e.target.value),
                }))
              }
            />
          </Field>
          <Field label="Date d'embauche">
            <input
              type="date"
              required
              className={inputClass}
              value={form.hireDate}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, hireDate: e.target.value }))
              }
            />
          </Field>
          <Field label="ID ZKTeco (empreinte)">
            <input
              className={inputClass}
              value={form.zktecoUserId}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, zktecoUserId: e.target.value }))
              }
              placeholder="ex. 1"
            />
          </Field>
          <Field label="Quota congés">
            <input
              type="number"
              className={inputClass}
              value={form.annualLeaveQuota}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  annualLeaveQuota: Number(e.target.value),
                }))
              }
            />
          </Field>
          <Field label="Solde congés">
            <input
              type="number"
              className={inputClass}
              value={form.annualLeaveBalance}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  annualLeaveBalance: Number(e.target.value),
                }))
              }
            />
          </Field>
          <div className="flex items-end">
            <PrimaryButton
              type="button"
              onClick={async () => {
                const hireTs = hireDateToTimestamp(form.hireDate);
                if (!hireTs) {
                  setMsg("");
                  return;
                }
                await onSave({
                  token,
                  userId: user._id,
                  firstName: form.firstName,
                  lastName: form.lastName,
                  departmentId: form.departmentId
                    ? (form.departmentId as Id<"departments">)
                    : undefined,
                  workplaceId: form.workplaceId
                    ? (form.workplaceId as Id<"workplaces">)
                    : undefined,
                  managerId: form.managerId
                    ? (form.managerId as Id<"users">)
                    : undefined,
                  phone: form.phone,
                  baseSalary: form.baseSalary,
                  baseBonus: form.baseBonus,
                  annualLeaveQuota: form.annualLeaveQuota,
                  annualLeaveBalance: form.annualLeaveBalance,
                  hireDate: hireTs,
                  zktecoUserId: form.zktecoUserId,
                });
                setMsg("Fiche enregistrée");
              }}
            >
              Enregistrer
            </PrimaryButton>
          </div>
          {msg ? <p className="text-sm text-emerald-600">{msg}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
