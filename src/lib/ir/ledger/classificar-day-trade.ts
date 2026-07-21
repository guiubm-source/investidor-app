import Decimal from "decimal.js";

/**
 * Classificação de day trade — motor PURO (sem acesso a banco/rede), fase 3
 * do §8.32.37, segunda metade (ver docs/MAPA-DE-DADOS.md §8.37).
 *
 * Substitui, EM ESPÍRITO (não em uso — nada ainda foi trocado no motor
 * antigo), a aproximação documentada em §8.6/§8.32.15 que o relatório de IR
 * pré-existente (`lib/ir/actions.ts#apurarVendasDoAtivo`) usa hoje: "mesmo
 * `ativo_id` com compra E venda na mesma `data`, `min(qtd comprada,
 * qtd vendida)` é day trade" — uma aproximação deliberadamente documentada
 * como "não um motor de casamento de ordens real". Este motor aqui tenta
 * ser mais fiel ao §8.32.15: considera também a mesma instituição
 * intermediadora (corretora) e, quando há múltiplas ordens de compra e/ou
 * venda no mesmo dia, exige sequência (horário de negociação) pra parear
 * ordem a ordem em vez de só bater os totais — e, sem informação
 * suficiente pra isso, BLOQUEIA a classificação (`pendente_*`) em vez de
 * aproximar, exatamente como §8.32.15 pede ("a operação não entra como
 * comum nem day trade; fica bloqueada até confirmação").
 *
 * Assim como o ledger de custo médio (`construir-ledger.ts`), este motor
 * ainda não é consumido por nenhum relatório — fica pronto pra fase 4
 * decidir se/quando substitui a aproximação antiga. Por decisão do
 * Guilherme nesta fase, o resultado fica só em memória (nenhuma coluna nova
 * em `transacoes`, nenhuma escrita no banco) — evita persistir um status
 * que teria que ser re-sincronizado toda vez que um lançamento do mesmo dia
 * for editado.
 *
 * `decimal.js` pelos mesmos motivos do ledger (§8.32.32).
 */

export type StatusClassificacaoDayTrade =
  | "nao_aplicavel"
  | "calculada_com_dados_completos"
  /** Reservado para uma futura tela de confirmação manual — este motor nunca produz este status sozinho. */
  | "confirmada_usuario"
  | "pendente_horario"
  | "pendente_corretora"
  /** Reservado para casos de ambiguidade que a versão atual do pareamento ainda não cobre (ver comentário em `parearComFifo`). */
  | "pendente_pareamento";

export type OperacaoParaClassificacaoDayTrade = {
  transacaoId: string;
  ativoId: string;
  tipo: "compra" | "venda";
  data: string;
  corretoraId: string | null;
  /** Formato "HH:MM" ou "HH:MM:SS" — comparação lexicográfica basta (mesmo padrão do `<input type="time">`). `null` = não informado. */
  horarioNegociacao: string | null;
  quantidade: number;
};

export type ResultadoClassificacaoDayTrade = {
  transacaoId: string;
  status: StatusClassificacaoDayTrade;
  quantidadeDayTrade: Decimal;
  quantidadeComum: Decimal;
};

function resultadoNaoAplicavel(op: OperacaoParaClassificacaoDayTrade): ResultadoClassificacaoDayTrade {
  return {
    transacaoId: op.transacaoId,
    status: "nao_aplicavel",
    quantidadeDayTrade: new Decimal(0),
    quantidadeComum: new Decimal(op.quantidade),
  };
}

function resultadoPendente(
  op: OperacaoParaClassificacaoDayTrade,
  status: "pendente_horario" | "pendente_corretora"
): ResultadoClassificacaoDayTrade {
  // Conservador: enquanto pendente, NADA é alocado como day trade — só
  // depois de resolvida a pendência (horário/corretora informados) o motor
  // recalcula. Evita a app tratar como "comum" algo que pode virar day
  // trade assim que o dado faltante for preenchido.
  return {
    transacaoId: op.transacaoId,
    status,
    quantidadeDayTrade: new Decimal(0),
    quantidadeComum: new Decimal(op.quantidade),
  };
}

/**
 * Pareia compras e vendas de UM subgrupo (mesmo ativo + data + corretora)
 * já ordenadas por horário, ordem a ordem, estilo FIFO — mesma convenção já
 * usada neste app pra consumir lotes por ordem cronológica (fila FIFO
 * auxiliar de renda fixa, ver §8.6): a compra mais antiga do dia pareia
 * primeiro com a venda mais antiga do dia, e assim por diante, até uma das
 * filas esgotar. O que sobra (se compras ≠ vendas em quantidade) fica como
 * operação comum na ponta que sobrou.
 *
 * Nota: a ORDEM cronológica entre compra e venda não importa pro resultado
 * agregado (day trade = min(total comprado, total vendido) no dia,
 * independente de sequência) — o que a sequência decide é só QUAL ordem
 * específica fica com qual pedaço, pra sustentar "memória por ordem"
 * (§8.32.17.2). Por isso `pendente_pareamento` não é produzido por esta
 * versão: o FIFO sempre resolve deterministicamente uma vez que as duas
 * filas estão ordenadas por horário, mesmo com horários empatados (sort
 * estável preserva a ordem original nesse caso).
 */
