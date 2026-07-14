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
export function calcularChecklistAcao(pontos: PontoTrimestralAcao[], precoAtual: number | null): ChecklistAcao {
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
  };
}

/**
 * Checklist FIIs — ver docs/MAPA-DE-DADOS.md §8.10. Dividend Yield é a
 * única métrica que não vem de `ativo_resultado_trimestral`: é calculada a
 * partir dos proventos já existentes (tabela `proventos`, fonte única).
 * Cap Rate anualiza a receita imobiliária do trimestre mais recente (×4) —
 * aproximação documentada, já que só temos o dado trimestral, não o anual.
 */
export function calcularChecklistFii(
  pontos: PontoTrimestralFii[],
  precoAtual: number | null,
  proventosUltimos12Meses: number
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

  const dividendYieldPct = precoAtual !== null && precoAtual > 0 ? (proventosUltimos12Meses / precoAtual) * 100 : null;

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
