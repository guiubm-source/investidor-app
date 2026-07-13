"use server";

import { createClient } from "@/lib/supabase/server";
import type { CorretoraForm, ProventoForm, TransacaoForm } from "./schema";
import { obterAtivosComPosicao } from "@/lib/ativos/actions";

export type AcaoResultado = { error?: string };

export type Corretora = { id: string; nome: string };

export type LancamentoTransacao = {
  categoria: "transacao";
  id: string;
  ativoId: string;
  ativoTicker: string;
  tipo: "compra" | "venda";
  data: string;
  quantidade: number;
  precoUnitario: number;
  custos: number;
  corretoraNome: string | null;
};

export type LancamentoProvento = {
  categoria: "provento";
  id: string;
  ativoId: string;
  ativoTicker: string;
  tipo: string;
  data: string;
  valorTotal: number;
};

export type Lancamento = LancamentoTransacao | LancamentoProvento;

export type LivroRazao = {
  lancamentos: Lancamento[];
  corretoras: Corretora[];
  proventosTotal: number;
};

/**
 * Livro-razão: todos os lançamentos (compra/venda/provento) do usuário, num
 * único feed ordenado por data. A Carteira só registra movimentos — os
 * números consolidados por ativo (posição, preço médio, lucro, desvio) vivem
 * na aba Ativos (ver lib/ativos/actions.ts), sem duplicar aqui.
 */
export async function obterLivroRazao(): Promise<LivroRazao> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { lancamentos: [], corretoras: [], proventosTotal: 0 };

  const [{ data: transacoesRaw }, { data: proventosRaw }, { data: corretorasRaw }] = await Promise.all([
    supabase
      .from("transacoes")
      .select("id, ativo_id, corretora_id, tipo, data, quantidade, preco_unitario, custos, ativos(ticker), corretoras(nome)")
      .eq("profile_id", user.id),
    supabase
      .from("proventos")
      .select("id, ativo_id, tipo, data, valor_total, ativos(ticker)")
      .eq("profile_id", user.id),
    supabase.from("corretoras").select("id, nome").eq("profile_id", user.id).order("nome"),
  ]);

  const transacoes: LancamentoTransacao[] = (transacoesRaw ?? []).map((t) => {
    const ativo = Array.isArray(t.ativos) ? t.ativos[0] : t.ativos;
    const corretora = Array.isArray(t.corretoras) ? t.corretoras[0] : t.corretoras;
    return {
      categoria: "transacao",
      id: t.id,
      ativoId: t.ativo_id,
      ativoTicker: ativo?.ticker ?? "—",
      tipo: t.tipo as "compra" | "venda",
      data: t.data as string,
      quantidade: Number(t.quantidade),
      precoUnitario: Number(t.preco_unitario),
      custos: Number(t.custos),
      corretoraNome: corretora?.nome ?? null,
    };
  });

  const proventos: LancamentoProvento[] = (proventosRaw ?? []).map((p) => {
    const ativo = Array.isArray(p.ativos) ? p.ativos[0] : p.ativos;
    return {
      categoria: "provento",
      id: p.id,
      ativoId: p.ativo_id,
      ativoTicker: ativo?.ticker ?? "—",
      tipo: p.tipo as string,
      data: p.data as string,
      valorTotal: Number(p.valor_total),
    };
  });

  const lancamentos: Lancamento[] = [...transacoes, ...proventos].sort((a, b) =>
    a.data < b.data ? 1 : a.data > b.data ? -1 : 0
  );

  const proventosTotal = proventos.reduce((s, p) => s + p.valorTotal, 0);

  return { lancamentos, corretoras: corretorasRaw ?? [], proventosTotal };
}

// ---------------------------------------------------------------------------
// Corretoras
// ---------------------------------------------------------------------------
export async function obterCorretoras(): Promise<Corretora[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("corretoras")
    .select("id, nome")
    .eq("profile_id", user.id)
    .order("nome");
  return data ?? [];
}

export async function criarCorretora(input: CorretoraForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("corretoras").insert({ profile_id: user.id, nome: input.nome });
  if (error) {
    if (error.code === "23505") return { error: "Já existe uma corretora com esse nome." };
    return { error: "Não foi possível criar a corretora." };
  }
  return {};
}

export async function excluirCorretora(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("corretoras").delete().eq("id", id).eq("profile_id", user.id);
  if (error) return { error: "Não foi possível excluir a corretora." };
  return {};
}

// ---------------------------------------------------------------------------
// Transações
// ---------------------------------------------------------------------------
export async function criarTransacao(input: TransacaoForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  if (input.tipo === "venda") {
    const ativos = await obterAtivosComPosicao();
    const ativo = ativos.find((a) => a.id === input.ativo_id);
    const disponivel = ativo?.quantidade ?? 0;
    if (input.quantidade > disponivel) {
      return {
        error: `Quantidade maior do que a disponível em carteira (${disponivel.toLocaleString("pt-BR")}).`,
      };
    }
  }

  const { error } = await supabase.from("transacoes").insert({
    profile_id: user.id,
    ativo_id: input.ativo_id,
    corretora_id: input.corretora_id || null,
    tipo: input.tipo,
    data: input.data,
    quantidade: input.quantidade,
    preco_unitario: input.preco_unitario,
    custos: input.custos,
  });

  if (error) return { error: "Não foi possível registrar a transação." };
  return {};
}

export async function excluirTransacao(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("transacoes").delete().eq("id", id).eq("profile_id", user.id);
  if (error) return { error: "Não foi possível excluir a transação." };
  return {};
}

// ---------------------------------------------------------------------------
// Proventos
// ---------------------------------------------------------------------------
export async function criarProvento(input: ProventoForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("proventos").insert({
    profile_id: user.id,
    ativo_id: input.ativo_id,
    tipo: input.tipo,
    data: input.data,
    valor_total: input.valor_total,
  });

  if (error) return { error: "Não foi possível registrar o provento." };
  return {};
}

export async function excluirProvento(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("proventos").delete().eq("id", id).eq("profile_id", user.id);
  if (error) return { error: "Não foi possível excluir o provento." };
  return {};
}
