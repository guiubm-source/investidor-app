import type { EstruturaAlocacao, MacroNode, ClasseNode, SetorNode, AtivoNode } from "@/lib/alocacao/actions";

/**
 * Helpers puros de navegação da árvore Macro>Classe>Setor>Ativo (fase 3 da
 * reformulação "Metas e estrutura", §8.50/§8.51/§8.52) — nenhuma chamada de
 * rede aqui, só resolve/percorre a `EstruturaAlocacao` já carregada em
 * memória pra alimentar a árvore (esquerda) e o painel contextual
 * (direita). Mantido fora de `actions.ts` (que é `"use server"`) porque isso
 * roda inteiramente no client, a cada clique de seleção.
 */

/**
 * `naoClassificado` (fase 6, §8.55/§16.2.14): pseudo-tipo pro bucket runtime
 * de Ativos sem `setor_id` — nunca é uma linha real em `alocacao_macros`,
 * não tem formulário de edição/exclusão, e por isso fica de fora dos
 * `Record<Exclude<TipoNo, "raiz" | "ativo">, ...>` usados pro CRUD normal
 * (ver `PainelContextual.tsx`) — todo lugar que monta esses Records precisa
 * também excluir `"naoClassificado"`.
 */
export type TipoNo = "raiz" | "macro" | "classe" | "setor" | "ativo" | "naoClassificado";

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
  /**
   * Quantidade de filhos DIRETOS deste filho (ex.: quantos Setores tem essa
   * Classe) — usado na fase 5 (§8.54/§16.2.12) pra avisar o impacto antes de
   * excluir um nó com descendentes ("isso vai apagar 3 Setores também" ou
   * oferecer a opção de mover esses descendentes pra outro pai).
   */
  qtdFilhosDiretos: number;
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
  /**
   * Bucket "Não classificado" (fase 6, §8.55/§16.2.14) — só preenchido pra
   * raiz (`null` em todo o resto), representando os Ativos sem `setor_id`
   * como um item extra e visualmente distinto ao lado dos Macros, sem
   * poluir `filhos` (que fica só com Macros de verdade, evitando ter que
   * tratar esse pseudo-item em todo lugar que já itera `filhos`).
   */
  naoClassificado: FilhoResolvido | null;
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
    qtdFilhosDiretos: c.setores.length,
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
    qtdFilhosDiretos: s.ativos.length,
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
    qtdFilhosDiretos: 0,
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
    qtdFilhosDiretos: m.classes.length,
  };
}

/** Representa o bucket "Não classificado" como um item de lista — só usado na raiz (§16.2.14). */
function paraFilhoNaoClassificado(estrutura: EstruturaAlocacao): FilhoResolvido {
  const valor = estrutura.naoClassificado.valorAtual;
  return {
    tipo: "naoClassificado",
    id: "nao-classificado",
    nome: "Não classificado",
    pesoAlvo: 0,
    pesoReal: 0,
    desvio: 0,
    pesoAlvoGlobal: 0,
    pesoRealGlobal: estrutura.patrimonioTotalInvestido > 0 ? (valor / estrutura.patrimonioTotalInvestido) * 100 : 0,
    valorAtual: valor,
    qtdFilhosDiretos: estrutura.naoClassificado.ativos.length,
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
      naoClassificado: estrutura.naoClassificado.valorAtual > 0 ? paraFilhoNaoClassificado(estrutura) : null,
    };
  }

  if (selecao.tipo === "naoClassificado") {
    return {
      tipo: "naoClassificado",
      id: null,
      nome: "Não classificado",
      pesoAlvo: null,
      pesoReal: null,
      desvio: null,
      pesoAlvoGlobal: 0,
      pesoRealGlobal:
        estrutura.patrimonioTotalInvestido > 0
          ? (estrutura.naoClassificado.valorAtual / estrutura.patrimonioTotalInvestido) * 100
          : 0,
      valorAtual: estrutura.naoClassificado.valorAtual,
      caminho: [],
      filhos: estrutura.naoClassificado.ativos.map(paraFilhoAtivo),
      rotuloFilhos: "Ativos",
      ehFolha: false,
      filhosEditaveisAqui: false,
      somaIrmaos: null,
      naoClassificado: null,
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
        naoClassificado: null,
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
          naoClassificado: null,
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
            naoClassificado: null,
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
              naoClassificado: null,
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

export type ItemDistribuicaoIgual = { id: string; nome: string; pesoAtual: number; pesoNovo: number };

/**
 * Calcula o novo peso-alvo de cada filho ao "distribuir o restante
 * igualmente" (ação principal, fase 5, §8.54/§16.2.8) — soma o restante
 * (100 - soma atual) dividido em partes iguais ao peso JÁ definido de cada
 * um (não reseta os valores atuais, decisão tomada explicitamente nesta
 * fase). O último item absorve o resíduo de arredondamento de centavos, pra
 * garantir que a soma final feche em exatamente 100.
 */
export function calcularDistribuicaoIgual(
  filhos: { id: string; nome: string; pesoAlvo: number }[]
): ItemDistribuicaoIgual[] {
  const n = filhos.length;
  if (n === 0) return [];
  const soma = filhos.reduce((s, f) => s + f.pesoAlvo, 0);
  const restante = 100 - soma;
  const parteBase = Math.round((restante / n) * 100) / 100;
  let acumulado = 0;
  return filhos.map((f, i) => {
    const parte = i < n - 1 ? parteBase : Math.round((restante - acumulado) * 100) / 100;
    acumulado += parte;
    return {
      id: f.id,
      nome: f.nome,
      pesoAtual: f.pesoAlvo,
      pesoNovo: Math.round((f.pesoAlvo + parte) * 100) / 100,
    };
  });
}
