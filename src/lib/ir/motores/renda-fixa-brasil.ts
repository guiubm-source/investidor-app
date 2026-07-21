import Decimal from "decimal.js";
import type { MemoriaConsumoLote } from "../ledger/fifo-dias-renda-fixa";

/**
 * Motor de renda fixa DIRETA Brasil — fase 6 do §8.32.37 (escopo decidido
 * com o Guilherme: só CDB/Tesouro/Debênture/LCI/LCA/CRI/CRA no motor novo;
 * fundos — curto/longo prazo/ações — e come-cotas ficam para uma fase
 * futura, ver docs/MAPA-DE-DADOS.md §8.41). Motor PURO (sem acesso a banco/
 * rede), `decimal.js` pelos mesmos motivos das fases anteriores (§8.32.32).
 *
 * Diferença estrutural em relação ao motor de renda variável (fase 4): não
 * há compensação de prejuízo entre lançamentos. Isso não é uma
 * simplificação — é a regra: cada resgate de renda fixa tem IRRF definitivo
 * retido na fonte pela instituição no ato, não existe "ficha de renda
 * variável" nem apuração mensal com compensação de prejuízo de meses
 * anteriores pra este tipo de ativo (diferente de ação/FII). Um resgate com
 * prejuízo simplesmente não gera IRRF — não abate ganho de outro resgate.
 * Mesmo comportamento do motor antigo (`lib/ir/actions.ts`), preservado
 * aqui.
 */

export type GrupoFiscalRendaFixa = "renda_fixa_tributavel" | "renda_fixa_isenta";

export const LABEL_GRUPO_FISCAL_RENDA_FIXA: Record<GrupoFiscalRendaFixa, string> = {
  renda_fixa_tributavel: "Renda fixa tributável (CDB/Tesouro/Debênture)",
  renda_fixa_isenta: "Renda fixa isenta (LCI/LCA/CRI/CRA)",
};

export type VendaParaApuracaoRendaFixa = {
  transacaoId: string;
  anoMes: string;
  vendaTotalBruta: Decimal;
  resultadoRealizado: Decimal;
  diasMediosRetencao: Decimal | null;
  memoriaLotes: MemoriaConsumoLote[];
};

export type AtivoParaApuracaoRendaFixa = {
  ativoId: string;
  ativoTicker: string;
  grupo: GrupoFiscalRendaFixa;
  vendas: VendaParaApuracaoRendaFixa[];
};

/** Tabela regressiva (§8.32.17.5), parametrizada — nunca hardcoded (mesma seed de fase 1, schema.sql §21.7: `renda_fixa.regressiva_*`). */
export type ParametrosRendaFixaBrasil = {
  aliquotaAte180Dias: Decimal;
  aliquotaAte360Dias: Decimal;
  aliquotaAte720Dias: Decimal;
  aliquotaAcima720Dias: Decimal;
};

/**
 * Uma venda (resgate) individual já classificada e com faixa/alíquota
 * resolvida — mantida por resgate (não agregada por mês) porque o IRRF de
 * renda fixa é definitivo POR EVENTO, e a faixa da tabela regressiva pode
 * variar de resgate pra resgate mesmo dentro do mesmo mês/ativo (lotes com
 * prazos diferentes). A agregação mensal (`LinhaMensalRendaFixa`, pro
 * formato que a tela hoje espera) vem depois, como uma segunda camada — ver
 * comentário em `agruparPorMes`.
 */
export type ResgateApuradoRendaFixa = {
  ativoId: string;
  ativoTicker: string;
  transacaoId: string;
  grupo: GrupoFiscalRendaFixa;
  anoMes: string;
  vendaTotalBruta: Decimal;
  lucroBruto: Decimal;
  baseCalculo: Decimal;
  isento: boolean;
  motivoIsencao: string | null;
  diasMediosRetencao: Decimal | null;
  aliquota: Decimal | null;
  /** Sempre `null` pra tributável (retido na fonte automaticamente, sem DARF — não entra na consolidação de DARF da fase 5) e `0` pra isenta. */
  impostoDevido: Decimal | null;
  memoriaLotes: MemoriaConsumoLote[];
};

/** Linha agregada por (grupo, mês) — mesmo formato que `LinhaMensal` (actions.ts) já espera, pra uma futura fase 6b conectar na tela igual fez a 4b. */
export type LinhaMensalRendaFixa = {
  grupo: GrupoFiscalRendaFixa;
  anoMes: string;
  vendaTotalBruta: Decimal;
  lucroBruto: Decimal;
  baseCalculo: Decimal;
  isento: boolean;
  motivoIsencao: string | null;
  /** Média simples dos `diasMediosRetencao` válidos dos resgates do mês — mesma convenção do motor antigo (não ponderada por valor, só por contagem de resgates). */
  diasMediosRetencao: Decimal | null;
  /** `null` quando o mês mistura resgates de faixas diferentes (não há uma alíquota única representativa) — ver `resgates` pra detalhe por evento. */
  aliquota: Decimal | null;
  impostoDevido: Decimal | null;
  /** Detalhe por resgate — preservado na linha mensal pra nunca perder a memória de cálculo por evento só porque a tela mostra o agregado (§8.32.38). */
  resgates: ResgateApuradoRendaFixa[];
};

export type ResultadoRendaFixaBrasil = {
  resgates: ResgateApuradoRendaFixa[];
  mensal: LinhaMensalRendaFixa[];
};

