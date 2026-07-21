import Decimal from "decimal.js";

/**
 * Ledger fiscal de custo médio — motor PURO (sem acesso a banco/rede),
 * fase 3 do §8.32.37 (ver docs/MAPA-DE-DADOS.md §8.36).
 *
 * Por que isto existe SEPARADO de lib/ativos/posicao-calculo.ts, em vez de
 * reaproveitar aquele motor: invariante §8.32.31 item 14 — "o custo médio
 * ajustado gerencial nunca é importado pelo motor fiscal". O algoritmo é o
 * mesmo em espírito (custo médio ponderado, padrão CVM/RFB para ações/FIIs
 * no Brasil), mas a implementação é paralela e independente de propósito:
 * a Posição gerencial existe pra exibição/decisão de investimento (pode um
 * dia ganhar regras de exibição que não fazem sentido fiscalmente — ex.
 * arredondamento diferente, ou uma visão "ajustada" hipotética) e o motor
 * que alimenta a declaração de IR não pode depender de uma tela pensada
 * pra outro fim. Se um dia os dois motores precisarem convergir, isso é
 * uma decisão de produto explícita, não um acidente de import.
 *
 * Por que `decimal.js` em vez de `number` — §8.32.32 exige "biblioteca
 * decimal no motor; não fazer somas fiscais com ponto flutuante JS". Somar
 * milhares de compras/vendas fracionárias (quantidade `numeric(28,12)`,
 * preço `numeric(24,10)`) em ponto flutuante nativo acumula erro de
 * arredondamento — imperceptível na Posição gerencial (poucas casas
 * decimais exibidas), mas inaceitável numa memória de cálculo que precisa
 * bater com o que a Receita espera centavo a centavo.
 *
 * Sem `"use server"` — funções puras, mesmo motivo de
 * lib/ativos/posicao-calculo.ts (Server Actions são obrigatoriamente
 * `async`, isto aqui é matemática síncrona).
 */

export type TipoEventoLedgerFiscal = "compra" | "venda" | "desdobramento" | "grupamento" | "bonificacao";

/**
 * Um evento (transação ou evento societário) já lido do banco, na forma que
 * o ledger fiscal precisa. Espelha `TransacaoCalc` (lib/ativos/
 * posicao-calculo.ts) de propósito — mesmos campos, mesma origem de dado
 * (tabela `transacoes`) — mas é um tipo próprio: nada daqui importa nem é
 * importado por aquele módulo (ver comentário acima).
 */
export type EventoLedgerFiscal = {
  transacaoId: string;
  tipo: TipoEventoLedgerFiscal;
  data: string;
  /** Desempate de ordem dentro do mesmo dia — mesmo padrão de `ordenarTransacoes`. */
  createdAt: string;
  quantidade: number | null;
  precoUnitario: number | null;
  custos: number | null;
  fatorProporcao: number | null;
  valorCapitalizado: number | null;
};

export type EstadoLedgerFiscal = {
  quantidade: Decimal;
  custoTotal: Decimal;
  lucroRealizadoAcumulado: Decimal;
};

export const ESTADO_LEDGER_FISCAL_INICIAL: EstadoLedgerFiscal = {
  quantidade: new Decimal(0),
  custoTotal: new Decimal(0),
  lucroRealizadoAcumulado: new Decimal(0),
};

/**
 * Uma linha da memória de cálculo — estado antes/depois de aplicar UM
 * evento. Guardada (não só o estado final) porque §8.32.38 exige que "todo
 * valor do dashboard abre memória de cálculo": construir isso já dentro do
 * ledger, em vez de só no motor de relatório (fase 10), evita reconstruir o
 * histórico passo a passo depois a partir de um estado final que já
 * "esqueceu" o caminho.
 */
export type LinhaLedgerFiscal = {
  transacaoId: string;
  tipo: TipoEventoLedgerFiscal;
  data: string;
  quantidadeAntes: Decimal;
  quantidadeDepois: Decimal;
  custoTotalAntes: Decimal;
  custoTotalDepois: Decimal;
  precoMedioAntes: Decimal;
  precoMedioDepois: Decimal;
  /** Lucro/prejuízo realizado NESTA linha — sempre 0, exceto em vendas. */
  resultadoRealizado: Decimal;
};

export type LedgerFiscalAtivo = {
  linhas: LinhaLedgerFiscal[];
  estadoFinal: EstadoLedgerFiscal;
};

function precoMedio(estado: EstadoLedgerFiscal): Decimal {
  return estado.quantidade.greaterThan(0) ? estado.custoTotal.dividedBy(estado.quantidade) : new Decimal(0);
}

