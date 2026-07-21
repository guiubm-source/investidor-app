import Decimal from "decimal.js";
import type { StatusClassificacaoDayTrade } from "../ledger/classificar-day-trade";

/**
 * Motor de apuração mensal de renda variável Brasil — ações/fundos (swing e
 * day trade) e FII — fase 4 do §8.32.37 (ver docs/MAPA-DE-DADOS.md §8.38).
 *
 * Escopo desta fase (decidido com o Guilherme): só ações/fundos e FII —
 * renda fixa (fase 6), exterior (fase 7) e cripto/derivativos (fase 8) ficam
 * de fora. IRRF como crédito (`ir_retencoes`) e DARF (fase 5) também ficam
 * de fora — nada ainda popula `ir_retencoes`, então não haveria crédito
 * nenhum pra aplicar mesmo se o motor tentasse.
 *
 * Motor PURO (sem acesso a banco/rede) — recebe as vendas já processadas
 * pelo ledger fiscal (fase 3, `construir-ledger.ts`) e já classificadas por
 * day trade (fase 3, `classificar-day-trade.ts`), mais os parâmetros de
 * regra versionados (fase 1). Não reimplementa custo médio nem pareamento
 * de day trade — só consome (invariante §8.32.31 item 3 do doc mestre:
 * "nenhum cálculo reimplementa custo médio fora do motor comum").
 *
 * `decimal.js` pelos mesmos motivos das fases anteriores (§8.32.32).
 */

export type GrupoFiscalRendaVariavel = "acao_swing" | "acao_day" | "fii";

export const LABEL_GRUPO_FISCAL_RENDA_VARIAVEL: Record<GrupoFiscalRendaVariavel, string> = {
  acao_swing: "Ações/fundos — swing trade",
  acao_day: "Ações/fundos — day trade",
  fii: "FIIs — venda de cotas",
};

/**
 * Uma venda já processada — resultado e valor bruto vêm do ledger fiscal
 * (`LinhaLedgerFiscal.resultadoRealizado`/`valorVendaBruto`), a quebra
 * day trade/comum vem do classificador (`ResultadoClassificacaoDayTrade`).
 * Para ativos `fii`, `quantidadeDayTrade`/`quantidadeComum`/`statusDayTrade`
 * são ignorados (FII não tem distinção day trade/swing, §8.32.17.3) — quem
 * monta o input pode preencher com qualquer valor, mas a convenção é
 * `quantidadeComum = quantidadeTotal`, `quantidadeDayTrade = 0`,
 * `statusDayTrade = "nao_aplicavel"`.
 */
export type VendaParaApuracaoRendaVariavel = {
  transacaoId: string;
  anoMes: string;
  quantidadeTotal: Decimal;
  vendaTotalBruta: Decimal;
  resultadoRealizado: Decimal;
  quantidadeDayTrade: Decimal;
  quantidadeComum: Decimal;
  statusDayTrade: StatusClassificacaoDayTrade;
};

export type AtivoParaApuracaoRendaVariavel = {
  ativoId: string;
  ativoTicker: string;
  /** `acao_fundo` cobre `ativos.tipo in (acao, fundo)` — mesma regra fiscal, mesmo grupo. FII é regime à parte. */
  tipoRegime: "acao_fundo" | "fii";
  vendas: VendaParaApuracaoRendaVariavel[];
};

export type ParametrosRendaVariavelBrasil = {
  isencaoSwingLimiteMensal: Decimal;
  aliquotaSwing: Decimal;
  aliquotaDayTrade: Decimal;
  aliquotaFii: Decimal;
};

export type LinhaMensalRendaVariavel = {
  grupo: GrupoFiscalRendaVariavel;
  anoMes: string;
  vendaTotalBruta: Decimal;
  lucroBruto: Decimal;
  /** Sempre >= 0 — quanto de prejuízo de meses/anos anteriores foi usado neste mês (mesmo campo/semântica de `LinhaMensal.prejuizoAnteriorAplicado` no motor antigo, §8.11). */
  prejuizoAnteriorAplicado: Decimal;
  /** Base após compensação de prejuízo, nunca negativa (se negativa, vira prejuízo do mês — ver `prejuizoSaldoFinal`). */
  baseCalculo: Decimal;
  isento: boolean;
  motivoIsencao: string | null;
  aliquota: Decimal | null;
  impostoDevido: Decimal | null;
  /** Saldo de prejuízo que SOBRA depois deste mês (sempre <= 0) — carregado pro próximo mês da mesma categoria, sem prazo de expiração (§8.32.23). */
  prejuizoSaldoFinal: Decimal;
  /**
   * true quando pelo menos uma venda deste ativo+mês não pôde ser
   * classificada com segurança (day trade pendente) — o valor dela NÃO
   * entra em `vendaTotalBruta`/`lucroBruto` (fato pendente não entra no
   * cálculo, §8.32.31 item 8), só é sinalizado aqui pra abrir pendência
   * numa fase futura (`ir_pendencias` — ver dívida técnica em §8.38).
   */
  pendente: boolean;
  motivosPendencia: string[];
};

