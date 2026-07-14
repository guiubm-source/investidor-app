/**
 * Cálculos derivados do Dólar — módulo PURO (sem "use server", sem acesso a
 * banco), mesmo padrão de `selic-estatisticas.ts`/`ipca-estatisticas.ts`.
 * Ver docs/MAPA-DE-DADOS.md §8.9: variação diária/mensal/anual, máxima/
 * mínima histórica, média/desvio padrão, médias móveis, tendência,
 * sequência de dias consecutivos, volatilidade e correlação com Selic/IPCA
 * NUNCA são armazenados — são sempre recalculados aqui a partir de
 * `indicador_dolar_diario` (e das séries de Selic/IPCA, para as
 * correlações). `lib/indicadores/actions.ts` usa isso no servidor (dentro
 * de `obterDolar()`) e o componente da aba Dólar usa direto no cliente
 * (filtros de gráfico).
 */

import { calcularMediaMovel } from "./selic-estatisticas";
import { correlacaoPearson } from "./ipca-estatisticas";

export type PontoDolar = { data: string; cotacao: number }; // data em "AAAA-MM-DD"

export type TendenciaDolar = "alta" | "baixa" | "lateral";

export type MaximoMinimoHistorico = { valor: number; data: string };

export type EstatisticasSerieDolar = {
  media: number | null;
  mediana: number | null;
  desvioPadrao: number | null;
  amplitude: number | null;
  maximo: number | null;
  minimo: number | null;
};

export type MediasMoveisAtuais = {
  mm5: number | null;
  mm20: number | null;
  mm50: number | null;
  mm100: number | null;
  mm200: number | null;
};

export type SequenciaDolar = { tipo: "alta" | "queda"; quantidade: number };

export type PontoMensalDolar = { anoMes: string; fechamento: number };
export type VariacaoMensalDolar = { anoMes: string; variacaoPct: number };

// ---------------------------------------------------------------------------
// Utilitários de data (sem dependência externa)
// ---------------------------------------------------------------------------

