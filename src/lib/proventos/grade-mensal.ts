"use server";

/**
 * Proventos → "Grade mensal/anual" (ver docs/MAPA-DE-DADOS.md §8.23): tabela
 * estilo planilha com uma linha por categoria (Ações/FIIs/Stocks/REITs/ETF/
 * ...) + linha TOTAL, colunas Jan..Dez + Total — uma seção "GERAL" (soma de
 * todos os anos) seguida de uma seção por ano, réplica do formato enviado
 * pelo Guilherme (mesmo espírito da "Visão mensal" da Carteira, mas agrupado
 * por categoria em vez de compra/venda).
 *
 * Fonte única continua sendo `obterLivroProventos` (lib/proventos/actions.ts)
 * — este arquivo só reagrupa os MESMOS lançamentos já calculados (status,
 * categoria) de outro jeito (por mês/ano), sem duplicar nenhuma consulta ao
 * banco nem recalcular status/categoria de novo.
 *
 * IMPORTANTE (mesmo motivo de visao-mensal.ts, §8.21): arquivo `"use
 * server"` só pode exportar `async function` — tipos e `MESES_LABEL` moram
 * em `grade-mensal-tipos.ts` (módulo puro), nunca reexportados daqui.
 */

import { obterLivroProventos, type LancamentoProvento } from "./actions";
import { ORDEM_GRUPOS, LABEL_GRUPO, type GrupoPosicao } from "@/lib/carteira/grupo-classificacao";
import type { GradeAno, GradeMensalProventos, LinhaGradeCategoria } from "./grade-mensal-tipos";

type ItemAgregavel = { grupo: GrupoPosicao; ano: string; mesIdx: number; valor: number };

function mesesVazios(): number[] {
  return Array.from({ length: 12 }, () => 0);
}

function construirGradeAno(itens: ItemAgregavel[], chave: string, label: string): GradeAno {
  const porGrupo = new Map<GrupoPosicao, number[]>();
  for (const it of itens) {
    if (!porGrupo.has(it.grupo)) porGrupo.set(it.grupo, mesesVazios());
    porGrupo.get(it.grupo)![it.mesIdx] += it.valor;
  }

  const linhas: LinhaGradeCategoria[] = ORDEM_GRUPOS.filter((g) => porGrupo.has(g)).map((grupo) => {
    const meses = porGrupo.get(grupo)!;
    return { grupo, label: LABEL_GRUPO[grupo], meses, totalLinha: meses.reduce((s, v) => s + v, 0) };
  });

  const totalMeses = mesesVazios();
  for (const linha of linhas) {
    linha.meses.forEach((v, i) => {
      totalMeses[i] += v;
    });
  }
  linhas.push({
    grupo: "total",
    label: "TOTAL",
    meses: totalMeses,
    totalLinha: totalMeses.reduce((s, v) => s + v, 0),
  });

  return { chave, label, linhas };
}

/**
 * `data_pagamento` é a base de agrupamento (mês em que o dinheiro entra ou
 * entrará na conta) — inclui lançamentos provisionados e recebidos, então um
 * provento já cadastrado com pagamento futuro aparece no mês em que vai cair,
 * não some da grade até lá.
 */
export async function obterGradeMensalProventos(): Promise<GradeMensalProventos> {
  const { lancamentos } = await obterLivroProventos();

  const itens: ItemAgregavel[] = lancamentos
    .map((l: LancamentoProvento) => ({
      grupo: l.grupo,
      ano: l.dataPagamento.slice(0, 4),
      mesIdx: Number(l.dataPagamento.slice(5, 7)) - 1,
      valor: l.valorTotal,
    }))
    .filter((it) => it.mesIdx >= 0 && it.mesIdx <= 11);

  const geral = construirGradeAno(itens, "GERAL", "Geral (todos os anos)");

  const anos = [...new Set(itens.map((it) => it.ano))].sort((a, b) => b.localeCompare(a));
  const porAno = anos.map((ano) => construirGradeAno(itens.filter((it) => it.ano === ano), ano, ano));

  return { geral, porAno };
}
