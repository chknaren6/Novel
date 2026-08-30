import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client, used from "use client" components (currently: the
// operator login page). Reads the two public, safe-to-expose env vars — never the
// service-role key, which must stay server-only.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
