"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buscarCotacaoYahoo, deriveYahooSymbol, TIPOS_COTACAO_AUTOMATICA } from "./yahoo-finance";
import { atualizarTodasCotacoes, type ResultadoAtualizacaoCotacoes } from "./atualizar-cotacoes";
import {
  buscarDadosEmpresaBrapi,
  buscarDadosEmpresaYahoo,
  deriveChaveExternaEmpresa,
  TIPOS_CARTAO_EMPRESA,
} from "./empresas";
import {
  calcularChecklistAcao,
  calcularChecklistFii,
  type ChecklistAcao,
  type ChecklistFii,
  type PontoTrimestralAcao,
  type PontoTrimestralFii,
} from "./checklist-estatisticas";
import type {
  AtivoForm,
  ClassificacaoForm,
  EmpresaForm,
  PrecoAtualForm,
  ResultadoTrimestralForm,
  SaldoAcionistasForm,
  SimboloTradingviewForm,
} from "./schema";
import {
  calcularPosicao,
  ordenarTransacoes,
  calcularRetornoSimplesAcumulado,
  type TransacaoCalc,
} from "./posicao-calculo";

export type AcaoResultado = { error?: string };

export type TipoAtivo =
  | "acao"
  | "fii"
  | "etf"
  | "renda_fixa"
  | "fundo"
  | "internacional"
  | "cripto"
  | "outro";

export type TransacaoItem = {
  id: string;
  tipo: "compra" | "venda" | "desdobramento" | "grupamento" | "bonificacao";
  data: string;
  quantidade: number | null;
  precoUnitario: number | null;
  custos: number | null;
  fatorProporcao: number | null;
  valorCapitalizado: number | null;
  corretoraId: string | null;
  corretoraNome: string | null;
};

export type ProventoItem = {
  id: string;
  tipo: string;
  data: string;
  valorTotal: number;
};

/**
 * "Cartão de visita" da empresa/fundo por trás do ativo — ver
 * docs/MAPA-DE-DADOS.md §8.56. `null` quando o ativo ainda não tem
 * `empresa_id` (tipo não elegível, ou elegível mas nunca buscado/vinculado).
 */
export type EmpresaView = {
  id: string;
  cnpj: string | null;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  logoUrl: string | null;
  segmento: string | null;
  descricao: string | null;
  origemDados: "manual" | "brapi" | "yahoo";
  atualizadoEm: string | null;
};

export type AtivoResumo = {
  id: string;
  ticker: string;
  nome: string | null;
  tipo: TipoAtivo;
  subtipoRendaFixa: string | null;
  criptoExchange: string | null;
  /** Ação (Stock) vs ETF dentro de `tipo === "internacional"` — ver docs/MAPA-DE-DADOS.md §8.16. */
  subtipoInternacional: string | null;
  precoAtual: number;
  precoAtualizadoEm: string | null;
  precoFonte: "yahoo_finance" | "manual" | null;
  cotacaoAutomatica: boolean;
  simboloTradingview: string;
  simboloTradingviewManual: boolean;
  classeId: string | null;
  classeNome: string | null;
  setorId: string | null;
  setorNome: string | null;
  pesoAlvo: number | null;
  empresa: EmpresaView | null;
  quantidade: number;
  precoMedio: number;
  valorAplicado: number;
  valorAtual: number;
  lucroNaoRealizado: number;
  lucroNaoRealizadoPct: number;
  lucroRealizado: number;
  proventosRecebidos: number;
  retornoTotal: number;
  /** Soma bruta de compras (nunca reduz na venda) — denominador da rentabilidade unificada, ver §8.16. */
  totalInvestidoBruto: number;
  /**
   * "Retorno simples acumulado" — mesma fórmula unificada usada na
   * rentabilidade histórica (§8.15): (valorAtual + totalVendidoLiquido) −
   * totalInvestidoBruto, em R$, e o mesmo dividido por totalInvestidoBruto
   * em %. `null` antes da primeira compra (totalInvestidoBruto === 0).
   * Usa `totalVendidoLiquido` (dinheiro total recebido em vendas), NÃO
   * `lucroRealizado` (só a fatia de lucro) — ver correção §8.28.
   */
  rentabilidadeTotalValor: number | null;
  rentabilidadeTotalPct: number | null;
};

export type AtivoDetalhe = AtivoResumo & {
  pesoReal: number | null;
  desvio: number | null;
  transacoes: TransacaoItem[];
  proventos: ProventoItem[];
};

/**
 * Deriva um símbolo padrão do TradingView (bolsa:ticker) a partir do tipo do
 * ativo, para quando o usuário ainda não sobrescreveu manualmente. É só um
 * ponto de partida razoável — ações/FIIs/fundos/renda fixa negociados em
 * bolsa no Brasil vão para a B3, cripto para a Binance, internacional para a
 * Nasdaq (o usuário pode corrigir a bolsa exata na página do ativo).
 */
function deriveTradingViewSymbol(tipo: TipoAtivo, ticker: string): string {
  const t = ticker.toUpperCase();
  switch (tipo) {
    case "acao":
    case "fii":
    case "etf":
    case "fundo":
    case "renda_fixa":
      return `BMFBOVESPA:${t}`;
    case "cripto":
      return `BINANCE:${t}USDT`;
    case "internacional":
      return `NASDAQ:${t}`;
    default:
      return t;
  }
}

/**
 * Registro mestre de ativos com posição calculada (quantidade, preço médio,
 * lucro, proventos) a partir dos lançamentos da Carteira. Fonte única usada
 * pela lista de Ativos, pela Alocação (valor atual) e pela Carteira (nomes).
 */
