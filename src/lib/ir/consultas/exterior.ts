/**
 * Orquestração do ganho de capital em aplicações financeiras no exterior
 * (fase 7 — ver docs/MAPA-DE-DADOS.md §8.42). Sem `"use server"` — mesmo
 * padrão das demais `consultas/*.ts`. Faz a conversão pra reais evento a
 * evento (câmbio de cada compra/venda/bonificação) ANTES de alimentar o
 * ledger fiscal de custo médio (fase 3, reaproveitado tal como está —
 * `construirLedgerFiscal` não sabe nem precisa saber que os valores já
 * passaram por conversão cambial) e o motor puro de apuração anual
 * (`motores/exterior-lei-14754.ts`).
 */

import Decimal from "decimal.js";
import { createClient } from "@/lib/supabase/server";
import { construirLedgerFiscal, ordenarEventosLedgerFiscal, type EventoLedgerFiscal } from "../ledger/construir-ledger";
import { obterVersaoRegraVigente, obterParametrosRegra } from "../regras/carregar-regras";
import { exercicioCorrente } from "./declaracao";
import {
  apurarGanhoCapitalExterior,
  type AtivoParaApuracaoExterior,
  type ParametrosExteriorLei14754,
  type ResultadoExteriorLei14754,
  type VendaParaApuracaoExterior,
} from "../motores/exterior-lei-14754";

const CHAVE_ALIQUOTA = "exterior_lei_14754.aliquota_padrao";

/**
 * Carrega a alíquota da versão de regra VIGENTE do exercício corrente
 * (§8.32.4 item 4: sem fallback pra "última versão qualquer" — se faltar a
 * versão ou o parâmetro, devolve `null` e quem chama decide o que fazer,
 * nunca aproximamos um valor fiscal).
 */
