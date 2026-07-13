"use server";

import { createClient } from "@/lib/supabase/server";
import type { SuitabilityCompleto } from "@/lib/suitability/schema";
import { calcularScoreSuitability, classificarPerfil } from "@/lib/suitability/score";

export type AcaoResultado = { error?: string };

/**
 * Salva um novo preenchimento do questionário de suitability.
 * Usado tanto no cadastro inicial quanto em "Refazer avaliação de perfil"
 * (Configurações). Sempre insere uma linha NOVA — nunca sobrescreve o
 * histórico, importante para rastreabilidade/compliance.
 */
export async function salvarSuitability(
  input: SuitabilityCompleto
): Promise<AcaoResultado & { perfilResultado?: ReturnType<typeof classificarPerfil> }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const score = calcularScoreSuitability(input);
  const perfil_resultado = classificarPerfil(score);

  const { error: insertError } = await supabase.from("investor_suitability").insert({
    profile_id: user.id,
    objetivo_investimento: input.objetivo_investimento,
    horizonte_investimento: input.horizonte_investimento,
    necessidade_liquidez: input.necessidade_liquidez,
    renda_mensal: input.renda_mensal,
    patrimonio_total: input.patrimonio_total,
    percentual_patrimonio_a_investir: input.percentual_patrimonio_a_investir,
    conhecimento_mercado: input.conhecimento_mercado,
    experiencia_renda_fixa: input.experiencia_renda_fixa,
    experiencia_fundos: input.experiencia_fundos,
    experiencia_acoes: input.experiencia_acoes,
    experiencia_derivativos: input.experiencia_derivativos,
    tolerancia_perda: input.tolerancia_perda,
    percentual_perda_aceitavel: input.percentual_perda_aceitavel,
    reacao_a_perda: input.reacao_a_perda,
    score,
    perfil_resultado,
  });

  if (insertError) {
    return { error: "Não foi possível salvar seu perfil de investidor. Tente novamente." };
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ cadastro_completo: true })
    .eq("id", user.id);

  if (updateError) {
    return { error: "Perfil salvo, mas houve um erro ao finalizar o cadastro." };
  }

  return { perfilResultado: perfil_resultado };
}
