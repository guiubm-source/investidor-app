"use server";

import { createClient } from "@/lib/supabase/server";
import type {
  AtivoForm,
  ClassificacaoForm,
  PrecoAtualForm,
  SimboloTradingviewForm,
} from "./schema";

export type AcaoResultado = { error?: string };

export type TipoAtivo =
  | "acao"
  | "fii"
  | "renda_fixa"
  | "fundo"
  | "internacional"
  | "cripto"
  | "outro";

export type TransacaoItem = {
  id: string;
  tipo: "compra" | "venda";
  data: string;
  quantidade: number;
  precoUnitario: number;
  custos: number;
  corretoraId: string | null;
  corretoraNome: string | null;
};

export type ProventoItem = {
  id: string;
  tipo: string;
  data: string;
  valorTotal: number;
};

export type AtivoResumo = {
  id: string;
  ticker: string;
  nome: string | null;
  tipo: TipoAtivo;
  precoAtual: number;
  precoAtualizadoEm: string | null;
  simboloTradingview: string;
  simboloTradingviewManual: boolean;
  classeId: string | null;
  classeNome: string | null;
  setorId: string | null;
  setorNome: string | null;
  pesoAlvo: number | null;
  quantidade: number;
  precoMedio: number;
  valorAplicado: number;
  valorAtual: number;
  lucroNaoRealizado: number;
  lucroNaoRealizadoPct: number;
  lucroRealizado: number;
  proventosRecebidos: number;
  retornoTotal: number;
};

export type AtivoDetalhe = AtivoResumo & {
  pesoReal: number | null;
  desvio: number | null;
  transacoes: TransacaoItem[];
  proventos: ProventoItem[];
};

type TransacaoCalc = {
  tipo: "compra" | "venda";
  data: string;
  quantidade: number;
  precoUnitario: number;
  custos: number;
};

/**
 * Deriva um símbolo padrão do TradingView (bolsa:ticker) a partir do tipo do
 * ativo, para quando o usuário ainda não sobrescreveu manualmente. É só um
 * ponto de partida razoável — ações/FIIs/fundos/renda fixa negociados em
 * bolsa no Brasil vão para a B3, cripto para a Binance, internacional para a
 * Nasdaq (o usuário pode corrigir a bolsa exata na página do ativo).
 */
export function deriveTradingViewSymbol(tipo: TipoAtivo, ticker: string): string {
  const t = ticker.toUpperCase();
  switch (tipo) {
    case "acao":
    case "fii":
    case "fundo":
    case "renda_fixa":
      return `BMFBOVESPA:${t}`;
    case "cripto":
      return `BINANCE:${t}USDT`;
    case "internacional":
      return `NASDAQ:${t}`;
    default:
      return t;
  }
}

/**
 * Calcula quantidade em carteira, preço médio (custo médio ponderado) e
 * lucro realizado a partir de uma lista de transações de UM ativo.
 *
 * Método do custo médio ponderado (padrão no Brasil, inclusive para IR sobre
 * renda variável): na compra, o preço médio é recalculado proporcionalmente;
 * na venda, o preço médio NÃO muda — apenas reduz a quantidade e apura lucro
 * ou prejuízo realizado (preço de venda − preço médio, descontados custos).
 */
function calcularPosicao(transacoesOrdenadas: TransacaoCalc[]) {
  let quantidade = 0;
  let custoTotal = 0;
  let lucroRealizado = 0;

  for (const t of transacoesOrdenadas) {
    if (t.tipo === "compra") {
      custoTotal += t.quantidade * t.precoUnitario + t.custos;
      quantidade += t.quantidade;
    } else {
      const precoMedioAtual = quantidade > 0 ? custoTotal / quantidade : 0;
      const qtdVenda = Math.min(t.quantidade, quantidade);
      lucroRealizado += (t.precoUnitario - precoMedioAtual) * qtdVenda - t.custos;
      custoTotal -= precoMedioAtual * qtdVenda;
      quantidade -= qtdVenda;
    }
  }

  const precoMedio = quantidade > 0 ? custoTotal / quantidade : 0;
  return { quantidade, precoMedio, lucroRealizado };
}