export type ResultadoRendaVariavelBrasil = {
  mensal: LinhaMensalRendaVariavel[];
};

const STATUS_BLOQUEIA_CALCULO: StatusClassificacaoDayTrade[] = [
  "pendente_horario",
  "pendente_corretora",
  "pendente_pareamento",
];

type AcumuladorMes = {
  vendaTotalBruta: Decimal;
  lucroBruto: Decimal;
  pendente: boolean;
  motivosPendencia: Set<string>;
};

function novoAcumulador(): AcumuladorMes {
  return { vendaTotalBruta: new Decimal(0), lucroBruto: new Decimal(0), pendente: false, motivosPendencia: new Set() };
}

/**
 * Divide o resultado/valor bruto de UMA venda entre day trade e comum,
 * proporcionalmente à quantidade de cada lado — mesma base de custo médio
 * já usada pro cálculo total (não há um "preço médio diferente" pro pedaço
 * day trade vs. o pedaço comum, então a divisão proporcional é a forma
 * consistente de repartir sem reprocessar nada do ledger).
 */
function dividirProporcional(
  venda: VendaParaApuracaoRendaVariavel
): { dayTrade: { vendaTotalBruta: Decimal; resultado: Decimal }; comum: { vendaTotalBruta: Decimal; resultado: Decimal } } {
  if (venda.quantidadeTotal.lessThanOrEqualTo(0)) {
    return {
      dayTrade: { vendaTotalBruta: new Decimal(0), resultado: new Decimal(0) },
      comum: { vendaTotalBruta: new Decimal(0), resultado: new Decimal(0) },
    };
  }
  const fracaoDayTrade = venda.quantidadeDayTrade.dividedBy(venda.quantidadeTotal);
  const fracaoComum = venda.quantidadeComum.dividedBy(venda.quantidadeTotal);
  return {
    dayTrade: {
      vendaTotalBruta: venda.vendaTotalBruta.times(fracaoDayTrade),
      resultado: venda.resultadoRealizado.times(fracaoDayTrade),
    },
    comum: {
      vendaTotalBruta: venda.vendaTotalBruta.times(fracaoComum),
      resultado: venda.resultadoRealizado.times(fracaoComum),
    },
  };
}

/**
 * Apura a renda variável Brasil (ações/fundos + FII) de todos os ativos
 * informados, mês a mês, com compensação de prejuízo entre meses/anos por
 * grupo fiscal. Devolve o histórico MENSAL COMPLETO (não filtrado por ano)
 * — quem for montar um relatório por exercício filtra depois; a
 * compensação de prejuízo precisa do histórico inteiro pra ficar correta
 * (prejuízo de renda variável não prescreve, §8.11/§8.32.23).
 */
