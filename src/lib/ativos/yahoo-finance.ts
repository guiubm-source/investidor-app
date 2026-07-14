import type { TipoAtivo } from "./actions";

/**
 * Tipos com cotação de mercado líquida derivável do ticker — ver
 * docs/MAPA-DE-DADOS.md §8.10 decisão 4. `renda_fixa`/`fundo`/`outro` não
 * têm ticker de bolsa comparável, continuam 100% manuais.
 */
export const TIPOS_COTACAO_AUTOMATICA: TipoAtivo[] = ["acao", "fii", "etf", "internacional", "cripto"];

/**
 * Deriva o símbolo usado pelo Yahoo Finance a partir do tipo+ticker do
 * ativo. Retorna null para tipos sem cotação de mercado líquida via Yahoo.
 */
export function deriveYahooSymbol(tipo: TipoAtivo, ticker: string): string | null {
  const t = ticker.trim().toUpperCase();
  switch (tipo) {
    case "acao":
    case "fii":
    case "etf":
      return `${t}.SA`;
    case "cripto":
      return `${t}-USD`;
    case "internacional":
      return t;
    default:
      return null;
  }
}

export type CotacaoYahoo = { preco: number } | { erro: string };

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

const USER_AGENT_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/**
 * Busca a cotação atual via endpoint não-oficial do Yahoo Finance
 * (query1.finance.yahoo.com). Não tem chave, não tem SLA — tolera qualquer
 * falha (rede, símbolo inválido, resposta inesperada, bloqueio por bot)
 * devolvendo um erro em vez de lançar exceção, pra quem chama em lote (cron)
 * conseguir seguir pro próximo ativo sem derrubar a chamada inteira. Ver
 * docs/MAPA-DE-DADOS.md §8.10 decisão 1.
 */
export async function buscarCotacaoYahoo(symbol: string): Promise<CotacaoYahoo> {
  try {
    const resposta = await fetch(`${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?interval=1d&range=1d`, {
      cache: "no-store",
      headers: {
        // Sem User-Agent de navegador, o endpoint não-oficial costuma
        // recusar a requisição como se fosse bot.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "application/json",
      },
    });

    if (!resposta.ok) {
      return { erro: `Yahoo Finance retornou ${resposta.status} para ${symbol}` };
    }

    const corpo = await resposta.json();
    const preco = corpo?.chart?.result?.[0]?.meta?.regularMarketPrice;

    if (typeof preco !== "number" || !Number.isFinite(preco) || preco <= 0) {
      return { erro: `Resposta do Yahoo Finance sem preço válido para ${symbol}` };
    }

    return { preco };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : `Erro desconhecido ao buscar cotação de ${symbol}` };
  }
}

export type PontoHistoricoYahoo = { data: string; preco: number };
export type HistoricoYahoo = { pontos: PontoHistoricoYahoo[] } | { erro: string };

/**
 * Busca a série histórica diária (fechamento) via o mesmo endpoint não-
 * oficial do Yahoo Finance usado em `buscarCotacaoYahoo`, só trocando
 * `range=1d` por um range maior — usado tanto pro backfill inicial (`range`
 * grande, ex. "10y") quanto pra manutenção incremental do cron (`range`
 * pequeno, ex. "5d", só pra pegar o(s) último(s) fechamento(s) sem perder
 * dia por causa de feriado/fim de semana). Ver docs/MAPA-DE-DADOS.md §8.12.
 *
 * O timestamp do Yahoo é convertido pra data (AAAA-MM-DD) via UTC — seguro
 * pros mercados cobertos aqui (B3, NYSE/Nasdaq, cripto) porque o horário de
 * pregão nunca cruza a meia-noite UTC.
 */
export async function buscarHistoricoYahoo(symbol: string, range: string): Promise<HistoricoYahoo> {
  try {
    const resposta = await fetch(
      `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}`,
      {
        cache: "no-store",
        headers: {
          "User-Agent": USER_AGENT_NAVEGADOR,
          Accept: "application/json",
        },
      }
    );

    if (!resposta.ok) {
      return { erro: `Yahoo Finance retornou ${resposta.status} para ${symbol}` };
    }

    const corpo = await resposta.json();
    const result = corpo?.chart?.result?.[0];
    const timestamps: unknown[] = result?.timestamp ?? [];
    const closes: unknown[] = result?.indicators?.quote?.[0]?.close ?? [];

    if (timestamps.length === 0) {
      return { erro: `Yahoo Finance sem série histórica para ${symbol}` };
    }

    const pontos: PontoHistoricoYahoo[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const preco = closes[i];
      if (typeof ts !== "number" || typeof preco !== "number" || !Number.isFinite(preco) || preco <= 0) continue;
      pontos.push({ data: new Date(ts * 1000).toISOString().slice(0, 10), preco });
    }

    if (pontos.length === 0) {
      return { erro: `Resposta do Yahoo Finance sem preços válidos para ${symbol}` };
    }

    return { pontos };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : `Erro desconhecido ao buscar histórico de ${symbol}` };
  }
}
