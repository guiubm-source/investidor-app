"use server";

import { createClient } from "@/lib/supabase/server";
import type { BacenDiretorForm, BrasilPresidenteForm, MetaInflacaoForm, PesoIpcaGrupoForm } from "./schema";

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

// ---------------------------------------------------------------------------
// Pesos do IPCA — ver docs/MAPA-DE-DADOS.md §8.8 decisão 5. Cadastro por
// grupo com vigência, consumido por lib/indicadores/ipca-estatisticas.ts
// (peso vigente na competência analisada) pra calcular impacto = peso ×
// variação. Mesmo padrão de dado compartilhado sem profile_id.
// ---------------------------------------------------------------------------

export type PesoIpcaGrupo = {
  id: string;
  grupo: string;
  pesoPct: number;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  metodologia: string | null;
};

export async function obterPesosIpca(): Promise<PesoIpcaGrupo[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("peso_ipca_grupo")
    .select("id, grupo, peso_pct, vigencia_inicio, vigencia_fim, metodologia")
    .order("grupo", { ascending: true })
    .order("vigencia_inicio", { ascending: false });

  return (data ?? []).map((p) => ({
    id: p.id,
    grupo: p.grupo,
    pesoPct: Number(p.peso_pct),
    vigenciaInicio: p.vigencia_inicio,
    vigenciaFim: p.vigencia_fim,
    metodologia: p.metodologia,
  }));
}

export async function criarPesoIpca(input: PesoIpcaGrupoForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("peso_ipca_grupo").insert({
    grupo: input.grupo,
    peso_pct: input.peso_pct,
    vigencia_inicio: input.vigencia_inicio,
    vigencia_fim: input.vigencia_fim,
    metodologia: input.metodologia,
  });

  if (error) return { error: "Não foi possível cadastrar o peso." };
  return {};
}

export async function editarPesoIpca(id: string, input: PesoIpcaGrupoForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("peso_ipca_grupo")
    .update({
      grupo: input.grupo,
      peso_pct: input.peso_pct,
      vigencia_inicio: input.vigencia_inicio,
      vigencia_fim: input.vigencia_fim,
      metodologia: input.metodologia,
    })
    .eq("id", id);

  if (error) return { error: "Não foi possível salvar as alterações." };
  return {};
}

export async function excluirPesoIpca(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const { error } = await supabase.from("peso_ipca_grupo").delete().eq("id", id);
  if (error) return { error: "Não foi possível excluir o registro." };
  return {};
}

// ---------------------------------------------------------------------------
// Metas de Inflação — ver docs/MAPA-DE-DADOS.md §8.8 decisão 6. Substitui as
// constantes hardcoded META_IPCA_CENTRO/META_IPCA_TOLERANCIA. Cadastro com
// vigência, banda informada explicitamente (não assume simetria).
// ---------------------------------------------------------------------------

export type MetaInflacao = {
  id: string;
  metaCentral: number;
  bandaInferior: number;
  bandaSuperior: number;
  vigenciaInicio: string;
  vigenciaFim: string | null;
};

export async function obterMetasInflacao(): Promise<MetaInflacao[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("meta_inflacao")
    .select("id, meta_central, banda_inferior, banda_superior, vigencia_inicio, vigencia_fim")
    .order("vigencia_inicio", { ascending: false });

  return (data ?? []).map((m) => ({
    id: m.id,
    metaCentral: Number(m.meta_central),
    bandaInferior: Number(m.banda_inferior),
    bandaSuperior: Number(m.banda_superior),
    vigenciaInicio: m.vigencia_inicio,
    vigenciaFim: m.vigencia_fim,
  }));
}

export async function criarMetaInflacao(input: MetaInflacaoForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("meta_inflacao").insert({
    meta_central: input.meta_central,
    banda_inferior: input.banda_inferior,
    banda_superior: input.banda_superior,
    vigencia_inicio: input.vigencia_inicio,
    vigencia_fim: input.vigencia_fim,
  });

  if (error) return { error: "Não foi possível cadastrar a meta." };
  return {};
}

export async function editarMetaInflacao(id: string, input: MetaInflacaoForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("meta_inflacao")
    .update({
      meta_central: input.meta_central,
      banda_inferior: input.banda_inferior,
      banda_superior: input.banda_superior,
      vigencia_inicio: input.vigencia_inicio,
      vigencia_fim: input.vigencia_fim,
    })
    .eq("id", id);

  if (error) return { error: "Não foi possível salvar as alterações." };
  return {};
}

export async function excluirMetaInflacao(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const { error } = await supabase.from("meta_inflacao").delete().eq("id", id);
  if (error) return { error: "Não foi possível excluir o registro." };
  return {};
}