function aliquotaPorDias(dias: Decimal, p: ParametrosRendaFixaBrasil): Decimal {
  if (dias.lessThanOrEqualTo(180)) return p.aliquotaAte180Dias;
  if (dias.lessThanOrEqualTo(360)) return p.aliquotaAte360Dias;
  if (dias.lessThanOrEqualTo(720)) return p.aliquotaAte720Dias;
  return p.aliquotaAcima720Dias;
}

function apurarResgate(
  ativo: AtivoParaApuracaoRendaFixa,
  venda: VendaParaApuracaoRendaFixa,
  parametros: ParametrosRendaFixaBrasil
): ResgateApuradoRendaFixa {
  const base = {
    ativoId: ativo.ativoId,
    ativoTicker: ativo.ativoTicker,
    transacaoId: venda.transacaoId,
    grupo: ativo.grupo,
    anoMes: venda.anoMes,
    vendaTotalBruta: venda.vendaTotalBruta,
    lucroBruto: venda.resultadoRealizado,
    diasMediosRetencao: venda.diasMediosRetencao,
    memoriaLotes: venda.memoriaLotes,
  };

  if (ativo.grupo === "renda_fixa_isenta") {
    return {
      ...base,
      baseCalculo: new Decimal(0),
      isento: true,
      motivoIsencao: "LCI/LCA/CRI/CRA são isentos de IR para pessoa física",
      aliquota: null,
      impostoDevido: new Decimal(0),
    };
  }

  const aliquota = venda.diasMediosRetencao !== null ? aliquotaPorDias(venda.diasMediosRetencao, parametros) : null;
  return {
    ...base,
    baseCalculo: Decimal.max(0, venda.resultadoRealizado),
    isento: false,
    motivoIsencao: null,
    aliquota,
    // Retido na fonte automaticamente pela instituição no ato do resgate —
    // não é um débito que o usuário recolhe via DARF (diferente de renda
    // variável, fase 5). `null` aqui tem o mesmo sentido que já tinha no
    // motor antigo: "valor informativo, não uma cobrança pendente".
    impostoDevido: null,
  };
}

/** Agrega resgates por (grupo, anoMes) pro formato que a tela hoje consome — mesma convenção do motor antigo (`actions.ts`, linhas ~445-449). */
function agruparPorMes(resgates: ResgateApuradoRendaFixa[]): LinhaMensalRendaFixa[] {
  const porChave = new Map<string, ResgateApuradoRendaFixa[]>();
  for (const r of resgates) {
    const chave = `${r.grupo}|${r.anoMes}`;
    const lista = porChave.get(chave) ?? [];
    lista.push(r);
    porChave.set(chave, lista);
  }

  const linhas: LinhaMensalRendaFixa[] = [];
  for (const [, doMes] of porChave) {
    const { grupo, anoMes } = doMes[0];
    const vendaTotalBruta = doMes.reduce((s, r) => s.plus(r.vendaTotalBruta), new Decimal(0));
    const lucroBruto = doMes.reduce((s, r) => s.plus(r.lucroBruto), new Decimal(0));
    const baseCalculo = doMes.reduce((s, r) => s.plus(r.baseCalculo), new Decimal(0));
    const impostoDevido = doMes.some((r) => r.impostoDevido === null)
      ? null
      : doMes.reduce((s, r) => s.plus(r.impostoDevido ?? new Decimal(0)), new Decimal(0));

    const diasValidos = doMes.map((r) => r.diasMediosRetencao).filter((d): d is Decimal => d !== null);
    const diasMediosRetencao =
      diasValidos.length > 0
        ? diasValidos.reduce((s, d) => s.plus(d), new Decimal(0)).dividedBy(diasValidos.length)
        : null;

    const aliquotasDistintas = new Set(doMes.map((r) => (r.aliquota ? r.aliquota.toString() : "null")));
    const aliquota = aliquotasDistintas.size === 1 ? doMes[0].aliquota : null;

    linhas.push({
      grupo,
      anoMes,
      vendaTotalBruta,
      lucroBruto,
      baseCalculo,
      isento: doMes[0].isento,
      motivoIsencao: doMes[0].motivoIsencao,
      diasMediosRetencao,
      aliquota,
      impostoDevido,
      resgates: doMes,
    });
  }

  linhas.sort((a, b) => (a.anoMes === b.anoMes ? a.grupo.localeCompare(b.grupo) : a.anoMes < b.anoMes ? -1 : 1));
  return linhas;
}

/**
 * Apura todos os resgates de renda fixa direta do usuário (todos os ativos,
 * todo o histórico) — sem compensação de prejuízo (ver comentário no topo
 * do arquivo), então diferente do motor de renda variável não precisa
 * processar em ordem cronológica acumulando estado entre meses: cada resgate
 * é independente.
 */
export function apurarRendaFixaBrasil(
  ativos: AtivoParaApuracaoRendaFixa[],
  parametros: ParametrosRendaFixaBrasil
): ResultadoRendaFixaBrasil {
  const resgates: ResgateApuradoRendaFixa[] = [];
  for (const ativo of ativos) {
    for (const venda of ativo.vendas) {
      resgates.push(apurarResgate(ativo, venda, parametros));
    }
  }
  resgates.sort((a, b) => (a.anoMes === b.anoMes ? a.transacaoId.localeCompare(b.transacaoId) : a.anoMes < b.anoMes ? -1 : 1));

  return { resgates, mensal: agruparPorMes(resgates) };
}
