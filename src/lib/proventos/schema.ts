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

export const proventoSchema = z.object({
  ativo_id: z.string().uuid("Selecione um ativo"),
  tipo: z.enum(["dividendo", "jcp", "rendimento", "outro"]),
  data: z.string().min(1, "Informe a data"),
  valor_total: z.number().min(0, "Informe um valor válido"),
});
export type ProventoForm = z.infer<typeof proventoSchema>;
