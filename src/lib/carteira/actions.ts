"use server";

import { createClient } from "@/lib/supabase/server";
import type { CorretoraForm, TransacaoForm } from "./schema";
import { obterQuantidadeDisponivelEmData } from "@/lib/ativos/actions";

export type AcaoResultado = {
  error?: string;
  /**
   * Preenchido (em vez de `error`) quando a transação enviada bate com uma
   * já existente (mesmo ativo, data, tipo, quantidade e preço unitário) —
   * ver docs/MAPA-DE-DADOS.md §8.18. Não é um erro: a UI mostra esse texto
   * num modal de confirmação e, se o usuário confirmar, reenvia a mesma
   * chamada com `{ confirmarDuplicata: true }` pra gravar mesmo assim (ex.:
   * duas compras reais do mesmo ativo no mesmo dia, coincidência legítima).
   */
  avisoDuplicata?: string;
};

export type Corretora = { id: string; nome: string };

/**
 * Ver docs/MAPA-DE-DADOS.md §8.22: `tipo` inclui eventos societários
 * (desdobramento/grupamento/bonificação) além de compra/venda. `quantidade`/
 * `precoUnitario` viram nullable (só compra/venda e, no caso de
 * `quantidade`, também bonificação — ações recebidas); `fatorProporcao`/
 * `valorCapitalizado` só existem em desdobramento-grupamento/bonificação
 * respectivamente.
 */
