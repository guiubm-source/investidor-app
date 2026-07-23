"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { DadosPessoais } from "@/lib/suitability/schema";

export type AcaoResultado = { error?: string };

/**
 * Etapa 1 do cadastro: cria a conta (email + senha).
 * O registro em "profiles" é criado automaticamente por trigger no banco
 * (ver supabase/schema.sql -> handle_new_user).
 */
export async function criarConta(input: {
  email: string;
  password: string;
}): Promise<AcaoResultado & { sessaoCriada: boolean }> {
  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/cadastro`,
    },
  });

  if (error) {
    // Mensagem propositalmente genérica (não confirma nem nega se o email já
    // tem conta) — evita enumeração de contas via esta tela, mesmo padrão já
    // usado em esqueci-senha/actions.ts e login/actions.ts (ver docs/MAPA-DE-DADOS.md §8.59).
    return {
      error:
        "Não foi possível concluir o cadastro com os dados informados. Se você já tem uma conta com esse email, faça login ou use \"Esqueci minha senha\"; caso contrário, tente novamente em instantes.",
      sessaoCriada: false,
    };
  }

  return { sessaoCriada: !!data.session };
}

export async function criarContaComGoogle() {
  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=/cadastro`,
    },
  });

  if (error || !data.url) {
    redirect("/cadastro?erro=google");
  }

  redirect(data.url);
}

/**
 * Etapa 2: dados pessoais. Exige usuário autenticado.
 */
export async function salvarDadosPessoais(
  input: DadosPessoais
): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: input.full_name,
      cpf: input.cpf,
      birth_date: input.birth_date,
      phone: input.phone,
    })
    .eq("id", user.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "Este CPF já está cadastrado em outra conta." };
    }
    return { error: "Não foi possível salvar seus dados. Tente novamente." };
  }

  return {};
}

export type StatusCadastro = {
  autenticado: boolean;
  emailConfirmado: boolean;
  dadosPessoaisPreenchidos: boolean;
  cadastroCompleto: boolean;
  email?: string;
};

export async function obterStatusCadastro(): Promise<StatusCadastro> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      autenticado: false,
      emailConfirmado: false,
      dadosPessoaisPreenchidos: false,
      cadastroCompleto: false,
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, cpf, birth_date, phone, cadastro_completo")
    .eq("id", user.id)
    .single();

  return {
    autenticado: true,
    emailConfirmado: !!user.email_confirmed_at,
    dadosPessoaisPreenchidos: !!(profile?.full_name && profile?.cpf),
    cadastroCompleto: !!profile?.cadastro_completo,
    email: user.email,
  };
}
