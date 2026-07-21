import type { EstruturaAlocacao, MacroNode, ClasseNode, SetorNode, AtivoNode } from "@/lib/alocacao/actions";

/**
 * Helpers puros de navegação da árvore Macro>Classe>Setor>Ativo (fase 3 da
 * reformulação "Metas e estrutura", §8.50/§8.51/§8.52) — nenhuma chamada de
 * rede aqui, só resolve/percorre a `EstruturaAlocacao` já carregada em
 * memória pra alimentar a árvore (esquerda) e o painel contextual
 * (direita). Mantido fora de `actions.ts` (que é `"use server"`) porque isso
 * roda inteiramente no client, a cada clique de seleção.
 */

export type TipoNo = "raiz" | "macro" | "classe" | "setor" | "ativo";

export type Selecao = { tipo: TipoNo; id: string | null };

export const RAIZ: Selecao = { tipo: "raiz", id: null };

/** Item do breadcrumb — ancestrais do nó selecionado, sempre do topo (Macro) até o pai imediato. */
export type ItemCaminho = {
  tipo: TipoNo;
  id: string;
  nome: string;
  pesoAlvo: number;
};

/** Filho listado no painel contextual (linha da lista de distribuição). */
export type FilhoResolvido = {
  tipo: TipoNo;
  id: string;
  nome: string;
  pesoAlvo: number;
  pesoReal: number;
  desvio: number;
  pesoAlvoGlobal: number;
  pesoRealGlobal: number;
  valorAtual: number;
  ticker?: string; // só presente quando o filho é um Ativo
};

export type NoResolvido = {
  tipo: TipoNo;
  id: string | null;
  nome: string;
  pesoAlvo: number | null;
  pesoReal: number | null;
  desvio: number | null;
  pesoAlvoGlobal: number | null;
  pesoRealGlobal: number | null;
  valorAtual: number | null;
  caminho: ItemCaminho[];
  filhos: FilhoResolvido[];
  /** Rótulo do tipo dos filhos, pro título/explicação do painel ("Classes", "Setores", "Ativos"). */
  rotuloFilhos: string;
  /** true só para Ativo (nó-folha, sem filhos e sem distribuição própria). */
  ehFolha: boolean;
  /** false só pra Ativo e Setor (Setor tem filhos, mas eles não são um grupo com meta editável aqui — são Ativos, geridos na aba Ativos). */
  filhosEditaveisAqui: boolean;
  /**
   * Soma do peso-alvo dos IRMÃOS do próprio nó (mesmo pai, excluindo o nó
   * em si) — usado na fase 4 (§8.53) pra bloquear o salvamento ao EDITAR o
   * próprio nó selecionado, de forma preventiva (sem esperar o servidor
   * rejeitar). `null` só pra raiz (não tem pai/irmãos).
   */
  somaIrmaos: number | null;
};

function paraFilhoClasse(c: ClasseNode): FilhoResolvido {
  return {
    tipo: "classe",
    id: c.id,
    nome: c.nome,
    pesoAlvo: c.pesoAlvo,
    pesoReal: c.pesoReal,
    desvio: c.desvio,
    pesoAlvoGlobal: c.pesoAlvoGlobal,
    pesoRealGlobal: c.pesoRealGlobal,
    valorAtual: c.valorAtual,
  };
}
function paraFilhoSetor(s: SetorNode): FilhoResolvido {
  return {
    tipo: "setor",
    id: s.id,
    nome: s.nome,
    pesoAlvo: s.pesoAlvo,
    pesoReal: s.pesoReal,
    desvio: s.desvio,
    pesoAlvoGlobal: s.pesoAlvoGlobal,
    pesoRealGlobal: s.pesoRealGlobal,
    valorAtual: s.valorAtual,
  };
}
function paraFilhoAtivo(a: AtivoNode): FilhoResolvido {
  return {
    tipo: "ativo",
    id: a.id,
    nome: a.nome ?? a.ticker,
    ticker: a.ticker,
    pesoAlvo: a.pesoAlvo,
    pesoReal: a.pesoReal,
    desvio: a.desvio,
    pesoAlvoGlobal: a.pesoAlvoGlobal,
    pesoRealGlobal: a.pesoRealGlobal,
    valorAtual: a.valorAtual,
  };
}
function paraFilhoMacro(m: MacroNode): FilhoResolvido {
  return {
    tipo: "macro",
    id: m.id,
    nome: m.nome,
    pesoAlvo: m.pesoAlvo,
    pesoReal: m.pesoReal,
    desvio: m.desvio,
    pesoAlvoGlobal: m.pesoAlvoGlobal,
    pesoRealGlobal: m.pesoRealGlobal,
    valorAtual: m.valorAtual,
  };
}

/**
 * Resolve o nó selecionado (por tipo+id) dentro da árvore já carregada,
 * devolvendo seus dados, o breadcrumb até ele e a lista de filhos prontos
 * pro painel contextual. Retorna `null` só se o id não existir mais na
 * árvore (ex. foi excluído em outra aba/aba duplicada) — quem chama deve
 * cair de volta pra raiz nesse caso.
 */