export async function obterAtivosComPosicao(): Promise<AtivoResumo[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // Ver docs/MAPA-DE-DADOS.md §8.23: `proventosRecebidos` (usada no
  // retornoTotal, "já embolsado") só deve contar o que JÁ foi pago —
  // provento provisionado (data_pagamento no futuro) ainda não é dinheiro
  // na conta, então fica de fora da soma aqui (aparece só na aba Proventos).
  const hojeStr = new Date().toISOString().slice(0, 10);

  const [ativosRes, transacoesRes, proventosRes] = await Promise.all([
    supabase
      .from("ativos")
      .select(
        "id, ticker, nome, tipo, subtipo_renda_fixa, cripto_exchange, subtipo_internacional, preco_atual, preco_atualizado_em, preco_fonte, cotacao_automatica, simbolo_tradingview, setor_id, peso_alvo, setor:alocacao_setores(id, nome, classe:alocacao_classes(id, nome)), empresa:empresas(id, cnpj, razao_social, nome_fantasia, logo_url, segmento, descricao, origem_dados, atualizado_em)"
      )
      .eq("profile_id", user.id)
      .order("ticker"),
    supabase
      .from("transacoes")
      .select(
        "id, ativo_id, corretora_id, tipo, data, quantidade, preco_unitario, custos, fator_proporcao, valor_capitalizado, created_at, corretoras(nome)"
      )
      .eq("profile_id", user.id),
    supabase
      .from("proventos")
      .select("id, ativo_id, tipo, data:data_pagamento, valor_total")
      .eq("profile_id", user.id)
      .lte("data_pagamento", hojeStr),
  ]);

  // Ver docs/MAPA-DE-DADOS.md §8.17: sem isso, uma coluna faltando no banco
  // (ex.: migração não rodada) fazia essa função devolver `[]` em silêncio —
  // Posição/Alocação/lista de Ativos ficavam vazias sem nenhuma pista da
  // causa. Agora o erro do Postgrest é jogado pra cima (Next mostra a tela
  // de erro em vez de uma tela vazia) e fica no log do servidor.
  if (ativosRes.error) throw new Error(`obterAtivosComPosicao: falha ao ler ativos — ${ativosRes.error.message}`);
  if (transacoesRes.error) throw new Error(`obterAtivosComPosicao: falha ao ler transações — ${transacoesRes.error.message}`);
  if (proventosRes.error) throw new Error(`obterAtivosComPosicao: falha ao ler proventos — ${proventosRes.error.message}`);

  const ativos = ativosRes.data ?? [];
  const transacoes = transacoesRes.data ?? [];
  const proventos = proventosRes.data ?? [];

  return ativos.map((ativo) => {
    const setor = Array.isArray(ativo.setor) ? ativo.setor[0] : ativo.setor;
    const classe = setor ? (Array.isArray(setor.classe) ? setor.classe[0] : setor.classe) : null;
    const empresaRaw = Array.isArray(ativo.empresa) ? ativo.empresa[0] : ativo.empresa;
    const empresa: EmpresaView | null = empresaRaw
      ? {
          id: empresaRaw.id,
          cnpj: empresaRaw.cnpj,
          razaoSocial: empresaRaw.razao_social,
          nomeFantasia: empresaRaw.nome_fantasia,
          logoUrl: empresaRaw.logo_url,
          segmento: empresaRaw.segmento,
          descricao: empresaRaw.descricao,
          origemDados: empresaRaw.origem_dados as EmpresaView["origemDados"],
          atualizadoEm: empresaRaw.atualizado_em,
        }
      : null;

    // Ver docs/MAPA-DE-DADOS.md §8.22: `fator_proporcao`/`valor_capitalizado`
    // precisam vir junto pra `aplicarTransacaoNaPosicao` (posicao-calculo.ts)
    // conseguir aplicar desdobramento/grupamento/bonificação — sem isso a
    // posição do ativo ficaria "surda" a eventos societários lançados no
    // Livro-razão.
    const transacoesDoAtivo = transacoes
      .filter((t) => t.ativo_id === ativo.id)
      .map((t) => {
        const corretora = Array.isArray(t.corretoras) ? t.corretoras[0] : t.corretoras;
        return {
          tipo: t.tipo as TransacaoCalc["tipo"],
          data: t.data as string,
          quantidade: t.quantidade !== null ? Number(t.quantidade) : null,
          precoUnitario: t.preco_unitario !== null ? Number(t.preco_unitario) : null,
          custos: t.custos !== null ? Number(t.custos) : null,
          fatorProporcao: t.fator_proporcao !== null ? Number(t.fator_proporcao) : null,
          valorCapitalizado: t.valor_capitalizado !== null ? Number(t.valor_capitalizado) : null,
          createdAt: t.created_at as string,
          _id: t.id as string,
          _corretoraId: t.corretora_id as string | null,
          _corretoraNome: corretora?.nome ?? null,
        };
      });

    const transacoesOrdenadas = ordenarTransacoes(transacoesDoAtivo);
    const { quantidade, precoMedio, lucroRealizado, totalInvestidoBruto, totalVendidoLiquido } =
      calcularPosicao(transacoesOrdenadas);

    const proventosDoAtivo = proventos.filter((p) => p.ativo_id === ativo.id);
    const proventosRecebidos = proventosDoAtivo.reduce((s, p) => s + Number(p.valor_total), 0);

    const precoAtual = Number(ativo.preco_atual);
    const valorAplicado = quantidade * precoMedio;
    const valorAtual = quantidade * precoAtual;
    const lucroNaoRealizado = valorAtual - valorAplicado;
    const lucroNaoRealizadoPct = valorAplicado > 0 ? (lucroNaoRealizado / valorAplicado) * 100 : 0;

    // "Retorno simples acumulado" — mesma fórmula da rentabilidade histórica
    // (§8.15), unificada aqui pro "hoje" (ver §8.16 e §8.28/§8.59 —
    // fórmula única em posicao-calculo.ts).
    const { valor: rentabilidadeTotalValor, pct: rentabilidadeTotalPct } = calcularRetornoSimplesAcumulado(
      valorAtual,
      totalVendidoLiquido,
      totalInvestidoBruto
    );

    return {
      id: ativo.id,
      ticker: ativo.ticker,
      nome: ativo.nome,
      tipo: ativo.tipo as TipoAtivo,
      subtipoRendaFixa: ativo.subtipo_renda_fixa,
      criptoExchange: ativo.cripto_exchange,
      subtipoInternacional: ativo.subtipo_internacional,
      precoAtual,
      precoAtualizadoEm: ativo.preco_atualizado_em,
      precoFonte: (ativo.preco_fonte as "yahoo_finance" | "manual" | null) ?? null,
      cotacaoAutomatica: !!ativo.cotacao_automatica,
      simboloTradingview: ativo.simbolo_tradingview || deriveTradingViewSymbol(ativo.tipo as TipoAtivo, ativo.ticker),
      simboloTradingviewManual: !!ativo.simbolo_tradingview,
      classeId: classe?.id ?? null,
      classeNome: classe?.nome ?? null,
      setorId: setor?.id ?? null,
      setorNome: setor?.nome ?? null,
      pesoAlvo: ativo.peso_alvo,
      empresa,
      quantidade,
      precoMedio,
      valorAplicado,
      valorAtual,
      lucroNaoRealizado,
      lucroNaoRealizadoPct,
      lucroRealizado,
      proventosRecebidos,
      retornoTotal: lucroNaoRealizado + lucroRealizado + proventosRecebidos,
      totalInvestidoBruto,
      rentabilidadeTotalValor,
      rentabilidadeTotalPct,
    };
  });
}

