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
  rentabilidadePct: number | null; // null enquanto quantidade == 0 (sem posição naquela data)
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
 * não entram (não existia posição ainda).
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

    pontos.push({
      data: p.data,
      precoFechamento: p.preco,
      quantidade: estado.quantidade,
      custoMedio,
      valorPosicao,
      valorAplicado,
      rentabilidadePct: estado.quantidade > 0 && custoMedio > 0 ? ((p.preco - custoMedio) / custoMedio) * 100 : null,
    });
  }

  return pontos;
}

export type PontoPatrimonio = {
  data: string;
  valorTotal: number;
};

/**
 * Evolução do patrimônio total investido, dia a dia — soma, em cada data,
 * `valorPosicao` (preço histórico × quantidade naquele dia) de TODOS os
 * ativos do usuário que têm pelo menos uma transação até aquela data.
 * Usado no Painel (dashboard). Reaproveita `obterRentabilidadeHistoricaAtivo`
 * por ativo, sem duplicar a lógica de cruzamento preço×posição.
 */
export async function obterEvolucaoPatrimonio(): Promise<PontoPatrimonio[]> {
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
  // nessa data — ex. feriado só nessa bolsa, ou ativo com histórico mais
  // curto) — carrega o último valor "pra frente" (forward-fill).
  const resultado: PontoPatrimonio[] = [];
  const indices = seriesPorAtivo.map(() => 0);

  for (const data of datasOrdenadas) {
    let valorTotal = 0;
    for (let i = 0; i < seriesPorAtivo.length; i++) {
      const serie = seriesPorAtivo[i];
      if (serie.length === 0) continue;
      while (indices[i] < serie.length - 1 && serie[indices[i] + 1].data <= data) {
        indices[i] += 1;
      }
      if (serie[indices[i]].data <= data) {
        valorTotal += serie[indices[i]].valorPosicao;
      }
    }
    resultado.push({ data, valorTotal });
  }

  return resultado;
}
