"use server";

import { createClient } from "@/lib/supabase/server";
import type { CorretoraForm, TransacaoForm } from "./schema";
import { obterQuantidadeDisponivelEmData } from "@/lib/ativos/actions";

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

export type Lancamento = LancamentoTransacao;

export type LivroRazao = {
  lancamentos: Lancamento[];
  corretoras: Corretora[];
};

/**
 * Livro-razão: só lançamentos de compra/venda, num único feed ordenado por
 * data — desde 2026-07-20 (ver docs/MAPA-DE-DADOS.md §8.16) proventos NÃO
 * são mais lidos aqui (nem lista nem resumo): quem quiser ver proventos vai
 * na aba Proventos, que é a única dona dessa leitura/escrita (ver
 * lib/proventos/actions.ts). Os números consolidados por ativo (posição,
 * preço médio, lucro, desvio) vivem na aba Ativos (lib/ativos/actions.ts) e
 * a visão agregada por classe vive em lib/carteira/posicao.ts (sub-aba
 * Posição) — nenhum dos dois duplica dado, só lê de `transacoes`.
 */
export async function obterLivroRazao(): Promise<LivroRazao> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { lancamentos: [], corretoras: [] };

  const [{ data: transacoesRaw }, { data: corretorasRaw }] = await Promise.all([
    supabase
      .from("transacoes")
      .select("id, ativo_id, corretora_id, tipo, data, quantidade, preco_unitario, custos, ativos(ticker), corretoras(nome)")
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

  const lancamentos: Lancamento[] = transacoes.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));

  return { lancamentos, corretoras: corretorasRaw ?? [] };
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
    // Valida contra a posição NA DATA da transação (ponto no tempo), não
    // contra a posição agregada final — uma venda retroativa lançada antes
    // de uma compra também retroativa não pode ficar negativa naquele
    // ponto da linha do tempo, mesmo que o total (somando tudo) feche
    // positivo. Ver docs/MAPA-DE-DADOS.md §8.11.
    const disponivel = await obterQuantidadeDisponivelEmData(input.ativo_id, input.data);
    if (input.quantidade > disponivel) {
      return {
        error: `Quantidade maior do que a disponível em carteira na data informada (${disponivel.toLocaleString("pt-BR")}).`,
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
    cambio: input.cambio || null,
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

// Cadastro/leitura/exclusão de provento é responsabilidade exclusiva de
// lib/proventos/actions.ts (aba Proventos) — lib/carteira não lê proventos
// em nenhum ponto desde 2026-07-20 (ver docs/MAPA-DE-DADOS.md §8.16).
