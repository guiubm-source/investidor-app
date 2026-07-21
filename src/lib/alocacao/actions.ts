"use server";

import { createClient } from "@/lib/supabase/server";
import type { ClasseForm, MacroForm, SetorForm } from "./schema";
import { obterAtivosComPosicao, type TipoAtivo } from "@/lib/ativos/actions";

export type AcaoResultado = { error?: string };

/**
 * Campos de peso comuns a todo nó da árvore (Macro/Classe/Setor/Ativo) desde
 * a fase 1 da reformulação "Metas e estrutura" (§8.50/§8.51 do mapa de
 * dados). `pesoAlvo`/`pesoReal`/`desvio` são sempre LOCAIS — relativos ao
 * pai imediato, mesmo comportamento de antes da fase 1 (só que agora Classe
 * também tem um pai imediato: o Macro, em vez do patrimônio total direto).
 * `pesoAlvoGlobal`/`pesoRealGlobal` são novos, só informativos (% do
 * patrimônio total, calculado multiplicando a cadeia de pesos locais dos
 * ancestrais) — nunca editáveis nem persistidos, ver §16.2.5 do spec.
 */
type PesosNode = {
  pesoAlvo: number;
  pesoReal: number;
  desvio: number;
  pesoAlvoGlobal: number;
  pesoRealGlobal: number;
  valorAtual: number;
};

export type AtivoNode = PesosNode & {
  id: string;
  ticker: string;
  nome: string | null;
  tipo: TipoAtivo;
};

export type SetorNode = PesosNode & {
  id: string;
  nome: string;
  ativos: AtivoNode[];
};

export type ClasseNode = PesosNode & {
  id: string;
  nome: string;
  setores: SetorNode[];
};

export type MacroNode = PesosNode & {
  id: string;
  nome: string;
  classes: ClasseNode[];
};

export type EstruturaAlocacao = {
  macros: MacroNode[];
  patrimonioTotalInvestido: number;
};

/**
 * Carrega a estrutura-alvo (Macro > Classe > Setor) e monta a árvore de
 * desvio lendo os ativos JÁ CLASSIFICADOS (setor_id/peso_alvo em `ativos`,
 * ver lib/ativos/actions.ts) — a Alocação não cria nem edita ativo, só lê.
 *
 * Cada nível compara o peso real com o peso-alvo relativo ao seu PAI
 * imediato — Classe é % do Macro, Setor é % da Classe, Ativo é % do Setor —
 * assim como as metas são cadastradas (cada nível soma 100% do nível
 * acima). Macro é o único nível cujo "pai" é o patrimônio total, então seu
 * peso local e global são sempre o mesmo número.
 */