/**
 * Quantidade disponível de um ativo até uma data específica (inclusive) —
 * posição NO PONTO DO TEMPO, não a posição final agregada depois de todas
 * as transações já lançadas. Usada por lib/carteira/actions.ts#criarTransacao
 * pra validar vendas retroativas: uma venda datada antes de uma compra
 * também retroativa não pode ficar negativa naquele ponto da linha do
 * tempo, mesmo que a posição final (somando tudo) feche positiva.
 * Reaproveita a mesma calcularPosicao/ordenarTransacoes da fonte única
 * (ver docs/MAPA-DE-DADOS.md §3) em vez de duplicar o cálculo.
 *
 * `excluirTransacaoId` (opcional): usado por `editarTransacao` — ao editar
 * uma venda, a própria transação (com os valores ANTIGOS, ainda não
 * sobrescritos no banco) não pode contar contra ela mesma na validação,
 * senão editar uma venda existente (sem mudar a quantidade) sempre falharia
 * achando que "faltou" a quantidade que ela mesma representa.
 */
export async function obterQuantidadeDisponivelEmData(
  ativoId: string,
  dataLimite: string,
  excluirTransacaoId?: string
): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;

  let query = supabase
    .from("transacoes")
    .select("tipo, data, quantidade, preco_unitario, custos, fator_proporcao, valor_capitalizado, created_at")
    .eq("profile_id", user.id)
    .eq("ativo_id", ativoId)
    .lte("data", dataLimite);
  if (excluirTransacaoId) query = query.neq("id", excluirTransacaoId);

  const { data } = await query;

  // Sem os campos de eventos societários aqui, uma quantidade recebida por
  // bonificação (ou multiplicada por um desdobramento) antes da data-limite
  // não entraria nesta conta — a validação de venda retroativa liberaria
  // menos quantidade do que realmente existia naquele ponto do tempo (ver §8.22).
  const transacoes = (data ?? []).map((t) => ({
    tipo: t.tipo as TransacaoCalc["tipo"],
    data: t.data as string,
    quantidade: t.quantidade !== null ? Number(t.quantidade) : null,
    precoUnitario: t.preco_unitario !== null ? Number(t.preco_unitario) : null,
    custos: t.custos !== null ? Number(t.custos) : null,
    fatorProporcao: t.fator_proporcao !== null ? Number(t.fator_proporcao) : null,
    valorCapitalizado: t.valor_capitalizado !== null ? Number(t.valor_capitalizado) : null,
    createdAt: t.created_at as string,
  }));

  const ordenadas = ordenarTransacoes(transacoes);
  return calcularPosicao(ordenadas).quantidade;
}

/** Valor atual (quantidade × preço atual) de cada ativo — usado pela Alocação. */
export async function obterValoresAtuaisPorAtivo(): Promise<Record<string, number>> {
  const ativos = await obterAtivosComPosicao();
  const mapa: Record<string, number> = {};
  for (const a of ativos) mapa[a.id] = a.valorAtual;
  return mapa;
}

