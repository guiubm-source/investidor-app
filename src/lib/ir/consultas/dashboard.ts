/**
 * Orquestração do dashboard fiscal (fase 10 — cabeçalho + cards principais,
 * ver docs/MAPA-DE-DADOS.md §8.45). Sem `"use server"` — mesmo padrão das
 * demais `consultas/*.ts`. NENHUM cálculo fiscal novo aqui — só chama os
 * motores já prontos das fases 4/5/7 e agrega o resultado pro formato do
 * `motores/dashboard-fiscal.ts`.
 */

import Decimal from "decimal.js";
import { obterVersaoRegraVigente } from "../regras/carregar-regras";
import { apurarRendaVariavelBrasilDoUsuario } from "./renda-variavel";
import { consolidarDarfRendaVariavelDoUsuario } from "./darf";
import { apurarGanhoCapitalExteriorDoUsuario } from "./exterior";
import {
  montarCardsPrincipais,
  ultimoPrejuizoPorGrupo,
  type CardsPrincipaisIR,
} from "../motores/dashboard-fiscal";
import { LABEL_GRUPO_FISCAL_RENDA_VARIAVEL, type GrupoFiscalRendaVariavel } from "../motores/renda-variavel-brasil";

export type ResultadoDashboardIR = {
  cards: CardsPrincipaisIR;
  /**
   * Conta sinais de pendência JÁ produzidos pelos motores existentes (day
   * trade sem corretora/horário na renda variável do ano; ativo
   * internacional sem câmbio no ganho de capital exterior) — não lê
   * `ir_pendencias` (tabela existe desde a fase 1, mas nenhum motor ainda
   * escreve nela; contar por lá daria sempre 0, o que seria enganoso).
   */
  quantidadePendencias: number;
  /** Nome da versão de regra vigente pro exercício — `null` se não houver (mesmo bloqueio gracioso de sempre). */
  versaoFiscalNome: string | null;
};

export async function obterDashboardIR(ano: number): Promise<ResultadoDashboardIR> {
  const exercicio = ano + 1;

  const [rendaVariavel, darf, exterior, versao] = await Promise.all([
    apurarRendaVariavelBrasilDoUsuario(),
    consolidarDarfRendaVariavelDoUsuario(),
    apurarGanhoCapitalExteriorDoUsuario(),
    obterVersaoRegraVigente("brasil", exercicio),
  ]);

  let quantidadePendencias = 0;
  if (rendaVariavel) {
    quantidadePendencias += rendaVariavel.mensal.filter((l) => l.anoMes.startsWith(String(ano)) && l.pendente).length;
  }
  if (exterior) {
    quantidadePendencias += exterior.ativosComPendencia.length;
  }

  const prejuizoPorGrupo = rendaVariavel
    ? [...ultimoPrejuizoPorGrupo(rendaVariavel.mensal, ano).entries()]
        .filter(([, saldo]) => !saldo.equals(0))
        .map(([grupo, saldo]) => ({
          grupo,
          label: LABEL_GRUPO_FISCAL_RENDA_VARIAVEL[grupo as GrupoFiscalRendaVariavel] ?? grupo,
          // prejuizoSaldoFinal é <= 0 por convenção interna dos motores — aqui exibimos como "quanto ainda está disponível pra abater", sempre >= 0.
          saldo: saldo.negated(),
        }))
    : [];

  const linhaExteriorDoAno = exterior?.anual.find((l) => l.ano === ano) ?? null;

  const cards = montarCardsPrincipais({
    guiasDarfValorTotal: darf ? darf.guias.reduce((soma, g) => soma.plus(g.valorConsolidado), new Decimal(0)) : null,
    prejuizoPorGrupo,
    ganhoCapitalExteriorImpostoAno: linhaExteriorDoAno?.impostoDevido ?? null,
    ganhoCapitalExteriorDisponivel: exterior !== null,
  });

  return {
    cards,
    quantidadePendencias,
    versaoFiscalNome: versao ? `${versao.nome} (${versao.versao})` : null,
  };
}
