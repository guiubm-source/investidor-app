import Decimal from "decimal.js";

/**
 * Motor de agregação do dashboard fiscal — fase 10 do §8.32.37, fatia
 * decidida com o Guilherme: só cabeçalho + cards principais (§8.32.21.1/
 * §8.32.21.2), ver docs/MAPA-DE-DADOS.md §8.45. Diferente de todos os
 * motores anteriores, este NÃO faz cálculo fiscal novo — só agrega/organiza
 * o que os motores das fases 3-9 já produziram (ledger fiscal, renda
 * variável, DARF, ganho de capital exterior). `decimal.js` continua sendo
 * usado (§8.32.32) porque os valores de entrada já vêm em Decimal desses
 * motores — não faz sentido converter pra `number` só pra somar de novo.
 *
 * Princípio central desta fase (decidido com o Guilherme): cards cujo dado
 * depende de um motor que ainda não existe (imposto pago/vencido — sem
 * controle de pagamento; IRRF disponível — `ir_retencoes` sem nenhum motor
 * escrevendo; crédito exterior admitido — §8.32.18.2 não construído;
 * obrigação de declarar — regra de obrigatoriedade não implementada;
 * documentos sem comprovante — upload de documento nunca foi construído,
 * deferido desde a fase 2) aparecem com `status: "nao_disponivel"` e um
 * motivo explícito, NUNCA um valor zero ou aproximado que pareça um cálculo
 * de verdade (mesmo princípio de §8.32.4 item 4 aplicado aqui à
 * apresentação, não só à apuração).
 */

export type StatusCard = "disponivel" | "nao_disponivel";

export type CardValor = {
  status: StatusCard;
  valor: Decimal | null;
  /** Só preenchido quando `status === "nao_disponivel"`. */
  motivo: string | null;
};

export type PrejuizoGrupo = {
  grupo: string;
  label: string;
  /** Sempre >= 0 — "quanto de prejuízo esse grupo ainda tem disponível pra abater lucro futuro" (convertido do `prejuizoSaldoFinal` interno, que é <= 0 por convenção dos motores). */
  saldo: Decimal;
};

export type CardsPrincipaisIR = {
  obrigacaoDeclarar: { status: "sim" | "nao" | "nao_avaliada"; motivos: string[] };
  impostoAPagar: CardValor;
  impostoPago: CardValor;
  impostoVencido: CardValor;
  prejuizoPorGrupo: PrejuizoGrupo[];
  irrfDisponivel: CardValor;
  /** Nomeado "ganho de capital" (não "rendimentos") de propósito — a fase 7 só cobre alienação, nunca dividendos/juros do exterior (§8.32.18.1, ainda fora de escopo). */
  ganhoCapitalExterior: CardValor;
  impostoPagoExterior: CardValor;
  creditoExteriorAdmitido: CardValor;
  documentosSemComprovante: CardValor;
};

function disponivel(valor: Decimal): CardValor {
  return { status: "disponivel", valor, motivo: null };
}

function naoDisponivel(motivo: string): CardValor {
  return { status: "nao_disponivel", valor: null, motivo };
}

/**
 * Pega, por grupo fiscal, o `prejuizoSaldoFinal` da última linha mensal
 * (cronologicamente) com `anoMes` até `anoLimite` inclusive — mesma
 * convenção "prejuízo não prescreve, só olhamos o estado mais recente" já
 * usada dentro dos motores de apuração (§8.11).
 */
export function ultimoPrejuizoPorGrupo(
  mensal: { grupo: string; anoMes: string; prejuizoSaldoFinal: Decimal }[],
  anoLimite: number
): Map<string, Decimal> {
  const maisRecentePorGrupo = new Map<string, { anoMes: string; prejuizoSaldoFinal: Decimal }>();

  for (const linha of mensal) {
    const ano = Number(linha.anoMes.slice(0, 4));
    if (ano > anoLimite) continue;

    const atual = maisRecentePorGrupo.get(linha.grupo);
    if (!atual || linha.anoMes > atual.anoMes) {
      maisRecentePorGrupo.set(linha.grupo, { anoMes: linha.anoMes, prejuizoSaldoFinal: linha.prejuizoSaldoFinal });
    }
  }

  const resultado = new Map<string, Decimal>();
  for (const [grupo, linha] of maisRecentePorGrupo) resultado.set(grupo, linha.prejuizoSaldoFinal);
  return resultado;
}

export function montarCardsPrincipais(input: {
  /** `null` quando o motor DARF está indisponível (fundação de regras incompleta) — diferente de "não há guias" (que seria uma lista vazia, não `null`). */
  guiasDarfValorTotal: Decimal | null;
  prejuizoPorGrupo: PrejuizoGrupo[];
  /** Imposto devido do ganho de capital exterior NO ANO selecionado, se houver linha. */
  ganhoCapitalExteriorImpostoAno: Decimal | null;
  /** `false` quando o motor de ganho de capital exterior está indisponível (fundação incompleta) — diferente de "não há imposto este ano" (0). */
  ganhoCapitalExteriorDisponivel: boolean;
}): CardsPrincipaisIR {
  const MOTIVO_SEM_CONTROLE_PAGAMENTO = "O app ainda não rastreia status de pagamento de DARF/guia (deferido na fase 5, §8.40).";
  const MOTIVO_SEM_RETENCAO = "Nenhum motor ainda escreve em ir_retencoes (fato de retenção fiscal, §8.37) — a fundação existe, mas nada a alimenta ainda.";

  const fundacaoImpostoAPagarCompleta = input.guiasDarfValorTotal !== null && input.ganhoCapitalExteriorDisponivel;
  const totalAPagar = (input.guiasDarfValorTotal ?? new Decimal(0)).plus(input.ganhoCapitalExteriorImpostoAno ?? new Decimal(0));

  return {
    obrigacaoDeclarar: {
      status: "nao_avaliada",
      motivos: [
        "Regra de obrigatoriedade de declarar (limites de renda tributável/isenta, bens, ganho de capital, atividade rural) ainda não foi implementada.",
      ],
    },
    impostoAPagar: fundacaoImpostoAPagarCompleta
      ? disponivel(totalAPagar)
      : naoDisponivel("Fundação de regras (versão vigente do exercício) incompleta para renda variável e/ou exterior."),
    impostoPago: naoDisponivel(MOTIVO_SEM_CONTROLE_PAGAMENTO),
    impostoVencido: naoDisponivel(MOTIVO_SEM_CONTROLE_PAGAMENTO),
    prejuizoPorGrupo: input.prejuizoPorGrupo,
    irrfDisponivel: naoDisponivel(MOTIVO_SEM_RETENCAO),
    ganhoCapitalExterior: input.ganhoCapitalExteriorDisponivel
      ? disponivel(input.ganhoCapitalExteriorImpostoAno ?? new Decimal(0))
      : naoDisponivel("Fundação de regras (versão vigente do exercício) incompleta para o motor de exterior."),
    impostoPagoExterior: naoDisponivel(MOTIVO_SEM_RETENCAO),
    creditoExteriorAdmitido: naoDisponivel("Motor de crédito de imposto pago no exterior ainda não foi construído (§8.32.18.2)."),
    documentosSemComprovante: naoDisponivel("Upload/controle de documentos ainda não foi construído (deferido desde a fase 2, §8.35)."),
  };
}
