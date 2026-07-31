import type { TipoAtivo } from "./actions";

/**
 * Tipos cobertos pelo parser do Status Invest — fase 1 (ver
 * docs/MAPA-DE-DADOS.md §8.67). Só `acao`: a página de Ações
 * (statusinvest.com.br/acoes/{ticker}) tem uma grade única de indicadores
 * que já vem pronta no HTML (confirmado via teste ao vivo, sem precisar de
 * JS/browser headless). FIIs têm layout bem diferente (cards soltos, não uma
 * grade única) e ficam pra uma fase separada, combinada com o Guilherme.
 */
export const TIPOS_INDICADOR_STATUS_INVEST: TipoAtivo[] = ["acao"];

export type IndicadoresStatusInvest = {
  evEbitda: number | null;
  evEbit: number | null;
  pEbitda: number | null;
  pEbit: number | null;
  pAtivo: number | null;
  psr: number | null;
  pCapitalGiro: number | null;
  pAtivoCirculanteLiq: number | null;
  passivosAtivos: number | null;
  giroAtivos: number | null;
  cagrReceita5AnosPct: number | null;
};

export type ResultadoStatusInvest = { indicadores: IndicadoresStatusInvest } | { erro: string };

const USER_AGENT_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/**
 * Mapa chave-do-Status-Invest -> campo do nosso tipo. As chaves vêm do
 * atributo `data-key` do botão de gráfico histórico de cada indicador no
 * HTML real da página (inspecionado ao vivo em wege3 — ver
 * docs/MAPA-DE-DADOS.md §8.67). Duas delas ("p_ebita", "p_capitlgiro") têm
 * erro de digitação no PRÓPRIO Status Invest — mantidas assim de propósito,
 * "sic", porque são a chave real usada no HTML, não um typo nosso.
 */
const CHAVES: { chave: string; campo: keyof IndicadoresStatusInvest }[] = [
  { chave: "ev_ebitda", campo: "evEbitda" },
  { chave: "ev_ebit", campo: "evEbit" },
  { chave: "p_ebita", campo: "pEbitda" }, // sic — chave real do Status Invest
  { chave: "p_ebit", campo: "pEbit" },
  { chave: "p_ativo", campo: "pAtivo" },
  { chave: "p_sr", campo: "psr" },
  { chave: "p_capitlgiro", campo: "pCapitalGiro" }, // sic — chave real do Status Invest
  { chave: "p_ativocirculante", campo: "pAtivoCirculanteLiq" },
  { chave: "passivo_ativo", campo: "passivosAtivos" },
  { chave: "giro_ativos", campo: "giroAtivos" },
  { chave: "receitas_cagr5", campo: "cagrReceita5AnosPct" },
];

function parseNumeroBr(bruto: string): number | null {
  const limpo = bruto.trim().replace(/%$/, "").replace(/\./g, "").replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/**
 * Acha o valor de um indicador buscando, no HTML, a última tag
 * `<strong class="value ...">` que aparece ANTES do botão
 * `data-key="{chave}"` — é assim que o layout real da página organiza cada
 * bloco de indicador (valor primeiro, botão de gráfico histórico depois).
 * Retorna null se a chave não existir no HTML (layout mudou) ou se não
 * houver nenhum `<strong class="value">` antes dela — nunca lança exceção,
 * cada campo falha isoladamente (mesmo espírito de `yahoo-finance.ts`).
 */
function extrairValor(html: string, chave: string): number | null {
  const marcador = `data-key="${chave}"`;
  const pos = html.indexOf(marcador);
  if (pos === -1) return null;

  const antes = html.slice(0, pos);
  const regex = /<strong[^>]*class="value[^"]*"[^>]*>([^<]+)<\/strong>/g;
  let ultimoValor: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(antes)) !== null) {
    ultimoValor = match[1];
  }

  return ultimoValor !== null ? parseNumeroBr(ultimoValor) : null;
}

/**
 * Busca os 11 indicadores de mercado do Status Invest pra um ticker de
 * Ação, via fetch simples (sem browser headless — ver docs/MAPA-DE-DADOS.md
 * §8.67). Tolera qualquer falha (rede, ticker inexistente, mudança de
 * layout) devolvendo um erro em vez de lançar exceção, mesmo padrão de
 * `buscarCotacaoYahoo`, pra quem chama em lote (cron) seguir pro próximo
 * ativo sem derrubar a chamada inteira.
 */
export async function buscarIndicadoresStatusInvest(ticker: string): Promise<ResultadoStatusInvest> {
  try {
    const resposta = await fetch(`https://statusinvest.com.br/acoes/${encodeURIComponent(ticker.trim().toLowerCase())}`, {
      cache: "no-store",
      headers: {
        "User-Agent": USER_AGENT_NAVEGADOR,
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!resposta.ok) {
      return { erro: `Status Invest retornou ${resposta.status} para ${ticker}` };
    }

    const html = await resposta.text();

    const indicadores = {} as IndicadoresStatusInvest;
    let algumEncontrado = false;
    for (const { chave, campo } of CHAVES) {
      const valor = extrairValor(html, chave);
      indicadores[campo] = valor;
      if (valor !== null) algumEncontrado = true;
    }

    if (!algumEncontrado) {
      return { erro: `Nenhum indicador reconhecido no HTML do Status Invest para ${ticker} — layout pode ter mudado.` };
    }

    return { indicadores };
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      return { erro: `Status Invest demorou demais para responder por ${ticker} (mais de 8s).` };
    }
    return { erro: e instanceof Error ? e.message : `Erro desconhecido ao buscar indicadores de ${ticker}` };
  }
}
