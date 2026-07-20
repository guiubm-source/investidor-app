/**
 * Classificação de ativo em "classe" de exibição (Ações/FIIs/Tesouro/...) —
 * módulo PURO, fora de qualquer arquivo `"use server"` (mesmo motivo de
 * lib/ativos/posicao-calculo.ts: um arquivo `"use server"` só pode exportar
 * async functions — ver docs/MAPA-DE-DADOS.md §8.12 decisão 4; array/objeto/
 * função síncrona exportados de lá quebrariam o build da Vercel, mesmo com
 * tsc limpo). Extraído de lib/carteira/posicao.ts pra ser reaproveitado
 * também por lib/carteira/visao-mensal.ts, sem duplicar a lógica de
 * classificação (fonte única, ver §3). `posicao.ts` reexporta o tipo
 * `GrupoPosicao` pra não quebrar quem já importava de lá.
 */
import type { TipoAtivo } from "@/lib/ativos/actions";

export type GrupoPosicao =
  | "acoes"
  | "fiis"
  | "tesouro"
  | "renda_fixa"
  | "fundos"
  | "stocks"
  | "reits"
  | "etf_exterior"
  | "internacional_outros"
  | "etf_brasil"
  | "cripto"
  | "outros";

/** Ordem de exibição dos grupos — mesma sequência do print de referência (§8.16). */
export const ORDEM_GRUPOS: GrupoPosicao[] = [
  "acoes",
  "fiis",
  "tesouro",
  "renda_fixa",
  "etf_brasil",
  "stocks",
  "reits",
  "etf_exterior",
  "internacional_outros",
  "cripto",
  "fundos",
  "outros",
];

export const LABEL_GRUPO: Record<GrupoPosicao, string> = {
  acoes: "Ações",
  fiis: "FIIs",
  tesouro: "Tesouro Direto",
  renda_fixa: "Renda Fixa",
  fundos: "Fundos de Investimento",
  stocks: "Stocks",
  reits: "REITs",
  etf_exterior: "ETF Exterior",
  internacional_outros: "Internacional (não classificado)",
  etf_brasil: "ETF Brasil",
  cripto: "Criptomoedas",
  outros: "Outros",
};

/**
 * Deriva o grupo de exibição a partir de tipo + subtipo — ver
 * docs/MAPA-DE-DADOS.md §8.16. `internacional` sem subtipo informado cai num
 * grupo separado "não classificado" em vez de adivinhar Stock vs ETF (o
 * usuário pode preencher a qualquer momento na página do ativo).
 */
export function grupoDoAtivo(
  tipo: TipoAtivo,
  subtipoRendaFixa: string | null,
  subtipoInternacional: string | null
): GrupoPosicao {
  switch (tipo) {
    case "acao":
      return "acoes";
    case "fii":
      return "fiis";
    case "etf":
      return "etf_brasil";
    case "renda_fixa":
      return subtipoRendaFixa === "tesouro" ? "tesouro" : "renda_fixa";
    case "fundo":
      return "fundos";
    case "cripto":
      return "cripto";
    case "internacional":
      if (subtipoInternacional === "etf") return "etf_exterior";
      if (subtipoInternacional === "acao") return "stocks";
      if (subtipoInternacional === "reit") return "reits";
      return "internacional_outros";
    default:
      return "outros";
  }
}
