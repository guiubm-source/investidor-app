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
  /** Posição entre os irmãos (mesma classe), pra ação "reordenar" — fase 5, §8.54/§16.2.8. */
  ordem: number;
  ativos: AtivoNode[];
};

export type ClasseNode = PesosNode & {
  id: string;
  nome: string;
  ordem: number;
  setores: SetorNode[];
};

export type MacroNode = PesosNode & {
  id: string;
  nome: string;
  ordem: number;
  classes: ClasseNode[];
};

export type EstruturaAlocacao = {
  macros: MacroNode[];
  /**
   * Patrimônio total investido (fase 6, §8.55/§16.2.14): desde esta fase
   * inclui TODOS os ativos com posição, classificados ou não — antes só
   * somava os classificados (a árvore de desvio nunca soube que ativos não
   * classificados existiam). Com o bucket "Não classificado" virando
   * primeira classe na árvore, o total precisa cobrir 100% da carteira de
   * verdade, senão Macros e "Não classificado" juntos não fechariam 100%.
   * Isso desloca ligeiramente pra baixo o peso real (global) de Macros/
   * Classes/Setores quando existem ativos não classificados — é o
   * comportamento correto (antes o percentual era inflado por ignorar essa
   * fatia da carteira).
   */
  patrimonioTotalInvestido: number;
  /** Bucket runtime (nunca persistido) de ativos sem `setor_id` — §16.2.14. */
  naoClassificado: { valorAtual: number; ativos: AtivoNode[] };
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

  if (!user) return { macros: [], patrimonioTotalInvestido: 0, naoClassificado: { valorAtual: 0, ativos: [] } };

  const [
    { data: macrosRaw, error: macrosErro },
    { data: classesRaw, error: classesErro },
    { data: setoresRaw, error: setoresErro },
    ativosComPosicao,
  ] = await Promise.all([
    supabase
      .from("alocacao_macros")
      .select("id, nome, peso_alvo, ordem")
      .eq("profile_id", user.id)
      .order("ordem"),
    supabase
      .from("alocacao_classes")
      .select("id, macro_id, nome, peso_alvo, ordem")
      .eq("profile_id", user.id)
      .order("ordem"),
    supabase
      .from("alocacao_setores")
      .select("id, classe_id, nome, peso_alvo, ordem")
      .eq("profile_id", user.id)
      .order("ordem"),
    obterAtivosComPosicao(),
  ]);

  // Fase 6 (§16.2.16, "estados da interface"): não mudamos o contrato de
  // retorno desta função (o front trata falha via try/catch no `atualizar`
  // de AlocacaoView.tsx), mas logamos aqui pra não silenciar um erro real de
  // query — sem isso, um RLS mal configurado ou uma coluna renomeada
  // apareceria só como "estrutura vazia", sem pista nenhuma no servidor.
  if (macrosErro) console.error("[alocacao] erro ao buscar alocacao_macros:", macrosErro);
  if (classesErro) console.error("[alocacao] erro ao buscar alocacao_classes:", classesErro);
  if (setoresErro) console.error("[alocacao] erro ao buscar alocacao_setores:", setoresErro);

  const macros = macrosRaw ?? [];
  const classes = classesRaw ?? [];
  const setores = setoresRaw ?? [];
  const ativosClassificados = ativosComPosicao.filter((a) => a.setorId);
  const ativosNaoClassificados = ativosComPosicao.filter((a) => !a.setorId);

  // Fase 6 (§8.55/§16.2.14): o total agora é de TODOS os ativos com posição,
  // não só dos classificados — ver comentário em `EstruturaAlocacao`.
  const patrimonioTotalInvestido = ativosComPosicao.reduce((s, a) => s + a.valorAtual, 0);

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
          ordem: setor.ordem,
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
        ordem: classe.ordem,
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
      ordem: macro.ordem,
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

  // Bucket "Não classificado" (fase 6, §8.55/§16.2.14) — ativos sem
  // `setor_id`, nunca têm peso-alvo (nem local nem global, sempre 0) e o
  // peso real local é relativo ao próprio bucket (não a um pai de verdade).
  const valorNaoClassificado = ativosNaoClassificados.reduce((s, a) => s + a.valorAtual, 0);
  const ativosNaoClassificadosNode: AtivoNode[] = ativosNaoClassificados.map((a) => ({
    id: a.id,
    ticker: a.ticker,
    nome: a.nome,
    tipo: a.tipo,
    valorAtual: a.valorAtual,
    pesoAlvo: 0,
    pesoReal: valorNaoClassificado > 0 ? (a.valorAtual / valorNaoClassificado) * 100 : 0,
    desvio: 0,
    pesoAlvoGlobal: 0,
    pesoRealGlobal: patrimonioTotalInvestido > 0 ? (a.valorAtual / patrimonioTotalInvestido) * 100 : 0,
  }));

  return {
    macros: arvore,
    patrimonioTotalInvestido,
    naoClassificado: { valorAtual: valorNaoClassificado, ativos: ativosNaoClassificadosNode },
  };
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

// ---------------------------------------------------------------------------
// Reordenar (fase 5, §8.54/§16.2.8) — troca a `ordem` do nó com a do irmão
// adjacente (mesmo pai imediato). Sem efeito, sem erro, quando o nó já está
// na ponta (primeiro pra "subir", último pra "descer") — é um estado normal
// da UI (botão desabilitado), não uma falha.
// ---------------------------------------------------------------------------
type TabelaOrdenavel = "alocacao_macros" | "alocacao_classes" | "alocacao_setores";

async function moverOrdem(
  tabela: TabelaOrdenavel,
  colunaPai: "profile_id" | "macro_id" | "classe_id",
  id: string,
  direcao: "subir" | "descer"
): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data: atual } = await supabase
    .from(tabela)
    .select(`id, ordem, ${colunaPai}`)
    .eq("id", id)
    .eq("profile_id", user.id)
    .single();
  if (!atual) return { error: "Item não encontrado." };

  const valorPai = (atual as Record<string, unknown>)[colunaPai] as string;

  const { data: irmaos } = await supabase
    .from(tabela)
    .select("id, ordem")
    .eq(colunaPai, valorPai)
    .eq("profile_id", user.id)
    .order("ordem");
  if (!irmaos) return { error: "Não foi possível carregar os irmãos." };

  const indexAtual = irmaos.findIndex((i) => i.id === id);
  const indexAlvo = direcao === "subir" ? indexAtual - 1 : indexAtual + 1;
  if (indexAtual === -1 || indexAlvo < 0 || indexAlvo >= irmaos.length) return {}; // já está na ponta

  const alvo = irmaos[indexAlvo];
  const ordemAtual = irmaos[indexAtual].ordem;

  const { error: err1 } = await supabase
    .from(tabela)
    .update({ ordem: alvo.ordem })
    .eq("id", id)
    .eq("profile_id", user.id);
  if (err1) return { error: "Não foi possível reordenar." };

  const { error: err2 } = await supabase
    .from(tabela)
    .update({ ordem: ordemAtual })
    .eq("id", alvo.id)
    .eq("profile_id", user.id);
  if (err2) return { error: "Não foi possível reordenar." };

  return {};
}

