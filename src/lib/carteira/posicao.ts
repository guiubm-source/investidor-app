"use server";

/**
 * Sub-aba Posição (Carteira) — visão consolidada por classe, ver
 * docs/MAPA-DE-DADOS.md §8.16/§8.17. Diferente do livro-razão
 * (lib/carteira/actions.ts, feed cru de lançamentos) e do registro mestre
 * por ativo (lib/ativos/actions.ts, um ativo por linha), aqui agregamos por
 * CLASSE (Ações/FIIs/Tesouro/Stocks/ETF Exterior/...), com variação do dia
 * e variação total, réplica do layout MyProfit/Status Invest que o
 * Guilherme mandou por print.
 *
 * Fonte única continua sendo `transacoes` — este arquivo só recalcula posição
 * (via calcularPosicao/ordenarTransacoes, mesmas funções puras usadas em
 * lib/ativos/actions.ts) agrupando de outro jeito, e opcionalmente filtrando
 * por corretora antes de somar (cada corretora tratada como sub-livro
 * independente do mesmo ativo).
 */

import { createClient } from "@/lib/supabase/server";
import { calcularPosicao, ordenarTransacoes, type TransacaoCalc } from "@/lib/ativos/posicao-calculo";
import { TIPOS_COTACAO_AUTOMATICA } from "@/lib/ativos/yahoo-finance";
import type { TipoAtivo } from "@/lib/ativos/actions";
import type { Corretora } from "./actions";
import { ORDEM_GRUPOS, LABEL_GRUPO, grupoDoAtivo, type GrupoPosicao } from "./grupo-classificacao";

// NÃO reexportar `GrupoPosicao` daqui, nem como `export type` — build real do
// Next/Turbopack (2026-07-20, ver §8.19/§8.21) quebrou com "Export
// GrupoPosicao doesn't exist in target module" porque o transform de Server
// Actions escaneia TODO export de um arquivo `"use server"` (inclusive
// `export type`) pra montar o módulo de referências de ações, e um export só-
// de-tipo não existe em tempo de execução. `tsc --noEmit` não pega isso (é
// checagem específica do bundler do Next, não do compilador TS) — por isso
// quem precisa do tipo `GrupoPosicao` importa direto de
// `./grupo-classificacao` (ex. PosicaoView.tsx), nunca daqui.

export type PosicaoAtivo = {
  ativoId: string;
  ticker: string;
  nome: string | null;
  tipo: TipoAtivo;
  grupo: GrupoPosicao;
  quantidade: number;
  precoMedio: number;
  precoAtual: number;
  /** false = `preco_atual` nunca foi definido (nasce 0 no banco) — ver §8.17. UI deve mostrar "—", não R$ 0,00. */
  precoDefinido: boolean;
  diferenca: number;
  patrimonioAtual: number;
  /** null = preço não definido, ou sem nenhum preço anterior salvo pra comparar (ver §8.17). */
  variacaoHojeValor: number | null;
  variacaoHojePct: number | null;
  /** "Retorno simples acumulado" (mesma fórmula unificada de lib/ativos/actions.ts). */
  variacaoTotalValor: number | null;
  variacaoTotalPct: number | null;
  pctDentroDaClasse: number;
  pctNaCarteira: number;
};

export type PosicaoGrupo = {
  grupo: GrupoPosicao;
  label: string;
  ativos: PosicaoAtivo[];
  patrimonioAtual: number;
  pctNaCarteira: number;
  variacaoHojeValor: number;
  variacaoHojePct: number | null;
  variacaoTotalValor: number;
  variacaoTotalPct: number | null;
  /** Quantos ativos do grupo têm `precoDefinido === false` — ver §8.17. */
  semPrecoCount: number;
};

export type PosicaoConsolidada = {
  grupos: PosicaoGrupo[];
  corretoras: Corretora[];
  totalCarteira: number;
  variacaoHojeValor: number;
  variacaoHojePct: number | null;
  variacaoTotalValor: number;
  variacaoTotalPct: number | null;
  /** Total de ativos em posição sem preço atual definido — ver §8.17. */
  ativosSemPrecoCount: number;
};

/**
 * Preço mais recente ANTERIOR a hoje de cada ativo cotado automaticamente,
 * agrupado por (tipo, ticker) — tabela compartilhada entre usuários.
 * "Hoje" em si vem de `ativos.preco_atual` (mesma fonte do Patrimônio
 * atual) — comparar sempre contra esse valor, e não contra o penúltimo
 * ponto salvo, evita o descompasso descrito em §8.17: o cron grava aqui uma
 * vez por dia, mas o botão "Atualizar agora" só atualiza `preco_atual`
 * (não esta tabela), então os "2 últimos pontos daqui" podiam ficar
 * defasados em relação ao preço já exibido no Patrimônio.
 */