function parearComFifo(
  compras: OperacaoParaClassificacaoDayTrade[],
  vendas: OperacaoParaClassificacaoDayTrade[]
): Map<string, { dayTrade: Decimal; total: Decimal }> {
  const comprasOrdenadas = [...compras].sort((a, b) => (a.horarioNegociacao ?? "").localeCompare(b.horarioNegociacao ?? ""));
  const vendasOrdenadas = [...vendas].sort((a, b) => (a.horarioNegociacao ?? "").localeCompare(b.horarioNegociacao ?? ""));

  const acumulado = new Map<string, { dayTrade: Decimal; total: Decimal }>();
  const registrar = (op: OperacaoParaClassificacaoDayTrade) => {
    if (!acumulado.has(op.transacaoId)) {
      acumulado.set(op.transacaoId, { dayTrade: new Decimal(0), total: new Decimal(op.quantidade) });
    }
  };
  for (const c of comprasOrdenadas) registrar(c);
  for (const v of vendasOrdenadas) registrar(v);

  const restanteCompra = comprasOrdenadas.map((c) => new Decimal(c.quantidade));
  const restanteVenda = vendasOrdenadas.map((v) => new Decimal(v.quantidade));

  let ci = 0;
  let vi = 0;
  while (ci < comprasOrdenadas.length && vi < vendasOrdenadas.length) {
    if (restanteCompra[ci].lessThanOrEqualTo(0)) {
      ci++;
      continue;
    }
    if (restanteVenda[vi].lessThanOrEqualTo(0)) {
      vi++;
      continue;
    }

    const parear = Decimal.min(restanteCompra[ci], restanteVenda[vi]);
    const compraId = comprasOrdenadas[ci].transacaoId;
    const vendaId = vendasOrdenadas[vi].transacaoId;
    acumulado.get(compraId)!.dayTrade = acumulado.get(compraId)!.dayTrade.plus(parear);
    acumulado.get(vendaId)!.dayTrade = acumulado.get(vendaId)!.dayTrade.plus(parear);
    restanteCompra[ci] = restanteCompra[ci].minus(parear);
    restanteVenda[vi] = restanteVenda[vi].minus(parear);
  }

  return acumulado;
}

/**
 * Classifica um conjunto de operações de compra/venda (já filtradas —
 * eventos societários não entram aqui, ver `lib/ir/consultas/day-trade.ts`)
 * em day trade vs. comum, por transação.
 */
export function classificarDayTrade(
  operacoes: OperacaoParaClassificacaoDayTrade[]
): ResultadoClassificacaoDayTrade[] {
  const porDia = new Map<string, OperacaoParaClassificacaoDayTrade[]>();
  for (const op of operacoes) {
    const chave = `${op.ativoId}|${op.data}`;
    const lista = porDia.get(chave) ?? [];
    lista.push(op);
    porDia.set(chave, lista);
  }

  const resultados: ResultadoClassificacaoDayTrade[] = [];

  for (const grupoDia of porDia.values()) {
    const temCompra = grupoDia.some((o) => o.tipo === "compra");
    const temVenda = grupoDia.some((o) => o.tipo === "venda");

    if (!temCompra || !temVenda) {
      for (const op of grupoDia) resultados.push(resultadoNaoAplicavel(op));
      continue;
    }

    const semCorretora = grupoDia.some((o) => o.corretoraId === null);
    if (semCorretora) {
      // Mesmo ativo/dia tem compra E venda, mas não dá pra confirmar se são
      // da mesma instituição intermediadora (critério §8.32.15 item 3) —
      // bloqueia o dia inteiro pro ativo, em vez de arriscar um pareamento
      // que pode estar juntando corretoras diferentes.
      for (const op of grupoDia) resultados.push(resultadoPendente(op, "pendente_corretora"));
      continue;
    }

    const porCorretora = new Map<string, OperacaoParaClassificacaoDayTrade[]>();
    for (const op of grupoDia) {
      const lista = porCorretora.get(op.corretoraId as string) ?? [];
      lista.push(op);
      porCorretora.set(op.corretoraId as string, lista);
    }

    for (const subgrupo of porCorretora.values()) {
      const compras = subgrupo.filter((o) => o.tipo === "compra");
      const vendas = subgrupo.filter((o) => o.tipo === "venda");

      if (compras.length === 0 || vendas.length === 0) {
        for (const op of subgrupo) resultados.push(resultadoNaoAplicavel(op));
        continue;
      }

      if (compras.length > 1 || vendas.length > 1) {
        const semHorario = subgrupo.some((o) => !o.horarioNegociacao);
        if (semHorario) {
          // Múltiplas ordens do mesmo lado (ex.: 2 compras no dia) exigem
          // sequência pra saber qual ordem pareia com qual — sem horário em
          // TODAS as operações do subgrupo, não dá pra montar essa
          // sequência com segurança (§8.32.15 item 5).
          for (const op of subgrupo) resultados.push(resultadoPendente(op, "pendente_horario"));
          continue;
        }
      }

      const pareado = parearComFifo(compras, vendas);
      for (const op of subgrupo) {
        const info = pareado.get(op.transacaoId)!;
        resultados.push({
          transacaoId: op.transacaoId,
          status: "calculada_com_dados_completos",
          quantidadeDayTrade: info.dayTrade,
          quantidadeComum: info.total.minus(info.dayTrade),
        });
      }
    }
  }

  return resultados;
}
