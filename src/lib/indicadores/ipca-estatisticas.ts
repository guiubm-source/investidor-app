/**
 * Cálculos derivados do IPCA — módulo PURO (sem "use server", sem acesso a
 * banco), mesmo padrão de `selic-estatisticas.ts`. Ver docs/MAPA-DE-DADOS.md
 * §8.8: impacto por grupo, acumulado no ano/12m, tendência (MM3×MM6),
 * distância da meta, rankings, correlação, índice de difusão e demais
 * estatísticas NUNCA são armazenados — são sempre recalculados aqui a partir
 * de `indicador_ipca_mensal` + `peso_ipca_grupo` + `meta_inflacao`.
 * `lib/indicadores/actions.ts` usa isso no servidor (dentro de `obterIpca()`)
 * e o componente da aba IPCA usa direto no cliente (filtros de gráfico).
 */

import { CATEGORIAS_IPCA } from "./schema";
import { calcularMediaMovel } from "./selic-estatisticas";

export type GrupoIpca = (typeof CATEGORIAS_IPCA)[number]["valor"];

export const GRUPOS_IPCA: GrupoIpca[] = CATEGORIAS_IPCA.map((c) => c.valor);

export type VariacoesGrupos = Record<GrupoIpca, number | null>;
export type ImpactosGrupo = Record<GrupoIpca, number | null>;

export type PontoIpca = {
  id: string;
  anoMes: string; // "AAAA-MM"
  geral: number | null;
  grupos: VariacoesGrupos;
  dataDivulgacao: string | null;
  fonte: string;
  observacoes: string | null;
};

export type PesoIpcaVigente = {
  grupo: GrupoIpca;
  pesoPct: number;
  vigenciaInicio: string;
  vigenciaFim: string | null;
};

export type MetaInflacaoVigente = {
  metaCentral: number;
  bandaInferior: number;
  bandaSuperior: number;
  vigenciaInicio: string;
  vigenciaFim: string | null;
};

export type SituacaoBanda = "abaixo" | "dentro" | "acima";
export type TendenciaInflacionaria = "acelerando" | "desacelerando" | "estavel";

export type EstatisticasSerie = {
  media: number | null;
  mediana: number | null;
  moda: number[] | null;
  variancia: number | null;
  desvioPadrao: number | null;
  amplitude: number | null;
  maximo: number | null;
  minimo: number | null;
  mesesPositivos: number;
  mesesNegativos: number;
};

function anoMesParaData(anoMes: string): string {
  return `${anoMes}-01`;
}

// ---------------------------------------------------------------------------
// Pesos e metas vigentes (busca por vigência, mesmo padrão de
// referencia/actions.ts#presidenteBcVigente)
// ---------------------------------------------------------------------------

/** Peso vigente de um grupo numa competência (AAAA-MM). Se houver mais de uma vigência aplicável, usa a mais recente. */
export function encontrarPesoVigente(pesos: PesoIpcaVigente[], grupo: GrupoIpca, anoMes: string): number | null {
  const data = anoMesParaData(anoMes);
  const candidatos = pesos
    .filter((p) => p.grupo === grupo && p.vigenciaInicio <= data && (p.vigenciaFim === null || p.vigenciaFim >= data))
    .sort((a, b) => b.vigenciaInicio.localeCompare(a.vigenciaInicio));
  return candidatos[0]?.pesoPct ?? null;
}

/** Meta vigente numa competência (AAAA-MM). Se houver mais de uma vigência aplicável, usa a mais recente. */
export function encontrarMetaVigente(metas: MetaInflacaoVigente[], anoMes: string): MetaInflacaoVigente | null {
  const data = anoMesParaData(anoMes);
  const candidatos = metas
    .filter((m) => m.vigenciaInicio <= data && (m.vigenciaFim === null || m.vigenciaFim >= data))
    .sort((a, b) => b.vigenciaInicio.localeCompare(a.vigenciaInicio));
  return candidatos[0] ?? null;
}

// ---------------------------------------------------------------------------
// Impacto por grupo (sempre calculado, nunca armazenado — decisão 2 do §8.8)
// ---------------------------------------------------------------------------

export function calcularImpacto(pesoPct: number | null, variacaoPct: number | null): number | null {
  if (pesoPct === null || variacaoPct === null) return null;
  return Number(((pesoPct / 100) * variacaoPct).toFixed(4));
}

