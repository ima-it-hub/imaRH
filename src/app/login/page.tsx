"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScanBarcode } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/lib/auth";
import { getDefaultHref } from "@/lib/pages";

export default function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isLoading || !user) return;
    const dest = getDefaultHref(user.role);
    router.replace(dest);
  }, [user, isLoading, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const loggedIn = await login(username, password);
      router.replace(getDefaultHref(loggedIn.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion échouée");
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading || user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0088E8] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#d9f0ff_0%,#f5f5f7_45%,#ececef_100%)]" />
      <div className="pointer-events-none absolute -left-24 top-20 h-72 w-72 rounded-full bg-[#0088E8]/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 bottom-10 h-64 w-64 rounded-full bg-black/5 blur-3xl" />

      <div className="relative w-full max-w-md rounded-2xl border border-zinc-200/80 bg-white p-8 shadow-[0_20px_60px_rgba(17,17,17,0.08)]">
        <Logo className="mb-6" />

        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-zinc-900">Connexion</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Portail RH IMA Plomberie — espace collaborateur & administration
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="mb-1.5 block text-sm font-medium text-zinc-700"
            >
              Nom d&apos;utilisateur
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-[#0088E8] focus:bg-white focus:ring-2 focus:ring-[#0088E8]/20"
              placeholder="ex. admin"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium text-zinc-700"
            >
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-[#0088E8] focus:bg-white focus:ring-2 focus:ring-[#0088E8]/20"
              placeholder="••••••••"
            />
          </div>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-[#0088E8] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#006FCB] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Connexion…" : "Se connecter"}
          </button>
        </form>

        <Link
          href="/scan"
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:border-[#1E6BFF]/40 hover:bg-[#1E6BFF]/5 hover:text-[#1E6BFF]"
        >
          <ScanBarcode className="h-4 w-4" />
          Terminal de pointage (scan badge)
        </Link>
      </div>
    </div>
  );
}