export async function obterEstruturaAlocacao(): Promise<EstruturaAlocacao> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { macros: [], patrimonioTotalInvestido: 0 };

  const [{ data: macrosRaw }, { data: classesRaw }, { data: setoresRaw }, ativosComPosicao] = await Promise.all([
    supabase
      .from("alocacao_macros")
      .select("id, nome, peso_alvo")
      .eq("profile_id", user.id)
      .order("nome"),
    supabase
      .from("alocacao_classes")
      .select("id, macro_id, nome, peso_alvo")
      .eq("profile_id", user.id)
      .order("nome"),
    supabase
      .from("alocacao_setores")
      .select("id, classe_id, nome, peso_alvo")
      .eq("profile_id", user.id)
      .order("nome"),
    obterAtivosComPosicao(),
  ]);

  const macros = macrosRaw ?? [];
  const classes = classesRaw ?? [];
  const setores = setoresRaw ?? [];
  const ativosClassificados = ativosComPosicao.filter((a) => a.setorId);

  const patrimonioTotalInvestido = ativosClassificados.reduce((s, a) => s + a.valorAtual, 0);

  const arvore: MacroNode[] = macros.map((macro) => {
    const classesDoMacro = classes.filter((c) => c.macro_id === macro.id);

    const classesNode: ClasseNode[] = classesDoMacro.map((classe) => {
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
          pesoAlvoGlobal: 0,
          pesoRealGlobal: patrimonioTotalInvestido > 0 ? (a.valorAtual / patrimonioTotalInvestido) * 100 : 0,
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
          pesoAlvoGlobal: 0,
          pesoRealGlobal: patrimonioTotalInvestido > 0 ? (valorAtualSetor / patrimonioTotalInvestido) * 100 : 0,
          valorAtual: valorAtualSetor,
          ativos: ativosNode,
        };
      });

      const valorAtualClasse = setoresNode.reduce((s, st) => s + st.valorAtual, 0);
      setoresNode.forEach((s) => {
        s.pesoReal = valorAtualClasse > 0 ? (s.valorAtual / valorAtualClasse) * 100 : 0;
        s.desvio = s.pesoReal - s.pesoAlvo;
      });

      return {
        id: classe.id,
        nome: classe.nome,
        pesoAlvo: classe.peso_alvo,
        pesoReal: 0,
        desvio: 0,
        pesoAlvoGlobal: 0,
        pesoRealGlobal: patrimonioTotalInvestido > 0 ? (valorAtualClasse / patrimonioTotalInvestido) * 100 : 0,
        valorAtual: valorAtualClasse,
        setores: setoresNode,
      };
    });

    const valorAtualMacro = classesNode.reduce((s, c) => s + c.valorAtual, 0);
    classesNode.forEach((c) => {
      c.pesoReal = valorAtualMacro > 0 ? (c.valorAtual / valorAtualMacro) * 100 : 0;
      c.desvio = c.pesoReal - c.pesoAlvo;
      // Peso-alvo global de Classe é informativo (produto Macro × Classe) — calculado
      // depois de sabermos o pesoAlvo do próprio Macro (abaixo).
    });

    const pesoRealMacro =
      patrimonioTotalInvestido > 0 ? (valorAtualMacro / patrimonioTotalInvestido) * 100 : 0;

    classesNode.forEach((c) => {
      c.pesoAlvoGlobal = (macro.peso_alvo / 100) * c.pesoAlvo;
    });

    return {
      id: macro.id,
      nome: macro.nome,
      pesoAlvo: macro.peso_alvo,
      pesoReal: pesoRealMacro,
      desvio: pesoRealMacro - macro.peso_alvo,
      pesoAlvoGlobal: macro.peso_alvo,
      pesoRealGlobal: pesoRealMacro,
      valorAtual: valorAtualMacro,
      classes: classesNode,
    };
  });

  // Peso-alvo global de Setor/Ativo (informativo) — depende do pesoAlvoGlobal já
  // resolvido da Classe/Setor pai, então é um segundo passe simples sobre a árvore.
  arvore.forEach((macro) => {
    macro.classes.forEach((classe) => {
      classe.setores.forEach((setor) => {
        setor.pesoAlvoGlobal = (classe.pesoAlvoGlobal / 100) * setor.pesoAlvo;
        setor.ativos.forEach((ativo) => {
          ativo.pesoAlvoGlobal = (setor.pesoAlvoGlobal / 100) * ativo.pesoAlvo;
        });
      });
    });
  });

  return { macros: arvore, patrimonioTotalInvestido };
}

// ---------------------------------------------------------------------------
// Macros
// ---------------------------------------------------------------------------
/** Tolerância de arredondamento pra validação de soma de peso-alvo (evita falso positivo por ponto flutuante). */
const TOLERANCIA_SOMA_PESO = 0.01;

async function somaPesoAlvoMacros(profileId: string, excluirId?: string): Promise<number> {
  const supabase = await createClient();
  let query = supabase.from("alocacao_macros").select("peso_alvo").eq("profile_id", profileId);
  if (excluirId) query = query.neq("id", excluirId);
  const { data } = await query;
  return (data ?? []).reduce((s, m) => s + Number(m.peso_alvo), 0);
}

export async function criarMacro(input: MacroForm): Promise<AcaoResultado & { id?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const somaAtual = await somaPesoAlvoMacros(user.id);
  if (somaAtual + input.peso_alvo > 100 + TOLERANCIA_SOMA_PESO) {
    return {
      error: `A soma dos pesos-alvo dos Macros passaria de 100% (já cadastrado: ${somaAtual.toFixed(1)}%, tentando adicionar ${input.peso_alvo.toFixed(1)}%).`,
    };
  }

  const { data, error } = await supabase
    .from("alocacao_macros")
    .insert({
      profile_id: user.id,
      nome: input.nome,
      peso_alvo: input.peso_alvo,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "Já existe um Macro com esse nome." };
    return { error: "Não foi possível criar o Macro." };
  }
  return { id: data.id };
}

export async function editarMacro(id: string, input: MacroForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const somaOutros = await somaPesoAlvoMacros(user.id, id);
  if (somaOutros + input.peso_alvo > 100 + TOLERANCIA_SOMA_PESO) {
    return {
      error: `A soma dos pesos-alvo dos Macros passaria de 100% (os outros Macros já somam ${somaOutros.toFixed(1)}%, tentando deixar este em ${input.peso_alvo.toFixed(1)}%).`,
    };
  }

  const { error } = await supabase
    .from("alocacao_macros")
    .update({ nome: input.nome, peso_alvo: input.peso_alvo })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) {
    if (error.code === "23505") return { error: "Já existe um Macro com esse nome." };
    return { error: "Não foi possível salvar o Macro." };
  }
  return {};
}