/** Detalhe completo de um ativo: posição, desvio de alocação e histórico. */
export async function obterAtivoDetalhe(ativoId: string): Promise<AtivoDetalhe | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [todos, { data: transacoesRaw }, { data: proventosRaw }] = await Promise.all([
    obterAtivosComPosicao(),
    supabase
      .from("transacoes")
      .select(
        "id, corretora_id, tipo, data, quantidade, preco_unitario, custos, fator_proporcao, valor_capitalizado, created_at, corretoras(nome)"
      )
      .eq("profile_id", user.id)
      .eq("ativo_id", ativoId),
    supabase
      .from("proventos")
      .select("id, tipo, data:data_pagamento, valor_total")
      .eq("profile_id", user.id)
      .eq("ativo_id", ativoId)
      .order("data_pagamento", { ascending: false }),
  ]);

  const resumo = todos.find((a) => a.id === ativoId);
  if (!resumo) return null;

  let pesoReal: number | null = null;
  let desvio: number | null = null;
  if (resumo.setorId) {
    const valorTotalSetor = todos
      .filter((a) => a.setorId === resumo.setorId)
      .reduce((s, a) => s + a.valorAtual, 0);
    pesoReal = valorTotalSetor > 0 ? (resumo.valorAtual / valorTotalSetor) * 100 : 0;
    desvio = pesoReal - (resumo.pesoAlvo ?? 0);
  }

  const transacoesItens: TransacaoItem[] = (transacoesRaw ?? [])
    .map((t) => {
      const corretora = Array.isArray(t.corretoras) ? t.corretoras[0] : t.corretoras;
      return {
        id: t.id,
        tipo: t.tipo as TransacaoItem["tipo"],
        data: t.data as string,
        quantidade: t.quantidade !== null ? Number(t.quantidade) : null,
        precoUnitario: t.preco_unitario !== null ? Number(t.preco_unitario) : null,
        custos: t.custos !== null ? Number(t.custos) : null,
        fatorProporcao: t.fator_proporcao !== null ? Number(t.fator_proporcao) : null,
        valorCapitalizado: t.valor_capitalizado !== null ? Number(t.valor_capitalizado) : null,
        corretoraId: t.corretora_id,
        corretoraNome: corretora?.nome ?? null,
        _createdAt: t.created_at as string,
      };
    })
    .sort((a, b) => (a._createdAt < b._createdAt ? 1 : -1))
    .map(({ _createdAt: _c, ...resto }) => resto);

  const proventosItens: ProventoItem[] = (proventosRaw ?? []).map((p) => ({
    id: p.id,
    tipo: p.tipo,
    data: p.data,
    valorTotal: Number(p.valor_total),
  }));

  return {
    ...resumo,
    pesoReal,
    desvio,
    transacoes: transacoesItens,
    proventos: proventosItens,
  };
}

// ---------------------------------------------------------------------------
// Estrutura de classes/setores (para o seletor de classificação)
// ---------------------------------------------------------------------------
export type SetorOpcao = { id: string; nome: string };
export type ClasseOpcao = { id: string; nome: string; setores: SetorOpcao[] };

export async function obterClassesSetores(): Promise<ClasseOpcao[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const [{ data: classes }, { data: setores }] = await Promise.all([
    supabase.from("alocacao_classes").select("id, nome").eq("profile_id", user.id).order("nome"),
    supabase
      .from("alocacao_setores")
      .select("id, nome, classe_id")
      .eq("profile_id", user.id)
      .order("nome"),
  ]);

  return (classes ?? []).map((c) => ({
    id: c.id,
    nome: c.nome,
    setores: (setores ?? []).filter((s) => s.classe_id === c.id).map((s) => ({ id: s.id, nome: s.nome })),
  }));
}

// ---------------------------------------------------------------------------
// CRUD de identidade do ativo
// ---------------------------------------------------------------------------
export async function criarAtivo(input: AtivoForm): Promise<AcaoResultado & { id?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data, error } = await supabase
    .from("ativos")
    .insert({
      profile_id: user.id,
      ticker: input.ticker,
      nome: input.nome || null,
      tipo: input.tipo,
      subtipo_renda_fixa: input.subtipo_renda_fixa || null,
      cripto_exchange: input.cripto_exchange || null,
      subtipo_internacional: input.subtipo_internacional || null,
      cotacao_automatica: TIPOS_COTACAO_AUTOMATICA.includes(input.tipo as TipoAtivo),
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") return { error: "Você já tem um ativo com esse ticker." };
    return { error: "Não foi possível cadastrar o ativo." };
  }

  return { id: data.id };
}

export async function editarAtivo(id: string, input: AtivoForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("ativos")
    .update({
      ticker: input.ticker,
      nome: input.nome || null,
      tipo: input.tipo,
      subtipo_renda_fixa: input.subtipo_renda_fixa || null,
      cripto_exchange: input.cripto_exchange || null,
      subtipo_internacional: input.subtipo_internacional || null,
      cotacao_automatica: TIPOS_COTACAO_AUTOMATICA.includes(input.tipo as TipoAtivo),
    })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) {
    if (error.code === "23505") return { error: "Você já tem outro ativo com esse ticker." };
    return { error: "Não foi possível salvar o ativo." };
  }
  return {};
}

export async function excluirAtivo(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("ativos").delete().eq("id", id).eq("profile_id", user.id);
  if (error) return { error: "Não foi possível excluir o ativo." };
  return {};
}

