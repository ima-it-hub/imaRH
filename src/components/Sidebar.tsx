"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { LogOut, Menu, X } from "lucide-react";
import { Fragment, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/lib/auth";
import {
  ADMIN_PAGES,
  EMPLOYEE_PAGES,
  canAccessPage,
  type PageKey,
} from "@/lib/pages";

export function Sidebar() {
  const { user, token, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const pendingBadges = useQuery(
    api.dashboard.navPendingBadges,
    token ? { token } : "skip"
  );
  if (!user) return null;

  const employeeLinks =
    user.role === "admin"
      ? []
      : EMPLOYEE_PAGES.filter((page) =>
          canAccessPage(
            user.allowedPages,
            page.pageKey as PageKey,
            user.role,
            user.department
          )
        );
  const grantedAdminLinks =
    user.role === "admin"
      ? []
      : ADMIN_PAGES.filter((page) =>
          canAccessPage(
            user.allowedPages,
            page.key as PageKey,
            user.role,
            user.department
          )
        );
  const links =
    user.role === "admin"
      ? ADMIN_PAGES
      : [...employeeLinks, ...grantedAdminLinks];

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  const nav = (
    <aside className="flex h-full min-h-0 w-72 flex-col overflow-hidden bg-[#1A2744] text-white">
      <div className="shrink-0 border-b border-white/10 px-5 py-5">
        <Logo variant="compact" />
      </div>

      <nav className="sidebar-scroll min-h-0 flex-1 space-y-1 overflow-x-hidden px-3 py-4">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          {user.role === "admin" ? "Administration RH" : "Espace employé"}
        </p>
        {links.map((link, index) => {
          const active =
            pathname === link.href || pathname.startsWith(link.href + "/");
          const Icon = link.icon;
          const pending = pendingBadges?.[link.key] ?? 0;

          return (
            <Fragment key={link.key}>
              {user.role === "employee" &&
              grantedAdminLinks.length > 0 &&
              index === employeeLinks.length ? (
                <p className="mb-1 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Administration autorisée
                </p>
              ) : null}
              <Link
                href={link.href}
                prefetch={false}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-[#0088E8] text-white"
                    : "text-zinc-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate">{link.label}</span>
                  {pending > 0 ? (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-emerald-400"
                      title={`${pending} en attente`}
                      aria-label={`${pending} en attente de confirmation`}
                    />
                  ) : null}
                </span>
              </Link>
            </Fragment>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-white/10 p-4">
        <div className="mb-3 rounded-lg bg-white/5 px-3 py-2">
          <p className="truncate text-sm font-medium text-white">{user.name}</p>
          <p className="truncate text-xs text-zinc-400">{user.email}</p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-[#0088E8]">
            {user.role === "admin"
              ? "Admin / RH"
              : user.department?.toLowerCase().includes("finance")
                ? "Finance"
                : "Employé"}
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Déconnexion
        </button>
      </div>
    </aside>
  );

  return (
    <>
      <div className="fixed inset-y-0 left-0 z-40 hidden h-dvh overflow-hidden lg:block">
        {nav}
      </div>

      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4 lg:hidden">
        <Logo variant="compact" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-zinc-200 p-2 text-zinc-700"
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
            aria-label="Fermer le menu"
          />
          <div className="absolute inset-y-0 left-0 flex">
            {nav}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="m-3 h-10 w-10 rounded-full bg-white text-zinc-800 shadow"
              aria-label="Fermer"
            >
              <X className="mx-auto h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
