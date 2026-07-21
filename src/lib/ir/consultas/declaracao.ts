/**
 * Leitura/criação de declaração + perfil fiscal (§8.32.11/§8.32.12). Sem
 * `"use server"` — helper interno chamado só a partir de `lib/ir/actions.ts`
 * (mesmo motivo de `regras/carregar-regras.ts`, ver comentário lá).
 */

import { createClient } from "@/lib/supabase/server";
import { obterVersaoRegraVigente } from "../regras/carregar-regras";
import type { DeclaracaoIR, PerfilFiscalIR } from "../tipos";

/**
 * Exercício "corrente" pra abrir por padrão: ano-calendário em curso + 1
 * (invariante §8.32.31 item 1 — `exercicio = ano_calendario + 1`). Não é
 * "o exercício mais recente com prazo aberto na Receita" (esse cálculo
 * pertenceria a uma regra versionada de calendário, que ainda não existe)
 * — é só o ano que o app está acumulando dado AGORA, pra declarar no ano
 * que vem.
 */
export function exercicioCorrente(): { exercicio: number; anoCalendario: number } {
  const anoCalendario = new Date().getFullYear();
  return { exercicio: anoCalendario + 1, anoCalendario };
}

function mapDeclaracao(d: Record<string, unknown>): DeclaracaoIR {
  return {
    id: d.id as string,
    exercicio: d.exercicio as number,
    anoCalendario: d.ano_calendario as number,
    status: d.status as DeclaracaoIR["status"],
    versaoRegraBrasilId: d.versao_regra_brasil_id as string | null,
    iniciadaEm: d.iniciada_em as string,
    relatorioGeradoEm: d.relatorio_gerado_em as string | null,
  };
}

function mapPerfil(p: Record<string, unknown>): PerfilFiscalIR {
  return {
    id: p.id as string,
    declaracaoId: p.declaracao_id as string,
    residenteBrasil: p.residente_brasil as boolean,
    residenteDesde: p.residente_desde as string | null,
    saidaDefinitiva: p.saida_definitiva as boolean,
    usPerson: p.us_person as boolean,
    cidadaniaEua: p.cidadania_eua as boolean,
    greenCard: p.green_card as boolean,
    nonresidentAlien: p.nonresident_alien as boolean,
    diasPresencaEua: p.dias_presenca_eua as number | null,
    possuiDependentes: p.possui_dependentes as boolean,
    declaracaoConjunta: p.declaracao_conjunta as boolean,
    possuiTrust: p.possui_trust as boolean,
    possuiControladaExterior: p.possui_controlada_exterior as boolean,
    confirmadoEm: p.confirmado_em as string | null,
  };
}

export type DeclaracaoComPerfil = {
  declaracao: DeclaracaoIR;
  perfil: PerfilFiscalIR | null;
  /** `null` quando ainda não existe `ir_versoes_regra` pro exercício — a UI trata isso como pendência de fundação, não estimamos nada (§8.32.4 item 4). */
  versaoRegraEncontrada: boolean;
};

/**
 * Busca (ou cria, se `criarSeNaoExistir`) a declaração do exercício pro
 * usuário logado, junto do perfil fiscal (se já preenchido). `unique
 * (profile_id, exercicio)` no banco garante que nunca existe mais de uma
 * por exercício (§8.32.31 item 2).
 */
export async function obterDeclaracaoAtual(
  exercicioAlvo?: number,
  opts: { criarSeNaoExistir?: boolean } = {}
): Promise<DeclaracaoComPerfil | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { exercicio, anoCalendario } = exercicioAlvo
    ? { exercicio: exercicioAlvo, anoCalendario: exercicioAlvo - 1 }
    : exercicioCorrente();

  const { data: existente, error: erroLeitura } = await supabase
    .from("ir_declaracoes")
    .select("id, exercicio, ano_calendario, status, versao_regra_brasil_id, iniciada_em, relatorio_gerado_em")
    .eq("profile_id", user.id)
    .eq("exercicio", exercicio)
    .maybeSingle();

  if (erroLeitura) throw new Error(`obterDeclaracaoAtual: falha ao ler ir_declaracoes — ${erroLeitura.message}`);

  let declaracaoRaw = existente;

  if (!declaracaoRaw) {
    if (!opts.criarSeNaoExistir) return null;

    const versaoRegra = await obterVersaoRegraVigente("brasil", exercicio);

    const { data: criada, error: erroCriar } = await supabase
      .from("ir_declaracoes")
      .insert({
        profile_id: user.id,
        exercicio,
        ano_calendario: anoCalendario,
        versao_regra_brasil_id: versaoRegra?.id ?? null,
        status: "em_configuracao",
      })
      .select("id, exercicio, ano_calendario, status, versao_regra_brasil_id, iniciada_em, relatorio_gerado_em")
      .single();

    if (erroCriar) throw new Error(`obterDeclaracaoAtual: falha ao criar ir_declaracoes — ${erroCriar.message}`);
    declaracaoRaw = criada;
  }

  const { data: perfilRaw, error: erroPerfil } = await supabase
    .from("ir_perfis_fiscais")
    .select(
      "id, declaracao_id, residente_brasil, residente_desde, saida_definitiva, us_person, cidadania_eua, green_card, nonresident_alien, dias_presenca_eua, possui_dependentes, declaracao_conjunta, possui_trust, possui_controlada_exterior, confirmado_em"
    )
    .eq("declaracao_id", declaracaoRaw.id)
    .maybeSingle();

  if (erroPerfil) throw new Error(`obterDeclaracaoAtual: falha ao ler ir_perfis_fiscais — ${erroPerfil.message}`);

  return {
    declaracao: mapDeclaracao(declaracaoRaw),
    perfil: perfilRaw ? mapPerfil(perfilRaw) : null,
    versaoRegraEncontrada: declaracaoRaw.versao_regra_brasil_id !== null,
  };
}
