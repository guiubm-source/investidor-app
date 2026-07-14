"use server";

import { createClient } from "@/lib/supabase/server";
import type { ProventoForm } from "./schema";
import { TIPOS_PROVENTO } from "./schema";

export type AcaoResultado = { error?: string };

export type LancamentoProvento = {
  id: string;
  ativoId: string;
  ativoTicker: string;
  tipo: string;
  data: string;
  valorTotal: number;
};

export type TotalPorTipo = { tipo: string; label: string; total: number };
export type TotalPorAtivo = { ativoId: string; ativoTicker: string; total: number };
export type TotalPorAno = { ano: string; total: number };

export type LivroProventos = {
  lancamentos: LancamentoProvento[];
  totalGeral: number;
  porTipo: TotalPorTipo[];
  porAtivo: TotalPorAtivo[];
  porAno: TotalPorAno[];
};

/**
 * Fonte única de escrita para proventos (dividendo/JCP/rendimento/outro).
 * Carteira e a página do Ativo apenas EXIBEM proventos (leitura direta na
 * tabela `proventos`, ver lib/carteira/actions.ts#obterLivroRazao e
 * lib/ativos/actions.ts#obterAtivoDetalhe) — cadastrar, editar ou excluir só
 * acontece por aqui.
 */
export async function obterLivroProventos(): Promise<LivroProventos> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { lancamentos: [], totalGeral: 0, porTipo: [], porAtivo: [], porAno: [] };
  }

  const { data: proventosRaw } = await supabase
    .from("proventos")
    .select("id, ativo_id, tipo, data, valor_total, ativos(ticker)")
    .eq("profile_id", user.id);

  const lancamentos: LancamentoProvento[] = (proventosRaw ?? [])
    .map((p) => {
      const ativo = Array.isArray(p.ativos) ? p.ativos[0] : p.ativos;
      return {
        id: p.id,
        ativoId: p.ativo_id,
        ativoTicker: ativo?.ticker ?? "—",
        tipo: p.tipo as string,
        data: p.data as string,
        valorTotal: Number(p.valor_total),
      };
    })
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));

  const totalGeral = lancamentos.reduce((s, l) => s + l.valorTotal, 0);

  const porTipo: TotalPorTipo[] = TIPOS_PROVENTO.map((t) => ({
    tipo: t.valor,
    label: t.label,
    total: lancamentos.filter((l) => l.tipo === t.valor).reduce((s, l) => s + l.valorTotal, 0),
  })).filter((t) => t.total > 0);

  const porAtivoMap = new Map<string, TotalPorAtivo>();
  for (const l of lancamentos) {
    const atual = porAtivoMap.get(l.ativoId);
    if (atual) atual.total += l.valorTotal;
    else porAtivoMap.set(l.ativoId, { ativoId: l.ativoId, ativoTicker: l.ativoTicker, total: l.valorTotal });
  }
  const porAtivo = [...porAtivoMap.values()].sort((a, b) => b.total - a.total);

  const porAnoMap = new Map<string, number>();
  for (const l of lancamentos) {
    const ano = l.data.slice(0, 4);
    porAnoMap.set(ano, (porAnoMap.get(ano) ?? 0) + l.valorTotal);
  }
  const porAno = [...porAnoMap.entries()]
    .map(([ano, total]) => ({ ano, total }))
    .sort((a, b) => (a.ano < b.ano ? 1 : -1));

  return { lancamentos, totalGeral, porTipo, porAtivo, porAno };
}

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

export async function editarProvento(id: string, input: ProventoForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("proventos")
    .update({
      ativo_id: input.ativo_id,
      tipo: input.tipo,
      data: input.data,
      valor_total: input.valor_total,
    })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Não foi possível salvar o provento." };
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

/** Exclusão em lote (seleção múltipla na aba Proventos). */
export async function excluirProventosEmLote(ids: string[]): Promise<AcaoResultado> {
  if (ids.length === 0) return {};

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("proventos").delete().eq("profile_id", user.id).in("id", ids);
  if (error) return { error: "Não foi possível excluir os proventos selecionados." };
  return {};
}
