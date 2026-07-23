"use server";

/**
 * Fonte única de escrita para proventos (dividendo/JCP/rendimento/outro).
 * Carteira e a página do Ativo apenas EXIBEM proventos (leitura direta na
 * tabela `proventos`, ver lib/carteira/actions.ts#obterLivroRazao e
 * lib/ativos/actions.ts#obterAtivoDetalhe) — cadastrar, editar ou excluir só
 * acontece por aqui.
 *
 * Ver docs/MAPA-DE-DADOS.md §8.23 (2026-07-20) — aba Proventos avançada:
 * - Status "provisionado"/"recebido" NUNCA é armazenado — é sempre calculado
 *   comparando `data_pagamento` com a data de hoje (futuro = provisionado,
 *   passado/hoje = recebido). Uma coluna de status ficaria desatualizada
 *   sozinha (o "hoje" muda todo dia); calcular em runtime é a única forma de
 *   nunca dessincronizar.
 * - `valor_total` passa a ser CALCULADO (quantidade × valor_por_cota) em vez
 *   de digitado — fonte única passa a ser os dois campos novos. Registros
 *   antigos (só com valor_total) continuam funcionando normalmente.
 * - DY (sobre preço atual) e Yield on Cost (sobre preço médio) reaproveitam a
 *   posição já calculada por `obterAtivosComPosicao` (lib/ativos/actions.ts)
 *   — nenhuma fórmula de posição é duplicada aqui, só usada.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ProventoForm } from "./schema";
import { TIPOS_PROVENTO } from "./schema";
import { obterAtivosComPosicao } from "@/lib/ativos/actions";
import { ORDEM_GRUPOS, LABEL_GRUPO, grupoDoAtivo, type GrupoPosicao } from "@/lib/carteira/grupo-classificacao";
import { buscarTodasLinhas } from "@/lib/supabase/paginacao";

/**
 * Ver docs/MAPA-DE-DADOS.md §8.31 (2026-07-21) — bug "Dividendos não
 * puxa na Posição": Next.js cacheia no cliente (Router Cache) o payload
 * de rota já renderizado de `/carteira` e `/ativos/[id]`; sem chamar
 * `revalidatePath` depois de gravar, quem navega pra essas rotas por link
 * (sem F5) continua vendo o snapshot de ANTES do provento existir — a aba
 * Proventos em si sempre mostra certo porque refaz o fetch on-demand
 * (`atualizar()`), sem depender desse cache de rota. Chamado depois de toda
 * gravação que muda `proventos`, nunca condicionado a sucesso silencioso.
 */
function revalidarRotasAfetadas(ativoId?: string) {
  revalidatePath("/carteira");
  revalidatePath("/proventos");
  if (ativoId) revalidatePath(`/ativos/${ativoId}`);
}

export type AcaoResultado = { error?: string };

export type StatusProvento = "provisionado" | "recebido";

export type LancamentoProvento = {
  id: string;
  ativoId: string;
  ativoTicker: string;
  grupo: GrupoPosicao;
  tipo: string;
  dataCom: string | null;
  dataPagamento: string;
  quantidade: number | null;
  valorPorCota: number | null;
  valorTotal: number;
  status: StatusProvento;
  // Detalhe fiscal opcional (§8.32.27.1, fase 2 — ver docs/MAPA-DE-DADOS.md
  // §8.35). Nenhum motor ainda consome (fase 7, crédito de imposto pago fora).
  moeda: "BRL" | "USD";
  cambio: number | null;
  impostoRetido: number;
  paisFonte: string;
  fontePagadoraIdentificador: string | null;
};

export type TotalPorTipo = { tipo: string; label: string; total: number };
export type TotalPorAtivo = { ativoId: string; ativoTicker: string; grupo: GrupoPosicao; total: number };
export type TotalPorAno = { ano: string; total: number };

export type TotalPorCategoria = {
  grupo: GrupoPosicao;
  label: string;
  totalRecebido: number;
  totalProvisionado: number;
  /** DY "de mercado": proventos recebidos nos últimos 12 meses ÷ valor de mercado (preço atual) da categoria. */
  dyPrecoAtual: number | null;
  /** Yield on Cost: proventos recebidos nos últimos 12 meses ÷ valor investido (preço médio × quantidade). */
  yieldOnCost: number | null;
  /** Patrimônio atual (preço atual × quantidade) da categoria — usado no donut "Ativos por categoria". */
  patrimonioAtual: number;
};

export type AtivoComProventos = {
  ativoId: string;
  ativoTicker: string;
  ativoNome: string | null;
  grupo: GrupoPosicao;
  quantidadeAtual: number;
  precoMedio: number;
  precoAtual: number;
  totalRecebido12Meses: number;
  totalRecebidoGeral: number;
  dyPrecoAtual: number | null;
  yieldOnCost: number | null;
};