export type LancamentoTransacao = {
  categoria: "transacao";
  id: string;
  ativoId: string;
  ativoTicker: string;
  tipo: "compra" | "venda" | "desdobramento" | "grupamento" | "bonificacao";
  data: string;
  quantidade: number | null;
  precoUnitario: number | null;
  custos: number;
  fatorProporcao: number | null;
  valorCapitalizado: number | null;
  cambio: number | null;
  corretoraId: string | null;
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
      .select(
        "id, ativo_id, corretora_id, tipo, data, quantidade, preco_unitario, custos, fator_proporcao, valor_capitalizado, cambio, ativos(ticker), corretoras(nome)"
      )
      .eq("profile_id", user.id),
    supabase.from("corretoras").select("id, nome").eq("profile_id", user.id).order("nome"),
  ]);

  const numOuNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  const transacoes: LancamentoTransacao[] = (transacoesRaw ?? []).map((t) => {
    const ativo = Array.isArray(t.ativos) ? t.ativos[0] : t.ativos;
    const corretora = Array.isArray(t.corretoras) ? t.corretoras[0] : t.corretoras;
    return {
      categoria: "transacao",
      id: t.id,
      ativoId: t.ativo_id,
      ativoTicker: ativo?.ticker ?? "—",
      tipo: t.tipo as LancamentoTransacao["tipo"],
      data: t.data as string,
      quantidade: numOuNull(t.quantidade),
      precoUnitario: numOuNull(t.preco_unitario),
      custos: Number(t.custos),
      fatorProporcao: numOuNull(t.fator_proporcao),
      valorCapitalizado: numOuNull(t.valor_capitalizado),
      cambio: t.cambio === null || t.cambio === undefined ? null : Number(t.cambio),
      corretoraId: t.corretora_id,
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

/**
 * Checagem de duplicidade (ver docs/MAPA-DE-DADOS.md §8.18): mesma
 * combinação ativo+data+tipo+quantidade+preço unitário já lançada antes.
 * Não olha `custos`/`corretora_id` de propósito — dois lançamentos com
 * custo de corretagem levemente diferente ainda são "a mesma transação"
 * pro propósito desse aviso. `excluirId` evita que uma edição que não muda
 * nenhum desses 5 campos acuse "duplicata" contra si mesma.
 *
 * Só se aplica a compra/venda (ver §8.22) — eventos societários
 * (desdobramento/grupamento/bonificação) não têm quantidade+preço
 * comparáveis do mesmo jeito (quantidade/preço ficam nulos, `.eq()` do
 * PostgREST não compara null de forma útil), e duplicidade ali é bem menos
 * comum/preocupante do que em compra/venda.
 */
async function existeTransacaoDuplicada(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string,
  input: TransacaoForm,
  excluirId?: string
): Promise<boolean> {
  if (input.tipo !== "compra" && input.tipo !== "venda") return false;

  let query = supabase
    .from("transacoes")
    .select("id")
    .eq("profile_id", profileId)
    .eq("ativo_id", input.ativo_id)
    .eq("data", input.data)
    .eq("tipo", input.tipo)
    .eq("quantidade", input.quantidade)
    .eq("preco_unitario", input.preco_unitario)
    .limit(1);
  if (excluirId) query = query.neq("id", excluirId);

  const { data, error } = await query;
  if (error) return false; // checagem é só um aviso auxiliar — falha aqui não deve bloquear o salvamento
  return (data?.length ?? 0) > 0;
}

const MENSAGEM_DUPLICATA = (data: string) =>
  `Já existe uma transação igual (mesmo ativo, tipo, quantidade e preço) lançada em ${data
    .split("-")
    .reverse()
    .join("/")}. Confirma que quer lançar mesmo assim?`;

export async function criarTransacao(
  input: TransacaoForm,
  opts?: { confirmarDuplicata?: boolean }
): Promise<AcaoResultado> {
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
    if ((input.quantidade ?? 0) > disponivel) {
      return {
        error: `Quantidade maior do que a disponível em carteira na data informada (${disponivel.toLocaleString("pt-BR")}).`,
      };
    }
  }

  if (!opts?.confirmarDuplicata && (await existeTransacaoDuplicada(supabase, user.id, input))) {
    return { avisoDuplicata: MENSAGEM_DUPLICATA(input.data) };
  }

  const { error } = await supabase.from("transacoes").insert({
    profile_id: user.id,
    ativo_id: input.ativo_id,
    corretora_id: input.corretora_id || null,
    tipo: input.tipo,
    data: input.data,
    quantidade: input.quantidade,
    preco_unitario: input.preco_unitario,
    custos: input.custos ?? 0,
    fator_proporcao: input.fator_proporcao,
    valor_capitalizado: input.valor_capitalizado,
    cambio: input.cambio || null,
  });

  if (error) return { error: "Não foi possível registrar a transação." };
  return {};
}

export async function editarTransacao(
  id: string,
  input: TransacaoForm,
  opts?: { confirmarDuplicata?: boolean }
): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  if (input.tipo === "venda") {
    // Mesma validação de ponto-no-tempo de criarTransacao, excluindo a
    // própria transação sendo editada (ver comentário de
    // obterQuantidadeDisponivelEmData em lib/ativos/actions.ts).
    const disponivel = await obterQuantidadeDisponivelEmData(input.ativo_id, input.data, id);
    if ((input.quantidade ?? 0) > disponivel) {
      return {
        error: `Quantidade maior do que a disponível em carteira na data informada (${disponivel.toLocaleString("pt-BR")}).`,
      };
    }
  }

  if (!opts?.confirmarDuplicata && (await existeTransacaoDuplicada(supabase, user.id, input, id))) {
    return { avisoDuplicata: MENSAGEM_DUPLICATA(input.data) };
  }

  const { error } = await supabase
    .from("transacoes")
    .update({
      ativo_id: input.ativo_id,
      corretora_id: input.corretora_id || null,
      tipo: input.tipo,
      data: input.data,
      quantidade: input.quantidade,
      preco_unitario: input.preco_unitario,
      custos: input.custos ?? 0,
      fator_proporcao: input.fator_proporcao,
      valor_capitalizado: input.valor_capitalizado,
      cambio: input.cambio || null,
    })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Não foi possível salvar a transação." };
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

/** Exclusão em lote (seleção múltipla no Livro-razão — ver §8.18). */
export async function excluirTransacoesEmLote(ids: string[]): Promise<AcaoResultado> {
  if (ids.length === 0) return {};

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("transacoes").delete().eq("profile_id", user.id).in("id", ids);
  if (error) return { error: "Não foi possível excluir as transações selecionadas." };
  return {};
}

// Cadastro/leitura/exclusão de provento é responsabilidade exclusiva de
// lib/proventos/actions.ts (aba Proventos) — lib/carteira não lê proventos
// em nenhum ponto desde 2026-07-20 (ver docs/MAPA-DE-DADOS.md §8.16).
