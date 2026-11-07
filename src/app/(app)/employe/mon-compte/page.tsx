"use client";

import { FormEvent, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { EmployeeBarcode } from "@/components/EmployeeBarcode";
import { PageShell } from "@/components/PageShell";
import { RequireAuth } from "@/components/RequireAuth";
import { Card, Field, PrimaryButton, inputClass } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function MonComptePage() {
  const { token, user } = useAuth();
  const updateProfile = useMutation(api.auth.updateProfile);
  const changePassword = useMutation(api.auth.changePassword);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [profileMsg, setProfileMsg] = useState("");
  const [profileErr, setProfileErr] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");
  const [pwdErr, setPwdErr] = useState("");

  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName || "");
    setLastName(user.lastName || "");
    setPhone(user.phone || "");
  }, [user]);

  async function onProfile(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setProfileMsg("");
    setProfileErr("");
    try {
      await updateProfile({ token, firstName, lastName, phone });
      setProfileMsg("Profil mis à jour");
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : "Erreur");
    }
  }

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setPwdMsg("");
    setPwdErr("");
    try {
      await changePassword({ token, currentPassword, newPassword });
      setPwdMsg("Mot de passe modifié");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setPwdErr(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <RequireAuth role="employee" page="mon-compte">
      <PageShell
        title="Mon compte"
        description="Mettez à jour vos informations personnelles et votre mot de passe."
      >
        {user?.barcode ? (
          <Card className="mb-6 max-w-md">
            <h2 className="mb-3 font-semibold text-zinc-900">
              Badge de pointage
            </h2>
            <EmployeeBarcode value={user.barcode} name={user.name} />
          </Card>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="font-semibold text-zinc-900">Informations personnelles</h2>
            <form onSubmit={onProfile} className="mt-4 space-y-3">
              <Field label="Prénom">
                <input
                  className={inputClass}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </Field>
              <Field label="Nom">
                <input
                  className={inputClass}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </Field>
              <Field label="E-mail">
                <input className={inputClass} value={user?.email ?? ""} disabled />
              </Field>
              <Field label="Téléphone">
                <input
                  className={inputClass}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
              <Field label="Département">
                <input
                  className={inputClass}
                  value={user?.department ?? ""}
                  disabled
                />
              </Field>
              {profileErr ? (
                <p className="text-sm text-red-600">{profileErr}</p>
              ) : null}
              {profileMsg ? (
                <p className="text-sm text-emerald-600">{profileMsg}</p>
              ) : null}
              <PrimaryButton type="submit">Enregistrer</PrimaryButton>
            </form>
          </Card>

          <Card>
            <h2 className="font-semibold text-zinc-900">Sécurité</h2>
            <form onSubmit={onPassword} className="mt-4 space-y-3">
              <Field label="Mot de passe actuel">
                <input
                  type="password"
                  className={inputClass}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </Field>
              <Field label="Nouveau mot de passe">
                <input
                  type="password"
                  minLength={4}
                  className={inputClass}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </Field>
              {pwdErr ? <p className="text-sm text-red-600">{pwdErr}</p> : null}
              {pwdMsg ? (
                <p className="text-sm text-emerald-600">{pwdMsg}</p>
              ) : null}
              <PrimaryButton type="submit">Changer le mot de passe</PrimaryButton>
            </form>
          </Card>
        </div>
      </PageShell>
    </RequireAuth>
  );
}
