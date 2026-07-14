import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Client "admin" (service role) — bypassa RLS. Só para uso em rotas de
 * servidor que não têm sessão de usuário (ex. cron jobs), como
 * `src/app/api/cron/dolar/route.ts`. Nunca importar isso em código que roda
 * no navegador nem em Server Actions/Components que respondem a um usuário
 * logado — para esses casos, use `lib/supabase/client.ts` ou `server.ts`,
 * que respeitam RLS por usuário.
 *
 * Requer `SUPABASE_SERVICE_ROLE_KEY` nas env vars (só no servidor, nunca
 * `NEXT_PUBLIC_*` — ver docs/MAPA-DE-DADOS.md §8.9).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (ou NEXT_PUBLIC_SUPABASE_URL) não configurada — necessária para operações administrativas no servidor."
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