export function calcularImpactosCompetencia(pesos: PesoIpcaVigente[], ponto: PontoIpca): ImpactosGrupo {
  const resultado = {} as ImpactosGrupo;
  for (const grupo of GRUPOS_IPCA) {
    const peso = encontrarPesoVigente(pesos, grupo, ponto.anoMes);
    resultado[grupo] = calcularImpacto(peso, ponto.grupos[grupo]);
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Acumulados (juros compostos — decisão 4 do §8.8)
// ---------------------------------------------------------------------------

/** Juros compostos: ((1+i1)×(1+i2)×...×(1+in))−1, variações em % (ex. 0.5 = 0,5%). Retorna em %. */
export function calcularAcumulado(variacoesPct: number[]): number {
  const fator = variacoesPct.reduce((acc, v) => acc * (1 + v / 100), 1);
  return Number(((fator - 1) * 100).toFixed(4));
}

export function calcularAcumuladoAno(pontosAsc: PontoIpca[], ano: string): { valor: number | null; meses: number } {
  const doAno = pontosAsc.filter((p) => p.anoMes.startsWith(ano) && p.geral !== null);
  if (doAno.length === 0) return { valor: null, meses: 0 };
  return { valor: calcularAcumulado(doAno.map((p) => p.geral!)), meses: doAno.length };
}

/** Acumulado nos últimos 12 meses com geral lançado. `completo=false` sinaliza menos de 12 meses disponíveis. */
export function calcularAcumulado12m(pontosAsc: PontoIpca[]): { valor: number | null; meses: number; completo: boolean } {
  const comGeral = pontosAsc.filter((p) => p.geral !== null);
  const ultimos12 = comGeral.slice(-12);
  if (ultimos12.length === 0) return { valor: null, meses: 0, completo: false };
  return {
    valor: calcularAcumulado(ultimos12.map((p) => p.geral!)),
    meses: ultimos12.length,
    completo: ultimos12.length >= 12,
  };
}

// ---------------------------------------------------------------------------
// Estatísticas de série (reaproveitada tanto pro índice geral quanto por grupo)
// ---------------------------------------------------------------------------

export function calcularEstatisticasSerie(valores: number[]): EstatisticasSerie {
  if (valores.length === 0) {
    return {
      media: null,
      mediana: null,
      moda: null,
      variancia: null,
      desvioPadrao: null,
      amplitude: null,
      maximo: null,
      minimo: null,
      mesesPositivos: 0,
      mesesNegativos: 0,
    };
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
  const mesesPositivos = valores.filter((v) => v > 0).length;
  const mesesNegativos = valores.filter((v) => v < 0).length;

  // Moda calculada sobre valores arredondados a 2 casas (série contínua raramente repete na casa 4).
  const contagem = new Map<number, number>();
  for (const v of valores) {
    const chave = Number(v.toFixed(2));
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }
  const maiorFrequencia = Math.max(...contagem.values());
  const moda = maiorFrequencia > 1 ? [...contagem.entries()].filter(([, f]) => f === maiorFrequencia).map(([v]) => v) : null;

  return { media, mediana, moda, variancia, desvioPadrao, amplitude, maximo, minimo, mesesPositivos, mesesNegativos };
}

/** Sequência de altas ou quedas seguidas no índice geral mês a mês (comparação com o mês anterior). */
export function calcularSequenciaAceleracaoDesaceleracao(
  pontosAsc: { anoMes: string; geral: number | null }[]
): { tipo: "aceleracao" | "desaceleracao"; quantidade: number } | null {
  const comGeral = pontosAsc.filter((p) => p.geral !== null);
  if (comGeral.length < 2) return null;

  const direcoes: ("up" | "down" | "igual")[] = [];
  for (let i = 1; i < comGeral.length; i++) {
    const diff = comGeral[i].geral! - comGeral[i - 1].geral!;
    direcoes.push(diff > 0 ? "up" : diff < 0 ? "down" : "igual");
  }

  const ultima = direcoes[direcoes.length - 1];
  if (ultima === "igual") return null;

  let quantidade = 0;
  for (let i = direcoes.length - 1; i >= 0; i--) {
    if (direcoes[i] !== ultima) break;
    quantidade++;
  }

  return { tipo: ultima === "up" ? "aceleracao" : "desaceleracao", quantidade };
}

/** Tendência inflacionária: compara a média móvel curta (3m) com a longa (6m) do índice geral. */
export function calcularTendenciaInflacionaria(geralSerieAsc: (number | null)[]): TendenciaInflacionaria | null {
  const mm3 = calcularMediaMovel(geralSerieAsc, 3);
  const mm6 = calcularMediaMovel(geralSerieAsc, 6);
  const ultimoMm3 = mm3.at(-1);
  const ultimoMm6 = mm6.at(-1);
  if (ultimoMm3 == null || ultimoMm6 == null) return null;
  if (ultimoMm3 > ultimoMm6) return "acelerando";
  if (ultimoMm3 < ultimoMm6) return "desacelerando";
  return "estavel";
}

// ---------------------------------------------------------------------------
// Meta de inflação
// ---------------------------------------------------------------------------

export function calcularDistanciaMeta(valor: number | null, metaCentral: number | null): number | null {
  if (valor === null || metaCentral === null) return null;
  return Number((valor - metaCentral).toFixed(4));
}

export function calcularSituacaoBanda(
  valor: number | null,
  bandaInferior: number | null,
  bandaSuperior: number | null
): SituacaoBanda | null {
  if (valor === null || bandaInferior === null || bandaSuperior === null) return null;
  if (valor < bandaInferior) return "abaixo";
  if (valor > bandaSuperior) return "acima";
  return "dentro";
}

// ---------------------------------------------------------------------------
// Rankings, correlação, difusão, volatilidade por grupo
// ---------------------------------------------------------------------------

export function rankingGruposNaCompetencia(ponto: PontoIpca): { grupo: GrupoIpca; variacao: number }[] {
  return GRUPOS_IPCA.filter((g) => ponto.grupos[g] !== null)
    .map((g) => ({ grupo: g, variacao: ponto.grupos[g]! }))
    .sort((a, b) => b.variacao - a.variacao);
}

export function rankingImpactosNaCompetencia(impactos: ImpactosGrupo): { grupo: GrupoIpca; impacto: number }[] {
  return GRUPOS_IPCA.filter((g) => impactos[g] !== null)
    .map((g) => ({ grupo: g, impacto: impactos[g]! }))
    .sort((a, b) => b.impacto - a.impacto);
}

export function correlacaoPearson(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 2) return null;
  const mediaA = a.reduce((s, v) => s + v, 0) / a.length;
  const mediaB = b.reduce((s, v) => s + v, 0) / b.length;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - mediaA;
    const db = b[i] - mediaB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return null;
  return Number((cov / Math.sqrt(varA * varB)).toFixed(4));
}

/** Correlação entre a variação de um grupo e o índice geral, usando só competências onde ambos existem. Amostra mínima de 3 pontos. */
export function correlacaoGrupoComGeral(pontosAsc: PontoIpca[], grupo: GrupoIpca): number | null {
  const pares = pontosAsc.filter((p) => p.geral !== null && p.grupos[grupo] !== null);
  if (pares.length < 3) return null;
  return correlacaoPearson(
    pares.map((p) => p.geral!),
    pares.map((p) => p.grupos[grupo]!)
  );
}

export function grupoMaisVolatilEEstavel(pontosAsc: PontoIpca[]): {
  maisVolatil: { grupo: GrupoIpca; desvioPadrao: number } | null;
  maisEstavel: { grupo: GrupoIpca; desvioPadrao: number } | null;
} {
  const desvios: { grupo: GrupoIpca; desvioPadrao: number }[] = [];
  for (const grupo of GRUPOS_IPCA) {
    const serie = pontosAsc.filter((p) => p.grupos[grupo] !== null).map((p) => p.grupos[grupo]!);
    if (serie.length < 2) continue;
    const { desvioPadrao } = calcularEstatisticasSerie(serie);
    if (desvioPadrao !== null) desvios.push({ grupo, desvioPadrao });
  }
  if (desvios.length === 0) return { maisVolatil: null, maisEstavel: null };
  const ordenado = [...desvios].sort((a, b) => b.desvioPadrao - a.desvioPadrao);
  return { maisVolatil: ordenado[0], maisEstavel: ordenado[ordenado.length - 1] };
}

/** Impacto médio e acumulado de cada grupo ao longo do histórico disponível, ordenado por acumulado desc. */
export function gruposPorImpactoHistorico(
  pontosAsc: PontoIpca[],
  pesos: PesoIpcaVigente[]
): { grupo: GrupoIpca; impactoMedio: number; impactoAcumulado: number }[] {
  const resultado: { grupo: GrupoIpca; impactoMedio: number; impactoAcumulado: number }[] = [];
  for (const grupo of GRUPOS_IPCA) {
    const impactos: number[] = [];
    for (const ponto of pontosAsc) {
      const peso = encontrarPesoVigente(pesos, grupo, ponto.anoMes);
      const impacto = calcularImpacto(peso, ponto.grupos[grupo]);
      if (impacto !== null) impactos.push(impacto);
    }
    if (impactos.length === 0) continue;
    resultado.push({
      grupo,
      impactoMedio: Number((impactos.reduce((s, v) => s + v, 0) / impactos.length).toFixed(4)),
      impactoAcumulado: Number(impactos.reduce((s, v) => s + v, 0).toFixed(4)),
    });
  }
  return resultado.sort((a, b) => b.impactoAcumulado - a.impactoAcumulado);
}

/** Índice de difusão: % dos 9 grupos com variação positiva na competência (entre os que têm dado lançado). */
export function calcularIndiceDifusao(
  ponto: PontoIpca
): { positivos: number; negativos: number; neutros: number; semDado: number; indice: number | null } {
  let positivos = 0;
  let negativos = 0;
  let neutros = 0;
  let semDado = 0;
  for (const grupo of GRUPOS_IPCA) {
    const v = ponto.grupos[grupo];
    if (v === null) {
      semDado++;
      continue;
    }
    if (v > 0) positivos++;
    else if (v < 0) negativos++;
    else neutros++;
  }
  const totalComDado = GRUPOS_IPCA.length - semDado;
  const indice = totalComDado > 0 ? Number(((positivos / totalComDado) * 100).toFixed(2)) : null;
  return { positivos, negativos, neutros, semDado, indice };
}

// ---------------------------------------------------------------------------
// Importação (colar texto) — parser puro; quem grava no banco é
// lib/indicadores/actions.ts#importarHistoricoIpca.
// ---------------------------------------------------------------------------

export type LinhaImportacaoIpca = {
  anoMes: string;
  geral: number;
  grupos: Partial<Record<GrupoIpca, number>>;
};
export type ResultadoParseImportacaoIpca = { linhas: LinhaImportacaoIpca[]; erros: string[] };

/**
 * Aceita colunas separadas por "|", TAB ou 2+ espaços, no formato
 * "COMPETÊNCIA | GERAL | 9 grupos (na ordem oficial de CATEGORIAS_IPCA)".
 * Colunas de grupo são opcionais (podem faltar todas ou faltar as últimas).
 * Colunas extras além das 11 esperadas (ex. impacto por grupo colado junto)
 * são ignoradas — impacto nunca é importado, é sempre calculado (decisão 2
 * do §8.8). Competência em MM/AAAA ou AAAA-MM. Decimais aceitam vírgula ou
 * ponto. Ignora uma linha de cabeçalho se a primeira palavra for "competência".
 */
export function parseImportacaoIpca(texto: string): ResultadoParseImportacaoIpca {
  const erros: string[] = [];
  const linhasTexto = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const linhas: LinhaImportacaoIpca[] = [];
  const competenciasVistas = new Set<string>();
  const hojeAnoMes = new Date().toISOString().slice(0, 7);

  linhasTexto.forEach((linhaOriginal, idx) => {
    if (/^compet[eê]ncia\b/i.test(linhaOriginal)) return;

    const colunas = linhaOriginal
      .split(/\||\t+|\s{2,}/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (colunas.length < 2) {
      erros.push(`Linha ${idx + 1}: não foi possível separar as colunas ("${linhaOriginal}").`);
      return;
    }

    const [competenciaTexto, geralTexto, ...resto] = colunas;

    const matchBr = competenciaTexto.match(/^(\d{2})\/(\d{4})$/);
    const matchIso = competenciaTexto.match(/^(\d{4})-(\d{2})$/);
    let anoMes: string;
    if (matchBr) {
      const [, mm, aaaa] = matchBr;
      anoMes = `${aaaa}-${mm}`;
    } else if (matchIso) {
      anoMes = competenciaTexto;
    } else {
      erros.push(`Linha ${idx + 1}: competência inválida ("${competenciaTexto}"). Use MM/AAAA ou AAAA-MM.`);
      return;
    }

    if (anoMes > hojeAnoMes) {
      erros.push(`Linha ${idx + 1}: competência futura não permitida ("${competenciaTexto}").`);
      return;
    }

    const geral = Number(geralTexto.replace(",", "."));
    if (!Number.isFinite(geral)) {
      erros.push(`Linha ${idx + 1}: índice geral inválido ("${geralTexto}").`);
      return;
    }

    const grupos: Partial<Record<GrupoIpca, number>> = {};
    let linhaComErro = false;
    for (let i = 0; i < GRUPOS_IPCA.length && i < resto.length; i++) {
      const textoValor = resto[i];
      if (!textoValor) continue;
      const valor = Number(textoValor.replace(",", "."));
      if (!Number.isFinite(valor)) {
        erros.push(`Linha ${idx + 1}: variação inválida para ${CATEGORIAS_IPCA[i].label} ("${textoValor}").`);
        linhaComErro = true;
        break;
      }
      grupos[GRUPOS_IPCA[i]] = valor;
    }
    if (linhaComErro) return;

    if (competenciasVistas.has(anoMes)) {
      erros.push(`Linha ${idx + 1}: competência duplicada dentro do texto colado ("${competenciaTexto}").`);
      return;
    }
    competenciasVistas.add(anoMes);

    linhas.push({ anoMes, geral, grupos });
  });

  linhas.sort((a, b) => a.anoMes.localeCompare(b.anoMes));

  return { linhas, erros };
}
