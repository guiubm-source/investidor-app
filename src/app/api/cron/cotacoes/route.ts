import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buscarCotacaoYahoo, deriveYahooSymbol, TIPOS_COTACAO_AUTOMATICA } from "@/lib/ativos/yahoo-finance";

/**
 * Cron de cotações — atualiza `preco_atual` de todos os ativos (de todos os
 * usuários) marcados com `cotacao_automatica = true`, via Yahoo Finance
 * (endpoint não-oficial). Ver docs/MAPA-DE-DADOS.md §8.10.
 *
 * Diferente do cron do Dólar (que escreve numa tabela compartilhada única),
 * esse varre a tabela `ativos` de todos os usuários — cada linha é
 * independente, então uma falha pontual num ticker não impede os outros de
 * atualizar (o endpoint do Yahoo é instável, sem SLA).
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

  return NextResponse.json({ ok: true, total: (ativos ?? []).length, atualizados, falhas });
}
