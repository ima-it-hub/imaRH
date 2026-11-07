"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { AuthProvider } from "@/lib/auth";

const convexUrl =
  process.env.NEXT_PUBLIC_CONVEX_URL?.trim() ||
  "https://placeholder.convex.cloud";

if (!process.env.NEXT_PUBLIC_CONVEX_URL?.trim()) {
  console.warn(
    "NEXT_PUBLIC_CONVEX_URL is missing. Run `npx convex dev` to create it."
  );
}

const convex = new ConvexReactClient(convexUrl);

export function ConvexClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ConvexProvider client={convex}>
      <AuthProvider>{children}</AuthProvider>
    </ConvexProvider>
  );
}
