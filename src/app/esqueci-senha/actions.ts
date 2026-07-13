"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

export type EsqueciSenhaState = {
  error?: string;
  sucesso?: boolean;
};

export async function enviarEmailRecuperacao(
  _prevState: EsqueciSenhaState,
  formData: FormData
): Promise<EsqueciSenhaState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Informe seu email." };

  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/redefinir-senha`,
  });

  // Sempre retorna sucesso, mesmo se o email não existir (evita enumeração de contas).
  return { sucesso: true };
}