export async function atualizarPrecoAtual(id: string, input: PrecoAtualForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("ativos")
    .update({ preco_atual: input.preco_atual, preco_atualizado_em: new Date().toISOString(), preco_fonte: "manual" })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Não foi possível atualizar o preço atual." };

  // Snapshot no histórico de preço manual (ver docs/MAPA-DE-DADOS.md §8.12) —
  // um ponto por dia; se já existir um lançamento hoje, o upsert sobrescreve
  // em vez de acumular intraday. Erro aqui não desfaz a atualização do preço
  // atual (já confirmada acima), só fica sem registrar o ponto histórico.
  await supabase.from("ativo_preco_diario_manual").upsert(
    {
      profile_id: user.id,
      ativo_id: id,
      data: new Date().toISOString().slice(0, 10),
      preco: input.preco_atual,
    },
    { onConflict: "ativo_id,data" }
  );

  return {};
}

/**
 * Botão "Atualizar agora" da página do ativo — busca a cotação na hora via
 * Yahoo Finance (mesma fonte do cron diário, ver docs/MAPA-DE-DADOS.md
 * §8.10 decisão 2). Só funciona pra tipos cotáveis com `cotacao_automatica`
 * ligado; o endpoint é não-oficial e pode falhar, então o erro devolvido é
 * sempre uma mensagem amigável, nunca uma exceção.
 */
export async function atualizarCotacaoAgora(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data: ativo, error: erroConsulta } = await supabase
    .from("ativos")
    .select("tipo, ticker, cotacao_automatica")
    .eq("id", id)
    .eq("profile_id", user.id)
    .single();

  if (erroConsulta || !ativo) return { error: "Ativo não encontrado." };
  if (!ativo.cotacao_automatica) {
    return { error: "Este ativo não está marcado para cotação automática." };
  }

  const symbol = deriveYahooSymbol(ativo.tipo as TipoAtivo, ativo.ticker);
  if (!symbol) return { error: "Este tipo de ativo não tem cotação automática disponível." };

  const resultado = await buscarCotacaoYahoo(symbol);
  if ("erro" in resultado) return { error: resultado.erro };

  const { error } = await supabase
    .from("ativos")
    .update({
      preco_atual: resultado.preco,
      preco_atualizado_em: new Date().toISOString(),
      preco_fonte: "yahoo_finance",
    })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Cotação buscada, mas não foi possível salvar." };
  return {};
}

/**
 * Botão "Atualizar cotações" da aba Posição (ver docs/MAPA-DE-DADOS.md
 * §8.49). Diferente de `atualizarCotacaoAgora` (acima), que só atualiza
 * `ativos.preco_atual` do ativo do próprio usuário via client comum
 * (respeitando RLS), esta action chama o motor compartilhado
 * `atualizarTodasCotacoes` — o mesmo que o cron usa —, que roda com o
 * client admin (service role) e por isso também atualiza o histórico
 * compartilhado `ativo_preco_diario_mercado`. Isso é necessário porque a
 * coluna "Variação hoje" da Posição depende desse histórico (ver
 * `obterPrecoAnteriorMercado` em `lib/carteira/posicao.ts`) — sem ele, ela
 * fica em branco mesmo com `preco_atual` em dia.
 *
 * A checagem de sessão abaixo só garante que quem clicou está logado; o
 * próprio motor atualiza os ativos de TODOS os usuários de uma vez (preço
 * de mercado é dado compartilhado, não pessoal — mesmo comportamento do
 * cron, só disparado manualmente).
 */
export async function atualizarTodasCotacoesAgora(): Promise<
  AcaoResultado & { resumo?: ResultadoAtualizacaoCotacoes }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  try {
    const resumo = await atualizarTodasCotacoes();
    revalidatePath("/carteira");
    return { resumo };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erro ao atualizar cotações." };
  }
}

/** Símbolo do gráfico TradingView. Valor vazio reseta para o derivado automaticamente. */
export async function atualizarSimboloTradingview(
  id: string,
  input: SimboloTradingviewForm
): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("ativos")
    .update({ simbolo_tradingview: input.simbolo_tradingview || null })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Não foi possível salvar o símbolo do gráfico." };
  return {};
}

// ---------------------------------------------------------------------------
// Classificação (setor + peso-alvo) — único lugar onde isso é definido
// ---------------------------------------------------------------------------
export async function classificarAtivo(id: string, input: ClassificacaoForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("ativos")
    .update({ setor_id: input.setor_id, peso_alvo: input.peso_alvo })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Não foi possível salvar a classificação." };
  return {};
}

export async function removerClassificacao(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("ativos")
    .update({ setor_id: null, peso_alvo: null })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Não foi possível remover a classificação." };
  return {};
}

// ---------------------------------------------------------------------------
// Empresa (cartão de visita) — CNPJ/nome/logo/segmento (ver
// docs/MAPA-DE-DADOS.md §8.56). Tabela `empresas` é a fonte única desse dado
// cadastral (nunca duplicado em `ativos`); as duas actions abaixo são as
// ÚNICAS que escrevem nela — busca automática (brapi/Yahoo) e edição
// manual, ambas fazendo upsert por (profile_id, chave_externa) pra dois
// ativos da mesma empresa (ex. PETR3/PETR4) compartilharem o registro.
// ---------------------------------------------------------------------------

/**
 * Botão "Atualizar dados cadastrais" da página do ativo — busca CNPJ/nome/
 * logo/segmento via brapi.dev (nacional) ou Yahoo Finance (internacional),
 * faz upsert em `empresas` e vincula `ativos.empresa_id`. Mesmo espírito de
 * `atualizarCotacaoAgora`: nunca lança, sempre devolve `{ error }` amigável
 * em caso de falha (API fora do ar, token ausente, ticker não encontrado).
 */
