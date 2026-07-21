/**
 * Leitura de regras fiscais versionadas (§8.32.4 item 3, tabelas
 * `ir_versoes_regra`/`ir_parametros_regra`). Sem `"use server"` de
 * propósito — não é Server Action, só helper de leitura chamado a partir de
 * `lib/ir/actions.ts` (mesmo padrão de `lib/ativos/posicao-calculo.ts`: só
 * arquivos que exportam Server Action precisam do diretiva, e ela proíbe
 * misturar com funções não-async, então mantemos os dois tipos de arquivo
 * separados).
 */

import { createClient } from "@/lib/supabase/server";
import type { VersaoRegra, ParametroRegra } from "../tipos";

/**
 * Busca a versão de regras vigente pra uma jurisdição/exercício. Não existe
 * fallback silencioso pra "última versão qualquer" — se não houver versão
 * cadastrada pro exercício pedido, quem chama recebe `null` e decide (abrir
 * pendência, bloquear, etc.), nunca inventamos um valor (§8.32.4 item 4).
 */
export async function obterVersaoRegraVigente(
  jurisdicao: "brasil" | "estados_unidos",
  exercicio: number
): Promise<VersaoRegra | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ir_versoes_regra")
    .select("id, jurisdicao, exercicio, ano_calendario, nome, versao, status, fonte_oficial")
    .eq("jurisdicao", jurisdicao)
    .eq("exercicio", exercicio)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`obterVersaoRegraVigente: falha ao ler ir_versoes_regra — ${error.message}`);
  if (!data) return null;

  return {
    id: data.id as string,
    jurisdicao: data.jurisdicao as "brasil" | "estados_unidos",
    exercicio: data.exercicio as number | null,
    anoCalendario: data.ano_calendario as number | null,
    nome: data.nome as string,
    versao: data.versao as string,
    status: data.status as VersaoRegra["status"],
    fonteOficial: data.fonte_oficial as string | null,
  };
}

/** Todos os parâmetros de uma versão de regra, indexados por `chave`. */
export async function obterParametrosRegra(versaoRegraId: string): Promise<Map<string, ParametroRegra>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ir_parametros_regra")
    .select("chave, valor_numero, valor_texto, valor_json, unidade, observacao")
    .eq("versao_regra_id", versaoRegraId);

  if (error) throw new Error(`obterParametrosRegra: falha ao ler ir_parametros_regra — ${error.message}`);

  const mapa = new Map<string, ParametroRegra>();
  for (const p of data ?? []) {
    mapa.set(p.chave as string, {
      chave: p.chave as string,
      valorNumero: p.valor_numero !== null ? Number(p.valor_numero) : null,
      valorTexto: p.valor_texto as string | null,
      valorJson: p.valor_json,
      unidade: p.unidade as string | null,
      observacao: p.observacao as string | null,
    });
  }
  return mapa;
}