function ordenarTransacoes<T extends { data: string; createdAt: string }>(itens: T[]): T[] {
  return [...itens].sort((a, b) => {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}

/**
 * Registro mestre de ativos com posição calculada (quantidade, preço médio,
 * lucro, proventos) a partir dos lançamentos da Carteira. Fonte única usada
 * pela lista de Ativos, pela Alocação (valor atual) e pela Carteira (nomes).
 */
export async function obterAtivosComPosicao(): Promise<AtivoResumo[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const [{ data: ativosRaw }, { data: transacoesRaw }, { data: proventosRaw }] = await Promise.all([
    supabase
      .from("ativos")
      .select(
        "id, ticker, nome, tipo, preco_atual, preco_atualizado_em, simbolo_tradingview, setor_id, peso_alvo, setor:alocacao_setores(id, nome, classe:alocacao_classes(id, nome))"
      )
      .eq("profile_id", user.id)
      .order("ticker"),
    supabase
      .from("transacoes")
      .select("id, ativo_id, corretora_id, tipo, data, quantidade, preco_unitario, custos, created_at, corretoras(nome)")
      .eq("profile_id", user.id),
    supabase.from("proventos").select("id, ativo_id, tipo, data, valor_total").eq("profile_id", user.id),
  ]);

  const ativos = ativosRaw ?? [];
  const transacoes = transacoesRaw ?? [];
  const proventos = proventosRaw ?? [];

  return ativos.map((ativo) => {
    const setor = Array.isArray(ativo.setor) ? ativo.setor[0] : ativo.setor;
    const classe = setor ? (Array.isArray(setor.classe) ? setor.classe[0] : setor.classe) : null;

    const transacoesDoAtivo = transacoes
      .filter((t) => t.ativo_id === ativo.id)
      .map((t) => {
        const corretora = Array.isArray(t.corretoras) ? t.corretoras[0] : t.corretoras;
        return {
          tipo: t.tipo as "compra" | "venda",
          data: t.data as string,
          quantidade: Number(t.quantidade),
          precoUnitario: Number(t.preco_unitario),
          custos: Number(t.custos),
          createdAt: t.created_at as string,
          _id: t.id as string,
          _corretoraId: t.corretora_id as string | null,
          _corretoraNome: corretora?.nome ?? null,
        };
      });

    const transacoesOrdenadas = ordenarTransacoes(transacoesDoAtivo);
    const { quantidade, precoMedio, lucroRealizado } = calcularPosicao(transacoesOrdenadas);

    const proventosDoAtivo = proventos.filter((p) => p.ativo_id === ativo.id);
    const proventosRecebidos = proventosDoAtivo.reduce((s, p) => s + Number(p.valor_total), 0);

    const precoAtual = Number(ativo.preco_atual);
    const valorAplicado = quantidade * precoMedio;
    const valorAtual = quantidade * precoAtual;
    const lucroNaoRealizado = valorAtual - valorAplicado;
    const lucroNaoRealizadoPct = valorAplicado > 0 ? (lucroNaoRealizado / valorAplicado) * 100 : 0;

    return {
      id: ativo.id,
      ticker: ativo.ticker,
      nome: ativo.nome,
      tipo: ativo.tipo as TipoAtivo,
      precoAtual,
      precoAtualizadoEm: ativo.preco_atualizado_em,
      simboloTradingview: ativo.simbolo_tradingview || deriveTradingViewSymbol(ativo.tipo as TipoAtivo, ativo.ticker),
      simboloTradingviewManual: !!ativo.simbolo_tradingview,
      classeId: classe?.id ?? null,
      classeNome: classe?.nome ?? null,
      setorId: setor?.id ?? null,
      setorNome: setor?.nome ?? null,
      pesoAlvo: ativo.peso_alvo,
      quantidade,
      precoMedio,
      valorAplicado,
      valorAtual,
      lucroNaoRealizado,
      lucroNaoRealizadoPct,
      lucroRealizado,
      proventosRecebidos,
      retornoTotal: lucroNaoRealizado + lucroRealizado + proventosRecebidos,
    };
  });
}

/** Valor atual (quantidade × preço atual) de cada ativo — usado pela Alocação. */
export async function obterValoresAtuaisPorAtivo(): Promise<Record<string, number>> {
  const ativos = await obterAtivosComPosicao();
  const mapa: Record<string, number> = {};
  for (const a of ativos) mapa[a.id] = a.valorAtual;
  return mapa;
}

/** Detalhe completo de um ativo: posição, desvio de alocação e histórico. */
export async function obterAtivoDetalhe(ativoId: string): Promise<AtivoDetalhe | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [todos, { data: transacoesRaw }, { data: proventosRaw }] = await Promise.all([
    obterAtivosComPosicao(),
    supabase
      .from("transacoes")
      .select("id, corretora_id, tipo, data, quantidade, preco_unitario, custos, created_at, corretoras(nome)")
      .eq("profile_id", user.id)
      .eq("ativo_id", ativoId),
    supabase
      .from("proventos")
      .select("id, tipo, data, valor_total")
      .eq("profile_id", user.id)
      .eq("ativo_id", ativoId)
      .order("data", { ascending: false }),
  ]);

  const resumo = todos.find((a) => a.id === ativoId);
  if (!resumo) return null;

  let pesoReal: number | null = null;
  let desvio: number | null = null;
  if (resumo.setorId) {
    const valorTotalSetor = todos
      .filter((a) => a.setorId === resumo.setorId)
      .reduce((s, a) => s + a.valorAtual, 0);
    pesoReal = valorTotalSetor > 0 ? (resumo.valorAtual / valorTotalSetor) * 100 : 0;
    desvio = pesoReal - (resumo.pesoAlvo ?? 0);
  }

  const transacoesItens: TransacaoItem[] = (transacoesRaw ?? [])
    .map((t) => {
      const corretora = Array.isArray(t.corretoras) ? t.corretoras[0] : t.corretoras;
      return {
        id: t.id,
        tipo: t.tipo as "compra" | "venda",
        data: t.data as string,
        quantidade: Number(t.quantidade),
        precoUnitario: Number(t.preco_unitario),
        custos: Number(t.custos),
        corretoraId: t.corretora_id,
        corretoraNome: corretora?.nome ?? null,
        _createdAt: t.created_at as string,
      };
    })
    .sort((a, b) => (a._createdAt < b._createdAt ? 1 : -1))
    .map(({ _createdAt: _c, ...resto }) => resto);

  const proventosItens: ProventoItem[] = (proventosRaw ?? []).map((p) => ({
    id: p.id,
    tipo: p.tipo,
    data: p.data,
    valorTotal: Number(p.valor_total),
  }));

  return {
    ...resumo,
    pesoReal,
    desvio,
    transacoes: transacoesItens,
    proventos: proventosItens,
  };
}

// ---------------------------------------------------------------------------
// Estrutura de classes/setores (para o seletor de classificação)
// ---------------------------------------------------------------------------
export type SetorOpcao = { id: string; nome: string };
export type ClasseOpcao = { id: string; nome: string; setores: SetorOpcao[] };

export async function obterClassesSetores(): Promise<ClasseOpcao[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const [{ data: classes }, { data: setores }] = await Promise.all([
    supabase.from("alocacao_classes").select("id, nome").eq("profile_id", user.id).order("nome"),
    supabase
      .from("alocacao_setores")
      .select("id, nome, classe_id")
      .eq("profile_id", user.id)
      .order("nome"),
  ]);

  return (classes ?? []).map((c) => ({
    id: c.id,
    nome: c.nome,
    setores: (setores ?? []).filter((s) => s.classe_id === c.id).map((s) => ({ id: s.id, nome: s.nome })),
  }));
}

// ---------------------------------------------------------------------------
// CRUD de identidade do ativo
// ---------------------------------------------------------------------------
export async function criarAtivo(input: AtivoForm): Promise<AcaoResultado & { id?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data, error } = await supabase
    .from("ativos")
    .insert({ profile_id: user.id, ticker: input.ticker, nome: input.nome || null, tipo: input.tipo })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") return { error: "Você já tem um ativo com esse ticker." };
    return { error: "Não foi possível cadastrar o ativo." };
  }

  return { id: data.id };
}

