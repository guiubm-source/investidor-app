// ---------------------------------------------------------------------------
// Motor de cálculo do checklist comparativo — Ações/ETF/Internacional e FIIs.
// Funções puras (sem "use server"), usadas tanto no servidor quanto, se
// precisar, direto no cliente. Nunca armazenam nada — sempre recalculam a
// partir de `ativo_resultado_trimestral` (dados brutos) + preço atual +
// proventos. Ver docs/MAPA-DE-DADOS.md §8.10.
// ---------------------------------------------------------------------------

/** Alíquota efetiva padrão de IRPJ+CSLL no Brasil (lucro real) — usada como
 * aproximação no cálculo de NOPAT do ROIC (ver §8.10 decisão 7). */
const ALIQUOTA_EFETIVA_PADRAO = 0.34;

export type PontoTrimestralAcao = {
  anoTrimestre: string; // "2026-Q2"
  receitaLiquida: number | null;
  lucroBruto: number | null;
  lucroLiquido: number | null;
  ebit: number | null;
  ebitda: number | null;
  patrimonioLiquido: number | null;
  ativoTotal: number | null;
  ativoCirculante: number | null;
  passivoCirculante: number | null;
  dividaLiquida: number | null;
  dividaBruta: number | null;
  numeroAcoes: number | null;
};

export type PontoTrimestralFii = {
  anoTrimestre: string;
  valorPatrimonialCota: number | null;
  numeroNegociosMes: number | null;
  vacanciaFinanceiraPct: number | null;
  vacanciaFisicaPct: number | null;
  receitaImobiliaria: number | null;
  valorAvaliacaoImoveis: number | null;
  valorM2Aluguel: number | null;
};

export type ChecklistAcao = {
  pl: number | null;
  pegRatio: number | null;
  pvp: number | null;
  roePct: number | null;
  roaPct: number | null;
  roicPct: number | null;
  margemBrutaPct: number | null;
  margemLucroPct: number | null;
  dlPl: number | null;
  dividaBrutaEbitda: number | null;
  liquidezCorrente: number | null;
  cagrEbit5AnosPct: number | null;
  cagrLucro5AnosPct: number | null;
  /** Preço Justo de Graham: √(22,5 × LPA × VPA) — ver docs/MAPA-DE-DADOS.md §8.65. */
  precoJustoGraham: number | null;
  /** Preço Justo de Bazin: dividendo anual por ação / 0,06 — ver docs/MAPA-DE-DADOS.md §8.65. */
  precoJustoBazin: number | null;
  /** Dividendo anual por ação (12 meses) / preço — mesmo dividendoAnualPorAcao usado no Preço Justo de Bazin. Ver §8.65. */
  dividendYieldPct: number | null;
};

export type ChecklistFii = {
  pvp: number | null;
  numeroNegociosMes: number | null;
  vacanciaFinanceiraPct: number | null;
  vacanciaFisicaPct: number | null;
  capRatePct: number | null;
  dividendYieldPct: number | null;
  valorM2Aluguel: number | null;
};

/** "2026-Q2" -> 8104 (ano×4 + trimestre) — só pra comparar/ordenar. */
function parseAnoTrimestre(v: string): number {
  const [anoStr, tStr] = v.split("-Q");
  return Number(anoStr) * 4 + Number(tStr);
}

function ordenarDesc<T extends { anoTrimestre: string }>(pontos: T[]): T[] {
  return [...pontos].sort((a, b) => parseAnoTrimestre(b.anoTrimestre) - parseAnoTrimestre(a.anoTrimestre));
}

/** Soma um campo numérico dos N pontos mais recentes (índices 0..N-1 de uma lista já em ordem desc). Null se faltar dado ou não houver N pontos. */
function somaUltimosN<T extends { anoTrimestre: string }>(
  pontosDesc: T[],
  campo: keyof T,
  n: number,
  offset = 0
): number | null {
  if (pontosDesc.length < offset + n) return null;
  let soma = 0;
  for (let i = offset; i < offset + n; i++) {
    const v = pontosDesc[i][campo];
    if (typeof v !== "number") return null;
    soma += v;
  }
  return soma;
}