export type ResumoProventos = {
  totalRecebido: number;
  totalProvisionado: number;
  ultimos6Meses: number;
  ultimos12Meses: number;
  ultimos24Meses: number;
  /** DY "de mercado" da carteira toda (mesma fórmula, agregada). */
  dyCarteiraPrecoAtual: number | null;
  /** Yield on Cost da carteira toda. */
  yieldOnCostCarteira: number | null;
};

export type LivroProventos = {
  lancamentos: LancamentoProvento[];
  resumo: ResumoProventos;
  porTipo: TotalPorTipo[];
  porAtivo: TotalPorAtivo[];
  porAno: TotalPorAno[];
  porCategoria: TotalPorCategoria[];
  ativos: AtivoComProventos[];
};

function livroVazio(): LivroProventos {
  return {
    lancamentos: [],
    resumo: {
      totalRecebido: 0,
      totalProvisionado: 0,
      ultimos6Meses: 0,
      ultimos12Meses: 0,
      ultimos24Meses: 0,
      dyCarteiraPrecoAtual: null,
      yieldOnCostCarteira: null,
    },
    porTipo: [],
    porAtivo: [],
    porAno: [],
    porCategoria: [],
    ativos: [],
  };
}

function diasAtras(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function obterLivroProventos(): Promise<LivroProventos> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return livroVazio();

  // Paginado (docs/MAPA-DE-DADOS.md §8.59) — sem isso, um histórico de
  // proventos com mais de 1000 lançamentos perderia o restante em silêncio
  // (teto de linhas por página do PostgREST).
  const [proventosRaw, posicoes] = await Promise.all([
    buscarTodasLinhas((inicio, fim) =>
      supabase
        .from("proventos")
        .select(
          "id, ativo_id, tipo, data_com, data_pagamento, quantidade, valor_por_cota, valor_total, moeda, cambio, imposto_retido, pais_fonte, fonte_pagadora_identificador, ativos(ticker)"
        )
        .eq("profile_id", user.id)
        .range(inicio, fim)
    ),
    obterAtivosComPosicao(),
  ]);

  const grupoPorAtivo = new Map<string, GrupoPosicao>(
    posicoes.map((a) => [a.id, grupoDoAtivo(a.tipo, a.subtipoRendaFixa, a.subtipoInternacional)])
  );

  const hojeStr = new Date().toISOString().slice(0, 10);

  const lancamentos: LancamentoProvento[] = (proventosRaw ?? [])
    .map((p) => {
      const ativo = Array.isArray(p.ativos) ? p.ativos[0] : p.ativos;
      const dataPagamento = p.data_pagamento as string;
      const item: LancamentoProvento = {
        id: p.id as string,
        ativoId: p.ativo_id as string,
        ativoTicker: ativo?.ticker ?? "—",
        grupo: grupoPorAtivo.get(p.ativo_id as string) ?? "outros",
        tipo: p.tipo as string,
        dataCom: (p.data_com as string | null) ?? null,
        dataPagamento,
        quantidade: p.quantidade !== null ? Number(p.quantidade) : null,
        valorPorCota: p.valor_por_cota !== null ? Number(p.valor_por_cota) : null,
        valorTotal: Number(p.valor_total),
        status: dataPagamento > hojeStr ? "provisionado" : "recebido",
        moeda: (p.moeda as "BRL" | "USD" | null) ?? "BRL",
        cambio: p.cambio !== null && p.cambio !== undefined ? Number(p.cambio) : null,
        impostoRetido: p.imposto_retido !== null && p.imposto_retido !== undefined ? Number(p.imposto_retido) : 0,
        paisFonte: (p.pais_fonte as string | null) ?? "Brasil",
        fontePagadoraIdentificador: (p.fonte_pagadora_identificador as string | null) ?? null,
      };
      return item;
    })
    .sort((a, b) => (a.dataPagamento < b.dataPagamento ? 1 : a.dataPagamento > b.dataPagamento ? -1 : 0));

  // ---- Resumo (cards do dashboard) ---------------------------------------
  const recebidos = lancamentos.filter((l) => l.status === "recebido");
  const provisionados = lancamentos.filter((l) => l.status === "provisionado");

  const totalRecebido = recebidos.reduce((s, l) => s + l.valorTotal, 0);
  const totalProvisionado = provisionados.reduce((s, l) => s + l.valorTotal, 0);

  const cutoff6 = diasAtras(180);
  const cutoff12 = diasAtras(365);
  const cutoff24 = diasAtras(730);
  const somaRecebidosDesde = (cutoff: string) =>
    recebidos.filter((l) => l.dataPagamento >= cutoff).reduce((s, l) => s + l.valorTotal, 0);

  const ultimos6Meses = somaRecebidosDesde(cutoff6);
  const ultimos12Meses = somaRecebidosDesde(cutoff12);
  const ultimos24Meses = somaRecebidosDesde(cutoff24);

  const patrimonioTotal = posicoes.reduce((s, a) => s + a.valorAtual, 0);
  const investidoTotal = posicoes.reduce((s, a) => s + a.precoMedio * a.quantidade, 0);
  const dyCarteiraPrecoAtual = patrimonioTotal > 0 ? (ultimos12Meses / patrimonioTotal) * 100 : null;
  const yieldOnCostCarteira = investidoTotal > 0 ? (ultimos12Meses / investidoTotal) * 100 : null;

  // ---- Por tipo / por ativo / por ano -------------------------------------
  const porTipo: TotalPorTipo[] = TIPOS_PROVENTO.map((t) => ({
    tipo: t.valor,
    label: t.label,
    total: lancamentos.filter((l) => l.tipo === t.valor).reduce((s, l) => s + l.valorTotal, 0),
  })).filter((t) => t.total > 0);

  const porAtivoMap = new Map<string, TotalPorAtivo>();
  for (const l of lancamentos) {
    const atual = porAtivoMap.get(l.ativoId);
    if (atual) atual.total += l.valorTotal;
    else porAtivoMap.set(l.ativoId, { ativoId: l.ativoId, ativoTicker: l.ativoTicker, grupo: l.grupo, total: l.valorTotal });
  }
  const porAtivo = [...porAtivoMap.values()].sort((a, b) => b.total - a.total);

  const porAnoMap = new Map<string, number>();
  for (const l of lancamentos) {
    const ano = l.dataPagamento.slice(0, 4);
    porAnoMap.set(ano, (porAnoMap.get(ano) ?? 0) + l.valorTotal);
  }
  const porAno = [...porAnoMap.entries()]
    .map(([ano, total]) => ({ ano, total }))
    .sort((a, b) => (a.ano < b.ano ? 1 : -1));

  // ---- Por categoria (DY + Yield on Cost agregados) -----------------------
  const porCategoria: TotalPorCategoria[] = ORDEM_GRUPOS.map((grupo): TotalPorCategoria | null => {
    const lancsDoGrupo = lancamentos.filter((l) => l.grupo === grupo);
    if (lancsDoGrupo.length === 0) return null;

    const totalRecebidoGrupo = lancsDoGrupo
      .filter((l) => l.status === "recebido")
      .reduce((s, l) => s + l.valorTotal, 0);
    const totalProvisionadoGrupo = lancsDoGrupo
      .filter((l) => l.status === "provisionado")
      .reduce((s, l) => s + l.valorTotal, 0);
    const recebidos12mGrupo = lancsDoGrupo
      .filter((l) => l.status === "recebido" && l.dataPagamento >= cutoff12)
      .reduce((s, l) => s + l.valorTotal, 0);

    const ativosDoGrupo = posicoes.filter((a) => grupoPorAtivo.get(a.id) === grupo);
    const patrimonioGrupo = ativosDoGrupo.reduce((s, a) => s + a.valorAtual, 0);
    const investidoGrupo = ativosDoGrupo.reduce((s, a) => s + a.precoMedio * a.quantidade, 0);

    return {
      grupo,
      label: LABEL_GRUPO[grupo],
      totalRecebido: totalRecebidoGrupo,
      totalProvisionado: totalProvisionadoGrupo,
      dyPrecoAtual: patrimonioGrupo > 0 ? (recebidos12mGrupo / patrimonioGrupo) * 100 : null,
      yieldOnCost: investidoGrupo > 0 ? (recebidos12mGrupo / investidoGrupo) * 100 : null,
      patrimonioAtual: patrimonioGrupo,
    };
  }).filter((c): c is TotalPorCategoria => c !== null);

  // ---- Por ativo (tabelas expansíveis por categoria) ----------------------
  const ativosComProventos: AtivoComProventos[] = posicoes
    .map((a): AtivoComProventos | null => {
      const lancsDoAtivo = lancamentos.filter((l) => l.ativoId === a.id);
      if (lancsDoAtivo.length === 0) return null;

      const totalRecebidoGeral = lancsDoAtivo
        .filter((l) => l.status === "recebido")
        .reduce((s, l) => s + l.valorTotal, 0);
      const totalRecebido12Meses = lancsDoAtivo
        .filter((l) => l.status === "recebido" && l.dataPagamento >= cutoff12)
        .reduce((s, l) => s + l.valorTotal, 0);

      const valorMercado = a.quantidade * a.precoAtual;
      const valorInvestido = a.quantidade * a.precoMedio;

      return {
        ativoId: a.id,
        ativoTicker: a.ticker,
        ativoNome: a.nome,
        grupo: grupoPorAtivo.get(a.id) ?? "outros",
        quantidadeAtual: a.quantidade,
        precoMedio: a.precoMedio,
        precoAtual: a.precoAtual,
        totalRecebido12Meses,
        totalRecebidoGeral,
        dyPrecoAtual: valorMercado > 0 ? (totalRecebido12Meses / valorMercado) * 100 : null,
        yieldOnCost: valorInvestido > 0 ? (totalRecebido12Meses / valorInvestido) * 100 : null,
      };
    })
    .filter((a): a is AtivoComProventos => a !== null)
    .sort((a, b) => b.totalRecebidoGeral - a.totalRecebidoGeral);

  return {
    lancamentos,
    resumo: {
      totalRecebido,
      totalProvisionado,
      ultimos6Meses,
      ultimos12Meses,
      ultimos24Meses,
      dyCarteiraPrecoAtual,
      yieldOnCostCarteira,
    },
    porTipo,
    porAtivo,
    porAno,
    porCategoria,
    ativos: ativosComProventos,
  };
}