export async function moverMacroOrdem(id: string, direcao: "subir" | "descer"): Promise<AcaoResultado> {
  return moverOrdem("alocacao_macros", "profile_id", id, direcao);
}
export async function moverClasseOrdem(id: string, direcao: "subir" | "descer"): Promise<AcaoResultado> {
  return moverOrdem("alocacao_classes", "macro_id", id, direcao);
}
export async function moverSetorOrdem(id: string, direcao: "subir" | "descer"): Promise<AcaoResultado> {
  return moverOrdem("alocacao_setores", "classe_id", id, direcao);
}

// ---------------------------------------------------------------------------
// Mover entre pais (fase 5, §8.54/§16.2.11) — move uma Classe pra outro
// Macro, ou um Setor pra outra Classe, preservando o peso local (só o peso
// global, derivado, muda). Nunca move Ativo — reclassificar `setor_id`
// continua exclusivo da aba Ativos (§16.2.13). Bloqueia com mensagem
// amigável se já existir um nó com o mesmo nome no destino, em vez de deixar
// o servidor rejeitar com um código de erro cru.
// ---------------------------------------------------------------------------
export async function moverClasseParaMacro(classeId: string, novoMacroId: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data: classe } = await supabase
    .from("alocacao_classes")
    .select("id, nome, macro_id, peso_alvo")
    .eq("id", classeId)
    .eq("profile_id", user.id)
    .single();
  if (!classe) return { error: "Classe não encontrada." };
  if (classe.macro_id === novoMacroId) return {};

  const { data: existente } = await supabase
    .from("alocacao_classes")
    .select("id")
    .eq("macro_id", novoMacroId)
    .eq("profile_id", user.id)
    .eq("nome", classe.nome)
    .maybeSingle();
  if (existente) {
    return { error: `Já existe uma classe chamada "${classe.nome}" no Macro de destino. Renomeie antes de mover.` };
  }

  const somaDestino = await somaPesoAlvoClasses(user.id, novoMacroId);
  if (somaDestino + Number(classe.peso_alvo) > 100 + TOLERANCIA_SOMA_PESO) {
    return {
      error: `Mover "${classe.nome}" (${Number(classe.peso_alvo).toFixed(1)}%) faria a soma das Classes do Macro de destino passar de 100% (já soma ${somaDestino.toFixed(1)}%). Ajuste os pesos antes de mover.`,
    };
  }

  const { data: irmaosDestino } = await supabase
    .from("alocacao_classes")
    .select("ordem")
    .eq("macro_id", novoMacroId)
    .eq("profile_id", user.id)
    .order("ordem", { ascending: false })
    .limit(1);
  const proximaOrdem = irmaosDestino && irmaosDestino.length > 0 ? irmaosDestino[0].ordem + 1 : 0;

  const { error } = await supabase
    .from("alocacao_classes")
    .update({ macro_id: novoMacroId, ordem: proximaOrdem })
    .eq("id", classeId)
    .eq("profile_id", user.id);

  if (error) {
    if (error.code === "23505") return { error: "Já existe uma classe com esse nome nesse Macro." };
    return { error: "Não foi possível mover a classe." };
  }
  return {};
}