export function resolverNo(estrutura: EstruturaAlocacao, selecao: Selecao): NoResolvido | null {
  if (selecao.tipo === "raiz") {
    return {
      tipo: "raiz",
      id: null,
      nome: "Estrutura da carteira",
      pesoAlvo: null,
      pesoReal: null,
      desvio: null,
      pesoAlvoGlobal: null,
      pesoRealGlobal: null,
      valorAtual: estrutura.patrimonioTotalInvestido,
      caminho: [],
      filhos: estrutura.macros.map(paraFilhoMacro),
      rotuloFilhos: "Macros",
      ehFolha: false,
      filhosEditaveisAqui: true,
      somaIrmaos: null,
    };
  }

  const somaPesoAlvo = (itens: { pesoAlvo: number }[]) => itens.reduce((s, i) => s + i.pesoAlvo, 0);

  for (const macro of estrutura.macros) {
    if (selecao.tipo === "macro" && selecao.id === macro.id) {
      return {
        tipo: "macro",
        id: macro.id,
        nome: macro.nome,
        pesoAlvo: macro.pesoAlvo,
        pesoReal: macro.pesoReal,
        desvio: macro.desvio,
        pesoAlvoGlobal: macro.pesoAlvoGlobal,
        pesoRealGlobal: macro.pesoRealGlobal,
        valorAtual: macro.valorAtual,
        caminho: [],
        filhos: macro.classes.map(paraFilhoClasse),
        rotuloFilhos: "Classes",
        ehFolha: false,
        filhosEditaveisAqui: true,
        somaIrmaos: somaPesoAlvo(estrutura.macros) - macro.pesoAlvo,
      };
    }

    const caminhoMacro: ItemCaminho[] = [{ tipo: "macro", id: macro.id, nome: macro.nome, pesoAlvo: macro.pesoAlvo }];

    for (const classe of macro.classes) {
      if (selecao.tipo === "classe" && selecao.id === classe.id) {
        return {
          tipo: "classe",
          id: classe.id,
          nome: classe.nome,
          pesoAlvo: classe.pesoAlvo,
          pesoReal: classe.pesoReal,
          desvio: classe.desvio,
          pesoAlvoGlobal: classe.pesoAlvoGlobal,
          pesoRealGlobal: classe.pesoRealGlobal,
          valorAtual: classe.valorAtual,
          caminho: caminhoMacro,
          filhos: classe.setores.map(paraFilhoSetor),
          rotuloFilhos: "Setores",
          ehFolha: false,
          filhosEditaveisAqui: true,
          somaIrmaos: somaPesoAlvo(macro.classes) - classe.pesoAlvo,
        };
      }

      const caminhoClasse: ItemCaminho[] = [
        ...caminhoMacro,
        { tipo: "classe", id: classe.id, nome: classe.nome, pesoAlvo: classe.pesoAlvo },
      ];

      for (const setor of classe.setores) {
        if (selecao.tipo === "setor" && selecao.id === setor.id) {
          return {
            tipo: "setor",
            id: setor.id,
            nome: setor.nome,
            pesoAlvo: setor.pesoAlvo,
            pesoReal: setor.pesoReal,
            desvio: setor.desvio,
            pesoAlvoGlobal: setor.pesoAlvoGlobal,
            pesoRealGlobal: setor.pesoRealGlobal,
            valorAtual: setor.valorAtual,
            caminho: caminhoClasse,
            filhos: setor.ativos.map(paraFilhoAtivo),
            rotuloFilhos: "Ativos",
            ehFolha: false,
            filhosEditaveisAqui: false, // Ativos são geridos na aba Ativos, não aqui (§16.2.13)
            somaIrmaos: somaPesoAlvo(classe.setores) - setor.pesoAlvo,
          };
        }

        const caminhoSetor: ItemCaminho[] = [
          ...caminhoClasse,
          { tipo: "setor", id: setor.id, nome: setor.nome, pesoAlvo: setor.pesoAlvo },
        ];

        for (const ativo of setor.ativos) {
          if (selecao.tipo === "ativo" && selecao.id === ativo.id) {
            return {
              tipo: "ativo",
              id: ativo.id,
              nome: ativo.nome ?? ativo.ticker,
              pesoAlvo: ativo.pesoAlvo,
              pesoReal: ativo.pesoReal,
              desvio: ativo.desvio,
              pesoAlvoGlobal: ativo.pesoAlvoGlobal,
              pesoRealGlobal: ativo.pesoRealGlobal,
              valorAtual: ativo.valorAtual,
              caminho: caminhoSetor,
              filhos: [],
              rotuloFilhos: "",
              ehFolha: true,
              filhosEditaveisAqui: false,
              somaIrmaos: somaPesoAlvo(setor.ativos) - ativo.pesoAlvo,
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Soma dos pesos-alvo dos filhos + status textual (completo/incompleto/
 * excedido/vazio) — usado tanto pelo badge da árvore quanto pelo indicador
 * permanente de distribuição do painel contextual (fase 4, §8.53/§16.2.7).
 * "Incompleto" nunca bloqueia salvamento (é condição intermediária válida);
 * "Excedido" é o único status que bloqueia — o bloqueio de verdade acontece
 * nos formulários (`somaOutros` prop de FormMacro/FormClasse/FormSetor),
 * que fazem essa mesma conta de forma preventiva enquanto o usuário digita,
 * antes mesmo de tentar salvar.
 */
export function statusSomaFilhos(filhos: { pesoAlvo: number }[]): {
  soma: number;
  status: "completo" | "incompleto" | "excedido" | "vazio";
} {
  if (filhos.length === 0) return { soma: 0, status: "vazio" };
  const soma = filhos.reduce((s, f) => s + f.pesoAlvo, 0);
  if (soma > 100.01) return { soma, status: "excedido" };
  if (soma < 99.99) return { soma, status: "incompleto" };
  return { soma, status: "completo" };
}
