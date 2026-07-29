/**
 * SEM `"use server"` de propósito (ver docs/MAPA-DE-DADOS.md §8.12 decisão 4
 * / comentário em `posicao-calculo.ts`): `taxaMaisRecenteAte` e
 * `converterCamposMonetariosParaBRL` são síncronas, e um arquivo `"use
 * server"` só pode exportar `async function`/`type` — o bundler real da
 * Vercel quebra com export síncrono mesmo quando `tsc --noEmit` fica limpo
 * (checagem que só o build de verdade faz). `obterCotacoesDolar` é a única
 * função async aqui; como o módulo não é chamado diretamente de Client
 * Components (só por `lib/carteira/posicao.ts`/`lib/ativos/actions.ts`,
 * ambos já `"use server"`), não precisa da diretiva pra funcionar como
 * Server Action.
 *
 * Câmbio (§8.60, 2026-07-23) — helpers compartilhados entre `lib/carteira/posicao.ts`
 * e `lib/ativos/actions.ts` (as duas consultas que constroem posição por
 * ativo a partir de `transacoes`). Extraído aqui pra não duplicar a mesma
 * lógica nos dois lugares (mesmo espírito de `posicao-calculo.ts`, ver §3 do
 * mapa: fonte única).
 *
 * Contexto do bug corrigido: nenhuma das duas consultas lia
 * `transacoes.moeda`/`.cambio`, nem convertia `ativos.preco_atual` de ativos
 * internacionais — uma transação lançada em USD (campo "Moeda" nos Detalhes
 * fiscais do formulário) entrava direto na soma de patrimônio como se
 * USD = BRL, e o preço de mercado de ativos internacionais (sempre em USD
 * quando vem do Yahoo Finance) também nunca era convertido.
 */

import { createClient } from "@/lib/supabase/server";
import { buscarTodasLinhas } from "@/lib/supabase/paginacao";

export type PontoCambio = { data: string; cotacao: number };

/** Busca TODA a série diária do dólar (`indicador_dolar_diario`), paginando em lotes. */
export async function obterCotacoesDolar(): Promise<PontoCambio[]> {
  const supabase = await createClient();
  const linhas = await buscarTodasLinhas<{ data: string; cotacao: number }>((inicio, fim) =>
    supabase.from("indicador_dolar_diario").select("data, cotacao").order("data", { ascending: true }).range(inicio, fim)
  );
  return linhas.map((l) => ({ data: l.data, cotacao: Number(l.cotacao) }));
}

/** `pontos` precisa estar ordenado ascendente por `data` (garantido pelo `.order()` da query). */
export function taxaMaisRecenteAte(pontos: PontoCambio[], dataAlvo: string): number | null {
  let melhor: number | null = null;
  for (const p of pontos) {
    if (p.data > dataAlvo) break;
    melhor = p.cotacao;
  }
  return melhor;
}

/**
 * Converte `precoUnitario`/`custos` de uma transação em USD pra BRL: usa o
 * `cambio` da PRÓPRIA transação (histórico, fiel ao dia do negócio) quando
 * presente; se ausente, cai pra cotação diária mais recente ANTES/NA data da
 * transação; se nem isso existir, mantém sem converter (nunca pior do que
 * já era antes desta correção).
 */
export function converterCamposMonetariosParaBRL<T extends { precoUnitario: number | null; custos: number | null; data: string }>(
  t: T,
  cambioTransacao: number | null,
  pontosCambio: PontoCambio[]
): T {
  const taxa = cambioTransacao ?? taxaMaisRecenteAte(pontosCambio, t.data);
  if (taxa === null) return t;
  return {
    ...t,
    precoUnitario: t.precoUnitario !== null ? t.precoUnitario * taxa : null,
    custos: t.custos !== null ? t.custos * taxa : null,
  };
}
