import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buscarCotacaoYahoo,
  buscarHistoricoYahoo,
  deriveYahooSymbol,
  TIPOS_COTACAO_AUTOMATICA,
} from "@/lib/ativos/yahoo-finance";
import type { TipoAtivo } from "@/lib/ativos/actions";

/**
 * Cron de cotações — atualiza `preco_atual` de todos os ativos (de todos os
 * usuários) marcados com `cotacao_automatica = true`, via Yahoo Finance
 * (endpoint não-oficial). Ver docs/MAPA-DE-DADOS.md §8.10.
 *
 * Diferente do cron do Dólar (que escreve numa tabela compartilhada única),
 * a fase 1 varre a tabela `ativos` de todos os usuários — cada linha é
 * independente, então uma falha pontual num ticker não impede os outros de
 * atualizar (o endpoint do Yahoo é instável, sem SLA).
 *
 * Fase 2 (ver docs/MAPA-DE-DADOS.md §8.12) mantém `ativo_preco_diario_mercado`
 * — histórico diário COMPARTILHADO por (tipo, ticker), não por ativo/usuário.
 * Processa cada combinação (tipo, ticker) uma única vez por execução, mesmo
 * que vários usuários tenham o mesmo ticker: 1 chamada ao Yahoo serve todo
 * mundo. Na primeira vez que vê uma combinação (sem nenhuma linha ainda),
 * busca o histórico completo (`range=10y`, backfill); nas execuções
 * seguintes só busca os últimos dias (`range=5d`) para capturar o
 * fechamento mais recente sem perder dia por causa de feriado/fim de semana.
 */

export const maxDuration = 60;

function autenticado(request: NextRequest): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return false;

  const header = request.headers.get("authorization");
  if (header === `Bearer ${segredo}`) return true;

  const querySecret = request.nextUrl.searchParams.get("secret");
  if (querySecret === segredo) return true;

  return false;
}

export async function GET(request: NextRequest) {
  if (!autenticado(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: ativos, error: erroConsulta } = await supabase
    .from("ativos")
    .select("id, ticker, tipo")
    .eq("cotacao_automatica", true)
    .in("tipo", TIPOS_COTACAO_AUTOMATICA);

  if (erroConsulta) {
    return NextResponse.json({ error: `Erro ao listar ativos: ${erroConsulta.message}` }, { status: 500 });
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

  return NextResponse.json({
    ok: true,
    total: (ativos ?? []).length,
    atualizados,
    falhas,
    historico: { combinacoes: combinacoesUnicas.size, atualizados: historicoAtualizados, falhas: historicoFalhas },
  });
}
