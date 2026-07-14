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
