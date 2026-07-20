import { z } from "zod";

/**
 * Único lugar onde a lista de tipos de provento é definida — usado tanto
 * pelo formulário de cadastro (aba Proventos) quanto pelas telas que só
 * exibem o rótulo (Carteira, detalhe do Ativo).
 */
export const TIPOS_PROVENTO = [
  { valor: "dividendo", label: "Dividendo" },
  { valor: "jcp", label: "Juros sobre capital próprio (JCP)" },
  { valor: "rendimento", label: "Rendimento" },
  { valor: "outro", label: "Outro" },
] as const;

/**
 * Ver docs/MAPA-DE-DADOS.md §8.23 (2026-07-20) — aba Proventos avançada:
 * - `data_pagamento` é a única data obrigatória (era `data` antes da
 *   migração). `data_com` é opcional — o usuário pode completar depois.
 * - `quantidade` + `valor_por_cota` substituem o `valor_total` digitado
 *   direto: a partir de agora o valor total é sempre CALCULADO
 *   (quantidade × valor_por_cota) em `criarProvento`/`editarProvento`, nunca
 *   digitado — evita o valor_total ficar dessincronizado dos dois campos que
 *   agora são a fonte única. Lançamentos antigos (só com valor_total) não são
 *   afetados, continuam existindo com quantidade/valor_por_cota nulos.
 */
export const proventoSchema = z.object({
  ativo_id: z.string().uuid("Selecione um ativo"),
  tipo: z.enum(["dividendo", "jcp", "rendimento", "outro"]),
  // Select/input de formulário manda "" quando "não informado" — union com
  // z.literal("") (em vez de z.preprocess) mantém o tipo de entrada
  // explícito, mesmo padrão já usado em lib/ativos/schema.ts.
  data_com: z.union([z.string(), z.literal("")]).transform((v) => (v ? v : null)),
  data_pagamento: z.string().min(1, "Informe a data de pagamento"),
  quantidade: z.number().positive("Informe uma quantidade válida"),
  valor_por_cota: z.number().min(0, "Informe um valor por cota válido"),
});
export type ProventoForm = z.infer<typeof proventoSchema>;
