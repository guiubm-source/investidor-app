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
  // Só relevante quando o ativo é do tipo `internacional` — câmbio do dia da
  // operação, usado pelo relatório de IR (ver docs/MAPA-DE-DADOS.md §8.5.4).
  // union com z.nan() (em vez de z.preprocess) aceita o NaN que o input HTML
  // manda quando fica vazio (valueAsNumber), sem deixar o tipo de entrada
  // como `unknown` — isso conflitaria com o generic do useForm.
  cambio: z
    .union([z.number().positive("Informe um câmbio válido"), z.nan()])
    .transform((v) => (typeof v === "number" && Number.isNaN(v) ? null : v)),
});
export type TransacaoForm = z.infer<typeof transacaoSchema>;

// Tipos e schema de provento moraram aqui antes; agora vivem em
// lib/proventos/schema.ts (cadastro de provento saiu da Carteira e virou
// aba própria — ver docs/MAPA-DE-DADOS.md). A Carteira ainda EXIBE proventos
// no livro-razão combinado (somente leitura), então continua importando
// TIPOS_PROVENTO de lá só para exibir o rótulo.
