import {
  Award,
  Building2,
  Calculator,
  CalendarDays,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Receipt,
  ScanBarcode,
  Settings,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type PageKey =
  | "tableau-de-bord"
  | "pointage-presence"
  | "conges"
  | "finances"
  | "caisse-paiements"
  | "rapports-mensuels"
  | "mon-compte";

/** Staff assigned to Finance / Finances department. */
export function isFinanceDepartment(department?: string | null) {
  const d = (department ?? "").trim().toLowerCase();
  return d.includes("finance");
}

export type NavLink = {
  key: string;
  label: string;
  href: string;
  description?: string;
  icon: LucideIcon;
  pageKey?: PageKey;
};

export const EMPLOYEE_PAGES: NavLink[] = [
  {
    key: "tableau-de-bord",
    label: "Tableau de bord",
    href: "/employe/tableau-de-bord",
    description: "Pointage du jour, solde congés et retards",
    icon: LayoutDashboard,
    pageKey: "tableau-de-bord",
  },
  {
    key: "pointage-presence",
    label: "Pointage & Présence",
    href: "/employe/pointage-presence",
    description: "Historique des entrées/sorties et retards",
    icon: ClipboardList,
    pageKey: "pointage-presence",
  },
  {
    key: "conges",
    label: "Congés",
    href: "/employe/conges",
    description: "Solde annuel, demandes et historique",
    icon: CalendarDays,
    pageKey: "conges",
  },
  {
    key: "finances",
    label: "Finances",
    href: "/employe/finances",
    description: "Salaires, primes et demandes de paiement",
    icon: Wallet,
    pageKey: "finances",
  },
  {
    key: "caisse-paiements",
    label: "Caisse / Paiements",
    href: "/employe/caisse-paiements",
    description: "Régler les demandes validées par l'admin",
    icon: Wallet,
    pageKey: "caisse-paiements",
  },
  {
    key: "rapports-mensuels",
    label: "Rapports mensuels",
    href: "/employe/rapports-mensuels",
    description: "Rapports et évaluations du manager",
    icon: FileText,
    pageKey: "rapports-mensuels",
  },
  {
    key: "mon-compte",
    label: "Mon compte",
    href: "/employe/mon-compte",
    description: "Profil et mot de passe",
    icon: UserRound,
    pageKey: "mon-compte",
  },
];

export const ADMIN_PAGES: NavLink[] = [
  {
    key: "admin-dashboard",
    label: "Tableau de bord",
    href: "/admin/tableau-de-bord",
    icon: LayoutDashboard,
  },
  {
    key: "admin-employes",
    label: "Employés",
    href: "/admin/employes",
    icon: Users,
  },
  {
    key: "admin-departements",
    label: "Départements",
    href: "/admin/departements",
    icon: Building2,
  },
  {
    key: "admin-scan",
    label: "Scan pointage",
    href: "/scan",
    icon: ScanBarcode,
  },
  {
    key: "admin-pointages",
    label: "Pointages & Retards",
    href: "/admin/pointages-et-retards",
    icon: ClipboardList,
  },
  {
    key: "admin-conges",
    label: "Gestion des congés",
    href: "/admin/gestion-conges",
    icon: CalendarDays,
  },
  {
    key: "admin-salaires",
    label: "Salaires",
    href: "/admin/salaires",
    icon: Wallet,
  },
  {
    key: "admin-primes",
    label: "Primes",
    href: "/admin/primes",
    icon: Award,
  },
  {
    key: "admin-calcul-primes",
    label: "Calcul des primes",
    href: "/admin/calcul-primes",
    icon: Calculator,
  },
  {
    key: "admin-ordres",
    label: "Ordres de paiement",
    href: "/admin/ordres-de-paiement",
    icon: Receipt,
  },
  {
    key: "admin-rapports",
    label: "Rapports mensuels",
    href: "/admin/rapports-mensuels",
    icon: FileText,
  },
  {
    key: "admin-parametres",
    label: "Paramètres",
    href: "/admin/parametres",
    icon: Settings,
  },
];

/** Pages assignable in the permissions UI (cash payments are not a toggle). */
export const APP_PAGES = EMPLOYEE_PAGES.filter(
  (p) => p.pageKey !== "caisse-paiements"
);

export function getPageByKey(key: string) {
  return EMPLOYEE_PAGES.find((page) => page.key === key);
}

export function canAccessPage(
  allowedPages: string[] | undefined,
  pageKey: PageKey,
  role?: "admin" | "employee",
  department?: string | null
) {
  if (role === "admin") return true;
  if (pageKey === "tableau-de-bord" || pageKey === "mon-compte") return true;
  if (pageKey === "caisse-paiements") {
    return isFinanceDepartment(department);
  }
  return Boolean(allowedPages?.includes(pageKey));
}

export function getDefaultHref(role: "admin" | "employee") {
  return role === "admin"
    ? "/admin/tableau-de-bord"
    : "/employe/tableau-de-bord";
}
