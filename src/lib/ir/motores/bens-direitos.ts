import Decimal from "decimal.js";
import type { LinhaLedgerFiscal } from "../ledger/construir-ledger";

/**
 * Motor de Bens e Direitos — fase 9 do §8.32.37 (ver docs/MAPA-DE-DADOS.md
 * §8.43). Escopo decidido com o Guilherme: combina itens MANUAIS (imóveis,
 * veículos, contas, participações societárias não listadas — vêm prontos
 * de `ir_bens_direitos_manuais`, ver `lib/ir/consultas/bens-direitos.ts`)
 * com os investimentos que o app já sabe calcular (ações, FIIs, renda
 * fixa direta, ativos internacionais) — nunca duplicando esses últimos em
 * tabela nova (fonte única de verdade, §3).
 *
 * Motor PURO (sem acesso a banco/rede). `decimal.js` pelos mesmos motivos
 * das fases anteriores (§8.32.32) — a "situação patrimonial" de um ativo
 * numa data de corte é lida diretamente do ledger fiscal (fase 3), que já
 * trabalha inteiramente em Decimal.
 *
 * Regra central (§8.32.20.7/§8.32.18.3): Bens e Direitos declara pelo CUSTO
 * DE AQUISIÇÃO acumulado (o que o ledger fiscal chama de `custoTotal`),
 * NUNCA valor de mercado — mesmo princípio já usado pro exterior (fase 7).
 */

export type GrupoCodigoBensDireitos = { grupo: string; codigo: string; label: string };

export type ItemBensDireitos = {
  origem: "manual" | "investimento";
  grupo: string;
  codigo: string;
  nome: string;
  localizacao: string | null;
  cpfCnpj: string | null;
  discriminacao: string | null;
  situacaoAnterior: Decimal;
  situacaoAtual: Decimal;
  observacoes: string | null;
  /** Só relevante pra manuais — itens de investimento são recalculados do zero a cada leitura, não têm "revisão" persistida. */
  statusRevisao: "pendente" | "revisado" | null;
  /** Só presente pra origem="investimento" — permite linkar de volta pro ativo/Posição. */
  ativoId: string | null;
  /** Só presente pra origem="manual" — permite editar/excluir o registro em `ir_bens_direitos_manuais`. */
  manualId: string | null;
};

export type AtivoParaBensDireitos = {
  ativoId: string;
  ativoTicker: string;
  /** Só os 4 tipos cobertos nesta fase — quem monta essa lista (consulta) já filtrou o resto. */
  tipo: "acao" | "fii" | "renda_fixa" | "internacional";
  subtipoRendaFixa: string | null;
  /** `null`/"Brasil" implícito pros tipos domésticos; string explícita (ex. "Exterior") só pra internacional. */
  localizacao: string | null;
  /** Linhas do ledger fiscal do ativo, JÁ ordenadas cronologicamente (mesma saída de `construirLedgerFiscal`). */
  linhasLedger: LinhaLedgerFiscal[];
};

const SUBTIPOS_RENDA_FIXA_ISENTOS = ["lci", "lca", "cri", "cra"];

/**
 * Resolve grupo/código oficial pra um ativo de investimento, usando dado
 * que o app já tem cadastrado (tipo + subtipo de renda fixa) — `null` se o
 * tipo não tiver mapeamento coberto nesta fase (fundo genérico sem
 * subtipo distintivo, cripto — explicitamente fora do escopo por decisão
 * do Guilherme de pular a fase 8 — e `outro`).
 *
 * `internacional` usa o MESMO código de ações domésticas (Grupo 03, Código
 * 01 — "Ações, inclusive as listadas em bolsa") porque, no padrão oficial,
 * é o campo "Localização (País)" de cada item que diferencia bem doméstico
 * de bem no exterior, não um código separado.
 */
