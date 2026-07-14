"use server";

import { createClient } from "@/lib/supabase/server";
import type { BacenDiretorForm, BrasilPresidenteForm } from "./schema";

export type AcaoResultado = { error?: string };

/**
 * Diretoria do Bacen e presidentes do Brasil são dado compartilhado (sem
 * profile_id, mesmo racional de docs/MAPA-DE-DADOS.md §8.3.8/§8.7) —
 * qualquer usuário autenticado lê e escreve o mesmo cadastro. Cadastrado em
 * Configurações, consumido pela aba Indicadores (filtros de mandato).
 */

// ---------------------------------------------------------------------------
// Diretoria do Bacen
// ---------------------------------------------------------------------------

export type DiretorBacen = {
  id: string;
  nome: string;
  cargo: string;
  presidente: boolean;
  mandatoInicio: string;
  mandatoFim: string | null;
  nomeadoPor: string | null;
  dataPosse: string | null;
};

export async function obterDiretoriaBacen(): Promise<DiretorBacen[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bacen_diretoria")
    .select("id, nome, cargo, presidente, mandato_inicio, mandato_fim, nomeado_por, data_posse")
    .order("mandato_inicio", { ascending: false });

  return (data ?? []).map((d) => ({
    id: d.id,
    nome: d.nome,
    cargo: d.cargo,
    presidente: d.presidente,
    mandatoInicio: d.mandato_inicio,
    mandatoFim: d.mandato_fim,
    nomeadoPor: d.nomeado_por,
    dataPosse: d.data_posse,
  }));
}

export async function criarDiretorBacen(input: BacenDiretorForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("bacen_diretoria").insert({
    nome: input.nome,
    cargo: input.cargo,
    presidente: input.presidente,
    mandato_inicio: input.mandato_inicio,
    mandato_fim: input.mandato_fim,
    nomeado_por: input.nomeado_por,
    data_posse: input.data_posse,
  });

  if (error) return { error: "Não foi possível cadastrar o diretor." };
  return {};
}

export async function editarDiretorBacen(id: string, input: BacenDiretorForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("bacen_diretoria")
    .update({
      nome: input.nome,
      cargo: input.cargo,
      presidente: input.presidente,
      mandato_inicio: input.mandato_inicio,
      mandato_fim: input.mandato_fim,
      nomeado_por: input.nomeado_por,
      data_posse: input.data_posse,
    })
    .eq("id", id);

  if (error) return { error: "Não foi possível salvar as alterações." };
  return {};
}

export async function excluirDiretorBacen(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const { error } = await supabase.from("bacen_diretoria").delete().eq("id", id);
  if (error) return { error: "Não foi possível excluir o registro." };
  return {};
}

// ---------------------------------------------------------------------------
// Presidentes do Brasil
// ---------------------------------------------------------------------------

export type PresidenteBrasil = {
  id: string;
  nome: string;
  mandatoInicio: string;
  mandatoFim: string | null;
};

export async function obterPresidentesBrasil(): Promise<PresidenteBrasil[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("brasil_presidentes")
    .select("id, nome, mandato_inicio, mandato_fim")
    .order("mandato_inicio", { ascending: false });

  return (data ?? []).map((p) => ({
    id: p.id,
    nome: p.nome,
    mandatoInicio: p.mandato_inicio,
    mandatoFim: p.mandato_fim,
  }));
}

export async function criarPresidenteBrasil(input: BrasilPresidenteForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("brasil_presidentes").insert({
    nome: input.nome,
    mandato_inicio: input.mandato_inicio,
    mandato_fim: input.mandato_fim,
  });

  if (error) return { error: "Não foi possível cadastrar o presidente." };
  return {};
}

export async function editarPresidenteBrasil(id: string, input: BrasilPresidenteForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("brasil_presidentes")
    .update({
      nome: input.nome,
      mandato_inicio: input.mandato_inicio,
      mandato_fim: input.mandato_fim,
    })
    .eq("id", id);

  if (error) return { error: "Não foi possível salvar as alterações." };
  return {};
}

export async function excluirPresidenteBrasil(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const { error } = await supabase.from("brasil_presidentes").delete().eq("id", id);
  if (error) return { error: "Não foi possível excluir o registro." };
  return {};
}

// ---------------------------------------------------------------------------
// Helper — presidente do Bacen vigente hoje (usado pelos cards da Selic)
// ---------------------------------------------------------------------------

export async function presidenteBcVigente(diretoria: DiretorBacen[]): Promise<DiretorBacen | null> {
  const hoje = new Date().toISOString().slice(0, 10);
  return (
    diretoria.find(
      (d) => d.presidente && d.mandatoInicio <= hoje && (d.mandatoFim === null || d.mandatoFim >= hoje)
    ) ?? null
  );
}
