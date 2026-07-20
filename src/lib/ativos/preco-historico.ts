"use server";

import { createClient } from "@/lib/supabase/server";
import {
  ESTADO_POSICAO_INICIAL,
  aplicarTransacaoNaPosicao,
  ordenarTransacoes,
  precoMedioDoEstado,
  type TransacaoCalc,
} from "./posicao-calculo";
import type { TipoAtivo } from "./actions";
import { TIPOS_COTACAO_AUTOMATICA } from "./yahoo-finance";

/**
 * Motor de rentabilidade histórica — ver docs/MAPA-DE-DADOS.md §8.12.
 *
 * Diferente de `obterAtivosComPosicao` (que só compara preço ATUAL contra
 * custo médio ATUAL, "desde a compra até agora"), aqui cruzamos a série de
 * preço diário (`ativo_preco_diario_mercado` ou `ativo_preco_diario_manual`,
 * dependendo do tipo do ativo) com a linha do tempo de transações, andando
 * dia a dia: em cada data com preço conhecido, aplicamos todas as
 * transações até aquela data (reaproveitando `aplicarTransacaoNaPosicao`,
 * fonte única de verdade, ver §3) pra saber a quantidade e o custo médio
 * NAQUELE momento, não no momento atual. Isso permite responder "quanto eu
 * tinha rendido em 3 meses atrás", não só "quanto rendi até agora".
 */

export type PontoRentabilidade = {
  data: string;
  precoFechamento: number;
  quantidade: number;
  custoMedio: number;
  valorPosicao: number;
  valorAplicado: number;
  /**
   * Lucro já realizado (vendas parciais/totais) acumulado ATÉ esta data —
   * exposto separado de `rentabilidadePct` pra permitir auditar a conta na
   * UI/tooltip sem recalcular nada (ver docs/MAPA-DE-DADOS.md §8.15).
   */
  lucroRealizadoAcumulado: number;
  /** Soma bruta de compras até esta data — denominador da rentabilidade. */
  totalInvestidoBruto: number;
  /**
   * "Retorno simples acumulado": (valorPosicao + lucroRealizadoAcumulado) /
   * totalInvestidoBruto − 1, em %. `null` só quando ainda não houve nenhuma
   * compra até essa data (totalInvestidoBruto === 0) — diferente da versão
   * anterior, que zerava (`null`) assim que a posição era totalmente
   * vendida; agora, depois de zerada, o valor fica congelado no retorno
   * final realizado (a série é truncada na data da venda que zerou a
   * posição — ver corte em `obterRentabilidadeHistoricaAtivo`).
   */
  rentabilidadePct: number | null;
};

async function obterTransacoesOrdenadas(profileId: string, ativoId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("transacoes")
    .select("tipo, data, quantidade, preco_unitario, custos, created_at")
    .eq("profile_id", profileId)
    .eq("ativo_id", ativoId);

  const transacoes: (TransacaoCalc & { createdAt: string })[] = (data ?? []).map((t) => ({
    tipo: t.tipo as "compra" | "venda",
    data: t.data as string,
    quantidade: Number(t.quantidade),
    precoUnitario: Number(t.preco_unitario),
    custos: Number(t.custos),
    createdAt: t.created_at as string,
  }));

  return ordenarTransacoes(transacoes);
}

/**
 * Série de preço diário de um ativo, na fonte certa conforme o tipo:
 * tipos com cotação automática (ver TIPOS_COTACAO_AUTOMATICA) leem da tabela
 * COMPARTILHADA por (tipo, ticker); os demais leem do snapshot manual
 * (por ativo/usuário). Ver docs/MAPA-DE-DADOS.md §8.12.
 */
export async function obterSeriePrecoAtivo(
  ativoId: string
): Promise<{ data: string; preco: number }[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: ativo } = await supabase
    .from("ativos")
    .select("tipo, ticker")
    .eq("id", ativoId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!ativo) return [];

  const tipo = ativo.tipo as TipoAtivo;

  if (TIPOS_COTACAO_AUTOMATICA.includes(tipo)) {
    const { data } = await supabase
      .from("ativo_preco_diario_mercado")
      .select("data, preco")
      .eq("tipo", tipo)
      .eq("ticker", ativo.ticker)
      .order("data");
    return (data ?? []).map((p) => ({ data: p.data as string, preco: Number(p.preco) }));
  }

  const { data } = await supabase
    .from("ativo_preco_diario_manual")
    .select("data, preco")
    .eq("profile_id", user.id)
    .eq("ativo_id", ativoId)
    .order("data");
  return (data ?? []).map((p) => ({ data: p.data as string, preco: Number(p.preco) }));
}

/**
 * Rentabilidade histórica dia a dia de um ativo — cruza `obterSeriePrecoAtivo`
 * com a linha do tempo de transações. Pontos antes da primeira transação
 * não entram (não existia posição ainda) e, se o ativo já foi totalmente
 * vendido (zerado) e nunca recomprado depois, a série é cortada no dia dessa
 * venda final — não continua "morta" até hoje. Decisão 2026-07-15 (ver
 * docs/MAPA-DE-DADOS.md §8.15): a janela vai da primeira negociação até a
 * venda (ou até hoje, se ainda em carteira).
 */
