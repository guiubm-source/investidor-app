import { NextRequest, NextResponse } from "next/server";
import { atualizarIndicadoresStatusInvest } from "@/lib/ativos/atualizar-indicadores-status-invest";

/**
 * Cron de indicadores do Status Invest (fase 1 — Ações) — ver
 * docs/MAPA-DE-DADOS.md §8.67. Chama o motor compartilhado
 * `atualizarIndicadoresStatusInvest`, que grava uma linha diária em
 * `ativo_indicador_status_invest_diario` por (tipo, ticker) de todos os
 * ativos tipo=acao (de todos os usuários).
 *
 * Mesmo esquema de autenticação e agendamento externo do cron de cotações
 * (`api/cron/cotacoes/route.ts`, §8.49): protegido por CRON_SECRET, e
 * agendado 1x/dia via cron-job.org (não no vercel.json nativo — o plano
 * Vercel Hobby já usa o único slot nativo pro cron do Dólar).
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
    const resultado = await atualizarIndicadoresStatusInvest();
    return NextResponse.json({ ok: true, ...resultado });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro desconhecido." }, { status: 500 });
  }
}