/** Valor de um campo exatamente N trimestres antes do mais recente (precisa achar o trimestre exato — sem aproximação). */
function valorTrimestresAtras<T extends { anoTrimestre: string }>(
  pontosDesc: T[],
  trimestresAtras: number,
  campo: keyof T
): number | null {
  if (pontosDesc.length === 0) return null;
  const chaveAlvo = parseAnoTrimestre(pontosDesc[0].anoTrimestre) - trimestresAtras;
  const ponto = pontosDesc.find((p) => parseAnoTrimestre(p.anoTrimestre) === chaveAlvo);
  if (!ponto) return null;
  const v = ponto[campo];
  return typeof v === "number" ? v : null;
}

/**
 * Checklist Ações/ETF/Internacional — ver docs/MAPA-DE-DADOS.md §8.10
 * decisões 6 e 7 para as fórmulas e nuances resolvidas (ROIC aproximado,
 * "DL/EBIT" = Dívida Bruta/EBITDA, TTM = 4 trimestres mais recentes, CAGR
 * = 20 trimestres de distância exata).
 */
export function calcularChecklistAcao(
  pontos: PontoTrimestralAcao[],
  precoAtual: number | null,
  /** Soma dos proventos por ação (campo `valor_por_cota`) pagos nos últimos 12 meses — só usado pro Preço Justo de Bazin. */
  dividendoAnualPorAcao: number | null = null
): ChecklistAcao {
  const desc = ordenarDesc(pontos);
  const ultimo = desc[0] as PontoTrimestralAcao | undefined;

  const receitaTTM = somaUltimosN(desc, "receitaLiquida", 4);
  const lucroBrutoTTM = somaUltimosN(desc, "lucroBruto", 4);
  const lucroLiquidoTTM = somaUltimosN(desc, "lucroLiquido", 4);
  const ebitTTM = somaUltimosN(desc, "ebit", 4);
  const ebitdaTTM = somaUltimosN(desc, "ebitda", 4);
  const lucroLiquidoTTMAnoAnterior = somaUltimosN(desc, "lucroLiquido", 4, 4);

  const numeroAcoes = ultimo?.numeroAcoes ?? null;
  const patrimonioLiquido = ultimo?.patrimonioLiquido ?? null;
  const ativoTotal = ultimo?.ativoTotal ?? null;
  const ativoCirculante = ultimo?.ativoCirculante ?? null;
  const passivoCirculante = ultimo?.passivoCirculante ?? null;
  const dividaLiquida = ultimo?.dividaLiquida ?? null;
  const dividaBruta = ultimo?.dividaBruta ?? null;

  const lpaTTM = lucroLiquidoTTM !== null && numeroAcoes ? lucroLiquidoTTM / numeroAcoes : null;
  const lpaTTMAnoAnterior =
    lucroLiquidoTTMAnoAnterior !== null && numeroAcoes ? lucroLiquidoTTMAnoAnterior / numeroAcoes : null;
  const vpa = patrimonioLiquido !== null && numeroAcoes ? patrimonioLiquido / numeroAcoes : null;

  const pl = precoAtual !== null && lpaTTM !== null && lpaTTM !== 0 ? precoAtual / lpaTTM : null;
  const pvp = precoAtual !== null && vpa !== null && vpa !== 0 ? precoAtual / vpa : null;

  const crescimentoLpaPct =
    lpaTTM !== null && lpaTTMAnoAnterior !== null && lpaTTMAnoAnterior !== 0
      ? ((lpaTTM - lpaTTMAnoAnterior) / Math.abs(lpaTTMAnoAnterior)) * 100
      : null;
  const pegRatio =
    pl !== null && crescimentoLpaPct !== null && crescimentoLpaPct !== 0 ? pl / crescimentoLpaPct : null;

  const roePct =
    lucroLiquidoTTM !== null && patrimonioLiquido && patrimonioLiquido !== 0
      ? (lucroLiquidoTTM / patrimonioLiquido) * 100
      : null;
  const roaPct = lucroLiquidoTTM !== null && ativoTotal ? (lucroLiquidoTTM / ativoTotal) * 100 : null;

  const nopat = ebitTTM !== null ? ebitTTM * (1 - ALIQUOTA_EFETIVA_PADRAO) : null;
  const capitalInvestido =
    dividaLiquida !== null && patrimonioLiquido !== null ? dividaLiquida + patrimonioLiquido : null;
  const roicPct = nopat !== null && capitalInvestido && capitalInvestido !== 0 ? (nopat / capitalInvestido) * 100 : null;

  const margemBrutaPct = lucroBrutoTTM !== null && receitaTTM ? (lucroBrutoTTM / receitaTTM) * 100 : null;
  const margemLucroPct = lucroLiquidoTTM !== null && receitaTTM ? (lucroLiquidoTTM / receitaTTM) * 100 : null;

  const dlPl = dividaLiquida !== null && patrimonioLiquido ? dividaLiquida / patrimonioLiquido : null;
  const dividaBrutaEbitda = dividaBruta !== null && ebitdaTTM ? dividaBruta / ebitdaTTM : null;
  const liquidezCorrente = ativoCirculante !== null && passivoCirculante ? ativoCirculante / passivoCirculante : null;

  const ebitAtual = ultimo?.ebit ?? null;
  const ebitAtras20 = valorTrimestresAtras(desc, 20, "ebit");
  const cagrEbit5AnosPct =
    ebitAtual !== null && ebitAtras20 !== null && ebitAtras20 > 0 && ebitAtual > 0
      ? (Math.pow(ebitAtual / ebitAtras20, 1 / 5) - 1) * 100
      : null;

  const lucroAtual = ultimo?.lucroLiquido ?? null;
  const lucroAtras20 = valorTrimestresAtras(desc, 20, "lucroLiquido");
  const cagrLucro5AnosPct =
    lucroAtual !== null && lucroAtras20 !== null && lucroAtras20 > 0 && lucroAtual > 0
      ? (Math.pow(lucroAtual / lucroAtras20, 1 / 5) - 1) * 100
      : null;

  // Preço Justo de Graham: VI = √(22,5 × LPA × VPA). O 22,5 vem de multiplicar
  // o P/L máximo aceitável por Graham (15) pelo P/VP máximo aceitável (1,5).
  // Só faz sentido com LPA e VPA positivos (empresa lucrativa e patrimônio
  // líquido positivo) — negativo ou zero vira null, igual ao resto do
  // checklist. Ver docs/MAPA-DE-DADOS.md §8.65.
  const precoJustoGraham = lpaTTM !== null && lpaTTM > 0 && vpa !== null && vpa > 0 ? Math.sqrt(22.5 * lpaTTM * vpa) : null;

  // Preço Justo de Bazin: dividendo anual por ação / 0,06 (6% de yield "justo",
  // premissa fixa do método — não se ajusta à Selic). Ver docs/MAPA-DE-DADOS.md §8.65.
  const precoJustoBazin =
    dividendoAnualPorAcao !== null && dividendoAnualPorAcao > 0 ? dividendoAnualPorAcao / 0.06 : null;

  // Dividend Yield da ação (não existia no checklist até aqui — só o FII
  // tinha; ver docs/MAPA-DE-DADOS.md §8.65). Mesmo insumo do Preço Justo de
  // Bazin, só que dividido pelo preço em vez de por 0,06.
  const dividendYieldPct =
    dividendoAnualPorAcao !== null && precoAtual !== null && precoAtual > 0
      ? (dividendoAnualPorAcao / precoAtual) * 100
      : null;

  return {
    pl,
    pegRatio,
    pvp,
    roePct,
    roaPct,
    roicPct,
    margemBrutaPct,
    margemLucroPct,
    dlPl,
    dividaBrutaEbitda,
    liquidezCorrente,
    cagrEbit5AnosPct,
    cagrLucro5AnosPct,
    precoJustoGraham,
    precoJustoBazin,
    dividendYieldPct,
  };
}

