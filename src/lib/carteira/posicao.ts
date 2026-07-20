"use server";

/**
 * Sub-aba Posição (Carteira) — visão consolidada por classe, ver
 * docs/MAPA-DE-DADOS.md §8.16. Diferente do livro-razão (lib/carteira/actions.ts,
 * feed cru de lançamentos) e do registro mestre por ativo (lib/ativos/actions.ts,
 * um ativo por linha), aqui agregamos por CLASSE (Ações/FIIs/Tesouro/Stocks/ETF
 * Exterior/...), com variação do dia e variação total, réplica do layout
 * MyProfit/Status Invest que o Guilherme mandou por print.
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

export type GrupoPosicao =
  | "acoes"
  | "fiis"
  | "tesouro"
  | "renda_fixa"
  | "fundos"
  | "stocks"
  | "etf_exterior"
  | "internacional_outros"
  | "etf_brasil"
  | "cripto"
  | "outros";

/** Ordem de exibição dos grupos — mesma sequência do print de referência. */
const ORDEM_GRUPOS: GrupoPosicao[] = [
  "acoes",
  "fiis",
  "tesouro",
  "renda_fixa",
  "etf_brasil",
  "stocks",
  "etf_exterior",
  "internacional_outros",
  "cripto",
  "fundos",
  "outros",
];

const LABEL_GRUPO: Record<GrupoPosicao, string> = {
  acoes: "Ações",
  fiis: "FIIs",
  tesouro: "Tesouro Direto",
  renda_fixa: "Renda Fixa",
  fundos: "Fundos de Investimento",
  stocks: "Stocks",
  etf_exterior: "ETF Exterior",
  internacional_outros: "Internacional (não classificado)",
  etf_brasil: "ETF Brasil",
  cripto: "Criptomoedas",
  outros: "Outros",
};

/**
 * Deriva o grupo de exibição a partir de tipo + subtipo — ver
 * docs/MAPA-DE-DADOS.md §8.16. `internacional` sem subtipo informado cai num
 * grupo separado "não classificado" em vez de adivinhar Stock vs ETF (o
 * usuário pode preencher a qualquer momento na página do ativo).
 */
function grupoDoAtivo(tipo: TipoAtivo, subtipoRendaFixa: string | null, subtipoInternacional: string | null): GrupoPosicao {
  switch (tipo) {
    case "acao":
      return "acoes";
    case "fii":
      return "fiis";
    case "etf":
      return "etf_brasil";
    case "renda_fixa":
      return subtipoRendaFixa === "tesouro" ? "tesouro" : "renda_fixa";
    case "fundo":
      return "fundos";
    case "cripto":
      return "cripto";
    case "internacional":
      if (subtipoInternacional === "etf") return "etf_exterior";
      if (subtipoInternacional === "acao") return "stocks";
      return "internacional_outros";
    default:
      return "outros";
  }
}

export type PosicaoAtivo = {
  ativoId: string;
  ticker: string;
  nome: string | null;
  tipo: TipoAtivo;
  grupo: GrupoPosicao;
  quantidade: number;
  precoMedio: number;
  precoAtual: number;
  diferenca: number;
  patrimonioAtual: number;
  /** null = sem 2 pontos de preço salvos ainda pra comparar (ver §8.16). */
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
};

export type PosicaoConsolidada = {
  grupos: PosicaoGrupo[];
  corretoras: Corretora[];
  totalCarteira: number;
  variacaoHojeValor: number;
  variacaoHojePct: number | null;
  variacaoTotalValor: number;
  variacaoTotalPct: number | null;
};

/** Últimos 2 pontos de preço conhecidos de cada ativo cotado automaticamente, agrupados por (tipo, ticker) — tabela compartilhada entre usuários. */
async function obterUltimosDoisPrecosMercado(
  pares: { tipo: TipoAtivo; ticker: string }[]
): Promise<Map<string, [number, number]>> {
  const mapa = new Map<string, [number, number]>();
  if (pares.length === 0) return mapa;

  const supabase = await createClient();
  const tickers = [...new Set(pares.map((p) => p.ticker))];

  // Janela de 15 dias corridos é folga suficiente pra cron diário pular
  // fim de semana/feriado e ainda achar os 2 últimos pontos.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 15);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data } = await supabase
    .from("ativo_preco_diario_mercado")
    .select("tipo, ticker, data, preco")
    .in("ticker", tickers)
    .gte("data", cutoffStr)
    .order("data", { ascending: false });

  const porChave = new Map<string, { data: string; preco: number }[]>();
  for (const row of data ?? []) {
    const chave = `${row.tipo}:${row.ticker}`;
    const lista = porChave.get(chave) ?? [];
    if (lista.length < 2) lista.push({ data: row.data as string, preco: Number(row.preco) });
    porChave.set(chave, lista);
  }

  for (const [chave, lista] of porChave) {
    if (lista.length === 2) mapa.set(chave, [lista[0].preco, lista[1].preco]);
  }

  return mapa;
}

