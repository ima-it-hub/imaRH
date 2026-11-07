"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Redirect to the public kiosk scan page. */
export default function AdminScanRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/scan");
  }, [router]);
  return null;
}
