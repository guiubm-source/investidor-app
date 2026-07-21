import { createAdminClient } from "@/lib/supabase/admin";
import { buscarCotacaoYahoo, buscarHistoricoYahoo, deriveYahooSymbol, TIPOS_COTACAO_AUTOMATICA } from "./yahoo-finance";
import type { TipoAtivo } from "./actions";

/**
 * Motor compartilhado de atualização de cotações (ver docs/MAPA-DE-DADOS.md
 * §8.49). Extraído de `src/app/api/cron/cotacoes/route.ts` pra ser chamado
 * tanto pelo cron (1x/dia nativo do Vercel + chamadas externas via
 * cron-job.org, ver vercel.json) quanto pelo botão manual "Atualizar
 * cotações" da aba Posição (`atualizarTodasCotacoesAgora`, em
 * `lib/ativos/actions.ts`).
 *
 * Sempre usa o client admin (service role) porque a Fase 2 (histórico
 * compartilhado em `ativo_preco_diario_mercado`) só aceita escrita via
 * service role — RLS dessa tabela só libera SELECT pra usuários
 * autenticados (ver supabase/schema.sql). Isso vale mesmo quando disparado
 * pelo botão manual de um usuário comum: preço de mercado é dado objetivo
 * compartilhado entre todos (§8.12), não pessoal, então atualizar "pra todo
 * mundo de uma vez" ao clicar é o comportamento certo, não um vazamento de
 * dado — é exatamente o mesmo dado que o cron já escreve.
 *
 * Fase 1 atualiza `ativos.preco_atual` de TODOS os usuários (ativos com
 * `cotacao_automatica = true`). Fase 2 faz o backfill/atualização do
 * histórico diário por combinação única (tipo, ticker) — é essa fase 2 que
 * corrige a coluna "Variação hoje" quando ela aparece em branco (ver
 * `obterPrecoAnteriorMercado` em `lib/carteira/posicao.ts`): sem uma linha
 * de "ontem" no histórico, não há base pra calcular a variação.
 */
export type ResultadoAtualizacaoCotacoes = {
  total: number;
  atualizados: number;
  falhas: string[];
  historico: { combinacoes: number; atualizados: number; falhas: string[] };
};

export async function atualizarTodasCotacoes(): Promise<ResultadoAtualizacaoCotacoes> {
  const supabase = createAdminClient();

  const { data: ativos, error: erroConsulta } = await supabase
    .from("ativos")
    .select("id, ticker, tipo")
    .eq("cotacao_automatica", true)
    .in("tipo", TIPOS_COTACAO_AUTOMATICA);

  if (erroConsulta) {
    throw new Error(`Erro ao listar ativos: ${erroConsulta.message}`);
  }

  let atualizados = 0;
  const falhas: string[] = [];

  for (const ativo of ativos ?? []) {
    const symbol = deriveYahooSymbol(ativo.tipo, ativo.ticker);
    if (!symbol) continue;

    const resultado = await buscarCotacaoYahoo(symbol);
    if ("erro" in resultado) {
      falhas.push(`${ativo.ticker}: ${resultado.erro}`);
      continue;
    }

    const { error: erroUpdate } = await supabase
      .from("ativos")
      .update({
        preco_atual: resultado.preco,
        preco_atualizado_em: new Date().toISOString(),
        preco_fonte: "yahoo_finance",
      })
      .eq("id", ativo.id);

    if (erroUpdate) {
      falhas.push(`${ativo.ticker}: erro ao salvar (${erroUpdate.message})`);
      continue;
    }

    atualizados += 1;
  }

  // Fase 2: histórico diário compartilhado por (tipo, ticker) — ver comentário no topo do arquivo.
  const combinacoesUnicas = new Map<string, { tipo: string; ticker: string }>();
  for (const ativo of ativos ?? []) {
    const chave = `${ativo.tipo}|${ativo.ticker}`;
    if (!combinacoesUnicas.has(chave)) combinacoesUnicas.set(chave, { tipo: ativo.tipo, ticker: ativo.ticker });
  }

  let historicoAtualizados = 0;
  const historicoFalhas: string[] = [];

  for (const { tipo, ticker } of combinacoesUnicas.values()) {
    const symbol = deriveYahooSymbol(tipo as TipoAtivo, ticker);
    if (!symbol) continue;

    const { count } = await supabase
      .from("ativo_preco_diario_mercado")
      .select("id", { count: "exact", head: true })
      .eq("tipo", tipo)
      .eq("ticker", ticker);

    const range = (count ?? 0) > 0 ? "5d" : "10y"; // backfill completo só na 1ª vez que vemos o ticker

    const historico = await buscarHistoricoYahoo(symbol, range);
    if ("erro" in historico) {
      historicoFalhas.push(`${ticker}: ${historico.erro}`);
      continue;
    }

    const linhas = historico.pontos.map((p) => ({ tipo, ticker, data: p.data, preco: p.preco }));
    const { error: erroUpsert } = await supabase
      .from("ativo_preco_diario_mercado")
      .upsert(linhas, { onConflict: "tipo,ticker,data" });

    if (erroUpsert) {
      historicoFalhas.push(`${ticker}: erro ao salvar histórico (${erroUpsert.message})`);
      continue;
    }

    historicoAtualizados += 1;
  }

  return {
    total: (ativos ?? []).length,
    atualizados,
    falhas,
    historico: { combinacoes: combinacoesUnicas.size, atualizados: historicoAtualizados, falhas: historicoFalhas },
  };
}
