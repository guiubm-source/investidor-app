/**
 * Cálculo de posição por custo médio ponderado — funções PURAS (sem acesso a
 * banco/rede), deliberadamente FORA de qualquer arquivo `"use server"`.
 *
 * Motivo: no Next.js, todo arquivo com `"use server"` no topo trata cada
 * função exportada como Server Action, e Server Actions são obrigadas a ser
 * `async` (o build falha em produção — `next build`/Turbopack — se não
 * forem, mesmo que `tsc`/`eslint` não acusem nada, já que é uma checagem
 * específica do compilador do Next, não do TypeScript). Como
 * `aplicarTransacaoNaPosicao`/`precoMedioDoEstado`/`ordenarTransacoes` são
 * síncronas de propósito (são só matemática, chamadas em loop por
 * lib/ativos/preco-historico.ts pra recalcular posição em CADA ponto de uma
 * série histórica — `async` desnecessário ali só adicionaria overhead de
 * microtask sem benefício nenhum), elas moram aqui, num módulo comum
 * importado tanto por lib/ativos/actions.ts quanto por
 * lib/ativos/preco-historico.ts. Fonte única de verdade continua sendo este
 * arquivo (ver docs/MAPA-DE-DADOS.md §3).
 */

/**
 * Ver docs/MAPA-DE-DADOS.md §8.22: além de compra/venda, `tipo` também cobre
 * eventos societários — desdobramento/grupamento (só `fatorProporcao`, sem
 * quantidade/preço) e bonificação (`quantidade` recebida + `valorCapitalizado`,
 * sem preço). Por isso quantidade/precoUnitario/custos viraram opcionais:
 * cada tipo usa só o subconjunto de campos que faz sentido pra ele — ver
 * `aplicarTransacaoNaPosicao` pra qual campo é obrigatório em qual tipo.
 */
export type TransacaoCalc = {
  tipo: "compra" | "venda" | "desdobramento" | "grupamento" | "bonificacao";
  data: string;
  /**
   * compra/venda: quantidade negociada. bonificação: quantidade de ações
   * recebidas. Ausente/nulo em desdobramento/grupamento. `| null` além de
   * opcional porque quem lê direto do banco (ex. `LancamentoTransacao` em
   * lib/carteira/actions.ts) sempre traz a coluna como `number | null`, nunca
   * `undefined` — aceitar os dois evita conversão manual em cada chamador.
   */
  quantidade?: number | null;
  /** Só compra/venda. */
  precoUnitario?: number | null;
  /** Só compra/venda (default 0 se ausente). */
  custos?: number | null;
  /** Só desdobramento/grupamento: fator multiplicador da quantidade em carteira (2 = desdobra 1:2, 0.1 = agrupa 10:1). */
  fatorProporcao?: number | null;
  /** Só bonificação: valor total (R$) atribuído pela empresa à capitalização — 0 se não houver (bonificação se comporta como split puro). */
  valorCapitalizado?: number | null;
};

export type EstadoPosicao = {
  quantidade: number;
  custoTotal: number;
  lucroRealizado: number;
  /**
   * Soma bruta de tudo que já foi pago em compras até aqui — SÓ CRESCE (venda
   * nunca reduz este campo, diferente de `custoTotal`, que é o custo médio ×
   * quantidade ainda em carteira). Usado como denominador da rentabilidade
   * histórica "retorno simples acumulado" (ver docs/MAPA-DE-DADOS.md §8.15):
   * (valorPosicao + lucroRealizado) / totalInvestidoBruto − 1. Sem esse
   * acumulador separado não dá pra medir corretamente o retorno de um ativo
   * já parcialmente vendido — `custoTotal` sozinho "esquece" o que já saiu.
   */
  totalInvestidoBruto: number;
  /**
   * Soma bruta (líquida de custos) de tudo que já foi recebido em vendas até
   * aqui — SÓ CRESCE, espelho de `totalInvestidoBruto` mas do lado da venda.
   * Usado pra "Total vendido" da seção Ativos encerrados (Posição, ver
   * docs/MAPA-DE-DADOS.md §8.25): sem esse acumulador não dava pra saber
   * quanto um ativo JÁ ZERADO tinha recebido em vendas ao longo do tempo,
   * só o residual (que é 0 depois de zerar).
   */
  totalVendidoLiquido: number;
};

export const ESTADO_POSICAO_INICIAL: EstadoPosicao = {
  quantidade: 0,
  custoTotal: 0,
  lucroRealizado: 0,
  totalInvestidoBruto: 0,
  totalVendidoLiquido: 0,
};

/**
 * Um passo do cálculo de posição por custo médio ponderado — usado tanto
 * por `calcularPosicao` (fold sobre a lista inteira, "posição final") quanto
 * por quem precisa da posição EM CADA PONTO de uma linha do tempo (ex.
 * rentabilidade histórica dia a dia).
 *
 * Método do custo médio ponderado (padrão no Brasil, inclusive para IR sobre
 * renda variável): na compra, o preço médio é recalculado proporcionalmente;
 * na venda, o preço médio NÃO muda — apenas reduz a quantidade e apura lucro
 * ou prejuízo realizado (preço de venda − preço médio, descontados custos).
 *
 * Eventos societários (ver docs/MAPA-DE-DADOS.md §8.22) NÃO mexem em
 * `lucroRealizado` nem `totalInvestidoBruto` — não há venda nem novo aporte
 * de verdade, só reorganização da mesma posição:
 * - desdobramento/grupamento: `custoTotal` não muda, só a quantidade (×
 *   fator) — o preço médio se ajusta sozinho (custoTotal/quantidade).
 * - bonificação: soma a quantidade recebida E o valor capitalizado ao
 *   custoTotal — redistribui o mesmo custo total (mais o capitalizado) sobre
 *   mais ações, nunca trata as novas como "custo zero" isoladamente.
 */
