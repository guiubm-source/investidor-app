import { z } from "zod";

export const corretoraSchema = z.object({
  nome: z.string().trim().min(1, "Informe um nome"),
});
export type CorretoraForm = z.infer<typeof corretoraSchema>;

/**
 * Ver docs/MAPA-DE-DADOS.md §8.22: além de compra/venda, o Livro-razão passou
 * a aceitar eventos societários — desdobramento/grupamento (fator de
 * proporção) e bonificação (quantidade recebida + valor capitalizado) — como
 * tipos especiais dentro da mesma tabela `transacoes` (não uma tabela
 * separada), pra manter fonte única de verdade.
 */
export const TIPOS_TRANSACAO = [
  { valor: "compra", label: "Compra" },
  { valor: "venda", label: "Venda" },
  { valor: "desdobramento", label: "Desdobramento" },
  { valor: "grupamento", label: "Grupamento" },
  { valor: "bonificacao", label: "Bonificação" },
] as const;

/**
 * Só desdobramento/grupamento/bonificação usam estes 3 campos — sempre
 * `null` para compra/venda. Compartilhado entre `transacaoSchema` e o motor
 * de cálculo (`TransacaoCalc` em lib/ativos/posicao-calculo.ts) só de nome,
 * não de tipo (schema usa snake_case pra bater com as colunas do banco).
 */
const numOuNan = z.union([z.number(), z.nan()]).optional();

export const transacaoSchema = z
  .object({
    ativo_id: z.string().uuid("Selecione um ativo"),
    corretora_id: z
      .string()
      .transform((v) => (v ? v : null))
      .nullable(),
    tipo: z.enum(["compra", "venda", "desdobramento", "grupamento", "bonificacao"]),
    data: z.string().min(1, "Informe a data"),
    // compra/venda: quantidade negociada. bonificação: quantidade de ações
    // recebidas. Ausente em desdobramento/grupamento — por isso vira opcional
    // aqui (obrigatoriedade por tipo é validada no superRefine abaixo), união
    // com z.nan() pelo mesmo motivo do câmbio (input HTML vazio manda NaN).
    quantidade: numOuNan,
    preco_unitario: numOuNan,
    custos: numOuNan,
    // Só desdobramento/grupamento: fator multiplicador (2 = desdobra 1:2, 0.1 = agrupa 10:1).
    fator_proporcao: numOuNan,
    // Só bonificação: valor total (R$) atribuído à capitalização (0 se não houver).
    valor_capitalizado: numOuNan,
    // Só relevante quando o ativo é do tipo `internacional` — câmbio do dia da
    // operação, usado pelo relatório de IR (ver docs/MAPA-DE-DADOS.md §8.5.4).
    // union com z.nan() (em vez de z.preprocess) aceita o NaN que o input HTML
    // manda quando fica vazio (valueAsNumber), sem deixar o tipo de entrada
    // como `unknown` — isso conflitaria com o generic do useForm.
    cambio: z
      .union([z.number().positive("Informe um câmbio válido"), z.nan()])
      .transform((v) => (typeof v === "number" && Number.isNaN(v) ? null : v)),
  })
  .superRefine((dados, ctx) => {
    const valido = (v: number | undefined) => typeof v === "number" && !Number.isNaN(v);

    if (dados.tipo === "compra" || dados.tipo === "venda") {
      if (!valido(dados.quantidade) || dados.quantidade! <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantidade"], message: "Quantidade deve ser maior que zero" });
      }
      if (!valido(dados.preco_unitario) || dados.preco_unitario! < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["preco_unitario"], message: "Informe um preço válido" });
      }
      if (valido(dados.custos) && dados.custos! < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["custos"], message: "Informe um valor válido" });
      }
    } else if (dados.tipo === "desdobramento" || dados.tipo === "grupamento") {
      if (!valido(dados.fator_proporcao) || dados.fator_proporcao! <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fator_proporcao"],
          message: "Informe o fator de proporção (ex.: 2 para desdobrar 1:2, 0,1 para agrupar 10:1)",
        });
      }
    } else {
      // bonificacao
      if (!valido(dados.quantidade) || dados.quantidade! <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantidade"], message: "Informe a quantidade de ações recebidas" });
      }
      if (!valido(dados.valor_capitalizado) || dados.valor_capitalizado! < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["valor_capitalizado"],
          message: "Informe o valor capitalizado (0 se a empresa não atribuiu valor)",
        });
      }
    }
  })
  .transform((dados) => {
    const num = (v: number | undefined) => (typeof v === "number" && !Number.isNaN(v) ? v : null);
    return {
      ativo_id: dados.ativo_id,
      corretora_id: dados.corretora_id,
      tipo: dados.tipo,
      data: dados.data,
      cambio: dados.cambio,
      quantidade: num(dados.quantidade),
      preco_unitario: num(dados.preco_unitario),
      custos: num(dados.custos) ?? 0,
      fator_proporcao: num(dados.fator_proporcao),
      valor_capitalizado: num(dados.valor_capitalizado),
    };
  });
export type TransacaoForm = z.infer<typeof transacaoSchema>;

// Tipos e schema de provento moraram aqui antes; agora vivem em
// lib/proventos/schema.ts (cadastro de provento saiu da Carteira e virou
// aba própria — ver docs/MAPA-DE-DADOS.md). A Carteira ainda EXIBE proventos
// no livro-razão combinado (somente leitura), então continua importando
// TIPOS_PROVENTO de lá só para exibir o rótulo.
