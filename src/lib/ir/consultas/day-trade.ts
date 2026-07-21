/**
 * Leitura de `transacoes` (só compra/venda) + classificação de day trade
 * (fase 3, segunda metade — ver docs/MAPA-DE-DADOS.md §8.37). Sem
 * `"use server"` — mesmo padrão de `consultas/ledger.ts`.
 */

import { createClient } from "@/lib/supabase/server";
import {
  classificarDayTrade,
  type OperacaoParaClassificacaoDayTrade,
  type ResultadoClassificacaoDayTrade,
} from "../ledger/classificar-day-trade";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Busca compras/vendas do usuário logado, paginando em lotes de 1000 —
 * mesmo padrão de `buscarTodasTransacoesParaLedger` (consultas/ledger.ts) e
 * `buscarTodasCotacoesDolar` (lib/indicadores/actions.ts), mesmo motivo
 * (§8.14/§8.32.35). Filtra `tipo in (compra, venda)` já na consulta —
 * eventos societários não participam de day trade.
 */
async function buscarOperacoesParaClassificacao(
  supabase: SupabaseServerClient,
  profileId: string,
  ativoId?: string
): Promise<OperacaoParaClassificacaoDayTrade[]> {
  const TAMANHO_PAGINA = 1000;
  const operacoes: OperacaoParaClassificacaoDayTrade[] = [];
  let pagina = 0;

  while (true) {
    const inicio = pagina * TAMANHO_PAGINA;
    const fim = inicio + TAMANHO_PAGINA - 1;
    let query = supabase
      .from("transacoes")
      .select("id, ativo_id, tipo, data, corretora_id, horario_negociacao, quantidade")
      .eq("profile_id", profileId)
      .in("tipo", ["compra", "venda"]);
    if (ativoId) query = query.eq("ativo_id", ativoId);
    const { data, error } = await query.order("data", { ascending: true }).range(inicio, fim);

    if (error) throw new Error(`buscarOperacoesParaClassificacao: falha ao ler transacoes — ${error.message}`);
    if (!data || data.length === 0) break;

    for (const t of data) {
      operacoes.push({
        transacaoId: t.id as string,
        ativoId: t.ativo_id as string,
        tipo: t.tipo as "compra" | "venda",
        data: t.data as string,
        corretoraId: t.corretora_id as string | null,
        horarioNegociacao: (t.horario_negociacao as string | null) ?? null,
        quantidade: Number(t.quantidade),
      });
    }

    if (data.length < TAMANHO_PAGINA) break;
    pagina++;
  }

  return operacoes;
}

/** Classificação de day trade de TODAS as compras/vendas do usuário logado. */
export async function classificarDayTradeDoUsuario(): Promise<ResultadoClassificacaoDayTrade[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const operacoes = await buscarOperacoesParaClassificacao(supabase, user.id);
  return classificarDayTrade(operacoes);
}

/** Classificação de day trade filtrada num único ativo (já na consulta ao banco). */
export async function classificarDayTradeDoAtivo(ativoId: string): Promise<ResultadoClassificacaoDayTrade[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const operacoes = await buscarOperacoesParaClassificacao(supabase, user.id, ativoId);
  return classificarDayTrade(operacoes);
}