export function apurarRendaVariavelBrasil(
  ativos: AtivoParaApuracaoRendaVariavel[],
  parametros: ParametrosRendaVariavelBrasil
): ResultadoRendaVariavelBrasil {
  // Acumula por (grupo, anoMes) somando todos os ativos.
  const porGrupoMes = new Map<string, AcumuladorMes>();
  const chave = (grupo: GrupoFiscalRendaVariavel, anoMes: string) => `${grupo}|${anoMes}`;
  const obterAcumulador = (grupo: GrupoFiscalRendaVariavel, anoMes: string) => {
    const k = chave(grupo, anoMes);
    let acc = porGrupoMes.get(k);
    if (!acc) {
      acc = novoAcumulador();
      porGrupoMes.set(k, acc);
    }
    return acc;
  };

  for (const ativo of ativos) {
    for (const venda of ativo.vendas) {
      if (ativo.tipoRegime === "fii") {
        const acc = obterAcumulador("fii", venda.anoMes);
        acc.vendaTotalBruta = acc.vendaTotalBruta.plus(venda.vendaTotalBruta);
        acc.lucroBruto = acc.lucroBruto.plus(venda.resultadoRealizado);
        continue;
      }

      // acao_fundo
      if (STATUS_BLOQUEIA_CALCULO.includes(venda.statusDayTrade)) {
        // Fato pendente não entra no cálculo (§8.32.31 item 8) — sinaliza
        // pendência nos DOIS grupos possíveis (swing e day), já que sem
        // classificação não dá pra saber qual dos dois seria afetado.
        const motivo = `Venda ${venda.transacaoId} em ${venda.anoMes}: day trade não classificado (${venda.statusDayTrade}).`;
        for (const grupo of ["acao_swing", "acao_day"] as const) {
          const acc = obterAcumulador(grupo, venda.anoMes);
          acc.pendente = true;
          acc.motivosPendencia.add(motivo);
        }
        continue;
      }

      const dividido = dividirProporcional(venda);
      if (venda.quantidadeDayTrade.greaterThan(0)) {
        const accDay = obterAcumulador("acao_day", venda.anoMes);
        accDay.vendaTotalBruta = accDay.vendaTotalBruta.plus(dividido.dayTrade.vendaTotalBruta);
        accDay.lucroBruto = accDay.lucroBruto.plus(dividido.dayTrade.resultado);
      }
      if (venda.quantidadeComum.greaterThan(0)) {
        const accSwing = obterAcumulador("acao_swing", venda.anoMes);
        accSwing.vendaTotalBruta = accSwing.vendaTotalBruta.plus(dividido.comum.vendaTotalBruta);
        accSwing.lucroBruto = accSwing.lucroBruto.plus(dividido.comum.resultado);
      }
    }
  }

  // Ledger de prejuízo por grupo, processando os meses em ordem cronológica
  // (mesmo princípio do motor antigo, §8.11: prejuízo de qualquer mês/ano
  // anterior abate lucro de qualquer mês/ano seguinte, sem prazo de
  // expiração — grupos NUNCA se misturam entre si).
  const grupos: GrupoFiscalRendaVariavel[] = ["acao_swing", "acao_day", "fii"];
  const mensal: LinhaMensalRendaVariavel[] = [];

  for (const grupo of grupos) {
    const mesesDoGrupo = [...porGrupoMes.entries()]
      .filter(([k]) => k.startsWith(`${grupo}|`))
      .map(([k, acc]) => ({ anoMes: k.split("|")[1], acc }))
      .sort((a, b) => (a.anoMes < b.anoMes ? -1 : a.anoMes > b.anoMes ? 1 : 0));

    let prejuizoAcumulado = new Decimal(0); // sempre <= 0

    for (const { anoMes, acc } of mesesDoGrupo) {
      const prejuizoAnterior = prejuizoAcumulado; // <= 0
      const baseAntesCompensacao = acc.lucroBruto.plus(prejuizoAnterior);

      let isento = false;
      let motivoIsencao: string | null = null;
      if (grupo === "acao_swing" && baseAntesCompensacao.greaterThan(0) && acc.vendaTotalBruta.lessThanOrEqualTo(parametros.isencaoSwingLimiteMensal)) {
        isento = true;
        motivoIsencao = `Vendas do mês ≤ ${parametros.isencaoSwingLimiteMensal.toString()} (isenção swing trade em ações)`;
      }

      let impostoDevido: Decimal | null = null;
      let aliquota: Decimal | null = null;
      let prejuizoSaldoFinal: Decimal;

      if (acc.pendente) {
        // Enquanto pendente, não decide nada sobre este mês — nem isenta,
        // nem tributa, nem consome/gera prejuízo. O saldo de prejuízo
        // simplesmente não muda até a pendência ser resolvida.
        prejuizoSaldoFinal = prejuizoAnterior;
      } else if (baseAntesCompensacao.lessThanOrEqualTo(0)) {
        prejuizoSaldoFinal = baseAntesCompensacao;
      } else if (isento) {
        prejuizoSaldoFinal = new Decimal(0);
      } else {
        aliquota = grupo === "acao_day" ? parametros.aliquotaDayTrade : grupo === "fii" ? parametros.aliquotaFii : parametros.aliquotaSwing;
        impostoDevido = baseAntesCompensacao.times(aliquota);
        prejuizoSaldoFinal = new Decimal(0);
      }

      prejuizoAcumulado = prejuizoSaldoFinal;

      mensal.push({
        grupo,
        anoMes,
        vendaTotalBruta: acc.vendaTotalBruta,
        lucroBruto: acc.lucroBruto,
        // O saldo de prejuízo anterior (sempre <= 0) é sempre integralmente
        // somado ao lucro bruto pra formar a base do mês (nunca aplicado
        // "parcialmente") — o que sobra negativo vira o novo saldo
        // (`prejuizoSaldoFinal`). Mesma convenção do motor antigo (§8.11).
        prejuizoAnteriorAplicado: acc.pendente ? new Decimal(0) : prejuizoAnterior.negated(),
        baseCalculo: Decimal.max(0, baseAntesCompensacao),
        isento,
        motivoIsencao,
        aliquota,
        impostoDevido,
        prejuizoSaldoFinal,
        pendente: acc.pendente,
        motivosPendencia: [...acc.motivosPendencia],
      });
    }
  }

  mensal.sort((a, b) => (a.anoMes === b.anoMes ? a.grupo.localeCompare(b.grupo) : a.anoMes < b.anoMes ? -1 : 1));

  return { mensal };
}
