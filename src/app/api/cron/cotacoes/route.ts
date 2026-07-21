import { NextRequest, NextResponse } from "next/server";
import { atualizarTodasCotacoes } from "@/lib/ativos/atualizar-cotacoes";

/**
 * Cron de cotações — chama o motor compartilhado `atualizarTodasCotacoes`
 * (em `lib/ativos/atualizar-cotacoes.ts`), que atualiza `preco_atual` de
 * todos os ativos (de todos os usuários) marcados com
 * `cotacao_automatica = true`, via Yahoo Finance (endpoint não-oficial), e
 * também mantém `ativo_preco_diario_mercado` (histórico diário
 * compartilhado por tipo+ticker, ver docs/MAPA-DE-DADOS.md §8.12).
 *
 * Ver docs/MAPA-DE-DADOS.md §8.49 — a partir de 2026-07-21 este mesmo motor
 * também é chamado pelo botão manual "Atualizar cotações" da aba Posição
 * (`atualizarTodasCotacoesAgora` em `lib/ativos/actions.ts`), e por chamadas
 * externas (cron-job.org) 3x/dia, já que o plano Vercel Hobby só permite
 * 1x/dia no cron nativo.
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

  try {
    const resultado = await atualizarTodasCotacoes();
    return NextResponse.json({ ok: true, ...resultado });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro desconhecido." }, { status: 500 });
  }
}