export async function criarProvento(input: ProventoForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const valorTotal = input.quantidade * input.valor_por_cota;

  const { error } = await supabase.from("proventos").insert({
    profile_id: user.id,
    ativo_id: input.ativo_id,
    tipo: input.tipo,
    data_com: input.data_com,
    data_pagamento: input.data_pagamento,
    quantidade: input.quantidade,
    valor_por_cota: input.valor_por_cota,
    valor_total: valorTotal,
    // Detalhe fiscal opcional (§8.35) — valor_bruto espelha valor_total
    // (mesma semântica de sempre: quantidade × valor por cota, sem nenhuma
    // retenção descontada) até que um motor de crédito de imposto exterior
    // (fase 7) precise de outra coisa. imposto_retido default 0.
    valor_bruto: valorTotal,
    imposto_retido: input.imposto_retido,
    moeda: input.moeda,
    cambio: input.cambio,
    pais_fonte: input.pais_fonte,
    fonte_pagadora_identificador: input.fonte_pagadora_identificador,
  });

  if (error) return { error: "Não foi possível registrar o provento." };
  revalidarRotasAfetadas(input.ativo_id);
  return {};
}

export async function editarProvento(id: string, input: ProventoForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const valorTotal = input.quantidade * input.valor_por_cota;

  const { error } = await supabase
    .from("proventos")
    .update({
      ativo_id: input.ativo_id,
      tipo: input.tipo,
      data_com: input.data_com,
      data_pagamento: input.data_pagamento,
      quantidade: input.quantidade,
      valor_por_cota: input.valor_por_cota,
      valor_total: valorTotal,
      valor_bruto: valorTotal,
      imposto_retido: input.imposto_retido,
      moeda: input.moeda,
      cambio: input.cambio,
      pais_fonte: input.pais_fonte,
      fonte_pagadora_identificador: input.fonte_pagadora_identificador,
    })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Não foi possível salvar o provento." };
  revalidarRotasAfetadas(input.ativo_id);
  return {};
}

export async function excluirProvento(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  // Pega o ativo_id ANTES de excluir só pra saber qual página do Ativo
  // revalidar depois — não bloqueia a exclusão se essa leitura falhar.
  const { data: existente } = await supabase.from("proventos").select("ativo_id").eq("id", id).maybeSingle();

  const { error } = await supabase.from("proventos").delete().eq("id", id).eq("profile_id", user.id);
  if (error) return { error: "Não foi possível excluir o provento." };
  revalidarRotasAfetadas(existente?.ativo_id as string | undefined);
  return {};
}

/** Exclusão em lote (seleção múltipla na aba Proventos). */
export async function excluirProventosEmLote(ids: string[]): Promise<AcaoResultado> {
  if (ids.length === 0) return {};

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("proventos").delete().eq("profile_id", user.id).in("id", ids);
  if (error) return { error: "Não foi possível excluir os proventos selecionados." };
  // Vários ativos podem estar envolvidos na seleção — revalida só as rotas
  // que não dependem de um ativo específico (a de cada Ativo individual
  // fica sem revalidar aqui; próxima visita normal já resolve, e o custo de
  // buscar todos os ativo_id antes de já ter apagado não compensa).
  revalidarRotasAfetadas();
  return {};
}
