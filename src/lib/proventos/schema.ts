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
  { valor: "aluguel", label: "Aluguel de ações" },
  { valor: "reembolso", label: "Reembolso" },
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
/**
 * Detalhe fiscal opcional (§8.32.27.1, fase 2 da reformulação do IR — ver
 * docs/MAPA-DE-DADOS.md §8.35). `valor_total` (calculado de sempre,
 * quantidade × valor_por_cota) continua sendo o valor usado em TODO cálculo
 * já existente (DY, Yield on Cost, retorno total) — estes campos são
 * detalhe ADICIONAL, ainda sem nenhum motor consumindo (isso é fase 7,
 * exterior/EUA — crédito de imposto pago fora).
 */
const numOuNan = z.union([z.number(), z.nan()]).optional();

export const proventoSchema = z.object({
  ativo_id: z.string().uuid("Selecione um ativo"),
  tipo: z.enum(["dividendo", "jcp", "rendimento", "aluguel", "reembolso", "outro"]),
  // Select/input de formulário manda "" quando "não informado" — union com
  // z.literal("") (em vez de z.preprocess) mantém o tipo de entrada
  // explícito, mesmo padrão já usado em lib/ativos/schema.ts.
  data_com: z.union([z.string(), z.literal("")]).transform((v) => (v ? v : null)),
  data_pagamento: z.string().min(1, "Informe a data de pagamento"),
  quantidade: z.number().positive("Informe uma quantidade válida"),
  valor_por_cota: z.number().min(0, "Informe um valor por cota válido"),
  moeda: z.enum(["BRL", "USD"]).optional(),
  cambio: numOuNan,
  imposto_retido: numOuNan,
  pais_fonte: z.union([z.string(), z.literal("")]).optional(),
  fonte_pagadora_identificador: z.union([z.string(), z.literal("")]).optional(),
})
  .transform((dados) => {
    const num = (v: number | undefined) => (typeof v === "number" && !Number.isNaN(v) ? v : null);
    const texto = (v: string | undefined) => (v ? v : null);
    return {
      ativo_id: dados.ativo_id,
      tipo: dados.tipo,
      data_com: dados.data_com,
      data_pagamento: dados.data_pagamento,
      quantidade: dados.quantidade,
      valor_por_cota: dados.valor_por_cota,
      moeda: dados.moeda ?? "BRL",
      cambio: num(dados.cambio),
      imposto_retido: num(dados.imposto_retido) ?? 0,
      pais_fonte: dados.pais_fonte ? dados.pais_fonte : "Brasil",
      fonte_pagadora_identificador: texto(dados.fonte_pagadora_identificador),
    };
  });
export type ProventoForm = z.infer<typeof proventoSchema>;