export async function moverSetorParaClasse(setorId: string, novaClasseId: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data: setor } = await supabase
    .from("alocacao_setores")
    .select("id, nome, classe_id, peso_alvo")
    .eq("id", setorId)
    .eq("profile_id", user.id)
    .single();
  if (!setor) return { error: "Setor não encontrado." };
  if (setor.classe_id === novaClasseId) return {};

  const { data: existente } = await supabase
    .from("alocacao_setores")
    .select("id")
    .eq("classe_id", novaClasseId)
    .eq("profile_id", user.id)
    .eq("nome", setor.nome)
    .maybeSingle();
  if (existente) {
    return { error: `Já existe um setor chamado "${setor.nome}" na Classe de destino. Renomeie antes de mover.` };
  }

  const somaDestino = await somaPesoAlvoSetores(user.id, novaClasseId);
  if (somaDestino + Number(setor.peso_alvo) > 100 + TOLERANCIA_SOMA_PESO) {
    return {
      error: `Mover "${setor.nome}" (${Number(setor.peso_alvo).toFixed(1)}%) faria a soma dos Setores da Classe de destino passar de 100% (já soma ${somaDestino.toFixed(1)}%). Ajuste os pesos antes de mover.`,
    };
  }

  const { data: irmaosDestino } = await supabase
    .from("alocacao_setores")
    .select("ordem")
    .eq("classe_id", novaClasseId)
    .eq("profile_id", user.id)
    .order("ordem", { ascending: false })
    .limit(1);
  const proximaOrdem = irmaosDestino && irmaosDestino.length > 0 ? irmaosDestino[0].ordem + 1 : 0;

  const { error } = await supabase
    .from("alocacao_setores")
    .update({ classe_id: novaClasseId, ordem: proximaOrdem })
    .eq("id", setorId)
    .eq("profile_id", user.id);

  if (error) {
    if (error.code === "23505") return { error: "Já existe um setor com esse nome nessa classe." };
    return { error: "Não foi possível mover o setor." };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Excluir com opções (fase 5, §8.54/§16.2.12) — excluir um Macro ou Classe
// que tem filhos nunca é silencioso: quem chama escolhe "mover" (os filhos
// sobem pra outro pai já existente, escolhido antes de confirmar) ou
// "subarvore" (exclui tudo — cascade do banco já cuida de Classes/Setores;
// Ativos classificados nos Setores excluídos ficam "não classificados"
// automaticamente via `ativos.setor_id on delete set null`, nunca uma
// escrita direta da Alocação no Ativo, ver §16.2.13). Setor não tem opção
// "mover": seus filhos são Ativos, e mudar `ativos.setor_id` é exclusivo da
// aba Ativos — por isso `excluirSetor` (acima) permanece simples.
// ---------------------------------------------------------------------------
export async function excluirMacroComOpcao(
  id: string,
  opcao: "subarvore" | "mover",
  destinoMacroId?: string
): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  if (opcao === "mover") {
    if (!destinoMacroId) return { error: "Escolha um Macro de destino." };
    if (destinoMacroId === id) return { error: "O destino não pode ser o próprio Macro." };

    const { data: classesOrigem } = await supabase
      .from("alocacao_classes")
      .select("id, nome, peso_alvo")
      .eq("macro_id", id)
      .eq("profile_id", user.id);
    const { data: classesDestino } = await supabase
      .from("alocacao_classes")
      .select("nome, ordem, peso_alvo")
      .eq("macro_id", destinoMacroId)
      .eq("profile_id", user.id);

    const nomesDestino = new Set((classesDestino ?? []).map((c) => c.nome));
    const colisoes = (classesOrigem ?? []).filter((c) => nomesDestino.has(c.nome)).map((c) => c.nome);
    if (colisoes.length > 0) {
      return {
        error: `Já existe(m) classe(s) com o mesmo nome no Macro de destino: ${colisoes.join(", ")}. Renomeie antes de mover, ou exclua a subárvore inteira.`,
      };
    }

    const somaOrigem = (classesOrigem ?? []).reduce((s, c) => s + Number(c.peso_alvo), 0);
    const somaDestinoAtual = (classesDestino ?? []).reduce((s, c) => s + Number(c.peso_alvo), 0);
    if (somaDestinoAtual + somaOrigem > 100 + TOLERANCIA_SOMA_PESO) {
      return {
        error: `Mover essas Classes faria a soma das Classes do Macro de destino passar de 100% (destino já soma ${somaDestinoAtual.toFixed(1)}%, as classes movidas somam ${somaOrigem.toFixed(1)}%). Ajuste os pesos antes de mover, ou exclua a subárvore inteira.`,
      };
    }

    let proximaOrdem = (classesDestino ?? []).reduce((max, c) => Math.max(max, c.ordem), -1) + 1;
    for (const classe of classesOrigem ?? []) {
      await supabase
        .from("alocacao_classes")
        .update({ macro_id: destinoMacroId, ordem: proximaOrdem })
        .eq("id", classe.id)
        .eq("profile_id", user.id);
      proximaOrdem += 1;
    }
  }

  const { error } = await supabase.from("alocacao_macros").delete().eq("id", id).eq("profile_id", user.id);
  if (error) return { error: "Não foi possível excluir o Macro." };
  return {};
}

