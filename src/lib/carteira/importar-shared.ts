/**
 * Helpers PUROS e compartilhados entre os dois motores de importação por
 * copiar/colar do app (Livro-razão → `importar-transacoes.ts` e Proventos →
 * `../proventos/importar-proventos.ts`) — ver docs/MAPA-DE-DADOS.md §8.24 e
 * §8.30. Deliberadamente FORA de qualquer arquivo `"use server"` (mesmo
 * motivo de `lib/ativos/posicao-calculo.ts`, ver comentário lá): são
 * funções síncronas, e Server Actions são obrigadas a ser `async` — colocar
 * essas aqui evita que cada motor de importação duplique a mesma lógica de
 * parsing/classificação (fonte única de verdade, ver §3).
 */

import type { TipoAtivo } from "@/lib/ativos/actions";

export function normalizar(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function parseNumeroBR(txt: string): number | null {
  const limpo = txt.trim().replace(/\./g, "").replace(",", ".");
  if (limpo === "") return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

export function parseDataBR(txt: string): string | null {
  const m = txt.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  // Validação mínima de data real (30/02 etc. não vira uma data "quase certa" silenciosa).
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.getUTCDate() !== Number(d)) return null;
  return iso;
}

/**
 * "Grupo"/"Tipo do ativo" da planilha do Guilherme → tipo/subtipo do app
 * (ver docs/MAPA-DE-DADOS.md §8.16/§8.23 pra classificação já existente) —
 * só usado quando o ATIVO ainda não está cadastrado (ativo já existente usa
 * o tipo/subtipo já salvo, ignorando o texto colado).
 */
export const MAPA_GRUPO: Record<string, { tipo: TipoAtivo; subtipoInternacional?: string; subtipoRendaFixa?: string }> = {
  acoes: { tipo: "acao" },
  acao: { tipo: "acao" },
  "acoes eua": { tipo: "internacional", subtipoInternacional: "acao" },
  "acoes exterior": { tipo: "internacional", subtipoInternacional: "acao" },
  stocks: { tipo: "internacional", subtipoInternacional: "acao" },
  stock: { tipo: "internacional", subtipoInternacional: "acao" },
  "etf usa": { tipo: "internacional", subtipoInternacional: "etf" },
  "etf exterior": { tipo: "internacional", subtipoInternacional: "etf" },
  "etf eua": { tipo: "internacional", subtipoInternacional: "etf" },
  "etf brasil": { tipo: "etf" },
  etf: { tipo: "etf" },
  "fundo imobiliario": { tipo: "fii" },
  fii: { tipo: "fii" },
  fiis: { tipo: "fii" },
  reit: { tipo: "internacional", subtipoInternacional: "reit" },
  reits: { tipo: "internacional", subtipoInternacional: "reit" },
  "tesouro direto": { tipo: "renda_fixa", subtipoRendaFixa: "tesouro" },
  tesouro: { tipo: "renda_fixa", subtipoRendaFixa: "tesouro" },
  "renda fixa": { tipo: "renda_fixa" },
  cripto: { tipo: "cripto" },
  criptomoeda: { tipo: "cripto" },
  fundo: { tipo: "fundo" },
  fundos: { tipo: "fundo" },
  "fundo de investimento": { tipo: "fundo" },
  outro: { tipo: "outro" },
  outros: { tipo: "outro" },
};

/** Payload de um ativo ainda não cadastrado, resolvido a partir de `MAPA_GRUPO`. */
export type AtivoNovo = {
  tipo: TipoAtivo;
  subtipoInternacional: "acao" | "etf" | "reit" | null;
  subtipoRendaFixa: "cdb" | "tesouro" | "debenture" | "lci" | "lca" | "cri" | "cra" | null;
};

/** Resolve o texto de "Grupo"/"Tipo do ativo" colado em um `AtivoNovo`, ou `null` se não reconhecido. */
export function resolverAtivoNovo(grupoTexto: string): AtivoNovo | null {
  const mapeado = MAPA_GRUPO[normalizar(grupoTexto)];
  if (!mapeado) return null;
  return {
    tipo: mapeado.tipo,
    subtipoInternacional: (mapeado.subtipoInternacional as AtivoNovo["subtipoInternacional"]) ?? null,
    subtipoRendaFixa: (mapeado.subtipoRendaFixa as AtivoNovo["subtipoRendaFixa"]) ?? null,
  };
}

/**
 * Índice de cada coluna esperada dentro da 1ª linha colada, na ordem de
 * `colunasEsperadas` (já normalizada) — ou `null` se a 1ª linha não bater
 * com um cabeçalho reconhecível (nesse caso quem chama assume a ordem fixa
 * de sempre). Genérico o bastante pra servir tanto o import de transações
 * quanto o de proventos, cada um com seu próprio conjunto de colunas.
 */
export function detectarIndicesColuna(primeiraLinha: string[], colunasEsperadas: readonly string[]): number[] | null {
  const normalizado = primeiraLinha.map(normalizar);
  const indices = colunasEsperadas.map((c) => normalizado.findIndex((n) => n === c));
  if (indices.some((i) => i === -1)) return null;
  return indices;
}