/**
 * Checklist FIIs — ver docs/MAPA-DE-DADOS.md §8.10. Dividend Yield é a
 * única métrica que não vem de `ativo_resultado_trimestral`: é calculada a
 * partir dos proventos já existentes (tabela `proventos`, fonte única), com
 * o mesmo critério usado em Ações desde a migração de 2026-07-30 (ver
 * §8.65 item de assimetria DY): soma de `valor_por_cota` (não `valor_total`)
 * dos últimos 12 meses — independente de o usuário ter aportado/resgatado
 * cotas no período. `null` quando nenhum provento no período tem
 * `valor_por_cota` preenchido (lançamentos antigos sem esse campo) — vira
 * "—" na UI, nunca 0%, pra não passar a falsa impressão de "yield zero".
 * Cap Rate anualiza a receita imobiliária do trimestre mais recente (×4) —
 * aproximação documentada, já que só temos o dado trimestral, não o anual.
 */
export function calcularChecklistFii(
  pontos: PontoTrimestralFii[],
  precoAtual: number | null,
  proventosUltimos12Meses: number | null
): ChecklistFii {
  const desc = ordenarDesc(pontos);
  const ultimo = desc[0] as PontoTrimestralFii | undefined;

  const pvp =
    precoAtual !== null && ultimo?.valorPatrimonialCota ? precoAtual / ultimo.valorPatrimonialCota : null;

  const capRatePct =
    ultimo?.receitaImobiliaria !== null &&
    ultimo?.receitaImobiliaria !== undefined &&
    ultimo?.valorAvaliacaoImoveis
      ? ((ultimo.receitaImobiliaria * 4) / ultimo.valorAvaliacaoImoveis) * 100
      : null;

  const dividendYieldPct =
    proventosUltimos12Meses !== null && precoAtual !== null && precoAtual > 0
      ? (proventosUltimos12Meses / precoAtual) * 100
      : null;

  return {
    pvp,
    numeroNegociosMes: ultimo?.numeroNegociosMes ?? null,
    vacanciaFinanceiraPct: ultimo?.vacanciaFinanceiraPct ?? null,
    vacanciaFisicaPct: ultimo?.vacanciaFisicaPct ?? null,
    capRatePct,
    dividendYieldPct,
    valorM2Aluguel: ultimo?.valorM2Aluguel ?? null,
  };
}

