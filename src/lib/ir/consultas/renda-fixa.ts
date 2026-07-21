/**
 * Orquestração da apuração de renda fixa DIRETA Brasil (fase 6 — ver
 * docs/MAPA-DE-DADOS.md §8.41). Sem `"use server"` — mesmo padrão das
 * demais `consultas/*.ts`. Combina o ledger fiscal de custo médio (fase 3),
 * o FIFO auxiliar de prazo de permanência (fase 6, novo) e os parâmetros de
 * regra versionados (fase 1) — e alimenta o motor puro
 * `motores/renda-fixa-brasil.ts`.
 *
 * Escopo desta fase (decidido com o Guilherme): só `ativos.tipo ===
 * 'renda_fixa'` (CDB/Tesouro/Debênture/LCI/LCA/CRI/CRA, distinguidos por
 * `subtipo_renda_fixa` — mesmo campo que o motor antigo já usa). Fundos
 * (curto prazo/longo prazo/ações) e come-cotas ficam para uma fase futura —
 * não tocamos `ativos.tipo === 'fundo'` aqui.
 */

import Decimal from "decimal.js";
import { createClient } from "@/lib/supabase/server";
import { construirLedgerFiscal, ordenarEventosLedgerFiscal } from "../ledger/construir-ledger";
import { calcularDiasMediosRetencao } from "../ledger/fifo-dias-renda-fixa";
import { buscarEventosLedgerFiscalDoUsuario } from "./ledger";
import { obterVersaoRegraVigente, obterParametrosRegra } from "../regras/carregar-regras";
import { exercicioCorrente } from "./declaracao";
import {
  apurarRendaFixaBrasil,
  type AtivoParaApuracaoRendaFixa,
  type GrupoFiscalRendaFixa,
  type ParametrosRendaFixaBrasil,
  type ResultadoRendaFixaBrasil,
  type VendaParaApuracaoRendaFixa,
} from "../motores/renda-fixa-brasil";

const CHAVE_ATE_180 = "renda_fixa.regressiva_ate_180_dias";
const CHAVE_ATE_360 = "renda_fixa.regressiva_ate_360_dias";
const CHAVE_ATE_720 = "renda_fixa.regressiva_ate_720_dias";
const CHAVE_ACIMA_720 = "renda_fixa.regressiva_acima_720_dias";

const SUBTIPOS_ISENTOS = ["lci", "lca", "cri", "cra"];

/** Mesma classificação isenta/tributável que `categoriaDoAtivo` (actions.ts, motor antigo) já usa — via `ativos.subtipo_renda_fixa`. */
function grupoFiscalDoAtivo(subtipoRendaFixa: string | null): GrupoFiscalRendaFixa {
  return SUBTIPOS_ISENTOS.includes(subtipoRendaFixa ?? "") ? "renda_fixa_isenta" : "renda_fixa_tributavel";
}

/**
 * Carrega a tabela regressiva da versão de regra VIGENTE do exercício
 * corrente (§8.32.4 item 4: sem fallback pra "última versão qualquer" — se
 * faltar a versão ou qualquer parâmetro, devolve `null` e quem chama decide
 * o que fazer, nunca aproximamos um valor fiscal).
 */
export async function obterParametrosRendaFixaVigente(): Promise<ParametrosRendaFixaBrasil | null> {
  const { exercicio } = exercicioCorrente();
  const versao = await obterVersaoRegraVigente("brasil", exercicio);
  if (!versao) return null;

  const parametros = await obterParametrosRegra(versao.id);
  const num = (chave: string): number | null => parametros.get(chave)?.valorNumero ?? null;

  const ate180 = num(CHAVE_ATE_180);
  const ate360 = num(CHAVE_ATE_360);
  const ate720 = num(CHAVE_ATE_720);
  const acima720 = num(CHAVE_ACIMA_720);
  if (ate180 === null || ate360 === null || ate720 === null || acima720 === null) return null;

  return {
    aliquotaAte180Dias: new Decimal(ate180),
    aliquotaAte360Dias: new Decimal(ate360),
    aliquotaAte720Dias: new Decimal(ate720),
    aliquotaAcima720Dias: new Decimal(acima720),
  };
}

/**
 * Apuração completa de renda fixa direta Brasil do usuário logado —
 * histórico inteiro, sem compensação de prejuízo (não se aplica a este
 * regime — ver comentário no topo de `motores/renda-fixa-brasil.ts`).
 * Devolve `null` quando não há versão de regra vigente/parâmetros completos
 * pro exercício corrente (fundação incompleta — não é erro do usuário).
 */
export async function apurarRendaFixaBrasilDoUsuario(): Promise<ResultadoRendaFixaBrasil | null> {
  const parametros = await obterParametrosRendaFixaVigente();
  if (!parametros) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { resgates: [], mensal: [] };

  const { data: ativosRaw, error } = await supabase
    .from("ativos")
    .select("id, ticker, subtipo_renda_fixa")
    .eq("profile_id", user.id)
    .eq("tipo", "renda_fixa");
  if (error) throw new Error(`apurarRendaFixaBrasilDoUsuario: falha ao ler ativos — ${error.message}`);

  const eventosPorAtivo = await buscarEventosLedgerFiscalDoUsuario();

  const ativosParaApuracao: AtivoParaApuracaoRendaFixa[] = [];

  for (const a of ativosRaw ?? []) {
    const ativoId = a.id as string;
    const eventos = eventosPorAtivo.get(ativoId);
    if (!eventos || eventos.length === 0) continue; // ativo sem nenhuma transação ainda — nada a apurar

    // Já vêm ordenados (`buscarEventosLedgerFiscalDoUsuario` ordena antes de
    // devolver), mas reordenar aqui é barato e evita depender silenciosamente
    // dessa garantia de quem produziu o Map.
    const eventosOrdenados = ordenarEventosLedgerFiscal(eventos);
    const ledger = construirLedgerFiscal(eventosOrdenados);
    const diasPorTransacao = calcularDiasMediosRetencao(eventosOrdenados);

    const vendas: VendaParaApuracaoRendaFixa[] = [];
    for (const linha of ledger.linhas) {
      if (linha.tipo !== "venda") continue;

      const dias = diasPorTransacao.get(linha.transacaoId) ?? null;
      vendas.push({
        transacaoId: linha.transacaoId,
        anoMes: linha.data.slice(0, 7),
        vendaTotalBruta: linha.valorVendaBruto,
        resultadoRealizado: linha.resultadoRealizado,
        diasMediosRetencao: dias?.diasMediosRetencao ?? null,
        memoriaLotes: dias?.memoria ?? [],
      });
    }
    if (vendas.length === 0) continue;

    ativosParaApuracao.push({
      ativoId,
      ativoTicker: a.ticker as string,
      grupo: grupoFiscalDoAtivo(a.subtipo_renda_fixa as string | null),
      vendas,
    });
  }

  return apurarRendaFixaBrasil(ativosParaApuracao, parametros);
}
