/**
 * Tipos da "Grade mensal/anual" de Proventos (visão estilo planilha, ver
 * docs/MAPA-DE-DADOS.md §8.23) — módulo PURO, fora de
 * `lib/proventos/grade-mensal.ts` (que tem `"use server"`). Mesmo motivo do
 * `visao-mensal-tipos.ts` da Carteira (§8.19/§8.21): um arquivo `"use
 * server"` só pode exportar `async function`, então tipos/consts moram aqui
 * e são só importados por quem precisar (server e UI).
 *
 * Reaproveita `MESES_LABEL` de `lib/carteira/visao-mensal-tipos.ts` — é um
 * rótulo de mês genérico (Jan..Dez), sem nenhuma regra de proventos embutida,
 * então reexportar de lá evita duplicar a mesma constante em dois lugares.
 */

import type { GrupoPosicao } from "@/lib/carteira/grupo-classificacao";

export { MESES_LABEL } from "@/lib/carteira/visao-mensal-tipos";

/** Uma linha da grade: uma categoria (ou a linha "TOTAL"), 12 valores mensais + total do período. */
export type LinhaGradeCategoria = {
  grupo: GrupoPosicao | "total";
  label: string;
  meses: number[];
  totalLinha: number;
};

export type GradeAno = {
  /** "GERAL" (soma de todos os anos, mês a mês) ou o ano em si (ex. "2025"). */
  chave: string;
  label: string;
  linhas: LinhaGradeCategoria[];
};

export type GradeMensalProventos = {
  geral: GradeAno;
  /** Mais recente primeiro. */
  porAno: GradeAno[];
};
