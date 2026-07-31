import { createAdminClient } from "@/lib/supabase/admin";
import { buscarIndicadoresStatusInvest, TIPOS_INDICADOR_STATUS_INVEST } from "./status-invest";

/**
 * Motor do cron diário de indicadores do Status Invest — ver
 * docs/MAPA-DE-DADOS.md §8.67. Mesmo formato de `atualizar-cotacoes.ts`:
 * função pura chamada pela rota de cron (`api/cron/status-invest/route.ts`),
 * usando o client admin (service role) porque
 * `ativo_indicador_status_invest_diario` só aceita escrita via service role
 * (RLS só libera SELECT pra usuários autenticados).
 *
 * Roda 1x/dia (agendado externamente via cron-job.org, mesmo esquema já
 * usado pra `/api/cron/cotacoes` — ver §8.49): grava uma linha NOVA por dia
 * por (tipo, ticker), sem sobrescrever dias anteriores, porque Guilherme
 * pediu explicitamente pra manter histórico de comparação ao longo do
 * tempo (não só o valor mais recente).
 *
 * Pausa de 300ms entre requisições (`aguardar`) só por cautela — evitar
 * disparar dezenas de requisições simultâneas pro Status Invest e correr
 * risco de bloqueio por bot, já que ao contrário do endpoint do Yahoo
 * Finance isso aqui é scraping de HTML de verdade, não uma API pública.
 */
export type ResultadoAtualizacaoIndicadoresStatusInvest = {
  combinacoes: number;
  atualizados: number;
  falhas: string[];
};

function aguardar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function atualizarIndicadoresStatusInvest(): Promise<ResultadoAtualizacaoIndicadoresStatusInvest> {
  const supabase = createAdminClient();

  const { data: ativos, error: erroConsulta } = await supabase
    .from("ativos")
    .select("ticker, tipo")
    .in("tipo", TIPOS_INDICADOR_STATUS_INVEST);

  if (erroConsulta) {
    throw new Error(`Erro ao listar ativos: ${erroConsulta.message}`);
  }

  const tickersUnicos = new Map<string, { tipo: string; ticker: string }>();
  for (const ativo of ativos ?? []) {
    const chave = `${ativo.tipo}|${ativo.ticker}`;
    if (!tickersUnicos.has(chave)) tickersUnicos.set(chave, { tipo: ativo.tipo, ticker: ativo.ticker });
  }

  let atualizados = 0;
  const falhas: string[] = [];
  const hojeStr = new Date().toISOString().slice(0, 10);

  let primeiro = true;
  for (const { tipo, ticker } of tickersUnicos.values()) {
    if (!primeiro) await aguardar(300);
    primeiro = false;

    const resultado = await buscarIndicadoresStatusInvest(ticker);
    if ("erro" in resultado) {
      falhas.push(`${ticker}: ${resultado.erro}`);
      continue;
    }

    const { error: erroUpsert } = await supabase.from("ativo_indicador_status_invest_diario").upsert(
      {
        tipo,
        ticker,
        data: hojeStr,
        ev_ebitda: resultado.indicadores.evEbitda,
        ev_ebit: resultado.indicadores.evEbit,
        p_ebitda: resultado.indicadores.pEbitda,
        p_ebit: resultado.indicadores.pEbit,
        p_ativo: resultado.indicadores.pAtivo,
        psr: resultado.indicadores.psr,
        p_capital_giro: resultado.indicadores.pCapitalGiro,
        p_ativo_circulante_liq: resultado.indicadores.pAtivoCirculanteLiq,
        passivos_ativos: resultado.indicadores.passivosAtivos,
        giro_ativos: resultado.indicadores.giroAtivos,
        cagr_receita_5anos_pct: resultado.indicadores.cagrReceita5AnosPct,
      },
      { onConflict: "tipo,ticker,data" }
    );

    if (erroUpsert) {
      falhas.push(`${ticker}: erro ao salvar (${erroUpsert.message})`);
      continue;
    }

    atualizados += 1;
  }

  return { combinacoes: tickersUnicos.size, atualizados, falhas };
}