export async function obterParametrosExteriorVigente(): Promise<ParametrosExteriorLei14754 | null> {
  const { exercicio } = exercicioCorrente();
  const versao = await obterVersaoRegraVigente("brasil", exercicio);
  if (!versao) return null;

  const parametros = await obterParametrosRegra(versao.id);
  const aliquota = parametros.get(CHAVE_ALIQUOTA)?.valorNumero ?? null;
  if (aliquota === null) return null;

  return { aliquotaPadrao: new Decimal(aliquota) };
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type TransacaoExteriorRaw = {
  id: string;
  ativo_id: string;
  tipo: EventoLedgerFiscal["tipo"];
  data: string;
  quantidade: number | null;
  preco_unitario: number | null;
  custos: number | null;
  fator_proporcao: number | null;
  valor_capitalizado: number | null;
  moeda: "BRL" | "USD";
  cambio: number | null;
  created_at: string;
};

/**
 * Busca transações de uma lista de ativos internacionais, paginando em
 * lotes de 1000 (mesmo padrão de `buscarTodasTransacoesParaLedger`,
 * consultas/ledger.ts) e já agrupando por `ativo_id`.
 */
async function buscarTransacoesExterior(
  supabase: SupabaseServerClient,
  profileId: string,
  ativoIds: string[]
): Promise<Map<string, TransacaoExteriorRaw[]>> {
  const porAtivo = new Map<string, TransacaoExteriorRaw[]>();
  if (ativoIds.length === 0) return porAtivo;

  const TAMANHO_PAGINA = 1000;
  let pagina = 0;
  while (true) {
    const inicio = pagina * TAMANHO_PAGINA;
    const fim = inicio + TAMANHO_PAGINA - 1;
    const { data, error } = await supabase
      .from("transacoes")
      .select(
        "id, ativo_id, tipo, data, quantidade, preco_unitario, custos, fator_proporcao, valor_capitalizado, moeda, cambio, created_at"
      )
      .eq("profile_id", profileId)
      .in("ativo_id", ativoIds)
      .order("data", { ascending: true })
      .range(inicio, fim);

    if (error) throw new Error(`buscarTransacoesExterior: falha ao ler transacoes — ${error.message}`);
    if (!data || data.length === 0) break;

    for (const t of data) {
      const lista = porAtivo.get(t.ativo_id as string) ?? [];
      lista.push(t as TransacaoExteriorRaw);
      porAtivo.set(t.ativo_id as string, lista);
    }

    if (data.length < TAMANHO_PAGINA) break;
    pagina++;
  }

  return porAtivo;
}

/**
 * Converte os eventos crus de UM ativo internacional pra reais, evento a
 * evento, usando o câmbio DAQUELE evento específico (nunca um câmbio médio
 * ou o câmbio atual) — é isso que faz o ledger fiscal de custo médio (fase
 * 3) já embutir a variação cambial automaticamente: o custo de cada compra
 * fica travado em reais na data da compra; a venda converte pelo câmbio da
 * própria venda; o resultado realizado que sai do ledger já é o ganho "em
 * reais", incluindo o efeito cambial (§8.32.18.1: "reconhecer ganhos,
 * inclusive variação cambial sobre o principal").
 *
 * `fator_proporcao` (desdobramento/grupamento) não precisa de conversão —
 * é uma razão adimensional, não um valor monetário.
 */
function converterEventosParaReais(
  transacoes: TransacaoExteriorRaw[]
): { eventos: EventoLedgerFiscal[]; pendente: boolean; motivos: string[] } {
  const motivos: string[] = [];
  let pendente = false;

  const eventos: EventoLedgerFiscal[] = transacoes.map((t) => {
    const precisaCambio = t.moeda === "USD" && (t.tipo === "compra" || t.tipo === "venda" || t.tipo === "bonificacao");
    if (precisaCambio && (t.cambio === null || t.cambio === undefined)) {
      pendente = true;
      motivos.push(`Câmbio ausente numa transação de ${t.tipo} em ${t.data}.`);
    }
    // Se pendente, o ativo inteiro é descartado por quem chama — o `?? 1`
    // aqui só evita propagar `NaN`/erro de multiplicação, o valor resultante
    // nunca é usado.
    const cambio = new Decimal(t.cambio ?? 1);

    // Multiplicação em Decimal, `.toNumber()` só na saída — mesmo motivo de
    // §8.32.32 (nunca fazer conta fiscal em ponto flutuante nativo). Fazer
    // `t.preco_unitario * cambio` diretamente em `number` introduz erro de
    // arredondamento binário (ex. 12 * 5.2 vira 62.39999999999999 em JS);
    // passar pelo Decimal primeiro dá o mesmo resultado que um humano
    // calculando na mão, só convertido pra `number` na fronteira porque
    // `EventoLedgerFiscal` (fase 3) já espera `number` nesses campos — o
    // ledger fiscal reconverte pra Decimal internamente de qualquer forma.
    const converter = (v: number | null) => (v !== null ? new Decimal(v).times(cambio).toNumber() : null);

    return {
      transacaoId: t.id,
      tipo: t.tipo,
      data: t.data,
      createdAt: t.created_at,
      quantidade: t.quantidade,
      precoUnitario: converter(t.preco_unitario),
      custos: converter(t.custos),
      fatorProporcao: t.fator_proporcao,
      valorCapitalizado: converter(t.valor_capitalizado),
    };
  });

  return { eventos, pendente, motivos };
}

/**
 * Apuração completa de ganho de capital exterior (Lei 14.754) do usuário
 * logado — todo o histórico, com compensação de prejuízo ano a ano. Devolve
 * `null` quando não há versão de regra vigente/parâmetro completo pro
 * exercício corrente (fundação incompleta — não é erro do usuário).
 */
export async function apurarGanhoCapitalExteriorDoUsuario(): Promise<ResultadoExteriorLei14754 | null> {
  const parametros = await obterParametrosExteriorVigente();
  if (!parametros) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { anual: [], ativosComPendencia: [] };

  const { data: ativosRaw, error } = await supabase
    .from("ativos")
    .select("id, ticker")
    .eq("profile_id", user.id)
    .eq("tipo", "internacional");
  if (error) throw new Error(`apurarGanhoCapitalExteriorDoUsuario: falha ao ler ativos — ${error.message}`);

  const ativoIds = (ativosRaw ?? []).map((a) => a.id as string);
  const transacoesPorAtivo = await buscarTransacoesExterior(supabase, user.id, ativoIds);

  const ativosParaApuracao: AtivoParaApuracaoExterior[] = [];

  for (const a of ativosRaw ?? []) {
    const ativoId = a.id as string;
    const ativoTicker = a.ticker as string;
    const brutas = transacoesPorAtivo.get(ativoId);
    if (!brutas || brutas.length === 0) continue; // ativo sem nenhuma transação ainda — nada a apurar

    const { eventos, pendente, motivos } = converterEventosParaReais(brutas);

    if (pendente) {
      ativosParaApuracao.push({ ativoId, ativoTicker, vendas: [], pendente: true, motivosPendencia: motivos });
      continue;
    }

    const eventosOrdenados = ordenarEventosLedgerFiscal(eventos);
    const ledger = construirLedgerFiscal(eventosOrdenados);

    const vendas: VendaParaApuracaoExterior[] = ledger.linhas
      .filter((l) => l.tipo === "venda")
      .map((l) => ({
        transacaoId: l.transacaoId,
        ano: Number(l.data.slice(0, 4)),
        vendaTotalBrutaReais: l.valorVendaBruto,
        resultadoRealizadoReais: l.resultadoRealizado,
      }));

    ativosParaApuracao.push({ ativoId, ativoTicker, vendas, pendente: false, motivosPendencia: [] });
  }

  return apurarGanhoCapitalExterior(ativosParaApuracao, parametros);
}