export async function editarAtivo(id: string, input: AtivoForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("ativos")
    .update({ ticker: input.ticker, nome: input.nome || null, tipo: input.tipo })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) {
    if (error.code === "23505") return { error: "Você já tem outro ativo com esse ticker." };
    return { error: "Não foi possível salvar o ativo." };
  }
  return {};
}

export async function excluirAtivo(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("ativos").delete().eq("id", id).eq("profile_id", user.id);
  if (error) return { error: "Não foi possível excluir o ativo." };
  return {};
}

export async function atualizarPrecoAtual(id: string, input: PrecoAtualForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("ativos")
    .update({ preco_atual: input.preco_atual, preco_atualizado_em: new Date().toISOString() })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Não foi possível atualizar o preço atual." };
  return {};
}

/** Símbolo do gráfico TradingView. Valor vazio reseta para o derivado automaticamente. */
export async function atualizarSimboloTradingview(
  id: string,
  input: SimboloTradingviewForm
): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("ativos")
    .update({ simbolo_tradingview: input.simbolo_tradingview || null })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Não foi possível salvar o símbolo do gráfico." };
  return {};
}

// ---------------------------------------------------------------------------
// Classificação (setor + peso-alvo) — único lugar onde isso é definido
// ---------------------------------------------------------------------------
export async function classificarAtivo(id: string, input: ClassificacaoForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("ativos")
    .update({ setor_id: input.setor_id, peso_alvo: input.peso_alvo })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Não foi possível salvar a classificação." };
  return {};
}

export async function removerClassificacao(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("ativos")
    .update({ setor_id: null, peso_alvo: null })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Não foi possível remover a classificação." };
  return {};
}
