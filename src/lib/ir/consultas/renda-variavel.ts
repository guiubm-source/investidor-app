/**
 * Orquestração da apuração de renda variável Brasil (fase 4 — ver
 * docs/MAPA-DE-DADOS.md §8.38). Sem `"use server"` — mesmo padrão das
 * demais `consultas/*.ts`. Combina 3 peças já prontas de fases anteriores:
 * ledger fiscal (fase 3), classificação de day trade (fase 3) e parâmetros
 * de regra versionados (fase 1) — e alimenta o motor puro
 * `motores/renda-variavel-brasil.ts`.
 */

import Decimal from "decimal.js";
import { createClient } from "@/lib/supabase/server";
import { construirLedgerFiscalDoUsuario } from "./ledger";
import { classificarDayTradeDoUsuario } from "./day-trade";
import { obterVersaoRegraVigente, obterParametrosRegra } from "../regras/carregar-regras";
import { exercicioCorrente } from "./declaracao";
import type { StatusClassificacaoDayTrade } from "../ledger/classificar-day-trade";
import {
  apurarRendaVariavelBrasil,
  type AtivoParaApuracaoRendaVariavel,
  type ParametrosRendaVariavelBrasil,
  type ResultadoRendaVariavelBrasil,
  type VendaParaApuracaoRendaVariavel,
} from "../motores/renda-variavel-brasil";

const CHAVE_ISENCAO_SWING = "renda_variavel.isencao_acao_swing_limite_mensal";
const CHAVE_ALIQUOTA_SWING = "renda_variavel.aliquota_acao_swing";
const CHAVE_ALIQUOTA_DAY = "renda_variavel.aliquota_acao_day_trade";
const CHAVE_ALIQUOTA_FII = "renda_variavel.aliquota_fii";

/**
 * Carrega os parâmetros de renda variável da versão de regra VIGENTE do
 * exercício corrente (§8.32.4 item 4: sem fallback pra "última versão
 * qualquer" — se faltar a versão ou qualquer parâmetro, devolve `null` e
 * quem chama decide o que fazer, nunca aproximamos um valor fiscal).
 */
export async function obterParametrosRendaVariavelVigente(): Promise<ParametrosRendaVariavelBrasil | null> {
  const { exercicio } = exercicioCorrente();
  const versao = await obterVersaoRegraVigente("brasil", exercicio);
  if (!versao) return null;

  const parametros = await obterParametrosRegra(versao.id);
  const num = (chave: string): number | null => parametros.get(chave)?.valorNumero ?? null;

  const isencao = num(CHAVE_ISENCAO_SWING);
  const aliquotaSwing = num(CHAVE_ALIQUOTA_SWING);
  const aliquotaDay = num(CHAVE_ALIQUOTA_DAY);
  const aliquotaFii = num(CHAVE_ALIQUOTA_FII);
  if (isencao === null || aliquotaSwing === null || aliquotaDay === null || aliquotaFii === null) return null;

  return {
    isencaoSwingLimiteMensal: new Decimal(isencao),
    aliquotaSwing: new Decimal(aliquotaSwing),
    aliquotaDayTrade: new Decimal(aliquotaDay),
    aliquotaFii: new Decimal(aliquotaFii),
  };
}

/**
 * Apuração completa de renda variável Brasil (ações/fundos + FII) do
 * usuário logado — histórico mensal inteiro, com compensação de prejuízo.
 * Devolve `null` quando não há versão de regra vigente/parâmetros completos
 * pro exercício corrente (fundação incompleta — não é erro do usuário).
 */
export async function apurarRendaVariavelBrasilDoUsuario(): Promise<ResultadoRendaVariavelBrasil | null> {
  const parametros = await obterParametrosRendaVariavelVigente();
  if (!parametros) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { mensal: [] };

  const { data: ativosRaw, error } = await supabase
    .from("ativos")
    .select("id, ticker, tipo")
    .eq("profile_id", user.id)
    .in("tipo", ["acao", "fundo", "fii"]);
  if (error) throw new Error(`apurarRendaVariavelBrasilDoUsuario: falha ao ler ativos — ${error.message}`);

  const [ledgerPorAtivo, classificacoes] = await Promise.all([
    construirLedgerFiscalDoUsuario(),
    classificarDayTradeDoUsuario(),
  ]);

  const classificacaoPorTransacao = new Map<
    string,
    { status: StatusClassificacaoDayTrade; dayTrade: Decimal; comum: Decimal }
  >();
  for (const c of classificacoes) {
    classificacaoPorTransacao.set(c.transacaoId, { status: c.status, dayTrade: c.quantidadeDayTrade, comum: c.quantidadeComum });
  }

  const ativosParaApuracao: AtivoParaApuracaoRendaVariavel[] = [];

  for (const a of ativosRaw ?? []) {
    const ledger = ledgerPorAtivo.get(a.id as string);
    if (!ledger) continue; // ativo sem nenhuma transação ainda — nada a apurar

    const tipoRegime: "acao_fundo" | "fii" = a.tipo === "fii" ? "fii" : "acao_fundo";

    const vendas: VendaParaApuracaoRendaVariavel[] = [];
    for (const linha of ledger.linhas) {
      if (linha.tipo !== "venda") continue;

      // Quantidade EFETIVAMENTE reduzida do estoque nesta venda (já limitada
      // ao saldo disponível pelo próprio ledger, ver `Decimal.min` em
      // `aplicarEventoAoLedgerFiscal`) — não a quantidade bruta pedida na
      // transação, que poderia (por inconsistência de dado) ser maior.
      const quantidadeTotal = linha.quantidadeAntes.minus(linha.quantidadeDepois).abs();

      if (tipoRegime === "fii") {
        // FII não tem distinção day trade/swing (§8.32.17.3) — tudo é
        // "comum" pro motor, sem depender da classificação de day trade.
        vendas.push({
          transacaoId: linha.transacaoId,
          anoMes: linha.data.slice(0, 7),
          quantidadeTotal,
          vendaTotalBruta: linha.valorVendaBruto,
          resultadoRealizado: linha.resultadoRealizado,
          quantidadeDayTrade: new Decimal(0),
          quantidadeComum: quantidadeTotal,
          statusDayTrade: "nao_aplicavel",
        });
        continue;
      }

      const classificacao = classificacaoPorTransacao.get(linha.transacaoId);
      vendas.push({
        transacaoId: linha.transacaoId,
        anoMes: linha.data.slice(0, 7),
        quantidadeTotal,
        vendaTotalBruta: linha.valorVendaBruto,
        resultadoRealizado: linha.resultadoRealizado,
        // Sem classificação encontrada (não deveria acontecer — toda venda
        // de ação/fundo passa pelo classificador) tratamos como pendente de
        // pareamento em vez de assumir "comum" silenciosamente.
        quantidadeDayTrade: classificacao?.dayTrade ?? new Decimal(0),
        quantidadeComum: classificacao?.comum ?? new Decimal(0),
        statusDayTrade: classificacao?.status ?? "pendente_pareamento",
      });
    }

    ativosParaApuracao.push({ ativoId: a.id as string, ativoTicker: a.ticker as string, tipoRegime, vendas });
  }

  return apurarRendaVariavelBrasil(ativosParaApuracao, parametros);
}
