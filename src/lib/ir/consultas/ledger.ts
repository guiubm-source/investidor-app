/**
 * Leitura de `transacoes` + construção do ledger fiscal por ativo (fase 3,
 * §8.32.37 — ver docs/MAPA-DE-DADOS.md §8.36). Sem `"use server"` — helper
 * interno chamado a partir de `lib/ir/actions.ts` (mesmo motivo de
 * `regras/carregar-regras.ts` e `consultas/declaracao.ts`).
 */

import { createClient } from "@/lib/supabase/server";
import {
  construirLedgerFiscal,
  ordenarEventosLedgerFiscal,
  type EventoLedgerFiscal,
  type LedgerFiscalAtivo,
} from "../ledger/construir-ledger";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Busca TODAS as transações do usuário logado, paginando em lotes de 1000 —
 * mesmo padrão (e mesmo motivo) de `buscarTodasCotacoesDolar`
 * (lib/indicadores/actions.ts): o PostgREST tem teto rígido de linhas por
 * página (db-max-rows) que um `.range()` maior não ultrapassa, então um
 * histórico com mais de 1000 lançamentos silenciosamente perderia o
 * restante sem o loop (ver docs/MAPA-DE-DADOS.md §8.14/§8.32.35).
 */
async function buscarTodasTransacoesParaLedger(
  supabase: SupabaseServerClient,
  profileId: string,
  ativoId?: string
): Promise<(EventoLedgerFiscal & { ativoId: string })[]> {
  const TAMANHO_PAGINA = 1000;
  const eventos: (EventoLedgerFiscal & { ativoId: string })[] = [];
  let pagina = 0;

  while (true) {
    const inicio = pagina * TAMANHO_PAGINA;
    const fim = inicio + TAMANHO_PAGINA - 1;
    let query = supabase
      .from("transacoes")
      .select(
        "id, ativo_id, tipo, data, quantidade, preco_unitario, custos, fator_proporcao, valor_capitalizado, created_at"
      )
      .eq("profile_id", profileId);
    if (ativoId) query = query.eq("ativo_id", ativoId);
    const { data, error } = await query.order("data", { ascending: true }).range(inicio, fim);

    if (error) throw new Error(`buscarTodasTransacoesParaLedger: falha ao ler transacoes — ${error.message}`);
    if (!data || data.length === 0) break;

    for (const t of data) {
      eventos.push({
        transacaoId: t.id as string,
        ativoId: t.ativo_id as string,
        tipo: t.tipo as EventoLedgerFiscal["tipo"],
        data: t.data as string,
        createdAt: t.created_at as string,
        quantidade: t.quantidade !== null ? Number(t.quantidade) : null,
        precoUnitario: t.preco_unitario !== null ? Number(t.preco_unitario) : null,
        custos: t.custos !== null ? Number(t.custos) : null,
        fatorProporcao: t.fator_proporcao !== null ? Number(t.fator_proporcao) : null,
        valorCapitalizado: t.valor_capitalizado !== null ? Number(t.valor_capitalizado) : null,
      });
    }

    if (data.length < TAMANHO_PAGINA) break;
    pagina++;
  }

  return eventos;
}

/**
 * Constrói o ledger fiscal de TODOS os ativos do usuário logado, agrupado
 * por `ativo_id`. Retorna um Map pra quem consumir (fase 4+) buscar por
 * ativo sem precisar refazer a leitura/agrupamento — nenhum motor ainda
 * chama isto (é o próprio objetivo desta fase: deixar pronto pra fase 4
 * consumir, sem tela nova agora, ver docs/MAPA-DE-DADOS.md §8.36).
 */
export async function construirLedgerFiscalDoUsuario(): Promise<Map<string, LedgerFiscalAtivo>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Map();

  const eventos = await buscarTodasTransacoesParaLedger(supabase, user.id);

  const eventosPorAtivo = new Map<string, EventoLedgerFiscal[]>();
  for (const evento of eventos) {
    const lista = eventosPorAtivo.get(evento.ativoId) ?? [];
    lista.push(evento);
    eventosPorAtivo.set(evento.ativoId, lista);
  }

  const ledgerPorAtivo = new Map<string, LedgerFiscalAtivo>();
  for (const [ativoId, eventosDoAtivo] of eventosPorAtivo) {
    ledgerPorAtivo.set(ativoId, construirLedgerFiscal(ordenarEventosLedgerFiscal(eventosDoAtivo)));
  }

  return ledgerPorAtivo;
}

/**
 * Ledger fiscal de UM ativo específico — filtra `ativo_id` já na consulta
 * (não busca as transações de outros ativos), útil quando só um ativo
 * interessa (ex.: futura tela de detalhe do Ativo, ou um motor de regime
 * que processa ativo por ativo em vez de carregar tudo de uma vez).
 */
export async function construirLedgerFiscalDoAtivo(ativoId: string): Promise<LedgerFiscalAtivo> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return construirLedgerFiscal([]);

  const eventosDoAtivo = await buscarTodasTransacoesParaLedger(supabase, user.id, ativoId);

  return construirLedgerFiscal(ordenarEventosLedgerFiscal(eventosDoAtivo));
}

/**
 * Eventos JÁ ORDENADOS de todos os ativos do usuário, agrupados por
 * `ativo_id`, SEM passar pelo ledger fiscal — pra motores que precisam da
 * sequência crua de eventos além do custo médio (ex.: fase 6, FIFO auxiliar
 * de prazo de permanência de renda fixa, `ledger/fifo-dias-renda-fixa.ts`,
 * que roda em paralelo ao ledger de custo médio sobre a MESMA sequência de
 * eventos, sem substituí-lo — ver docs/MAPA-DE-DADOS.md §8.41). Refaz a
 * própria leitura (não reaproveita `construirLedgerFiscalDoUsuario`) de
 * propósito: mantém este arquivo com uma única responsabilidade por função
 * exportada, sem acoplar o consumidor ao formato de saída do ledger.
 */
export async function buscarEventosLedgerFiscalDoUsuario(): Promise<Map<string, EventoLedgerFiscal[]>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Map();

  const eventos = await buscarTodasTransacoesParaLedger(supabase, user.id);

  const eventosPorAtivo = new Map<string, EventoLedgerFiscal[]>();
  for (const evento of eventos) {
    const lista = eventosPorAtivo.get(evento.ativoId) ?? [];
    lista.push(evento);
    eventosPorAtivo.set(evento.ativoId, lista);
  }
  for (const [ativoId, lista] of eventosPorAtivo) {
    eventosPorAtivo.set(ativoId, ordenarEventosLedgerFiscal(lista));
  }

  return eventosPorAtivo;
}