/**
 * Aplica UM evento ao estado do ledger fiscal — mesma lógica de
 * `aplicarTransacaoNaPosicao` (custo médio ponderado: compra recalcula o
 * preço médio proporcionalmente; venda reduz quantidade e apura resultado
 * sem alterar o preço médio; eventos societários reorganizam a posição sem
 * gerar resultado), reimplementada em Decimal e sem importar aquele módulo.
 *
 * Nota sobre invariante §8.32.31 item 3 ("nenhuma venda pode deixar estoque
 * negativo"): assim como o motor gerencial, este `Decimal.min` protege o
 * PRÓPRIO estado do ledger de ficar negativo por inconsistência de dado
 * (ex. venda maior que o saldo por um lançamento faltando) — não é uma
 * validação de entrada (essa já existe em `obterQuantidadeDisponivelEmData`,
 * lib/ativos/actions.ts, na escrita da transação); é uma defesa a mais pro
 * motor fiscal nunca produzir um saldo negativo mesmo se ler dado
 * inconsistente de outra fonte no futuro (ex. importação em lote).
 */
export function aplicarEventoAoLedgerFiscal(
  estado: EstadoLedgerFiscal,
  evento: EventoLedgerFiscal
): { estado: EstadoLedgerFiscal; linha: LinhaLedgerFiscal } {
  const quantidadeAntes = estado.quantidade;
  const custoTotalAntes = estado.custoTotal;
  const precoMedioAntes = precoMedio(estado);

  let novoEstado: EstadoLedgerFiscal;
  let resultadoRealizado = new Decimal(0);

  if (evento.tipo === "compra") {
    const qtd = new Decimal(evento.quantidade ?? 0);
    const preco = new Decimal(evento.precoUnitario ?? 0);
    const custos = new Decimal(evento.custos ?? 0);
    const valorComprado = qtd.times(preco).plus(custos);
    novoEstado = {
      quantidade: estado.quantidade.plus(qtd),
      custoTotal: estado.custoTotal.plus(valorComprado),
      lucroRealizadoAcumulado: estado.lucroRealizadoAcumulado,
    };
  } else if (evento.tipo === "venda") {
    const qtdSolicitada = new Decimal(evento.quantidade ?? 0);
    const qtdVenda = Decimal.min(qtdSolicitada, estado.quantidade);
    const preco = new Decimal(evento.precoUnitario ?? 0);
    const custos = new Decimal(evento.custos ?? 0);
    const custoBaixado = precoMedioAntes.times(qtdVenda);
    resultadoRealizado = preco.minus(precoMedioAntes).times(qtdVenda).minus(custos);
    novoEstado = {
      quantidade: estado.quantidade.minus(qtdVenda),
      custoTotal: estado.custoTotal.minus(custoBaixado),
      lucroRealizadoAcumulado: estado.lucroRealizadoAcumulado.plus(resultadoRealizado),
    };
  } else if (evento.tipo === "desdobramento" || evento.tipo === "grupamento") {
    const fator = new Decimal(evento.fatorProporcao ?? 1);
    novoEstado = {
      quantidade: estado.quantidade.times(fator),
      custoTotal: estado.custoTotal,
      lucroRealizadoAcumulado: estado.lucroRealizadoAcumulado,
    };
  } else {
    // bonificacao
    const qtd = new Decimal(evento.quantidade ?? 0);
    const valorCapitalizado = new Decimal(evento.valorCapitalizado ?? 0);
    novoEstado = {
      quantidade: estado.quantidade.plus(qtd),
      custoTotal: estado.custoTotal.plus(valorCapitalizado),
      lucroRealizadoAcumulado: estado.lucroRealizadoAcumulado,
    };
  }

  const linha: LinhaLedgerFiscal = {
    transacaoId: evento.transacaoId,
    tipo: evento.tipo,
    data: evento.data,
    quantidadeAntes,
    quantidadeDepois: novoEstado.quantidade,
    custoTotalAntes,
    custoTotalDepois: novoEstado.custoTotal,
    precoMedioAntes,
    precoMedioDepois: precoMedio(novoEstado),
    resultadoRealizado,
  };

  return { estado: novoEstado, linha };
}

/** Mesmo desempate de `ordenarTransacoes` (posicao-calculo.ts): data e, no empate, `created_at`. */
export function ordenarEventosLedgerFiscal(eventos: EventoLedgerFiscal[]): EventoLedgerFiscal[] {
  return [...eventos].sort((a, b) => {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}

/**
 * Constrói o ledger fiscal completo (todas as linhas de memória de cálculo
 * + estado final) de UM ativo, a partir dos eventos já ordenados
 * (`ordenarEventosLedgerFiscal`). Quem chama é responsável por já ter
 * filtrado os eventos pro ativo correto — este motor não agrupa por ativo,
 * só processa a lista que recebe (ver lib/ir/consultas/ledger.ts, que faz
 * o agrupamento por `ativo_id` a partir da leitura no banco).
 */
export function construirLedgerFiscal(eventosOrdenados: EventoLedgerFiscal[]): LedgerFiscalAtivo {
  let estado = ESTADO_LEDGER_FISCAL_INICIAL;
  const linhas: LinhaLedgerFiscal[] = [];
  for (const evento of eventosOrdenados) {
    const resultado = aplicarEventoAoLedgerFiscal(estado, evento);
    estado = resultado.estado;
    linhas.push(resultado.linha);
  }
  return { linhas, estadoFinal: estado };
}
