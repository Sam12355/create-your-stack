import { createFileRoute } from "@tanstack/react-router";

// Serves the public Supabase connection values to the browser as a tiny script.
// These are publishable (anon) values — safe to expose. The service-role key is
// never sent here.
export const Route = createFileRoute("/api/public/config.js")({
  server: {
    handlers: {
      GET: async () => {
        const cfg = {
          url: process.env["VYBE_SUPABASE_URL"] ?? "",
          key: process.env["VYBE_SUPABASE_PUBLISHABLE_KEY"] ?? "",
        };
        return new Response(`window.__VYBE_CFG=${JSON.stringify(cfg)};`, {
          headers: {
            "content-type": "application/javascript; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
