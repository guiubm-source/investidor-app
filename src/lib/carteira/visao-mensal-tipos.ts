/**
 * Tipos + constantes da Visão mensal (ver docs/MAPA-DE-DADOS.md §8.19/§8.21)
 * — módulo PURO, deliberadamente FORA de `lib/carteira/visao-mensal.ts`
 * (que tem `"use server"`).
 *
 * Motivo (mesmo bug de `GrupoPosicao`, ver §8.21): um arquivo `"use server"`
 * só pode exportar `async function` — o transform de Server Actions do
 * Next/Turbopack escaneia TODO export do arquivo (inclusive `export const`
 * e `export type`) pra montar o módulo de referências de ações, e nem
 * `MESES_LABEL` (const) nem os tipos abaixo existem como Server Action de
 * verdade, então o build real (Vercel) quebra mesmo com `tsc --noEmit`
 * limpo. `visao-mensal.ts` importa tudo daqui e exporta só
 * `obterVisaoMensal` (async function) — quem mais precisar de
 * `MESES_LABEL`/tipos (ex. `VisaoMensalView.tsx`) importa direto deste
 * módulo, nunca de `visao-mensal.ts`.
 */

import type { GrupoPosicao } from "./grupo-classificacao";

export const MESES_LABEL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export type MesDado = { compra: number; venda: number };

export type LinhaTabelaMensal = {
  /** "GERAL" (agregado de todos os anos, mês a mês) ou o ano em si (ex. "2025"). */
  chave: string;
  label: string;
  /** Índice 0 = Janeiro ... 11 = Dezembro. */
  meses: MesDado[];
  totalLinha: MesDado;
};

/** `geral` soma cada mês-calendário (Jan, Fev, ...) através de TODOS os anos; `porAno` é o detalhamento ano a ano, mais recente primeiro. */
export type TabelaMensal = {
  geral: LinhaTabelaMensal;
  porAno: LinhaTabelaMensal[];
};

export type GrupoVisaoMensal = {
  grupo: GrupoPosicao;
  label: string;
  tabela: TabelaMensal;
};

/**
 * Um ponto por mês (cronológico, "AAAA-MM") pro gráfico de acúmulo de
 * capital. `retirada` é a regra definida pelo Guilherme em 2026-07-20: se a
 * venda do mês superar o aporte do mês, o excedente é tratado como retirada
 * (não rebalanceamento) — `acumulado` continua sendo simplesmente a soma
 * corrida de `liquido` (aporte − venda), a marcação de retirada é só um
 * insight complementar sobre O PORQUÊ de uma queda no acumulado.
 */
export type PontoCapitalMensal = {
  anoMes: string;
  compra: number;
  venda: number;
  liquido: number;
  retirada: number;
  acumulado: number;
};

export type VisaoMensal = {
  total: TabelaMensal;
  porGrupo: GrupoVisaoMensal[];
  evolucaoCapital: PontoCapitalMensal[];
};