export async function obterRentabilidadeHistoricaAtivo(ativoId: string): Promise<PontoRentabilidade[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const [transacoes, serie] = await Promise.all([
    obterTransacoesOrdenadas(user.id, ativoId),
    obterSeriePrecoAtivo(ativoId),
  ]);

  if (transacoes.length === 0 || serie.length === 0) return [];

  const primeiraData = transacoes[0].data;
  const serieRelevante = serie.filter((p) => p.data >= primeiraData).sort((a, b) => (a.data < b.data ? -1 : 1));

  const pontos: PontoRentabilidade[] = [];
  let estado = ESTADO_POSICAO_INICIAL;
  let indiceTransacao = 0;

  for (const p of serieRelevante) {
    // Aplica todas as transações com data <= data do ponto de preço, na ordem.
    while (indiceTransacao < transacoes.length && transacoes[indiceTransacao].data <= p.data) {
      estado = aplicarTransacaoNaPosicao(estado, transacoes[indiceTransacao]);
      indiceTransacao += 1;
    }

    const custoMedio = precoMedioDoEstado(estado);
    const valorPosicao = estado.quantidade * p.preco;
    const valorAplicado = estado.quantidade * custoMedio;

    // "Retorno simples acumulado" (mesma fórmula da Carteira, ver §8.15):
    // soma o que já foi embolsado em vendas parciais/totais ao que ainda
    // está de pé, sobre tudo que já foi pago em compras até aqui.
    const rentabilidadePct =
      estado.totalInvestidoBruto > 0
        ? ((valorPosicao + estado.lucroRealizado) / estado.totalInvestidoBruto - 1) * 100
        : null;

    pontos.push({
      data: p.data,
      precoFechamento: p.preco,
      quantidade: estado.quantidade,
      custoMedio,
      valorPosicao,
      valorAplicado,
      lucroRealizadoAcumulado: estado.lucroRealizado,
      totalInvestidoBruto: estado.totalInvestidoBruto,
      rentabilidadePct,
    });
  }

  // Corta a série no dia da venda final: se o último ponto está zerado, anda
  // pra trás até o início dessa sequência final de "quantidade 0" e descarta
  // tudo depois dela — o último ponto mantido É o dia em que a posição foi
  // zerada (retorno final realizado), não um rastro de dias mortos até hoje.
  if (pontos.length > 0 && pontos[pontos.length - 1].quantidade === 0) {
    let i = pontos.length - 1;
    while (i > 0 && pontos[i - 1].quantidade === 0) i -= 1;
    return pontos.slice(0, i + 1);
  }

  return pontos;
}

export type PontoEvolucaoCarteira = {
  data: string;
  valorTotal: number;
  /** Mesma fórmula "retorno simples acumulado" da Carteira (ver §8.15) — soma
   *  os ativos ainda em carteira + o que já foi realizado em vendas, sobre
   *  tudo que já foi investido em compras até aquele dia. `null` só antes da
   *  primeira compra de qualquer ativo. */
  rentabilidadePct: number | null;
};

/**
 * Evolução da Carteira inteira, dia a dia, em duas leituras (R$ e %) — soma,
 * em cada data, o `valorPosicao` de TODOS os ativos do usuário pra `valorTotal`
 * (mesmo cálculo de antes, "Evolução do patrimônio"), e agrega
 * `lucroRealizadoAcumulado`/`totalInvestidoBruto` de todos os ativos pra
 * `rentabilidadePct` — o equivalente, em nível de carteira, do "retorno
 * simples acumulado" de cada Ativo (ver §8.15). Usado no Painel (dashboard).
 * Reaproveita `obterRentabilidadeHistoricaAtivo` por ativo (já com a janela
 * certa: primeira negociação até a venda ou hoje), sem duplicar a lógica de
 * cruzamento preço×posição.
 */
export async function obterEvolucaoCarteira(): Promise<PontoEvolucaoCarteira[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: ativosRaw } = await supabase.from("ativos").select("id").eq("profile_id", user.id);
  const ativos = ativosRaw ?? [];
  if (ativos.length === 0) return [];

  const seriesPorAtivo = await Promise.all(ativos.map((a) => obterRentabilidadeHistoricaAtivo(a.id)));

  // Junta todas as datas que aparecem em qualquer série, ordenadas.
  const todasDatas = new Set<string>();
  for (const serie of seriesPorAtivo) {
    for (const p of serie) todasDatas.add(p.data);
  }
  const datasOrdenadas = [...todasDatas].sort();

  if (datasOrdenadas.length === 0) return [];

  // Pra cada ativo, em cada data do calendário unificado, usa o último valor
  // conhecido até aquela data (a série do ativo pode não ter ponto exatamente
  // nessa data — ex. feriado só nessa bolsa, ativo com histórico mais curto,
  // ou já vendido — nesse caso o forward-fill trava no último ponto, que é
  // exatamente o dia da venda final, "congelando" a contribuição dali em
  // diante) — carrega o último valor "pra frente" (forward-fill).
  const resultado: PontoEvolucaoCarteira[] = [];
  const indices = seriesPorAtivo.map(() => 0);

  for (const data of datasOrdenadas) {
    let valorTotal = 0;
    let lucroRealizadoTotal = 0;
    let totalInvestidoBrutoTotal = 0;
    for (let i = 0; i < seriesPorAtivo.length; i++) {
      const serie = seriesPorAtivo[i];
      if (serie.length === 0) continue;
      while (indices[i] < serie.length - 1 && serie[indices[i] + 1].data <= data) {
        indices[i] += 1;
      }
      if (serie[indices[i]].data <= data) {
        const p = serie[indices[i]];
        valorTotal += p.valorPosicao;
        lucroRealizadoTotal += p.lucroRealizadoAcumulado;
        totalInvestidoBrutoTotal += p.totalInvestidoBruto;
      }
    }
    const rentabilidadePct =
      totalInvestidoBrutoTotal > 0 ? ((valorTotal + lucroRealizadoTotal) / totalInvestidoBrutoTotal - 1) * 100 : null;
    resultado.push({ data, valorTotal, rentabilidadePct });
  }

  return resultado;
}