// ---------------------------------------------------------------------------
// Painel de monitoramento (2026-07-14): série histórica dos índices do
// checklist que NÃO dependem do preço atual, + insights automáticos em texto
// (regras simples, sem IA). Reaproveita calcularChecklistAcao/Fii chamando-as
// repetidamente com uma janela de trimestres encolhendo (do mais recente pra
// trás) e precoAtual: null — nenhuma fórmula nova. Índices dependentes de
// preço (P/L, P/VP, PEG Ratio, Dividend Yield) ficam de fora: só temos o
// preço de HOJE, não o de cada trimestre passado, então entram null
// naturalmente e são excluídos da série (ver docs/MAPA-DE-DADOS.md §8.10
// decisão 11). Continuam disponíveis como valor atual único na seção de
// Checklist já existente.
// ---------------------------------------------------------------------------

export type PontoSerieAcao = {
  anoTrimestre: string;
  roePct: number | null;
  roaPct: number | null;
  roicPct: number | null;
  margemBrutaPct: number | null;
  margemLucroPct: number | null;
  dlPl: number | null;
  dividaBrutaEbitda: number | null;
  liquidezCorrente: number | null;
};

/** Evolução trimestral dos índices independentes de preço. Ordem cronológica (mais antigo primeiro) — pronta pra gráfico. */
export function calcularSerieChecklistAcao(pontos: PontoTrimestralAcao[]): PontoSerieAcao[] {
  const desc = ordenarDesc(pontos);
  return desc
    .map((ponto, i) => {
      const c = calcularChecklistAcao(desc.slice(i), null);
      return {
        anoTrimestre: ponto.anoTrimestre,
        roePct: c.roePct,
        roaPct: c.roaPct,
        roicPct: c.roicPct,
        margemBrutaPct: c.margemBrutaPct,
        margemLucroPct: c.margemLucroPct,
        dlPl: c.dlPl,
        dividaBrutaEbitda: c.dividaBrutaEbitda,
        liquidezCorrente: c.liquidezCorrente,
      };
    })
    .reverse();
}

// ---------------------------------------------------------------------------
// Histórico de P/L, P/VP, PEG Ratio e Dividend Yield (2026-07-30, §8.65) —
// os 4 índices que calcularSerieChecklistAcao deixa de fora por dependerem do
// preço. Diferente do resto do painel, aqui cruzamos o LPA/VPA de cada
// trimestre com o preço de FECHAMENTO NO FIM DAQUELE TRIMESTRE (não o preço
// de hoje), usando a série de preço diário que o app já guarda por ativo
// (`obterSeriePrecoAtivo`) — sem nenhuma fonte de dado nova ou paga. Mesma
// aproximação de "trimestre = data de fim de trimestre" que Status
// Invest/Investidor10 usam nos gráficos históricos deles.
// ---------------------------------------------------------------------------

