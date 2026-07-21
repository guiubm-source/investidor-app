import Decimal from "decimal.js";

/**
 * Motor de consolidação de DARF — fase 5 do §8.32.37 (ver
 * docs/MAPA-DE-DADOS.md §8.40). Escopo desta fase (decidido com o
 * Guilherme): só a consolidação por código de receita + o ledger de valor
 * mínimo de R$10 que acumula entre competências (§8.32.24.2/§8.32.24.3).
 * Multa/juros de atraso (§8.32.24.4), geração de PDF e acompanhamento de
 * pagamento (§8.32.24.1/§8.32.24.5) ficam para uma fase futura.
 *
 * Motor PURO (sem acesso a banco/rede) — recebe o imposto devido mensal já
 * apurado pelo motor de renda variável (fase 4, `renda-variavel-brasil.ts`)
 * e o valor mínimo de recolhimento (parametrizado, fase 1). Não recalcula
 * nem reaproveita lógica de apuração — só consolida valores já prontos.
 *
 * `decimal.js` pelos mesmos motivos das fases anteriores (§8.32.32).
 */

/**
 * Uma "parcela" de imposto devido que precisa ser consolidada num DARF —
 * já filtrada por quem monta o input (só linhas com imposto devido
 * conhecido, não pendente, não isenta — ver `lib/ir/consultas/darf.ts`).
 */
export type ParcelaParaDarf = {
  grupo: string;
  anoMes: string;
  codigoReceita: string;
  valor: Decimal;
};

/** Uma parcela específica que compôs uma guia consolidada — pra memória de cálculo (§8.32.24.2 item 4). */
export type ParcelaNaMemoriaDarf = {
  grupo: string;
  anoMes: string;
  valor: Decimal;
};

export type GuiaDarfConsolidada = {
  codigoReceita: string;
  /** Competência (anoMes) em que o valor acumulado atingiu o mínimo — é o período de apuração da guia gerada. */
  competenciaGeracao: string;
  valorConsolidado: Decimal;
  /** Todas as parcelas (de 1 ou mais competências/grupos) que compuseram esta guia — pode incluir competências anteriores à `competenciaGeracao` (acumuladas por estarem abaixo do mínimo). */
  memoria: ParcelaNaMemoriaDarf[];
};

/** Valor acumulado de um código de receita que AINDA não atingiu o mínimo — não gera guia, mas fica visível pra transparência (§8.32.24.3: "quando atingir o mínimo, a memória lista todas as parcelas"). */
export type SaldoPendenteDarf = {
  codigoReceita: string;
  valorAcumulado: Decimal;
  memoria: ParcelaNaMemoriaDarf[];
};

export type ResultadoDarf = {
  guias: GuiaDarfConsolidada[];
  saldosPendentes: SaldoPendenteDarf[];
};

/**
 * Consolida parcelas de imposto devido em guias de DARF por código de
 * receita, aplicando a regra do valor mínimo (§8.32.24.3): parcelas de
 * competências diferentes do MESMO código de receita se acumulam até a
 * soma atingir `valorMinimo` — só então uma guia é "gerada" (aqui: emitida
 * no resultado), com memória de todas as parcelas que a compuseram. O que
 * não atingir o mínimo até a última competência disponível fica em
 * `saldosPendentes`, não vira guia.
 *
 * Parcelas de grupos DIFERENTES que compartilham o mesmo código de receita
 * na MESMA competência são somadas antes de entrar no acumulador (§8.32.24.2
 * item 1: "agrupar débitos por código de receita e período de apuração").
 */
export function consolidarDarf(parcelas: ParcelaParaDarf[], valorMinimo: Decimal): ResultadoDarf {
  // Passo 1: soma por (codigoReceita, anoMes), preservando a contribuição de
  // cada grupo pra memória.
  const porCodigo = new Map<string, Map<string, ParcelaNaMemoriaDarf[]>>();
  for (const p of parcelas) {
    if (p.valor.lessThanOrEqualTo(0)) continue; // só débito relevante, nunca negativo/zero aqui
    let porCompetencia = porCodigo.get(p.codigoReceita);
    if (!porCompetencia) {
      porCompetencia = new Map();
      porCodigo.set(p.codigoReceita, porCompetencia);
    }
    const lista = porCompetencia.get(p.anoMes) ?? [];
    lista.push({ grupo: p.grupo, anoMes: p.anoMes, valor: p.valor });
    porCompetencia.set(p.anoMes, lista);
  }

  const guias: GuiaDarfConsolidada[] = [];
  const saldosPendentes: SaldoPendenteDarf[] = [];

  for (const [codigoReceita, porCompetencia] of porCodigo) {
    const competenciasOrdenadas = [...porCompetencia.keys()].sort();

    let acumulado = new Decimal(0);
    let memoriaAcumulada: ParcelaNaMemoriaDarf[] = [];

    for (const anoMes of competenciasOrdenadas) {
      const parcelasDaCompetencia = porCompetencia.get(anoMes)!;
      for (const parcela of parcelasDaCompetencia) {
        acumulado = acumulado.plus(parcela.valor);
        memoriaAcumulada.push(parcela);
      }

      if (acumulado.greaterThanOrEqualTo(valorMinimo)) {
        guias.push({
          codigoReceita,
          competenciaGeracao: anoMes,
          valorConsolidado: acumulado,
          memoria: memoriaAcumulada,
        });
        acumulado = new Decimal(0);
        memoriaAcumulada = [];
      }
    }

    if (acumulado.greaterThan(0)) {
      saldosPendentes.push({ codigoReceita, valorAcumulado: acumulado, memoria: memoriaAcumulada });
    }
  }

  guias.sort((a, b) => (a.competenciaGeracao === b.competenciaGeracao ? a.codigoReceita.localeCompare(b.codigoReceita) : a.competenciaGeracao < b.competenciaGeracao ? -1 : 1));
  saldosPendentes.sort((a, b) => a.codigoReceita.localeCompare(b.codigoReceita));

  return { guias, saldosPendentes };
}
