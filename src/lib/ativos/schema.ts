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

export const ativoSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1, "Informe o ticker/código")
    .transform((v) => v.toUpperCase()),
  nome: z.string().trim().optional(),
  tipo: z.enum(["acao", "fii", "renda_fixa", "fundo", "internacional", "cripto", "outro"]),
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