export type PontoSerieAcaoComPreco = PontoSerieAcao & {
  pl: number | null;
  pvp: number | null;
  pegRatio: number | null;
  dividendYieldPct: number | null;
};

const MES_DIA_FIM_TRIMESTRE: Record<string, string> = { "1": "03-31", "2": "06-30", "3": "09-30", "4": "12-31" };

/** "2026-Q2" -> "2026-06-30". */
function dataFimTrimestre(anoTrimestre: string): string {
  const [anoStr, tStr] = anoTrimestre.split("-Q");
  return `${anoStr}-${MES_DIA_FIM_TRIMESTRE[tStr]}`;
}

/** Último preço conhecido em ou antes de `data` (backward-fill) — null se a série só começar depois dela. Espera `precosAsc` já ordenado por data crescente. */
function precoEmOuAntes(precosAsc: { data: string; preco: number }[], data: string): number | null {
  let resultado: number | null = null;
  for (const p of precosAsc) {
    if (p.data > data) break;
    resultado = p.preco;
  }
  return resultado;
}

/** Soma de `valorPorCota` pago nos 365 dias terminando em `dataFim` (inclusive) — null se não houver nenhum provento nessa janela. */
function dividendoAnualEmData(proventos: { data: string; valorPorCota: number }[], dataFim: string): number | null {
  const fim = new Date(`${dataFim}T00:00:00Z`);
  const inicio = new Date(fim);
  inicio.setUTCDate(inicio.getUTCDate() - 365);
  const inicioStr = inicio.toISOString().slice(0, 10);
  const soma = proventos
    .filter((p) => p.data > inicioStr && p.data <= dataFim)
    .reduce((s, p) => s + p.valorPorCota, 0);
  return soma > 0 ? soma : null;
}

/**
 * Evolução trimestral de P/L, P/VP, PEG Ratio e Dividend Yield — ver
 * cabeçalho da seção acima. `precosDiarios` e `proventosPorAcao` vêm de
 * `obterSeriePrecoAtivo` e da tabela `proventos` (campo `valor_por_cota`,
 * não `valor_total` — precisamos do valor POR AÇÃO, não do total recebido
 * pelo usuário, que varia com quanto ele tinha guardado na época).
 */
export function calcularSerieChecklistAcaoComPreco(
  pontos: PontoTrimestralAcao[],
  precosDiarios: { data: string; preco: number }[],
  proventosPorAcao: { data: string; valorPorCota: number }[]
): PontoSerieAcaoComPreco[] {
  const desc = ordenarDesc(pontos);
  const precosAsc = [...precosDiarios].sort((a, b) => (a.data < b.data ? -1 : 1));

  return desc
    .map((ponto, i) => {
      const dataFim = dataFimTrimestre(ponto.anoTrimestre);
      const precoNaData = precoEmOuAntes(precosAsc, dataFim);
      const dividendoNaData = dividendoAnualEmData(proventosPorAcao, dataFim);
      const c = calcularChecklistAcao(desc.slice(i), precoNaData, dividendoNaData);
      return {
        anoTrimestre: ponto.anoTrimestre,
        roePct: c.roePct,
        roaPct: c.roaPct,
        roicPct: c.roicPct,
        margemBrutaPct: c.margemBrutaPct,
        margemLucroPct: c.margemLucroPct,
        dlPl: c.dlPl,
        dividaBrutaEbitda: c.dividaBrutaEbitda,
        liquidezCorrente: c.liquidezCorrente,
        pl: c.pl,
        pvp: c.pvp,
        pegRatio: c.pegRatio,
        dividendYieldPct: c.dividendYieldPct,
      };
    })
    .reverse();
}

export type PontoSerieFii = {
  anoTrimestre: string;
  numeroNegociosMes: number | null;
  vacanciaFinanceiraPct: number | null;
  vacanciaFisicaPct: number | null;
  capRatePct: number | null;
};

