"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export type LoginState = {
  error?: string;
};

export async function loginComEmailSenha(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Preencha email e senha." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Mensagens genéricas por segurança (não revelar se o email existe ou não).
    if (error.message.toLowerCase().includes("invalid login credentials")) {
      return { error: "Email ou senha incorretos." };
    }
    if (error.message.toLowerCase().includes("email not confirmed")) {
      return { error: "Confirme seu email antes de entrar. Verifique sua caixa de entrada." };
    }
    return { error: "Não foi possível entrar. Tente novamente em instantes." };
  }

  redirect("/dashboard");
}

export async function loginComGoogle() {
  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=/dashboard`,
    },
  });

  if (error || !data.url) {
    redirect("/login?erro=google");
  }

  redirect(data.url);
}
