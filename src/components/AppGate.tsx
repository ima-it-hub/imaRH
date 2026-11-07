"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

/**
 * Auth shell for the app layout.
 * Do not keep route children mounted while logged out — that can make Next
 * repeatedly re-fetch the segment (refresh loop in dev).
 */
export function AppGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;
    if (!user && pathname !== "/login") {
      router.replace("/login");
    }
  }, [user, isLoading, router, pathname]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0088E8] border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