function adicionarDiasIso(iso: string, dias: number): string {
  const data = new Date(`${iso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function encontrarPontoAnteriorOuIgual(pontosAsc: PontoDolar[], dataAlvo: string): PontoDolar | null {
  let encontrado: PontoDolar | null = null;
  for (const p of pontosAsc) {
    if (p.data <= dataAlvo) encontrado = p;
    else break;
  }
  return encontrado;
}

// ---------------------------------------------------------------------------
// Variações
// ---------------------------------------------------------------------------

export function calcularVariacaoPct(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || anterior === 0) return null;
  return Number((((atual - anterior) / anterior) * 100).toFixed(4));
}

export function calcularDistanciaPct(valor: number | null, referencia: number | null): number | null {
  if (valor === null || referencia === null || referencia === 0) return null;
  return Number((((valor - referencia) / referencia) * 100).toFixed(2));
}

/** Variação dia a dia (percentual). Primeiro ponto sempre null (sem ponto anterior). */
export function calcularVariacoesDiarias(pontosAsc: PontoDolar[]): (number | null)[] {
  return pontosAsc.map((p, i) => (i === 0 ? null : calcularVariacaoPct(p.cotacao, pontosAsc[i - 1].cotacao)));
}

/** Variação vs. ~30 dias corridos atrás (usa o ponto disponível mais próximo, sem passar da data alvo). */
export function calcularVariacaoMensal(pontosAsc: PontoDolar[]): number | null {
  if (pontosAsc.length < 2) return null;
  const ultimo = pontosAsc[pontosAsc.length - 1];
  const alvo = adicionarDiasIso(ultimo.data, -30);
  const referencia = encontrarPontoAnteriorOuIgual(pontosAsc, alvo) ?? pontosAsc[0];
  return calcularVariacaoPct(ultimo.cotacao, referencia.cotacao);
}

/** Variação vs. ~365 dias corridos atrás. */
export function calcularVariacaoAnual(pontosAsc: PontoDolar[]): number | null {
  if (pontosAsc.length < 2) return null;
  const ultimo = pontosAsc[pontosAsc.length - 1];
  const alvo = adicionarDiasIso(ultimo.data, -365);
  const referencia = encontrarPontoAnteriorOuIgual(pontosAsc, alvo) ?? pontosAsc[0];
  return calcularVariacaoPct(ultimo.cotacao, referencia.cotacao);
}

// ---------------------------------------------------------------------------
// Máxima/mínima e estatísticas
// ---------------------------------------------------------------------------

export function encontrarMaximoHistorico(pontosAsc: PontoDolar[]): MaximoMinimoHistorico | null {
  if (pontosAsc.length === 0) return null;
  return pontosAsc.reduce<MaximoMinimoHistorico>(
    (max, p) => (p.cotacao > max.valor ? { valor: p.cotacao, data: p.data } : max),
    { valor: pontosAsc[0].cotacao, data: pontosAsc[0].data }
  );
}

export function encontrarMinimoHistorico(pontosAsc: PontoDolar[]): MaximoMinimoHistorico | null {
  if (pontosAsc.length === 0) return null;
  return pontosAsc.reduce<MaximoMinimoHistorico>(
    (min, p) => (p.cotacao < min.valor ? { valor: p.cotacao, data: p.data } : min),
    { valor: pontosAsc[0].cotacao, data: pontosAsc[0].data }
  );
}

export function calcularMediaHistorica(pontosAsc: PontoDolar[]): number | null {
  if (pontosAsc.length === 0) return null;
  return Number((pontosAsc.reduce((s, p) => s + p.cotacao, 0) / pontosAsc.length).toFixed(4));
}

/** Máxima/mínima só dentro dos últimos ~12 meses (365 dias corridos a partir do último ponto). */
export function maximoMinimoUltimos12Meses(pontosAsc: PontoDolar[]): {
  maximo: MaximoMinimoHistorico | null;
  minimo: MaximoMinimoHistorico | null;
} {
  if (pontosAsc.length === 0) return { maximo: null, minimo: null };
  const ultimo = pontosAsc[pontosAsc.length - 1];
  const alvo = adicionarDiasIso(ultimo.data, -365);
  const janela = pontosAsc.filter((p) => p.data >= alvo);
  if (janela.length === 0) return { maximo: null, minimo: null };
  return { maximo: encontrarMaximoHistorico(janela), minimo: encontrarMinimoHistorico(janela) };
}

/** Estatísticas genéricas sobre uma série de valores (usada tanto pra cotação em nível quanto pra variações %). */
export function calcularEstatisticasSerie(valores: number[]): EstatisticasSerieDolar {
  if (valores.length === 0) {
    return { media: null, mediana: null, desvioPadrao: null, amplitude: null, maximo: null, minimo: null };
  }
  const media = valores.reduce((s, v) => s + v, 0) / valores.length;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  const mediana = ordenados.length % 2 === 0 ? (ordenados[meio - 1] + ordenados[meio]) / 2 : ordenados[meio];
  const variancia = valores.reduce((s, v) => s + (v - media) ** 2, 0) / valores.length;
  const desvioPadrao = Math.sqrt(variancia);
  const maximo = Math.max(...valores);
  const minimo = Math.min(...valores);
  const amplitude = maximo - minimo;
  return { media, mediana, desvioPadrao, amplitude, maximo, minimo };
}

// ---------------------------------------------------------------------------
// Volatilidade (desvio padrão das variações percentuais diárias)
// ---------------------------------------------------------------------------

export function calcularVolatilidadeAtual(pontosAsc: PontoDolar[], janelaDias = 30): number | null {
  const variacoes = calcularVariacoesDiarias(pontosAsc).filter((v): v is number => v !== null);
  const recentes = variacoes.slice(-janelaDias);
  if (recentes.length < 2) return null;
  return calcularEstatisticasSerie(recentes).desvioPadrao;
}

export function calcularVolatilidadeHistorica(pontosAsc: PontoDolar[]): number | null {
  const variacoes = calcularVariacoesDiarias(pontosAsc).filter((v): v is number => v !== null);
  if (variacoes.length < 2) return null;
  return calcularEstatisticasSerie(variacoes).desvioPadrao;
}

// ---------------------------------------------------------------------------
// Médias móveis e tendência
// ---------------------------------------------------------------------------

export function calcularMediasMoveisAtuais(cotacoesAsc: (number | null)[]): MediasMoveisAtuais {
  return {
    mm5: calcularMediaMovel(cotacoesAsc, 5).at(-1) ?? null,
    mm20: calcularMediaMovel(cotacoesAsc, 20).at(-1) ?? null,
    mm50: calcularMediaMovel(cotacoesAsc, 50).at(-1) ?? null,
    mm100: calcularMediaMovel(cotacoesAsc, 100).at(-1) ?? null,
    mm200: calcularMediaMovel(cotacoesAsc, 200).at(-1) ?? null,
  };
}

/** Tendência via MM20 x MM200 (curto prazo de mercado vs. tendência de longo prazo — ver §8.9). */
export function calcularTendencia(cotacoesAsc: (number | null)[]): TendenciaDolar | null {
  const ultimaCotacao = cotacoesAsc.at(-1);
  const ultimaMm20 = calcularMediaMovel(cotacoesAsc, 20).at(-1);
  const ultimaMm200 = calcularMediaMovel(cotacoesAsc, 200).at(-1);
  if (ultimaCotacao == null || ultimaMm20 == null || ultimaMm200 == null) return null;
  if (ultimaCotacao > ultimaMm20 && ultimaMm20 > ultimaMm200) return "alta";
  if (ultimaCotacao < ultimaMm20 && ultimaMm20 < ultimaMm200) return "baixa";
  return "lateral";
}

/** Sequência de dias consecutivos de alta ou queda (comparação com o dia anterior). */
export function calcularSequenciaDiasConsecutivos(pontosAsc: PontoDolar[]): SequenciaDolar | null {
  if (pontosAsc.length < 2) return null;

  const direcoes: ("up" | "down" | "igual")[] = [];
  for (let i = 1; i < pontosAsc.length; i++) {
    const diff = pontosAsc[i].cotacao - pontosAsc[i - 1].cotacao;
    direcoes.push(diff > 0 ? "up" : diff < 0 ? "down" : "igual");
  }

  const ultima = direcoes[direcoes.length - 1];
  if (ultima === "igual") return null;

  let quantidade = 0;
  for (let i = direcoes.length - 1; i >= 0; i--) {
    if (direcoes[i] !== ultima) break;
    quantidade++;
  }

  return { tipo: ultima === "up" ? "alta" : "queda", quantidade };
}

// ---------------------------------------------------------------------------
// Reamostragem mensal + correlação com Selic/IPCA
// ---------------------------------------------------------------------------

/** Reamostra a série diária pra mensal: fechamento = cotação do último dia útil disponível no mês. */
export function reamostrarMensal(pontosAsc: PontoDolar[]): PontoMensalDolar[] {
  const porMes = new Map<string, number>();
  for (const p of pontosAsc) {
    porMes.set(p.data.slice(0, 7), p.cotacao); // pontosAsc em ordem ascendente — o último set de cada mês é o fechamento
  }
  return [...porMes.entries()]
    .map(([anoMes, fechamento]) => ({ anoMes, fechamento }))
    .sort((a, b) => a.anoMes.localeCompare(b.anoMes));
}

export function calcularVariacoesMensais(mensal: PontoMensalDolar[]): VariacaoMensalDolar[] {
  const resultado: VariacaoMensalDolar[] = [];
  for (let i = 1; i < mensal.length; i++) {
    const variacaoPct = calcularVariacaoPct(mensal[i].fechamento, mensal[i - 1].fechamento);
    if (variacaoPct !== null) resultado.push({ anoMes: mensal[i].anoMes, variacaoPct });
  }
  return resultado;
}

/** Correlação entre a variação mensal do Dólar e a variação mensal do IPCA geral. Amostra mínima de 3 pontos pareados. */
export function correlacaoComIpca(
  variacoesMensaisDolar: VariacaoMensalDolar[],
  ipcaMensal: { anoMes: string; geral: number | null }[]
): number | null {
  const mapaIpca = new Map(ipcaMensal.filter((i) => i.geral !== null).map((i) => [i.anoMes, i.geral as number]));
  const pares = variacoesMensaisDolar.filter((d) => mapaIpca.has(d.anoMes));
  if (pares.length < 3) return null;
  return correlacaoPearson(
    pares.map((d) => d.variacaoPct),
    pares.map((d) => mapaIpca.get(d.anoMes)!)
  );
}

/** Correlação entre a variação mensal do Dólar e a Selic vigente no fim de cada mês. Amostra mínima de 3 pontos pareados. */
export function correlacaoComSelic(
  variacoesMensaisDolar: VariacaoMensalDolar[],
  selicVigentePorMes: { anoMes: string; taxa: number }[]
): number | null {
  const mapaSelic = new Map(selicVigentePorMes.map((s) => [s.anoMes, s.taxa]));
  const pares = variacoesMensaisDolar.filter((d) => mapaSelic.has(d.anoMes));
  if (pares.length < 3) return null;
  return correlacaoPearson(
    pares.map((d) => d.variacaoPct),
    pares.map((d) => mapaSelic.get(d.anoMes)!)
  );
}
