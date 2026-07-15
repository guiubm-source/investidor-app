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

export type TransacaoCalc = {
  tipo: "compra" | "venda";
  data: string;
  quantidade: number;
  precoUnitario: number;
  custos: number;
};

export type EstadoPosicao = { quantidade: number; custoTotal: number; lucroRealizado: number };

export const ESTADO_POSICAO_INICIAL: EstadoPosicao = { quantidade: 0, custoTotal: 0, lucroRealizado: 0 };

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
 */
export function aplicarTransacaoNaPosicao(estado: EstadoPosicao, t: TransacaoCalc): EstadoPosicao {
  if (t.tipo === "compra") {
    return {
      quantidade: estado.quantidade + t.quantidade,
      custoTotal: estado.custoTotal + t.quantidade * t.precoUnitario + t.custos,
      lucroRealizado: estado.lucroRealizado,
    };
  }
  const precoMedioAtual = estado.quantidade > 0 ? estado.custoTotal / estado.quantidade : 0;
  const qtdVenda = Math.min(t.quantidade, estado.quantidade);
  return {
    quantidade: estado.quantidade - qtdVenda,
    custoTotal: estado.custoTotal - precoMedioAtual * qtdVenda,
    lucroRealizado: estado.lucroRealizado + (t.precoUnitario - precoMedioAtual) * qtdVenda - t.custos,
  };
}

export function precoMedioDoEstado(estado: EstadoPosicao): number {
  return estado.quantidade > 0 ? estado.custoTotal / estado.quantidade : 0;
}

/** Fold de `aplicarTransacaoNaPosicao` sobre a lista inteira — "posição final". */
export function calcularPosicao(transacoesOrdenadas: TransacaoCalc[]) {
  let estado = ESTADO_POSICAO_INICIAL;
  for (const t of transacoesOrdenadas) estado = aplicarTransacaoNaPosicao(estado, t);
  return { quantidade: estado.quantidade, precoMedio: precoMedioDoEstado(estado), lucroRealizado: estado.lucroRealizado };
}

export function ordenarTransacoes<T extends { data: string; createdAt: string }>(itens: T[]): T[] {
  return [...itens].sort((a, b) => {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}
