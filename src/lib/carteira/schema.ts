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
    // Detalhe fiscal opcional (§8.32.27.1, fase 2 da reformulação do IR —
    // ver docs/MAPA-DE-DADOS.md §8.35). Só faz sentido pra compra/venda;
    // nenhum motor de cálculo ainda usa esses campos (isso é fase 3+,
    // ledger fiscal/day trade) — hoje servem só de registro pra quando esse
    // motor existir. `custos` continua sendo o total que TODO cálculo já
    // existente usa (posição, IR); se os 4 campos discriminados abaixo
    // forem preenchidos, o `.transform()` recalcula `custos` como a soma
    // deles, sobrescrevendo o valor digitado direto em `custos` — evita ter
    // dois números conflitantes pro mesmo total.
    moeda: z.enum(["BRL", "USD"]).optional(),
    horario_negociacao: z.union([z.string(), z.literal("")]).optional(),
    numero_nota: z.union([z.string(), z.literal("")]).optional(),
    numero_ordem: z.union([z.string(), z.literal("")]).optional(),
    mercado: z.union([z.string(), z.literal("")]).optional(),
    corretagem: numOuNan,
    emolumentos: numOuNan,
    taxa_liquidacao: numOuNan,
    outras_taxas: numOuNan,
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

    // Ver docs/MAPA-DE-DADOS.md §8.29 (correção 2026-07-20): o formulário é
    // ÚNICO pros 5 tipos (só troca quais campos aparecem), e a lib usada
    // (react-hook-form) NÃO limpa o valor de um campo quando ele some da
    // tela ao trocar o tipo — o valor antigo (ex. `preco_unitario` que veio
    // com default 0 do tipo "Compra" inicial) continua "grudado" no estado
    // do form. Sem esse filtro por tipo AQUI (na fronteira antes do banco),
    // uma Bonificação lançada logo depois de abrir o form (que nasce em
    // "Compra") ia junto com `preco_unitario: 0` — e o CHECK
    // `transacoes_campos_por_tipo` exige `preco_unitario is null` pra
    // bonificação, then Postgres rejeitava o insert com um erro genérico
    // ("Não foi possível registrar a transação"), sem pista nenhuma da causa
    // real. Cada campo agora só passa adiante se o tipo realmente o usa —
    // os demais viram `null` (ou 0 pra `custos`) incondicionalmente, não
    // importa o que sobrou no estado do form.
    const compraOuVenda = dados.tipo === "compra" || dados.tipo === "venda";
    const desdobramentoOuGrupamento = dados.tipo === "desdobramento" || dados.tipo === "grupamento";
    const bonificacao = dados.tipo === "bonificacao";
    const texto = (v: string | undefined) => (v ? v : null);

    const corretagem = num(dados.corretagem);
    const emolumentos = num(dados.emolumentos);
    const taxaLiquidacao = num(dados.taxa_liquidacao);
    const outrasTaxas = num(dados.outras_taxas);
    const temCustoDiscriminado = [corretagem, emolumentos, taxaLiquidacao, outrasTaxas].some((v) => v !== null);
    const somaCustoDiscriminado = (corretagem ?? 0) + (emolumentos ?? 0) + (taxaLiquidacao ?? 0) + (outrasTaxas ?? 0);

    return {
      ativo_id: dados.ativo_id,
      corretora_id: dados.corretora_id,
      tipo: dados.tipo,
      data: dados.data,
      cambio: dados.cambio,
      quantidade: compraOuVenda || bonificacao ? num(dados.quantidade) : null,
      preco_unitario: compraOuVenda ? num(dados.preco_unitario) : null,
      // Detalhado sobrescreve o valor cru de `custos` quando preenchido —
      // ver comentário no objeto de campos acima.
      custos: compraOuVenda ? (temCustoDiscriminado ? somaCustoDiscriminado : (num(dados.custos) ?? 0)) : 0,
      fator_proporcao: desdobramentoOuGrupamento ? num(dados.fator_proporcao) : null,
      valor_capitalizado: bonificacao ? num(dados.valor_capitalizado) : null,
      moeda: compraOuVenda ? (dados.moeda ?? "BRL") : "BRL",
      horario_negociacao: compraOuVenda ? texto(dados.horario_negociacao) : null,
      numero_nota: compraOuVenda ? texto(dados.numero_nota) : null,
      numero_ordem: compraOuVenda ? texto(dados.numero_ordem) : null,
      mercado: compraOuVenda ? texto(dados.mercado) : null,
      corretagem: compraOuVenda ? corretagem : null,
      emolumentos: compraOuVenda ? emolumentos : null,
      taxa_liquidacao: compraOuVenda ? taxaLiquidacao : null,
      outras_taxas: compraOuVenda ? outrasTaxas : null,
    };
  });
export type TransacaoForm = z.infer<typeof transacaoSchema>;

// Tipos e schema de provento moraram aqui antes; agora vivem em
// lib/proventos/schema.ts (cadastro de provento saiu da Carteira e virou
// aba própria — ver docs/MAPA-DE-DADOS.md). A Carteira ainda EXIBE proventos
// no livro-razão combinado (somente leitura), então continua importando
// TIPOS_PROVENTO de lá só para exibir o rótulo.