export function aplicarTransacaoNaPosicao(estado: EstadoPosicao, t: TransacaoCalc): EstadoPosicao {
  if (t.tipo === "compra") {
    const valorComprado = (t.quantidade ?? 0) * (t.precoUnitario ?? 0) + (t.custos ?? 0);
    return {
      quantidade: estado.quantidade + (t.quantidade ?? 0),
      custoTotal: estado.custoTotal + valorComprado,
      lucroRealizado: estado.lucroRealizado,
      totalInvestidoBruto: estado.totalInvestidoBruto + valorComprado,
      totalVendidoLiquido: estado.totalVendidoLiquido,
    };
  }

  if (t.tipo === "venda") {
    const precoMedioAtual = estado.quantidade > 0 ? estado.custoTotal / estado.quantidade : 0;
    const qtdVenda = Math.min(t.quantidade ?? 0, estado.quantidade);
    const valorVendido = (t.quantidade ?? 0) * (t.precoUnitario ?? 0) - (t.custos ?? 0);
    return {
      quantidade: estado.quantidade - qtdVenda,
      custoTotal: estado.custoTotal - precoMedioAtual * qtdVenda,
      lucroRealizado: estado.lucroRealizado + ((t.precoUnitario ?? 0) - precoMedioAtual) * qtdVenda - (t.custos ?? 0),
      totalInvestidoBruto: estado.totalInvestidoBruto,
      totalVendidoLiquido: estado.totalVendidoLiquido + valorVendido,
    };
  }

  if (t.tipo === "desdobramento" || t.tipo === "grupamento") {
    const fator = t.fatorProporcao ?? 1;
    return {
      quantidade: estado.quantidade * fator,
      custoTotal: estado.custoTotal,
      lucroRealizado: estado.lucroRealizado,
      totalInvestidoBruto: estado.totalInvestidoBruto,
      totalVendidoLiquido: estado.totalVendidoLiquido,
    };
  }

  // bonificacao
  return {
    quantidade: estado.quantidade + (t.quantidade ?? 0),
    custoTotal: estado.custoTotal + (t.valorCapitalizado ?? 0),
    lucroRealizado: estado.lucroRealizado,
    totalInvestidoBruto: estado.totalInvestidoBruto,
    totalVendidoLiquido: estado.totalVendidoLiquido,
  };
}

export function precoMedioDoEstado(estado: EstadoPosicao): number {
  return estado.quantidade > 0 ? estado.custoTotal / estado.quantidade : 0;
}

/**
 * Valor em caixa de UMA transação — compra = quanto saiu do bolso
 * (`quantidade×preço + custos`), venda = quanto entrou líquido
 * (`quantidade×preço − custos`). Usado tanto no total filtrado do
 * Livro-razão (`LivroRazaoView.tsx`) quanto na Visão mensal
 * (`lib/carteira/visao-mensal.ts`) — fonte única pra não deixar as duas
 * telas divergirem na definição de "valor da transação" (ver §3/§8.18).
 *
 * Eventos societários (desdobramento/grupamento/bonificação, ver §8.22)
 * sempre retornam 0 aqui — não há desembolso nem entrada de caixa de
 * verdade, é só reorganização da posição já existente. Retorno 0 nesta
 * função é o mecanismo que os exclui automaticamente do "comprado/vendido"
 * do Livro-razão e do aporte/retirada da Visão mensal, sem precisar filtrar
 * em cada lugar que chama esta função.
 */
export function valorCaixaTransacao(t: TransacaoCalc): number {
  if (t.tipo !== "compra" && t.tipo !== "venda") return 0;
  const bruto = (t.quantidade ?? 0) * (t.precoUnitario ?? 0);
  return t.tipo === "compra" ? bruto + (t.custos ?? 0) : bruto - (t.custos ?? 0);
}

/** Fold de `aplicarTransacaoNaPosicao` sobre a lista inteira — "posição final". */
export function calcularPosicao(transacoesOrdenadas: TransacaoCalc[]) {
  let estado = ESTADO_POSICAO_INICIAL;
  for (const t of transacoesOrdenadas) estado = aplicarTransacaoNaPosicao(estado, t);
  return {
    quantidade: estado.quantidade,
    precoMedio: precoMedioDoEstado(estado),
    lucroRealizado: estado.lucroRealizado,
    totalInvestidoBruto: estado.totalInvestidoBruto,
    totalVendidoLiquido: estado.totalVendidoLiquido,
  };
}

export function ordenarTransacoes<T extends { data: string; createdAt: string }>(itens: T[]): T[] {
  return [...itens].sort((a, b) => {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}
