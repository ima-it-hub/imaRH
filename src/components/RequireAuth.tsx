"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { canAccessPage, getDefaultHref, type PageKey } from "@/lib/pages";

type RequireAuthProps = {
  children: React.ReactNode;
  role?: "admin" | "employee";
  page?: PageKey;
};

export function RequireAuth({ children, role, page }: RequireAuthProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const allowed =
    !page ||
    user?.role !== "employee" ||
    canAccessPage(user.allowedPages, page, user.role, user.department);

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      if (pathname !== "/login") router.replace("/login");
      return;
    }

    if (role === "admin" && user.role !== "admin") {
      const dest = getDefaultHref(user.role);
      if (dest !== pathname) router.replace(dest);
      return;
    }

    if (
      role === "employee" &&
      user.role !== "employee" &&
      user.role !== "admin"
    ) {
      const dest = getDefaultHref(user.role);
      if (dest !== pathname) router.replace(dest);
      return;
    }

    if (!allowed) {
      const fallback = getDefaultHref(user.role);
      if (fallback !== pathname) router.replace(fallback);
    }
  }, [
    user,
    isLoading,
    role,
    router,
    pathname,
    allowed,
  ]);

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0088E8] border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;
  if (role === "admin" && user.role !== "admin") return null;
  if (!allowed) return null;

  return <>{children}</>;
}