export async function buscarDadosCadastraisAtivo(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data: ativo, error: erroConsulta } = await supabase
    .from("ativos")
    .select("tipo, ticker, subtipo_internacional")
    .eq("id", id)
    .eq("profile_id", user.id)
    .single();

  if (erroConsulta || !ativo) return { error: "Ativo não encontrado." };

  const tipo = ativo.tipo as TipoAtivo;
  if (!TIPOS_CARTAO_EMPRESA.includes(tipo)) {
    return { error: "Este tipo de ativo não tem cartão de empresa disponível." };
  }

  const resultado =
    tipo === "internacional"
      ? await buscarDadosEmpresaYahoo(ativo.ticker)
      : await buscarDadosEmpresaBrapi(ativo.ticker);

  if ("erro" in resultado) return { error: resultado.erro };

  const chaveExterna = deriveChaveExternaEmpresa(ativo.ticker, resultado.cnpj);

  const { data: empresa, error: erroUpsert } = await supabase
    .from("empresas")
    .upsert(
      {
        profile_id: user.id,
        chave_externa: chaveExterna,
        cnpj: resultado.cnpj,
        razao_social: resultado.razaoSocial,
        nome_fantasia: resultado.nomeFantasia,
        logo_url: resultado.logoUrl,
        segmento: resultado.segmento,
        descricao: resultado.descricao,
        origem_dados: tipo === "internacional" ? "yahoo" : "brapi",
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "profile_id,chave_externa" }
    )
    .select("id")
    .single();

  if (erroUpsert || !empresa) return { error: "Dados buscados, mas não foi possível salvar o cadastro da empresa." };

  const { error: erroVinculo } = await supabase
    .from("ativos")
    .update({ empresa_id: empresa.id })
    .eq("id", id)
    .eq("profile_id", user.id);

  if (erroVinculo) return { error: "Empresa cadastrada, mas não foi possível vincular ao ativo." };
  return {};
}

/**
 * Edição manual do cartão de visita — sobrepõe (ou preenche do zero) o que
 * a busca automática trouxe. Se o ativo ainda não tem `empresa_id` (nunca
 * buscou automaticamente antes), cria um registro novo em `empresas` com
 * `chave_externa` derivada do ticker (sem CNPJ ainda, já que a busca
 * automática não rodou) — o usuário pode preencher o CNPJ manualmente aqui
 * mesmo, o que já ajuda a próxima dedupe.
 */
export async function atualizarEmpresaManual(ativoId: string, input: EmpresaForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { data: ativo, error: erroConsulta } = await supabase
    .from("ativos")
    .select("ticker, empresa_id")
    .eq("id", ativoId)
    .eq("profile_id", user.id)
    .single();

  if (erroConsulta || !ativo) return { error: "Ativo não encontrado." };

  const dados = {
    cnpj: input.cnpj || null,
    razao_social: input.razao_social || null,
    nome_fantasia: input.nome_fantasia || null,
    logo_url: input.logo_url || null,
    segmento: input.segmento || null,
    descricao: input.descricao || null,
    origem_dados: "manual" as const,
    atualizado_em: new Date().toISOString(),
  };

  if (ativo.empresa_id) {
    const { error } = await supabase
      .from("empresas")
      .update(dados)
      .eq("id", ativo.empresa_id)
      .eq("profile_id", user.id);
    if (error) return { error: "Não foi possível salvar os dados da empresa." };
    return {};
  }

  const chaveExterna = deriveChaveExternaEmpresa(ativo.ticker, input.cnpj || null);
  const { data: empresa, error: erroUpsert } = await supabase
    .from("empresas")
    .upsert({ profile_id: user.id, chave_externa: chaveExterna, ...dados }, { onConflict: "profile_id,chave_externa" })
    .select("id")
    .single();

  if (erroUpsert || !empresa) return { error: "Não foi possível salvar os dados da empresa." };

  const { error: erroVinculo } = await supabase
    .from("ativos")
    .update({ empresa_id: empresa.id })
    .eq("id", ativoId)
    .eq("profile_id", user.id);

  if (erroVinculo) return { error: "Empresa salva, mas não foi possível vincular ao ativo." };
  return {};
}

// ---------------------------------------------------------------------------
// Checklist comparativo (Ações/ETF/Internacional vs FIIs) + resultados
// trimestrais — ver docs/MAPA-DE-DADOS.md §8.10. Os índices do checklist
// nunca são armazenados: `obterChecklistAtivo` sempre recalcula a partir de
// `ativo_resultado_trimestral` (dados brutos) + preço atual + proventos.
// ---------------------------------------------------------------------------

export type ResultadoTrimestralItem = {
  id: string;
  anoTrimestre: string;
  receitaLiquida: number | null;
  lucroBruto: number | null;
  lucroLiquido: number | null;
  ebit: number | null;
  ebitda: number | null;
  patrimonioLiquido: number | null;
  ativoTotal: number | null;
  ativoCirculante: number | null;
  passivoCirculante: number | null;
  dividaLiquida: number | null;
  dividaBruta: number | null;
  numeroAcoes: number | null;
  valorPatrimonialCota: number | null;
  numeroNegociosMes: number | null;
  vacanciaFinanceiraPct: number | null;
  vacanciaFisicaPct: number | null;
  receitaImobiliaria: number | null;
  valorAvaliacaoImoveis: number | null;
  valorM2Aluguel: number | null;
};

export type GrupoChecklist = "acoes" | "fiis" | null;

