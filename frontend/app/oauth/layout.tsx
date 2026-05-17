import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";

/**
 * GHB-188 — layout for OAuth-flow pages (currently just `/oauth/authorize`).
 *
 * Mirrors `/app/layout.tsx` in providing AuthProvider so `<Guard>` and any
 * Privy hooks work during SSR/prerender. Intentionally omits the `app-shell`
 * wrapper — OAuth consent is a standalone screen without the in-app chrome
 * (no nav, no footer).
 */
export default function OAuthLayout({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
