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

// Tipos e schema de provento moraram aqui antes; agora vivem em
// lib/proventos/schema.ts (cadastro de provento saiu da Carteira e virou
// aba própria — ver docs/MAPA-DE-DADOS.md). A Carteira ainda EXIBE proventos
// no livro-razão combinado (somente leitura), então continua importando
// TIPOS_PROVENTO de lá só para exibir o rótulo.