async function obterPrecoAnteriorMercado(pares: { tipo: TipoAtivo; ticker: string }[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (pares.length === 0) return mapa;

  const supabase = await createClient();
  const tickers = [...new Set(pares.map((p) => p.ticker))];
  const hojeStr = new Date().toISOString().slice(0, 10);

  // Janela de 15 dias corridos é folga suficiente pra cron diário pular
  // fim de semana/feriado e ainda achar um ponto anterior a hoje.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 15);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("ativo_preco_diario_mercado")
    .select("tipo, ticker, data, preco")
    .in("ticker", tickers)
    .gte("data", cutoffStr)
    .lt("data", hojeStr)
    .order("data", { ascending: false });

  if (error) throw new Error(`obterPrecoAnteriorMercado: falha ao ler ativo_preco_diario_mercado — ${error.message}`);

  for (const row of data ?? []) {
    const chave = `${row.tipo}:${row.ticker}`;
    // Já vem ordenado por data desc — a primeira ocorrência de cada chave é a mais recente.
    if (!mapa.has(chave)) mapa.set(chave, Number(row.preco));
  }

  return mapa;
}

/**
 * Mesma ideia de `obterPrecoAnteriorMercado`, mas pra ativos de preço
 * manual: preço mais recente salvo ANTES de hoje, por ativo_id — sem corte
 * de data (decisão 2026-07-16: "comparar com o último preço salvo, seja de
 * quando for", já que atualização manual pode ficar dias/semanas parada).
 */
async function obterPrecoAnteriorManual(ativoIds: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (ativoIds.length === 0) return mapa;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return mapa;

  const hojeStr = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("ativo_preco_diario_manual")
    .select("ativo_id, data, preco")
    .eq("profile_id", user.id)
    .in("ativo_id", ativoIds)
    .lt("data", hojeStr)
    .order("data", { ascending: false });

  if (error) throw new Error(`obterPrecoAnteriorManual: falha ao ler ativo_preco_diario_manual — ${error.message}`);

  for (const row of data ?? []) {
    if (!mapa.has(row.ativo_id)) mapa.set(row.ativo_id, Number(row.preco));
  }

  return mapa;
}

/**
 * Posição consolidada por classe — motor da sub-aba Posição. `corretoraId`
 * opcional filtra as transações antes de recalcular a posição (cada
 * corretora é um sub-livro independente do mesmo ativo, ver
 * docs/MAPA-DE-DADOS.md §8.16); `null`/omitido soma todas as corretoras.
 */
export async function obterPosicaoConsolidada(corretoraId?: string | null): Promise<PosicaoConsolidada> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const vazio: PosicaoConsolidada = {
    grupos: [],
    corretoras: [],
    totalCarteira: 0,
    variacaoHojeValor: 0,
    variacaoHojePct: null,
    variacaoTotalValor: 0,
    variacaoTotalPct: null,
    ativosSemPrecoCount: 0,
  };
  if (!user) return vazio;

  const [ativosRes, transacoesRes, corretorasRes] = await Promise.all([
    supabase
      .from("ativos")
      .select("id, ticker, nome, tipo, subtipo_renda_fixa, subtipo_internacional, preco_atual, preco_atualizado_em")
      .eq("profile_id", user.id),
    supabase
      .from("transacoes")
      .select("id, ativo_id, corretora_id, tipo, data, quantidade, preco_unitario, custos, created_at")
      .eq("profile_id", user.id),
    supabase.from("corretoras").select("id, nome").eq("profile_id", user.id).order("nome"),
  ]);

  // Ver docs/MAPA-DE-DADOS.md §8.17: sem isso, uma coluna faltando no banco
  // (ex.: migração não rodada) fazia a Posição virar "carteira vazia" sem
  // nenhuma pista da causa real — agora o erro do Postgrest sobe pra tela
  // de erro do Next em vez de sumir em silêncio.
  if (ativosRes.error) throw new Error(`obterPosicaoConsolidada: falha ao ler ativos — ${ativosRes.error.message}`);
  if (transacoesRes.error) throw new Error(`obterPosicaoConsolidada: falha ao ler transações — ${transacoesRes.error.message}`);
  if (corretorasRes.error) throw new Error(`obterPosicaoConsolidada: falha ao ler corretoras — ${corretorasRes.error.message}`);

  const ativos = ativosRes.data ?? [];
  const todasTransacoes = transacoesRes.data ?? [];
  const corretoras = corretorasRes.data ?? [];

  const transacoesFiltradas = corretoraId
    ? todasTransacoes.filter((t) => t.corretora_id === corretoraId)
    : todasTransacoes;

  // Posição (quantidade/preço médio/lucro realizado/total investido bruto)
  // de cada ativo, já considerando o filtro de corretora — mesmo cálculo de
  // lib/ativos/actions.ts#obterAtivosComPosicao, só que sobre o subconjunto
  // de transações filtrado.
  type PosicaoBase = {
    ativoId: string;
    ticker: string;
    nome: string | null;
    tipo: TipoAtivo;
    subtipoRendaFixa: string | null;
    subtipoInternacional: string | null;
    precoAtual: number;
    precoDefinido: boolean;
    quantidade: number;
    precoMedio: number;
    lucroRealizado: number;
    totalInvestidoBruto: number;
  };

  const posicoesBase: PosicaoBase[] = ativos
    .map((ativo) => {
      const transacoesDoAtivo: (TransacaoCalc & { createdAt: string })[] = transacoesFiltradas
        .filter((t) => t.ativo_id === ativo.id)
        .map((t) => ({
          tipo: t.tipo as "compra" | "venda",
          data: t.data as string,
          quantidade: Number(t.quantidade),
          precoUnitario: Number(t.preco_unitario),
          custos: Number(t.custos),
          createdAt: t.created_at as string,
        }));

      const ordenadas = ordenarTransacoes(transacoesDoAtivo);
      const { quantidade, precoMedio, lucroRealizado, totalInvestidoBruto } = calcularPosicao(ordenadas);

      return {
        ativoId: ativo.id,
        ticker: ativo.ticker,
        nome: ativo.nome,
        tipo: ativo.tipo as TipoAtivo,
        subtipoRendaFixa: ativo.subtipo_renda_fixa,
        subtipoInternacional: ativo.subtipo_internacional,
        precoAtual: Number(ativo.preco_atual),
        precoDefinido: ativo.preco_atualizado_em !== null,
        quantidade,
        precoMedio,
        lucroRealizado,
        totalInvestidoBruto,
      };
    })
    // Só entra na Posição quem ainda tem quantidade em carteira (sob o
    // filtro de corretora aplicado, se houver) — ativo zerado não é
    // "posição", já saiu por completo.
    .filter((p) => p.quantidade > 0);

  // Busca em lote o último preço ANTERIOR a hoje (mercado + manual) pra
  // "variação hoje" — uma query por fonte, não uma por ativo.
  const paresAutomaticos = posicoesBase
    .filter((p) => TIPOS_COTACAO_AUTOMATICA.includes(p.tipo))
    .map((p) => ({ tipo: p.tipo, ticker: p.ticker }));
  const idsManuais = posicoesBase.filter((p) => !TIPOS_COTACAO_AUTOMATICA.includes(p.tipo)).map((p) => p.ativoId);

  const [precosAnterioresMercado, precosAnterioresManuais] = await Promise.all([
    obterPrecoAnteriorMercado(paresAutomaticos),
    obterPrecoAnteriorManual(idsManuais),
  ]);

  const totalCarteira = posicoesBase.reduce((s, p) => s + p.quantidade * p.precoAtual, 0);

  const ativosCalculados: PosicaoAtivo[] = posicoesBase.map((p) => {
    const patrimonioAtual = p.quantidade * p.precoAtual;
    const diferenca = p.precoAtual - p.precoMedio;

    const precoAnterior = TIPOS_COTACAO_AUTOMATICA.includes(p.tipo)
      ? precosAnterioresMercado.get(`${p.tipo}:${p.ticker}`)
      : precosAnterioresManuais.get(p.ativoId);

    // "Hoje" é sempre `preco_atual` (mesma fonte do Patrimônio atual, ver
    // comentário em obterPrecoAnteriorMercado) — só falta o "ontem".
    let variacaoHojeValor: number | null = null;
    let variacaoHojePct: number | null = null;
    if (p.precoDefinido && precoAnterior !== undefined && precoAnterior > 0) {
      variacaoHojeValor = p.quantidade * (p.precoAtual - precoAnterior);
      variacaoHojePct = ((p.precoAtual - precoAnterior) / precoAnterior) * 100;
    }

    const variacaoTotalValor =
      p.totalInvestidoBruto > 0 ? patrimonioAtual + p.lucroRealizado - p.totalInvestidoBruto : null;
    const variacaoTotalPct =
      p.totalInvestidoBruto > 0 ? ((patrimonioAtual + p.lucroRealizado) / p.totalInvestidoBruto - 1) * 100 : null;

    return {
      ativoId: p.ativoId,
      ticker: p.ticker,
      nome: p.nome,
      tipo: p.tipo,
      grupo: grupoDoAtivo(p.tipo, p.subtipoRendaFixa, p.subtipoInternacional),
      quantidade: p.quantidade,
      precoMedio: p.precoMedio,
      precoAtual: p.precoAtual,
      precoDefinido: p.precoDefinido,
      diferenca,
      patrimonioAtual,
      variacaoHojeValor,
      variacaoHojePct,
      variacaoTotalValor,
      variacaoTotalPct,
      pctDentroDaClasse: 0, // preenchido depois de agrupar
      pctNaCarteira: totalCarteira > 0 ? (patrimonioAtual / totalCarteira) * 100 : 0,
    };
  });

  // Agrupa por classe.
  const porGrupo = new Map<GrupoPosicao, PosicaoAtivo[]>();
  for (const a of ativosCalculados) {
    const lista = porGrupo.get(a.grupo) ?? [];
    lista.push(a);
    porGrupo.set(a.grupo, lista);
  }

  const grupos: PosicaoGrupo[] = ORDEM_GRUPOS.filter((g) => porGrupo.has(g)).map((grupo) => {
    const ativosDoGrupo = porGrupo.get(grupo)!;
    const patrimonioGrupo = ativosDoGrupo.reduce((s, a) => s + a.patrimonioAtual, 0);

    // Preenche % dentro da classe agora que o total do grupo é conhecido.
    for (const a of ativosDoGrupo) {
      a.pctDentroDaClasse = patrimonioGrupo > 0 ? (a.patrimonioAtual / patrimonioGrupo) * 100 : 0;
    }

    // Variação hoje do grupo: soma valor de quem tem variação conhecida,
    // dividido pelo patrimônio de ontem desse mesmo subconjunto (ativos sem
    // preço definido ou sem preço anterior salvo ficam de fora da conta em
    // R$ e %, não distorcem o denominador).
    let somaHoje = 0;
    let somaOntem = 0;
    for (const a of ativosDoGrupo) {
      if (a.variacaoHojeValor !== null) {
        somaHoje += a.variacaoHojeValor;
        somaOntem += a.patrimonioAtual - a.variacaoHojeValor;
      }
    }
    const variacaoHojePct = somaOntem > 0 ? (somaHoje / somaOntem) * 100 : null;

    // Variação total do grupo: mesma fórmula unificada, agregada.
    const somaLucroRealizado = posicoesBase
      .filter((p) => ativosDoGrupo.some((a) => a.ativoId === p.ativoId))
      .reduce((s, p) => s + p.lucroRealizado, 0);
    const somaInvestidoBruto = posicoesBase
      .filter((p) => ativosDoGrupo.some((a) => a.ativoId === p.ativoId))
      .reduce((s, p) => s + p.totalInvestidoBruto, 0);
    const variacaoTotalValor = somaInvestidoBruto > 0 ? patrimonioGrupo + somaLucroRealizado - somaInvestidoBruto : 0;
    const variacaoTotalPct =
      somaInvestidoBruto > 0 ? ((patrimonioGrupo + somaLucroRealizado) / somaInvestidoBruto - 1) * 100 : null;

    return {
      grupo,
      label: LABEL_GRUPO[grupo],
      ativos: ativosDoGrupo.sort((a, b) => b.patrimonioAtual - a.patrimonioAtual),
      patrimonioAtual: patrimonioGrupo,
      pctNaCarteira: totalCarteira > 0 ? (patrimonioGrupo / totalCarteira) * 100 : 0,
      variacaoHojeValor: somaHoje,
      variacaoHojePct,
      variacaoTotalValor,
      variacaoTotalPct,
      semPrecoCount: ativosDoGrupo.filter((a) => !a.precoDefinido).length,
    };
  });

  const totalHojeValor = grupos.reduce((s, g) => s + g.variacaoHojeValor, 0);
  const totalOntem = ativosCalculados.reduce(
    (s, a) => (a.variacaoHojeValor !== null ? s + (a.patrimonioAtual - a.variacaoHojeValor) : s),
    0
  );
  const totalVariacaoHojePct = totalOntem > 0 ? (totalHojeValor / totalOntem) * 100 : null;

  const totalLucroRealizado = posicoesBase.reduce((s, p) => s + p.lucroRealizado, 0);
  const totalInvestidoBruto = posicoesBase.reduce((s, p) => s + p.totalInvestidoBruto, 0);
  const totalVariacaoTotalValor =
    totalInvestidoBruto > 0 ? totalCarteira + totalLucroRealizado - totalInvestidoBruto : 0;
  const totalVariacaoTotalPct =
    totalInvestidoBruto > 0 ? ((totalCarteira + totalLucroRealizado) / totalInvestidoBruto - 1) * 100 : null;

  return {
    grupos,
    corretoras,
    totalCarteira,
    variacaoHojeValor: totalHojeValor,
    variacaoHojePct: totalVariacaoHojePct,
    variacaoTotalValor: totalVariacaoTotalValor,
    variacaoTotalPct: totalVariacaoTotalPct,
    ativosSemPrecoCount: posicoesBase.filter((p) => !p.precoDefinido).length,
  };
}
