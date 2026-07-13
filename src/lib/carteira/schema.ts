import { z } from "zod";

export const corretoraSchema = z.object({
  nome: z.string().trim().min(1, "Informe um nome"),
});
export type CorretoraForm = z.infer<typeof corretoraSchema>;

export const TIPOS_TRANSACAO = [
  { valor: "compra", label: "Compra" },
  { valor: "venda", label: "Venda" },
] as const;

export const transacaoSchema = z.object({
  ativo_id: z.string().uuid("Selecione um ativo"),
  corretora_id: z
    .string()
    .transform((v) => (v ? v : null))
    .nullable(),
  tipo: z.enum(["compra", "venda"]),
  data: z.string().min(1, "Informe a data"),
  quantidade: z.number().positive("Quantidade deve ser maior que zero"),
  preco_unitario: z.number().min(0, "Informe um preço válido"),
  custos: z.number().min(0, "Informe um valor válido"),
});
export type TransacaoForm = z.infer<typeof transacaoSchema>;

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