export function resolverGrupoCodigoAtivo(
  tipo: AtivoParaBensDireitos["tipo"],
  subtipoRendaFixa: string | null
): { grupo: string; codigo: string } | null {
  switch (tipo) {
    case "acao":
    case "internacional":
      return { grupo: "03", codigo: "01" };
    case "fii":
      return { grupo: "07", codigo: "03" };
    case "renda_fixa":
      return SUBTIPOS_RENDA_FIXA_ISENTOS.includes(subtipoRendaFixa ?? "")
        ? { grupo: "04", codigo: "03" } // Títulos isentos (LCI/LCA/CRI/CRA e outros)
        : { grupo: "04", codigo: "02" }; // Títulos sujeitos à tributação (Tesouro/CDB/RDB e outros)
    default:
      return null;
  }
}

/**
 * Custo total acumulado (situação patrimonial) de um ativo numa data de
 * corte — pega a última linha do ledger fiscal com `data <= dataCorte`
 * (linhas já vêm ordenadas cronologicamente); `0` se nenhuma linha anterior
 * ou na própria data existir ainda (ativo comprado depois da data de
 * corte).
 */
export function custoTotalNaData(linhasLedger: LinhaLedgerFiscal[], dataCorte: string): Decimal {
  let resultado = new Decimal(0);
  for (const linha of linhasLedger) {
    if (linha.data > dataCorte) break;
    resultado = linha.custoTotalDepois;
  }
  return resultado;
}

/**
 * Monta o item de Bens e Direitos de UM ativo de investimento, comparando
 * a situação em 31/12 do ano anterior com a do ano corrente da declaração.
 * Devolve `null` quando o ativo não tem mapeamento de grupo/código coberto
 * OU quando não havia posição em NENHUMA das duas datas (nunca chegou a
 * existir no período relevante) — mas NÃO quando só a atual é zero: um
 * ativo vendido/zerado no ano ainda precisa aparecer pra refletir a baixa
 * (§8.32.20.7).
 */
export function montarItemInvestimento(
  ativo: AtivoParaBensDireitos,
  anoAnterior: number,
  anoAtual: number
): ItemBensDireitos | null {
  const grupoCodigo = resolverGrupoCodigoAtivo(ativo.tipo, ativo.subtipoRendaFixa);
  if (!grupoCodigo) return null;

  const situacaoAnterior = custoTotalNaData(ativo.linhasLedger, `${anoAnterior}-12-31`);
  const situacaoAtual = custoTotalNaData(ativo.linhasLedger, `${anoAtual}-12-31`);

  if (situacaoAnterior.equals(0) && situacaoAtual.equals(0)) return null;

  return {
    origem: "investimento",
    grupo: grupoCodigo.grupo,
    codigo: grupoCodigo.codigo,
    nome: ativo.ativoTicker,
    localizacao: ativo.localizacao,
    cpfCnpj: null,
    discriminacao: `${ativo.ativoTicker} — posição consolidada da Carteira (custo de aquisição acumulado, não valor de mercado).`,
    situacaoAnterior,
    situacaoAtual,
    observacoes: null,
    statusRevisao: null,
    ativoId: ativo.ativoId,
    manualId: null,
  };
}

/** Junta itens manuais (já prontos) com os itens de investimento derivados dos ativos, ordenando por grupo/código. */
export function montarBensDireitos(
  itensManuais: ItemBensDireitos[],
  ativos: AtivoParaBensDireitos[],
  anoAnterior: number,
  anoAtual: number
): ItemBensDireitos[] {
  const itensInvestimento = ativos
    .map((a) => montarItemInvestimento(a, anoAnterior, anoAtual))
    .filter((i): i is ItemBensDireitos => i !== null);

  const todos = [...itensManuais, ...itensInvestimento];
  todos.sort((a, b) => (a.grupo === b.grupo ? a.codigo.localeCompare(b.codigo) : a.grupo.localeCompare(b.grupo)));
  return todos;
}