/** Evolução trimestral dos índices de FII (todos já independentes de preço). Ordem cronológica. */
export function calcularSerieChecklistFii(pontos: PontoTrimestralFii[]): PontoSerieFii[] {
  const desc = ordenarDesc(pontos);
  return desc
    .map((ponto, i) => {
      const c = calcularChecklistFii(desc.slice(i), null, null);
      return {
        anoTrimestre: ponto.anoTrimestre,
        numeroNegociosMes: c.numeroNegociosMes,
        vacanciaFinanceiraPct: c.vacanciaFinanceiraPct,
        vacanciaFisicaPct: c.vacanciaFisicaPct,
        capRatePct: c.capRatePct,
      };
    })
    .reverse();
}

export type Insight = { texto: string; tom: "positivo" | "negativo" | "neutro" };

type PontoValor = { anoTrimestre: string; valor: number | null };

/** Sequência de altas/baixas consecutivas terminando no ponto mais recente (série cronológica). Null se não houver ao menos 2 seguidos na mesma direção. */
function streakFinal(serieCronologica: PontoValor[]): { direcao: "alta" | "baixa"; tamanho: number } | null {
  const valores = serieCronologica.filter((p) => p.valor !== null).map((p) => p.valor as number);
  if (valores.length < 2) return null;
  const ultimo = valores.length - 1;
  if (valores[ultimo] === valores[ultimo - 1]) return null;
  const direcao: "alta" | "baixa" = valores[ultimo] > valores[ultimo - 1] ? "alta" : "baixa";
  let tamanho = 1;
  for (let i = ultimo; i > 0; i--) {
    const subiu = valores[i] > valores[i - 1];
    const desceu = valores[i] < valores[i - 1];
    if ((direcao === "alta" && subiu) || (direcao === "baixa" && desceu)) tamanho++;
    else break;
  }
  return tamanho >= 2 ? { direcao, tamanho } : null;
}

/** Recorde (máximo ou mínimo) do histórico lançado, se o ponto mais recente for ele. Exige ao menos 3 pontos pra fazer sentido. */
function ehRecorde(serieCronologica: PontoValor[]): "maximo" | "minimo" | null {
  const valores = serieCronologica.filter((p) => p.valor !== null).map((p) => p.valor as number);
  if (valores.length < 3) return null;
  const ultimo = valores[valores.length - 1];
  if (ultimo === Math.max(...valores)) return "maximo";
  if (ultimo === Math.min(...valores)) return "minimo";
  return null;
}

function formatarPctInsight(v: number): string {
  return `${v.toFixed(1)}%`;
}

function formatarRatioInsight(v: number): string {
  return `${v.toFixed(2)}x`;
}

function formatarCompactoInsight(v: number): string {
  return v.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
}

function gerarInsightsMetrica(
  serieCronologica: PontoValor[],
  rotulo: string,
  maiorEhMelhor: boolean,
  formatar: (v: number) => string
): Insight[] {
  const insights: Insight[] = [];
  const valoresValidos = serieCronologica.filter((p) => p.valor !== null);
  const ultimoValor = valoresValidos.length > 0 ? (valoresValidos[valoresValidos.length - 1].valor as number) : null;
  if (ultimoValor === null) return insights;

  const streak = streakFinal(serieCronologica);
  if (streak) {
    const bom = (streak.direcao === "alta") === maiorEhMelhor;
    insights.push({
      texto: `${rotulo} em ${streak.direcao} há ${streak.tamanho} trimestres seguidos (atual: ${formatar(ultimoValor)})`,
      tom: bom ? "positivo" : "negativo",
    });
  }

  const recorde = ehRecorde(serieCronologica);
  if (recorde) {
    const bom = (recorde === "maximo") === maiorEhMelhor;
    insights.push({
      texto: `${rotulo} no ${recorde === "maximo" ? "maior" : "menor"} nível do histórico lançado (${formatar(ultimoValor)})`,
      tom: bom ? "positivo" : "neutro",
    });
  }

  return insights;
}

