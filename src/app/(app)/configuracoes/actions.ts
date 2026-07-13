"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { DadosPessoaisEditavel, TrocarSenhaForm } from "@/lib/suitability/schema";

export type AcaoResultado = { error?: string };

export type DadosConfiguracoes = {
  email: string;
  temSenha: boolean;
  conectadoGoogle: boolean;
  perfil: {
    full_name: string | null;
    cpf: string | null;
    birth_date: string | null;
    phone: string | null;
  };
  suitability: {
    perfil_resultado: string;
    score: number;
    created_at: string;
  } | null;
};

/**
 * Carrega os dados exibidos na aba Configurações: dados pessoais, status da
 * conta (email/senha, vínculo com Google) e o perfil de suitability vigente.
 */
export async function obterDadosConfiguracoes(): Promise<DadosConfiguracoes | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, cpf, birth_date, phone")
    .eq("id", user.id)
    .single();

  const { data: suitability } = await supabase
    .from("current_investor_suitability")
    .select("perfil_resultado, score, created_at")
    .eq("profile_id", user.id)
    .single();

  const identities = user.identities ?? [];

  return {
    email: user.email ?? "",
    temSenha: identities.some((i) => i.provider === "email"),
    conectadoGoogle: identities.some((i) => i.provider === "google"),
    perfil: {
      full_name: profile?.full_name ?? null,
      cpf: profile?.cpf ?? null,
      birth_date: profile?.birth_date ?? null,
      phone: profile?.phone ?? null,
    },
    suitability: suitability
      ? {
          perfil_resultado: suitability.perfil_resultado,
          score: suitability.score,
          created_at: suitability.created_at,
        }
      : null,
  };
}

/**
 * Atualiza nome, data de nascimento e telefone. O CPF não entra aqui de
 * propósito — é identidade do investidor e fica travado após o cadastro.
 */
export async function salvarDadosPessoaisConfig(
  input: DadosPessoaisEditavel
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
      birth_date: input.birth_date,
      phone: input.phone,
    })
    .eq("id", user.id);

  if (error) {
    return { error: "Não foi possível salvar seus dados. Tente novamente." };
  }

  return {};
}

/**
 * Troca a senha de quem já tem uma, ou define a primeira senha para quem
 * entrou apenas via Google (o Supabase aceita `updateUser({ password })`
 * nos dois casos, associando a credencial de email/senha à mesma conta).
 */
export async function trocarSenha(input: TrocarSenhaForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.auth.updateUser({ password: input.novaSenha });

  if (error) {
    return { error: "Não foi possível salvar a nova senha. Tente novamente." };
  }

  return {};
}

export async function sairDaConta() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
