"use server";

import { createClient } from "@/lib/supabase/server";
import type { ClasseForm, SetorForm } from "./schema";
import { obterAtivosComPosicao, type TipoAtivo } from "@/lib/ativos/actions";

export type AcaoResultado = { error?: string };

export type AtivoNode = {
  id: string;
  ticker: string;
  nome: string | null;
  tipo: TipoAtivo;
  valorAtual: number;
  pesoAlvo: number;
  pesoReal: number;
  desvio: number;
};

export type SetorNode = {
  id: string;
  nome: string;
  pesoAlvo: number;
  pesoReal: number;
  desvio: number;
  valorAtual: number;
  ativos: AtivoNode[];
};

export type ClasseNode = {
  id: string;
  nome: string;
  pesoAlvo: number;
  pesoReal: number;
  desvio: number;
  valorAtual: number;
  setores: SetorNode[];
};

export type EstruturaAlocacao = {
  classes: ClasseNode[];
  patrimonioTotalInvestido: number;
};

/**
 * Carrega a estrutura-alvo (classes > setores) e monta a árvore de desvio
 * lendo os ativos JÁ CLASSIFICADOS (setor_id/peso_alvo em `ativos`, ver
 * lib/ativos/actions.ts) — a Alocação não cria nem edita ativo, só lê.
 *
 * Cada nível compara o peso real com o peso-alvo relativo ao seu PAI
 * imediato — setor é % da classe, ativo é % do setor — assim como as metas
 * foram cadastradas (cada nível soma 100% do nível acima).
 */
export async function obterEstruturaAlocacao(): Promise<EstruturaAlocacao> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { classes: [], patrimonioTotalInvestido: 0 };

  const [{ data: classesRaw }, { data: setoresRaw }, ativosComPosicao] = await Promise.all([
    supabase
      .from("alocacao_classes")
      .select("id, nome, peso_alvo")
      .eq("profile_id", user.id)
      .order("nome"),
    supabase
      .from("alocacao_setores")
      .select("id, classe_id, nome, peso_alvo")
      .eq("profile_id", user.id)
      .order("nome"),
    obterAtivosComPosicao(),
  ]);

  const classes = classesRaw ?? [];
  const setores = setoresRaw ?? [];
  const ativosClassificados = ativosComPosicao.filter((a) => a.setorId);

  const patrimonioTotalInvestido = ativosClassificados.reduce((s, a) => s + a.valorAtual, 0);

  const arvore: ClasseNode[] = classes.map((classe) => {
    const setoresDaClasse = setores.filter((s) => s.classe_id === classe.id);

    const setoresNode: SetorNode[] = setoresDaClasse.map((setor) => {
      const ativosDoSetor = ativosClassificados.filter((a) => a.setorId === setor.id);

      const ativosNode: AtivoNode[] = ativosDoSetor.map((a) => ({
        id: a.id,
        ticker: a.ticker,
        nome: a.nome,
        tipo: a.tipo,
        valorAtual: a.valorAtual,
        pesoAlvo: a.pesoAlvo ?? 0,
        pesoReal: 0,
        desvio: 0,
      }));

      const valorAtualSetor = ativosNode.reduce((s, a) => s + a.valorAtual, 0);
      ativosNode.forEach((a) => {
        a.pesoReal = valorAtualSetor > 0 ? (a.valorAtual / valorAtualSetor) * 100 : 0;
        a.desvio = a.pesoReal - a.pesoAlvo;
      });

      return {
        id: setor.id,
        nome: setor.nome,
        pesoAlvo: setor.peso_alvo,
        pesoReal: 0,
        desvio: 0,
        valorAtual: valorAtualSetor,
        ativos: ativosNode,
      };
    });

    const valorAtualClasse = setoresNode.reduce((s, st) => s + st.valorAtual, 0);
    setoresNode.forEach((s) => {
      s.pesoReal = valorAtualClasse > 0 ? (s.valorAtual / valorAtualClasse) * 100 : 0;
      s.desvio = s.pesoReal - s.pesoAlvo;
    });

    const pesoRealClasse =
      patrimonioTotalInvestido > 0 ? (valorAtualClasse / patrimonioTotalInvestido) * 100 : 0;

    return {
      id: classe.id,
      nome: classe.nome,
      pesoAlvo: classe.peso_alvo,
      pesoReal: pesoRealClasse,
      desvio: pesoRealClasse - classe.peso_alvo,
      valorAtual: valorAtualClasse,
      setores: setoresNode,
    };
  });

  return { classes: arvore, patrimonioTotalInvestido };
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------
export async function criarClasse(input: ClasseForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("alocacao_classes").insert({
    profile_id: user.id,
    nome: input.nome,
    peso_alvo: input.peso_alvo,
  });

  if (error) {
    if (error.code === "23505") return { error: "Já existe uma classe com esse nome." };
    return { error: "Não foi possível criar a classe." };
  }
  return {};
}

export async function editarClasse(id: string, input: ClasseForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("alocacao_classes")
    .update({ nome: input.nome, peso_alvo: input.peso_alvo })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) {
    if (error.code === "23505") return { error: "Já existe uma classe com esse nome." };
    return { error: "Não foi possível salvar a classe." };
  }
  return {};
}

export async function excluirClasse(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("alocacao_classes")
    .delete()
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Não foi possível excluir a classe." };
  return {};
}

// ---------------------------------------------------------------------------
// Setores
// ---------------------------------------------------------------------------
export async function criarSetor(classeId: string, input: SetorForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("alocacao_setores").insert({
    profile_id: user.id,
    classe_id: classeId,
    nome: input.nome,
    peso_alvo: input.peso_alvo,
  });

  if (error) {
    if (error.code === "23505") return { error: "Já existe um setor com esse nome nessa classe." };
    return { error: "Não foi possível criar o setor." };
  }
  return {};
}

export async function editarSetor(id: string, input: SetorForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("alocacao_setores")
    .update({ nome: input.nome, peso_alvo: input.peso_alvo })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) {
    if (error.code === "23505") return { error: "Já existe um setor com esse nome nessa classe." };
    return { error: "Não foi possível salvar o setor." };
  }
  return {};
}

export async function excluirSetor(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("alocacao_setores")
    .delete()
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Não foi possível excluir o setor." };
  return {};
}

/**
 * Perfil de suitability vigente do usuário, usado para sugerir um template
 * inicial de alocação quando ele ainda não cadastrou nenhuma classe.
 */
export async function obterPerfilParaSugestao(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("current_investor_suitability")
    .select("perfil_resultado")
    .eq("profile_id", user.id)
    .single();

  return data?.perfil_resultado ?? null;
}