export async function excluirMacro(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("alocacao_macros")
    .delete()
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Não foi possível excluir o Macro." };
  return {};
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------
/**
 * Soma dos pesos-alvo das classes já cadastradas DENTRO do mesmo Macro,
 * exceto `excluirId` (uso em editarClasse, pra não contar o peso antigo da
 * própria classe duas vezes). Validação redundante (ver docs/MAPA-DE-DADOS.md
 * §8.11): além do usuário poder ver o total na tela, o servidor também barra
 * se ultrapassar 100%. Desde a fase 1 da reformulação (§8.50/§8.51), a soma é
 * por Macro, não mais pelo profile inteiro — Classe agora soma 100% dentro
 * do seu Macro pai, não do patrimônio total direto.
 */
async function somaPesoAlvoClasses(profileId: string, macroId: string, excluirId?: string): Promise<number> {
  const supabase = await createClient();
  let query = supabase
    .from("alocacao_classes")
    .select("peso_alvo")
    .eq("profile_id", profileId)
    .eq("macro_id", macroId);
  if (excluirId) query = query.neq("id", excluirId);
  const { data } = await query;
  return (data ?? []).reduce((s, c) => s + Number(c.peso_alvo), 0);
}

async function somaPesoAlvoSetores(profileId: string, classeId: string, excluirId?: string): Promise<number> {
  const supabase = await createClient();
  let query = supabase
    .from("alocacao_setores")
    .select("peso_alvo")
    .eq("profile_id", profileId)
    .eq("classe_id", classeId);
  if (excluirId) query = query.neq("id", excluirId);
  const { data } = await query;
  return (data ?? []).reduce((s, c) => s + Number(c.peso_alvo), 0);
}

export async function criarClasse(macroId: string, input: ClasseForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const somaAtual = await somaPesoAlvoClasses(user.id, macroId);
  if (somaAtual + input.peso_alvo > 100 + TOLERANCIA_SOMA_PESO) {
    return {
      error: `A soma dos pesos-alvo das Classes desse Macro passaria de 100% (já cadastrado: ${somaAtual.toFixed(1)}%, tentando adicionar ${input.peso_alvo.toFixed(1)}%).`,
    };
  }

  const { error } = await supabase.from("alocacao_classes").insert({
    profile_id: user.id,
    macro_id: macroId,
    nome: input.nome,
    peso_alvo: input.peso_alvo,
  });

  if (error) {
    if (error.code === "23505") return { error: "Já existe uma classe com esse nome nesse Macro." };
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

  const { data: classeAtual } = await supabase
    .from("alocacao_classes")
    .select("macro_id")
    .eq("id", id)
    .eq("profile_id", user.id)
    .single();
  if (!classeAtual) return { error: "Classe não encontrada." };

  const somaOutras = await somaPesoAlvoClasses(user.id, classeAtual.macro_id, id);
  if (somaOutras + input.peso_alvo > 100 + TOLERANCIA_SOMA_PESO) {
    return {
      error: `A soma dos pesos-alvo das Classes desse Macro passaria de 100% (as outras classes já somam ${somaOutras.toFixed(1)}%, tentando deixar esta em ${input.peso_alvo.toFixed(1)}%).`,
    };
  }

  const { error } = await supabase
    .from("alocacao_classes")
    .update({ nome: input.nome, peso_alvo: input.peso_alvo })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) {
    if (error.code === "23505") return { error: "Já existe uma classe com esse nome nesse Macro." };
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

  const somaAtual = await somaPesoAlvoSetores(user.id, classeId);
  if (somaAtual + input.peso_alvo > 100 + TOLERANCIA_SOMA_PESO) {
    return {
      error: `A soma dos pesos-alvo dos setores dessa classe passaria de 100% (já cadastrado: ${somaAtual.toFixed(1)}%, tentando adicionar ${input.peso_alvo.toFixed(1)}%).`,
    };
  }

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

  const { data: setorAtual } = await supabase
    .from("alocacao_setores")
    .select("classe_id")
    .eq("id", id)
    .eq("profile_id", user.id)
    .single();
  if (!setorAtual) return { error: "Setor não encontrado." };

  const somaOutros = await somaPesoAlvoSetores(user.id, setorAtual.classe_id, id);
  if (somaOutros + input.peso_alvo > 100 + TOLERANCIA_SOMA_PESO) {
    return {
      error: `A soma dos pesos-alvo dos setores dessa classe passaria de 100% (os outros setores já somam ${somaOutros.toFixed(1)}%, tentando deixar este em ${input.peso_alvo.toFixed(1)}%).`,
    };
  }

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
 * inicial de alocação quando ele ainda não cadastrou nenhum Macro.
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
