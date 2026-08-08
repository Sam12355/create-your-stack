import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare global {
  interface Window {
    __VYBE_CFG?: { url: string; key: string };
  }
}

let client: SupabaseClient | null = null;

/**
 * Browser Supabase client. Config is delivered by /api/public/config.js
 * (publishable values only) so it works with an externally connected project.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  const cfg = typeof window !== "undefined" ? window.__VYBE_CFG : undefined;
  if (!cfg?.url || !cfg?.key) {
    throw new Error(
      "Supabase is not configured. Run the schema in supabase/schema.sql and make sure the VYBE_SUPABASE_* secrets are set.",
    );
  }
  client = createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (cfg.key.startsWith("sb_") && h.get("Authorization") === `Bearer ${cfg.key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", cfg.key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  return client;
}

export function isSupabaseConfigured(): boolean {
  const cfg = typeof window !== "undefined" ? window.__VYBE_CFG : undefined;
  return Boolean(cfg?.url && cfg?.key);
}