/**
 * Últimos 2 snapshots manuais de cada ativo, por ativo_id — sem corte de
 * data (decisão 2026-07-16: "comparar com o último preço salvo, seja de
 * quando for", já que atualização manual pode ficar dias/semanas parada).
 */
async function obterUltimosDoisPrecosManuais(ativoIds: string[]): Promise<Map<string, [number, number]>> {
  const mapa = new Map<string, [number, number]>();
  if (ativoIds.length === 0) return mapa;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return mapa;

  const { data } = await supabase
    .from("ativo_preco_diario_manual")
    .select("ativo_id, data, preco")
    .eq("profile_id", user.id)
    .in("ativo_id", ativoIds)
    .order("data", { ascending: false });

  const porAtivo = new Map<string, { data: string; preco: number }[]>();
  for (const row of data ?? []) {
    const lista = porAtivo.get(row.ativo_id) ?? [];
    if (lista.length < 2) lista.push({ data: row.data as string, preco: Number(row.preco) });
    porAtivo.set(row.ativo_id, lista);
  }

  for (const [ativoId, lista] of porAtivo) {
    if (lista.length === 2) mapa.set(ativoId, [lista[0].preco, lista[1].preco]);
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
  };
  if (!user) return vazio;

  const [{ data: ativosRaw }, { data: transacoesRaw }, { data: corretorasRaw }] = await Promise.all([
    supabase
      .from("ativos")
      .select("id, ticker, nome, tipo, subtipo_renda_fixa, subtipo_internacional, preco_atual")
      .eq("profile_id", user.id),
    supabase
      .from("transacoes")
      .select("id, ativo_id, corretora_id, tipo, data, quantidade, preco_unitario, custos, created_at")
      .eq("profile_id", user.id),
    supabase.from("corretoras").select("id, nome").eq("profile_id", user.id).order("nome"),
  ]);

  const ativos = ativosRaw ?? [];
  const todasTransacoes = transacoesRaw ?? [];
  const corretoras = corretorasRaw ?? [];

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

  // Busca em lote os 2 últimos preços conhecidos (mercado + manual) pra
  // "variação hoje" — uma query por fonte, não uma por ativo.
  const paresAutomaticos = posicoesBase
    .filter((p) => TIPOS_COTACAO_AUTOMATICA.includes(p.tipo))
    .map((p) => ({ tipo: p.tipo, ticker: p.ticker }));
  const idsManuais = posicoesBase.filter((p) => !TIPOS_COTACAO_AUTOMATICA.includes(p.tipo)).map((p) => p.ativoId);

  const [precosMercado, precosManuais] = await Promise.all([
    obterUltimosDoisPrecosMercado(paresAutomaticos),
    obterUltimosDoisPrecosManuais(idsManuais),
  ]);

  const totalCarteira = posicoesBase.reduce((s, p) => s + p.quantidade * p.precoAtual, 0);

  const ativosCalculados: PosicaoAtivo[] = posicoesBase.map((p) => {
    const patrimonioAtual = p.quantidade * p.precoAtual;
    const diferenca = p.precoAtual - p.precoMedio;

    const par = TIPOS_COTACAO_AUTOMATICA.includes(p.tipo)
      ? precosMercado.get(`${p.tipo}:${p.ticker}`)
      : precosManuais.get(p.ativoId);

    let variacaoHojeValor: number | null = null;
    let variacaoHojePct: number | null = null;
    if (par) {
      const [precoHoje, precoAnterior] = par;
      if (precoAnterior > 0) {
        variacaoHojeValor = p.quantidade * (precoHoje - precoAnterior);
        variacaoHojePct = ((precoHoje - precoAnterior) / precoAnterior) * 100;
      }
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
    // 2 preços salvos ainda ficam de fora da conta em R$ e %, não distorcem
    // o denominador).
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
  };
}
