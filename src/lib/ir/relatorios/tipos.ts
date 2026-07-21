import Decimal from "decimal.js";
import type { CardsPrincipaisIR } from "../motores/dashboard-fiscal";
import type { ItemBensDireitos } from "../motores/bens-direitos";
import type { LinhaMensalRendaVariavel } from "../motores/renda-variavel-brasil";
import type { LinhaMensalRendaFixa } from "../motores/renda-fixa-brasil";
import type { LinhaAnualExterior, AtivoComPendenciaExterior } from "../motores/exterior-lei-14754";
import type { ResultadoDarf } from "../motores/darf";

/**
 * Tipos do PDF final (fase 11 do §8.32.37, ver docs/MAPA-DE-DADOS.md §8.46).
 * Espelha a estrutura de 23 itens do §8.32.26. NENHUM cálculo fiscal novo
 * mora aqui — este módulo só formata/agrega o que os motores das fases
 * 3-10 já produzem, exatamente como `motores/dashboard-fiscal.ts` fez na
 * fase 10 (mesmo espírito, escala maior).
 */

export type StatusSecao = "disponivel" | "nao_disponivel";

/**
 * Generalização do padrão `CardValor` (fase 10) pra qualquer seção do PDF:
 * toda seção sem motor por trás aparece como `nao_disponivel` com o motivo
 * exato (qual fase/seção do mapa deferiu aquilo) — nunca aproximada ou
 * preenchida com zero. `avisos` são notas que aparecem mesmo quando
 * `disponivel`, pra deixar explícito o que aquela seção NÃO cobre ainda
 * (ex.: "não inclui proventos/dividendos").
 */
export type SecaoRelatorio<T> = {
  status: StatusSecao;
  dados: T | null;
  motivo: string | null;
  avisos: string[];
};

export type CapaRelatorio = {
  exercicio: number;
  anoCalendario: number;
  titularNome: string | null;
  titularCpf: string | null;
  /** ISO 8601 — momento em que o relatório foi montado. */
  dataGeracao: string;
  perfilResumo: string;
  versaoFiscalNome: string | null;
};

/**
 * Uma pendência já sinalizada por algum motor (renda variável fase 4: day
 * trade não classificado; exterior fase 7: câmbio faltando) — este item só
 * REAPRESENTA o que os motores já marcam como `pendente`/`motivosPendencia`,
 * não é uma tabela `ir_pendencias` real (essa tabela não tem gravador ainda,
 * ver dívida técnica §8.45).
 */
export type PendenciaRelatorio = {
  origem: "renda_variavel" | "exterior";
  referencia: string; // anoMes (renda variável) ou ticker do ativo (exterior)
  descricao: string;
  motivos: string[];
};

/** Uma linha do anexo de operações — detalhe por venda/resgate, extraído do ledger fiscal (fase 3) já calculado, sem reprocessar nada. */
export type OperacaoAnexo = {
  ativoId: string;
  ativoTicker: string;
  categoria: string;
  data: string;
  quantidade: Decimal;
  valorVendaBruto: Decimal;
  resultadoRealizado: Decimal;
};

export type RendimentosIsentosRelatorio = {
  rendaVariavelIsenta: LinhaMensalRendaVariavel[];
  rendaFixaIsenta: LinhaMensalRendaFixa[];
};

/**
 * Estrutura completa do PDF final, seguindo a ordem do §8.32.26. Os itens 1
 * (capa), 4 (versão de regras) e 8 (instruções) viram campos próprios da
 * capa/disclaimer/instruções — não fazem sentido como `SecaoRelatorio`
 * (sempre existem, não dependem de motor nenhum). O item 21 ("memória de
 * cálculo por regime") não é uma seção separada: cada seção de apuração
 * acima (renda fixa/variável/exterior) já carrega o detalhe linha a linha
 * (base de cálculo, alíquota, prejuízo aplicado) — decisão registrada em
 * `nota21MemoriaCalculo`, ver docs/MAPA-DE-DADOS.md §8.46.
 */
export type RelatorioCompletoIR = {
  capa: CapaRelatorio;
  disclaimer: string[];
  instrucoesUso: string[];
  resumoObrigatoriedade: SecaoRelatorio<null>;
  resumoDeclaracao: SecaoRelatorio<CardsPrincipaisIR>;
  pendencias: PendenciaRelatorio[];
  documentosSemComprovante: SecaoRelatorio<null>;
  bensDireitos: SecaoRelatorio<ItemBensDireitos[]>;
  rendimentosTributaveis: SecaoRelatorio<null>;
  rendimentosIsentos: SecaoRelatorio<RendimentosIsentosRelatorio>;
  tributacaoExclusiva: SecaoRelatorio<LinhaMensalRendaFixa[]>;
  rendaVariavelMensal: SecaoRelatorio<LinhaMensalRendaVariavel[]>;
  ganhoCapitalForaBolsa: SecaoRelatorio<null>;
  aplicacoesExterior: SecaoRelatorio<LinhaAnualExterior[]>;
  impostoPagoExteriorCredito: SecaoRelatorio<null>;
  pagamentosDeducoes: SecaoRelatorio<null>;
  dividas: SecaoRelatorio<null>;
  resumoDarfs: SecaoRelatorio<ResultadoDarf>;
  nota21MemoriaCalculo: string;
  anexoOperacoes: SecaoRelatorio<OperacaoAnexo[]>;
  anexoDocumentos: SecaoRelatorio<null>;
  ativosComPendenciaExterior: AtivoComPendenciaExterior[];
};