export type ChecklistAtivoView = {
  ativoId: string;
  tipo: TipoAtivo;
  ticker: string;
  precoAtual: number;
  grupo: GrupoChecklist;
  checklistAcao: ChecklistAcao | null;
  checklistFii: ChecklistFii | null;
  saldoAcionistas: string;
  resultados: ResultadoTrimestralItem[];
};

/** Tipos que usam o template de checklist "Ações/ETF/Internacional". */
const TIPOS_CHECKLIST_ACOES: TipoAtivo[] = ["acao", "etf", "internacional"];

function grupoChecklistDoTipo(tipo: TipoAtivo): GrupoChecklist {
  if (TIPOS_CHECKLIST_ACOES.includes(tipo)) return "acoes";
  if (tipo === "fii") return "fiis";
  return null;
}

function mapResultado(r: {
  id: string;
  ano_trimestre: string;
  receita_liquida: number | null;
  lucro_bruto: number | null;
  lucro_liquido: number | null;
  ebit: number | null;
  ebitda: number | null;
  patrimonio_liquido: number | null;
  ativo_total: number | null;
  ativo_circulante: number | null;
  passivo_circulante: number | null;
  divida_liquida: number | null;
  divida_bruta: number | null;
  numero_acoes: number | null;
  valor_patrimonial_cota: number | null;
  numero_negocios_mes: number | null;
  vacancia_financeira_pct: number | null;
  vacancia_fisica_pct: number | null;
  receita_imobiliaria: number | null;
  valor_avaliacao_imoveis: number | null;
  valor_m2_aluguel: number | null;
}): ResultadoTrimestralItem {
  return {
    id: r.id,
    anoTrimestre: r.ano_trimestre,
    receitaLiquida: r.receita_liquida !== null ? Number(r.receita_liquida) : null,
    lucroBruto: r.lucro_bruto !== null ? Number(r.lucro_bruto) : null,
    lucroLiquido: r.lucro_liquido !== null ? Number(r.lucro_liquido) : null,
    ebit: r.ebit !== null ? Number(r.ebit) : null,
    ebitda: r.ebitda !== null ? Number(r.ebitda) : null,
    patrimonioLiquido: r.patrimonio_liquido !== null ? Number(r.patrimonio_liquido) : null,
    ativoTotal: r.ativo_total !== null ? Number(r.ativo_total) : null,
    ativoCirculante: r.ativo_circulante !== null ? Number(r.ativo_circulante) : null,
    passivoCirculante: r.passivo_circulante !== null ? Number(r.passivo_circulante) : null,
    dividaLiquida: r.divida_liquida !== null ? Number(r.divida_liquida) : null,
    dividaBruta: r.divida_bruta !== null ? Number(r.divida_bruta) : null,
    numeroAcoes: r.numero_acoes !== null ? Number(r.numero_acoes) : null,
    valorPatrimonialCota: r.valor_patrimonial_cota !== null ? Number(r.valor_patrimonial_cota) : null,
    numeroNegociosMes: r.numero_negocios_mes !== null ? Number(r.numero_negocios_mes) : null,
    vacanciaFinanceiraPct: r.vacancia_financeira_pct !== null ? Number(r.vacancia_financeira_pct) : null,
    vacanciaFisicaPct: r.vacancia_fisica_pct !== null ? Number(r.vacancia_fisica_pct) : null,
    receitaImobiliaria: r.receita_imobiliaria !== null ? Number(r.receita_imobiliaria) : null,
    valorAvaliacaoImoveis: r.valor_avaliacao_imoveis !== null ? Number(r.valor_avaliacao_imoveis) : null,
    valorM2Aluguel: r.valor_m2_aluguel !== null ? Number(r.valor_m2_aluguel) : null,
  };
}

