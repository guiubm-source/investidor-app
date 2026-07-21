import Decimal from "decimal.js";
import type { EventoLedgerFiscal } from "./construir-ledger";

/**
 * FIFO auxiliar de prazo de permanência — fase 6 do §8.32.37 (renda fixa
 * direta, ver docs/MAPA-DE-DADOS.md §8.41). Motor PURO (sem acesso a banco/
 * rede), `decimal.js` pelos mesmos motivos das fases anteriores (§8.32.32).
 *
 * Por que isto existe SEPARADO do ledger fiscal de custo médio
 * (`construir-ledger.ts`): §8.32.17.5 é explícito — "a fila FIFO auxiliar já
 * planejada pode ser usada para prazo de permanência, mas não pode
 * substituir o custo médio oficial quando a regra de cálculo do ganho exigir
 * outra base". O ganho de cada venda de renda fixa já vem do ledger fiscal
 * (custo médio ponderado, igual a qualquer outro ativo — invariante
 * §8.32.31 item 14, o motor fiscal nunca importa o motor gerencial). Este
 * módulo NÃO recalcula ganho nenhum — só responde "em média, quantos dias
 * corridos os lotes consumidos por esta venda ficaram aplicados", pra
 * escolher a faixa da tabela regressiva. É uma reimplementação Decimal do
 * `fifoRendaFixa` que já existia em `lib/ir/actions.ts#apurarVendasDoAtivo`
 * (motor antigo), independente e paralela, mesmo padrão de toda fase 3-5.
 *
 * A "memória de lotes consumidos" (§8.32.17.5: "para cada resgate, guardar
 * na memória os lotes consumidos, dias e faixa aplicável") é exposta em
 * `MemoriaConsumoLote[]` por venda — não só a média — porque a média sozinha
 * perde a informação de auditoria (quais lotes, de qual data, quantos dias
 * cada um) que a Receita/um contador poderia querer conferir.
 */

type Lote = { data: string; quantidade: Decimal };

export type MemoriaConsumoLote = {
  dataLote: string;
  quantidadeConsumida: Decimal;
  dias: Decimal;
};

export type ResultadoDiasRetencao = {
  /** Média ponderada (por quantidade) dos dias dos lotes consumidos nesta venda — `null` se nada foi consumido (ex. venda maior que o estoque, mesma defesa do ledger fiscal). */
  diasMediosRetencao: Decimal | null;
  /** Trilha de auditoria: cada lote consumido, quanto e há quantos dias. */
  memoria: MemoriaConsumoLote[];
};

/**
 * Processa os eventos de UM ativo (já ordenados cronologicamente — mesma
 * ordenação usada pelo ledger fiscal, `ordenarEventosLedgerFiscal`) e devolve
 * o resultado de prazo de permanência por `transacaoId` de venda. Eventos
 * que não são venda não aparecem no Map de saída (não têm "dias de
 * retenção" — esse conceito só existe no resgate).
 *
 * Réplica fiel da convenção do motor antigo: desdobramento/grupamento
 * multiplicam a quantidade de todos os lotes pelo fator (sem alterar a
 * data); bonificação entra como um lote novo na data do evento (mesma
 * convenção do ledger fiscal — nunca "custo zero" isolado, aqui equivalente
 * a "prazo zero" isolado na quantidade bonificada).
 */
export function calcularDiasMediosRetencao(
  eventosOrdenados: EventoLedgerFiscal[]
): Map<string, ResultadoDiasRetencao> {
  const resultado = new Map<string, ResultadoDiasRetencao>();
  let lotes: Lote[] = [];

  for (const evento of eventosOrdenados) {
    if (evento.tipo === "compra") {
      lotes.push({ data: evento.data, quantidade: new Decimal(evento.quantidade ?? 0) });
    } else if (evento.tipo === "desdobramento" || evento.tipo === "grupamento") {
      const fator = new Decimal(evento.fatorProporcao ?? 1);
      lotes = lotes.map((l) => ({ data: l.data, quantidade: l.quantidade.times(fator) }));
    } else if (evento.tipo === "bonificacao") {
      lotes.push({ data: evento.data, quantidade: new Decimal(evento.quantidade ?? 0) });
    } else {
      // venda: consome lotes FIFO (mais antigo primeiro) até completar a
      // quantidade vendida ou esgotar os lotes disponíveis.
      let restante = new Decimal(evento.quantidade ?? 0);
      const dataVenda = new Date(evento.data).getTime();
      const memoria: MemoriaConsumoLote[] = [];
      let somaDiasPonderada = new Decimal(0);
      let qtdConsumida = new Decimal(0);

      while (restante.greaterThan(0) && lotes.length > 0) {
        const lote = lotes[0];
        const consumida = Decimal.min(restante, lote.quantidade);
        const diasCorridos = Math.round((dataVenda - new Date(lote.data).getTime()) / 86_400_000);
        const dias = Decimal.max(0, new Decimal(diasCorridos));

        memoria.push({ dataLote: lote.data, quantidadeConsumida: consumida, dias });
        somaDiasPonderada = somaDiasPonderada.plus(dias.times(consumida));
        qtdConsumida = qtdConsumida.plus(consumida);

        lote.quantidade = lote.quantidade.minus(consumida);
        restante = restante.minus(consumida);
        if (lote.quantidade.lessThanOrEqualTo(0)) lotes.shift();
      }

      resultado.set(evento.transacaoId, {
        diasMediosRetencao: qtdConsumida.greaterThan(0) ? somaDiasPonderada.dividedBy(qtdConsumida) : null,
        memoria,
      });
    }
  }

  return resultado;
}
