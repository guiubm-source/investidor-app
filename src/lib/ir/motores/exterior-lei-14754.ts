import Decimal from "decimal.js";

/**
 * Motor de ganho de capital em aplicações financeiras no exterior (ações/
 * ETF/REIT — `ativos.tipo === 'internacional'`) — fase 7 do §8.32.37,
 * fatia decidida com o Guilherme: SÓ ganho de capital (venda/alienação),
 * ainda sem dividendos/rendimentos, crédito de imposto pago no exterior,
 * posição patrimonial, depósitos/moeda ou camada EUA (ver
 * docs/MAPA-DE-DADOS.md §8.42). Motor PURO (sem acesso a banco/rede),
 * `decimal.js` pelos mesmos motivos das fases anteriores (§8.32.32).
 *
 * Regra de negócio central (§8.32.18.1): apuração ANUAL (não mensal),
 * separada das demais categorias, com compensação de prejuízo entre anos —
 * mesma convenção que o motor antigo (`lib/ir/actions.ts`,
 * `CATEGORIAS_APURACAO_ANUAL`) já usa pra `internacional`, com uma correção
 * importante: o ganho de cada venda já chega aqui EM REAIS, convertido
 * evento a evento pelo câmbio de cada compra/venda (ver
 * `lib/ir/consultas/exterior.ts` — quem monta o ledger fiscal em BRL antes
 * de chamar este motor). O motor antigo nunca fazia essa conversão (a
 * consulta de `obterRelatorioIR` nem lê `transacoes.cambio`/`moeda`) — na
 * prática, hoje ele mistura valor em USD como se fosse BRL sempre que o
 * ativo é internacional. Esta fase corrige esse gap.
 *
 * Diferente da renda variável Brasil (fase 4): não há day trade, não há
 * isenção mensal, não há separação por "grupo fiscal" (ações/ETF/REIT
 * entram no MESMO pool anual — a Lei 14.754 consolida "aplicações
 * financeiras no exterior" como um bloco só, não por classe de ativo).
 */

export type VendaParaApuracaoExterior = {
  transacaoId: string;
  /** Ano-calendário do evento (não ano-mês — a apuração aqui é anual). */
  ano: number;
  /** Já convertido pra reais pelo câmbio DAQUELE dia (ver comentário no topo). */
  vendaTotalBrutaReais: Decimal;
  /** Já convertido pra reais — inclui variação cambial embutida (custo travado no câmbio da compra, venda no câmbio do dia). */
  resultadoRealizadoReais: Decimal;
};

export type AtivoParaApuracaoExterior = {
  ativoId: string;
  ativoTicker: string;
  vendas: VendaParaApuracaoExterior[];
  /**
   * `true` quando algum evento monetário (compra/venda/bonificação) deste
   * ativo não tinha câmbio cadastrado — um único evento sem câmbio corrompe
   * o custo médio de TODA a história seguinte do ativo (a conversão é
   * sequencial, não pontual), então a exclusão é do ativo INTEIRO, nunca de
   * uma venda isolada. Ver `motivosPendencia` pra detalhe.
   */
  pendente: boolean;
  motivosPendencia: string[];
};

/** Só a alíquota — §8.32.18.1 ainda não teve faixas/exceções pesquisadas (seed `exterior_lei_14754.aliquota_padrao`, ver schema.sql §21.7). */
export type ParametrosExteriorLei14754 = {
  aliquotaPadrao: Decimal;
};

export type LinhaAnualExterior = {
  ano: number;
  vendaTotalBruta: Decimal;
  lucroBruto: Decimal;
  /** Prejuízo de anos anteriores abatido neste ano — sempre >= 0. */
  prejuizoAnteriorAplicado: Decimal;
  baseCalculo: Decimal;
  aliquota: Decimal;
  impostoDevido: Decimal;
  /** Prejuízo que sobra pro próximo ano — sempre <= 0. */
  prejuizoSaldoFinal: Decimal;
  /** Detalhe por venda/ativo — preservado por linha pra memória de cálculo (§8.32.38) e pra alimentar uma futura tela de "Descrição sugerida para Bens e Direitos" (§8.32.18.1). */
  vendas: (VendaParaApuracaoExterior & { ativoId: string; ativoTicker: string })[];
};

export type AtivoComPendenciaExterior = {
  ativoId: string;
  ativoTicker: string;
  motivos: string[];
};

export type ResultadoExteriorLei14754 = {
  anual: LinhaAnualExterior[];
  /** Ativos totalmente excluídos da apuração por falta de câmbio em algum evento — nunca aproximados, ver invariante §8.32.31 item 8 (fato pendente não entra no cálculo), aqui aplicada por ativo inteiro em vez de por evento. */
  ativosComPendencia: AtivoComPendenciaExterior[];
};

/**
 * Apura o ganho de capital anual consolidado (todos os ativos internacionais
 * juntos, mesmo pool) com compensação de prejuízo ano a ano — nunca reseta
 * entre anos (mesma regra de "prejuízo não prescreve" já usada em renda
 * variável, §8.11).
 */
export function apurarGanhoCapitalExterior(
  ativos: AtivoParaApuracaoExterior[],
  parametros: ParametrosExteriorLei14754
): ResultadoExteriorLei14754 {
  const ativosComPendencia: AtivoComPendenciaExterior[] = ativos
    .filter((a) => a.pendente)
    .map((a) => ({ ativoId: a.ativoId, ativoTicker: a.ativoTicker, motivos: a.motivosPendencia }));

  type VendaComOrigem = VendaParaApuracaoExterior & { ativoId: string; ativoTicker: string };
  const todasVendas: VendaComOrigem[] = [];
  for (const ativo of ativos) {
    if (ativo.pendente) continue;
    for (const v of ativo.vendas) {
      todasVendas.push({ ...v, ativoId: ativo.ativoId, ativoTicker: ativo.ativoTicker });
    }
  }

  const porAno = new Map<number, VendaComOrigem[]>();
  for (const v of todasVendas) {
    const lista = porAno.get(v.ano) ?? [];
    lista.push(v);
    porAno.set(v.ano, lista);
  }
  const anosOrdenados = [...porAno.keys()].sort((a, b) => a - b);

  const anual: LinhaAnualExterior[] = [];
  let prejuizoAcumulado = new Decimal(0); // sempre <= 0

  for (const ano of anosOrdenados) {
    const vendasDoAno = porAno.get(ano)!;
    const vendaTotalBruta = vendasDoAno.reduce((s, v) => s.plus(v.vendaTotalBrutaReais), new Decimal(0));
    const lucroBruto = vendasDoAno.reduce((s, v) => s.plus(v.resultadoRealizadoReais), new Decimal(0));

    const prejuizoAnteriorAplicado = prejuizoAcumulado.negated();
    const baseAntesCompensacao = lucroBruto.plus(prejuizoAcumulado);
    const baseCalculo = Decimal.max(0, baseAntesCompensacao);
    const impostoDevido = baseCalculo.times(parametros.aliquotaPadrao);

    prejuizoAcumulado = baseAntesCompensacao.lessThan(0) ? baseAntesCompensacao : new Decimal(0);

    anual.push({
      ano,
      vendaTotalBruta,
      lucroBruto,
      prejuizoAnteriorAplicado,
      baseCalculo,
      aliquota: parametros.aliquotaPadrao,
      impostoDevido,
      prejuizoSaldoFinal: prejuizoAcumulado,
      vendas: vendasDoAno,
    });
  }

  return { anual, ativosComPendencia };
}