export async function excluirClasseComOpcao(
  id: string,
  opcao: "subarvore" | "mover",
  destinoClasseId?: string
): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  if (opcao === "mover") {
    if (!destinoClasseId) return { error: "Escolha uma Classe de destino." };
    if (destinoClasseId === id) return { error: "O destino não pode ser a própria Classe." };

    const { data: setoresOrigem } = await supabase
      .from("alocacao_setores")
      .select("id, nome, peso_alvo")
      .eq("classe_id", id)
      .eq("profile_id", user.id);
    const { data: setoresDestino } = await supabase
      .from("alocacao_setores")
      .select("nome, ordem, peso_alvo")
      .eq("classe_id", destinoClasseId)
      .eq("profile_id", user.id);

    const nomesDestino = new Set((setoresDestino ?? []).map((s) => s.nome));
    const colisoes = (setoresOrigem ?? []).filter((s) => nomesDestino.has(s.nome)).map((s) => s.nome);
    if (colisoes.length > 0) {
      return {
        error: `Já existe(m) setor(es) com o mesmo nome na Classe de destino: ${colisoes.join(", ")}. Renomeie antes de mover, ou exclua a subárvore inteira.`,
      };
    }

    const somaOrigem = (setoresOrigem ?? []).reduce((s, st) => s + Number(st.peso_alvo), 0);
    const somaDestinoAtual = (setoresDestino ?? []).reduce((s, st) => s + Number(st.peso_alvo), 0);
    if (somaDestinoAtual + somaOrigem > 100 + TOLERANCIA_SOMA_PESO) {
      return {
        error: `Mover esses Setores faria a soma dos Setores da Classe de destino passar de 100% (destino já soma ${somaDestinoAtual.toFixed(1)}%, os setores movidos somam ${somaOrigem.toFixed(1)}%). Ajuste os pesos antes de mover, ou exclua a subárvore inteira.`,
      };
    }

    let proximaOrdem = (setoresDestino ?? []).reduce((max, s) => Math.max(max, s.ordem), -1) + 1;
    for (const setor of setoresOrigem ?? []) {
      await supabase
        .from("alocacao_setores")
        .update({ classe_id: destinoClasseId, ordem: proximaOrdem })
        .eq("id", setor.id)
        .eq("profile_id", user.id);
      proximaOrdem += 1;
    }
  }

  const { error } = await supabase.from("alocacao_classes").delete().eq("id", id).eq("profile_id", user.id);
  if (error) return { error: "Não foi possível excluir a classe." };
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