/** Checklist completo de um ativo: calculado a partir dos resultados trimestrais + preço atual + proventos (Dividend Yield do FII). */
export async function obterChecklistAtivo(ativoId: string): Promise<ChecklistAtivoView | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: ativo }, { data: resultadosRaw }, { data: checklistRaw }, { data: proventosRaw }] = await Promise.all([
    supabase
      .from("ativos")
      .select("id, ticker, tipo, preco_atual")
      .eq("id", ativoId)
      .eq("profile_id", user.id)
      .maybeSingle(),
    supabase
      .from("ativo_resultado_trimestral")
      .select(
        "id, ano_trimestre, receita_liquida, lucro_bruto, lucro_liquido, ebit, ebitda, patrimonio_liquido, ativo_total, ativo_circulante, passivo_circulante, divida_liquida, divida_bruta, numero_acoes, valor_patrimonial_cota, numero_negocios_mes, vacancia_financeira_pct, vacancia_fisica_pct, receita_imobiliaria, valor_avaliacao_imoveis, valor_m2_aluguel"
      )
      .eq("profile_id", user.id)
      .eq("ativo_id", ativoId),
    supabase.from("ativo_checklist").select("saldo_acionistas").eq("profile_id", user.id).eq("ativo_id", ativoId).maybeSingle(),
    supabase
      .from("proventos")
      .select("valor_total, data:data_pagamento")
      .eq("profile_id", user.id)
      .eq("ativo_id", ativoId),
  ]);

  if (!ativo) return null;

  const tipo = ativo.tipo as TipoAtivo;
  const grupo = grupoChecklistDoTipo(tipo);
  const precoAtual = Number(ativo.preco_atual);
  const resultados = (resultadosRaw ?? []).map(mapResultado);

  let checklistAcao: ChecklistAcao | null = null;
  let checklistFii: ChecklistFii | null = null;

  if (grupo === "acoes") {
    const pontos: PontoTrimestralAcao[] = resultados.map((r) => ({
      anoTrimestre: r.anoTrimestre,
      receitaLiquida: r.receitaLiquida,
      lucroBruto: r.lucroBruto,
      lucroLiquido: r.lucroLiquido,
      ebit: r.ebit,
      ebitda: r.ebitda,
      patrimonioLiquido: r.patrimonioLiquido,
      ativoTotal: r.ativoTotal,
      ativoCirculante: r.ativoCirculante,
      passivoCirculante: r.passivoCirculante,
      dividaLiquida: r.dividaLiquida,
      dividaBruta: r.dividaBruta,
      numeroAcoes: r.numeroAcoes,
    }));
    checklistAcao = calcularChecklistAcao(pontos, precoAtual);
  } else if (grupo === "fiis") {
    const pontos: PontoTrimestralFii[] = resultados.map((r) => ({
      anoTrimestre: r.anoTrimestre,
      valorPatrimonialCota: r.valorPatrimonialCota,
      numeroNegociosMes: r.numeroNegociosMes,
      vacanciaFinanceiraPct: r.vacanciaFinanceiraPct,
      vacanciaFisicaPct: r.vacanciaFisicaPct,
      receitaImobiliaria: r.receitaImobiliaria,
      valorAvaliacaoImoveis: r.valorAvaliacaoImoveis,
      valorM2Aluguel: r.valorM2Aluguel,
    }));
    const hoje = new Date();
    const hojeStr = hoje.toISOString().slice(0, 10);
    const umAnoAtras = new Date(hoje);
    umAnoAtras.setDate(umAnoAtras.getDate() - 365);
    const cutoff = umAnoAtras.toISOString().slice(0, 10);
    // Ver docs/MAPA-DE-DADOS.md §8.23: sem o limite superior (`<= hojeStr`),
    // um provento provisionado (data_pagamento no futuro) contaria como
    // "recebido nos últimos 12 meses" — DY do FII inflado por dinheiro que
    // ainda não caiu na conta.
    const proventosUltimos12Meses = (proventosRaw ?? [])
      .filter((p) => p.data >= cutoff && p.data <= hojeStr)
      .reduce((s, p) => s + Number(p.valor_total), 0);
    checklistFii = calcularChecklistFii(pontos, precoAtual, proventosUltimos12Meses);
  }

  return {
    ativoId,
    tipo,
    ticker: ativo.ticker,
    precoAtual,
    grupo,
    checklistAcao,
    checklistFii,
    saldoAcionistas: checklistRaw?.saldo_acionistas ?? "",
    resultados: resultados.sort((a, b) => (a.anoTrimestre < b.anoTrimestre ? 1 : -1)),
  };
}

export async function salvarSaldoAcionistas(ativoId: string, input: SaldoAcionistasForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("ativo_checklist")
    .upsert(
      { profile_id: user.id, ativo_id: ativoId, saldo_acionistas: input.saldo_acionistas || null },
      { onConflict: "ativo_id" }
    );

  if (error) return { error: "Não foi possível salvar a nota de governança." };
  return {};
}

/** Cria ou atualiza (upsert por ativo+trimestre) um lançamento de resultado trimestral. */
export async function salvarResultadoTrimestral(
  ativoId: string,
  input: ResultadoTrimestralForm
): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("ativo_resultado_trimestral").upsert(
    {
      profile_id: user.id,
      ativo_id: ativoId,
      ano_trimestre: input.ano_trimestre,
      receita_liquida: input.receita_liquida,
      lucro_bruto: input.lucro_bruto,
      lucro_liquido: input.lucro_liquido,
      ebit: input.ebit,
      ebitda: input.ebitda,
      patrimonio_liquido: input.patrimonio_liquido,
      ativo_total: input.ativo_total,
      ativo_circulante: input.ativo_circulante,
      passivo_circulante: input.passivo_circulante,
      divida_liquida: input.divida_liquida,
      divida_bruta: input.divida_bruta,
      numero_acoes: input.numero_acoes,
      valor_patrimonial_cota: input.valor_patrimonial_cota,
      numero_negocios_mes: input.numero_negocios_mes,
      vacancia_financeira_pct: input.vacancia_financeira_pct,
      vacancia_fisica_pct: input.vacancia_fisica_pct,
      receita_imobiliaria: input.receita_imobiliaria,
      valor_avaliacao_imoveis: input.valor_avaliacao_imoveis,
      valor_m2_aluguel: input.valor_m2_aluguel,
    },
    { onConflict: "ativo_id,ano_trimestre" }
  );

  if (error) return { error: "Não foi possível salvar o trimestre." };
  return {};
}

export async function excluirResultadoTrimestral(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("ativo_resultado_trimestral")
    .delete()
    .eq("id", id)
    .eq("profile_id", user.id);

  if (error) return { error: "Não foi possível excluir o trimestre." };
  return {};
}

/**
 * Checklists de todos os ativos de um grupo (pra tela de comparação lado a
 * lado) — reaproveita `obterChecklistAtivo` por ativo, sem duplicar lógica.
 */
export async function obterChecklistsPorGrupo(grupo: "acoes" | "fiis"): Promise<ChecklistAtivoView[]> {
  const ativos = await obterAtivosComPosicao();
  const doGrupo = ativos.filter((a) => grupoChecklistDoTipo(a.tipo) === grupo);
  const checklists = await Promise.all(doGrupo.map((a) => obterChecklistAtivo(a.id)));
  return checklists.filter((c): c is ChecklistAtivoView => c !== null);
}
