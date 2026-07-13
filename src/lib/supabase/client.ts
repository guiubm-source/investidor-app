import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente Supabase para uso em Client Components (roda no navegador).
 * Usa as chaves públicas (URL + anon key), seguras para expor no front-end
 * porque toda a proteção de dados fica a cargo das políticas de RLS no banco.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
