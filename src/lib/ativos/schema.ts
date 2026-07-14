import { z } from "zod";

export const TIPOS_ATIVO = [
  { valor: "acao", label: "Ação" },
  { valor: "fii", label: "Fundo imobiliário (FII)" },
  { valor: "renda_fixa", label: "Renda fixa" },
  { valor: "fundo", label: "Fundo de investimento" },
  { valor: "internacional", label: "Internacional (ação/ETF exterior)" },
  { valor: "cripto", label: "Criptomoeda" },
  { valor: "outro", label: "Outro" },
] as const;

/**
 * Só usados pelo relatório de Imposto de Renda (ver docs/MAPA-DE-DADOS.md
 * §8.5) — distinguem, dentro de `renda_fixa` e `cripto`, subtipos que mudam
 * a tributação (LCI/LCA/CRI/CRA isentos; cripto em exchange estrangeira sem
 * isenção de piso). Sem efeito em nenhum outro cálculo do app.
 */
export const SUBTIPOS_RENDA_FIXA = [
  { valor: "cdb", label: "CDB" },
  { valor: "tesouro", label: "Tesouro Direto" },
  { valor: "debenture", label: "Debênture" },
  { valor: "lci", label: "LCI (isento)" },
  { valor: "lca", label: "LCA (isento)" },
  { valor: "cri", label: "CRI (isento)" },
  { valor: "cra", label: "CRA (isento)" },
] as const;

export const EXCHANGES_CRIPTO = [
  { valor: "nacional", label: "Exchange nacional" },
  { valor: "estrangeira", label: "Exchange estrangeira" },
] as const;

export const ativoSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1, "Informe o ticker/código")
    .transform((v) => v.toUpperCase()),
  nome: z.string().trim().optional(),
  tipo: z.enum(["acao", "fii", "renda_fixa", "fundo", "internacional", "cripto", "outro"]),
  // Selects de formulário mandam "" quando "não informado" — union com
  // z.literal("") (em vez de z.preprocess) mantém o tipo de entrada
  // explícito, o que evita conflito de tipos entre zodResolver e o generic
  // do useForm (preprocess deixa o tipo de entrada como `unknown`).
  subtipo_renda_fixa: z
    .union([z.enum(["cdb", "tesouro", "debenture", "lci", "lca", "cri", "cra"]), z.literal("")])
    .transform((v) => (v ? v : null)),
  cripto_exchange: z
    .union([z.enum(["nacional", "estrangeira"]), z.literal("")])
    .transform((v) => (v ? v : null)),
});
export type AtivoForm = z.infer<typeof ativoSchema>;

export const classificacaoSchema = z.object({
  setor_id: z.string().uuid("Selecione um setor"),
  peso_alvo: z.number().min(0, "Deve ser entre 0 e 100").max(100, "Deve ser entre 0 e 100"),
});
export type ClassificacaoForm = z.infer<typeof classificacaoSchema>;

export const precoAtualSchema = z.object({
  preco_atual: z.number().min(0, "Informe um preço válido"),
});
export type PrecoAtualForm = z.infer<typeof precoAtualSchema>;

// Vazio ("") = usar o símbolo derivado automaticamente do tipo do ativo.
export const simboloTradingviewSchema = z.object({
  simbolo_tradingview: z.string().trim(),
});
export type SimboloTradingviewForm = z.infer<typeof simboloTradingviewSchema>;