/** Insights automáticos pra Ações/ETF/Internacional. Combina receita/lucro (dados brutos) com os índices do checklist independentes de preço. Limitado a 6 pra não poluir a tela. */
export function gerarInsightsAcao(pontos: PontoTrimestralAcao[]): Insight[] {
  const cronologica = [...ordenarDesc(pontos)].reverse();
  const serie = calcularSerieChecklistAcao(pontos);

  return [
    ...gerarInsightsMetrica(
      cronologica.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.receitaLiquida })),
      "Receita Líquida",
      true,
      formatarCompactoInsight
    ),
    ...gerarInsightsMetrica(
      cronologica.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.lucroLiquido })),
      "Lucro Líquido",
      true,
      formatarCompactoInsight
    ),
    ...gerarInsightsMetrica(
      serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.roePct })),
      "ROE",
      true,
      formatarPctInsight
    ),
    ...gerarInsightsMetrica(
      serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.roicPct })),
      "ROIC",
      true,
      formatarPctInsight
    ),
    ...gerarInsightsMetrica(
      serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.margemLucroPct })),
      "Margem Líquida",
      true,
      formatarPctInsight
    ),
    ...gerarInsightsMetrica(
      serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.margemBrutaPct })),
      "Margem Bruta",
      true,
      formatarPctInsight
    ),
    ...gerarInsightsMetrica(
      serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.dlPl })),
      "Dívida Líquida/PL",
      false,
      formatarRatioInsight
    ),
    ...gerarInsightsMetrica(
      serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.dividaBrutaEbitda })),
      "Dívida Bruta/EBITDA",
      false,
      formatarRatioInsight
    ),
    ...gerarInsightsMetrica(
      serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.liquidezCorrente })),
      "Liquidez Corrente",
      true,
      formatarRatioInsight
    ),
  ].slice(0, 6);
}

/** Insights automáticos pra FIIs. Mesma lógica de streak/recorde, limitado a 6. */
export function gerarInsightsFii(pontos: PontoTrimestralFii[]): Insight[] {
  const cronologica = [...ordenarDesc(pontos)].reverse();
  const serie = calcularSerieChecklistFii(pontos);

  return [
    ...gerarInsightsMetrica(
      cronologica.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.receitaImobiliaria })),
      "Receita Imobiliária",
      true,
      formatarCompactoInsight
    ),
    ...gerarInsightsMetrica(
      serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.capRatePct })),
      "Cap Rate",
      true,
      formatarPctInsight
    ),
    ...gerarInsightsMetrica(
      serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.vacanciaFinanceiraPct })),
      "Vacância Financeira",
      false,
      formatarPctInsight
    ),
    ...gerarInsightsMetrica(
      serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.vacanciaFisicaPct })),
      "Vacância Física",
      false,
      formatarPctInsight
    ),
    ...gerarInsightsMetrica(
      serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.numeroNegociosMes })),
      "Número de Negócios/mês",
      true,
      (v) => v.toFixed(0)
    ),
  ].slice(0, 6);
}

// ---------------------------------------------------------------------------
// Aviso de yield inflado por evento atípico (2026-07-30, §8.65) — um
// provento fora do padrão dentro da janela de 12 meses (ex.: venda de imóvel
// de um FII, dividendo extraordinário de uma ação) pode inflar o Dividend
// Yield mostrado sem isso ficar claro pro usuário. Ver docs/MAPA-DE-DADOS.md.
// ---------------------------------------------------------------------------

export type AvisoProventoAtipico = {
  data: string;
  valor: number;
  medianaDemais: number;
};

/**
 * Detecta um pagamento muito maior que os demais dentro da janela de 12
 * meses usada pro Dividend Yield. Heurística própria deste app, documentada
 * aqui (não é uma convenção de mercado): exige pelo menos 3 pagamentos na
 * janela — com menos que isso não dá pra separar "atípico" de "normal" com
 * alguma confiança — e o maior precisa ser mais que o dobro da MEDIANA dos
 * demais (mediana, não média, pra não deixar o próprio maior valor puxar a
 * régua de comparação pra cima).
 */
export function detectarProventoAtipico(pagamentos: { data: string; valor: number }[]): AvisoProventoAtipico | null {
  if (pagamentos.length < 3) return null;
  const ordenadosDesc = [...pagamentos].sort((a, b) => b.valor - a.valor);
  const maior = ordenadosDesc[0];
  const demaisAsc = ordenadosDesc
    .slice(1)
    .map((p) => p.valor)
    .sort((a, b) => a - b);
  const meio = Math.floor(demaisAsc.length / 2);
  const medianaDemais = demaisAsc.length % 2 === 0 ? (demaisAsc[meio - 1] + demaisAsc[meio]) / 2 : demaisAsc[meio];
  if (medianaDemais <= 0 || maior.valor <= medianaDemais * 2) return null;
  return { data: maior.data, valor: maior.valor, medianaDemais };
}
