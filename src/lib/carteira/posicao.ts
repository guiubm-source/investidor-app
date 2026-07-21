"use server";

/**
 * Sub-aba Posição (Carteira) — visão consolidada por classe, ver
 * docs/MAPA-DE-DADOS.md §8.16/§8.17. Diferente do livro-razão
 * (lib/carteira/actions.ts, feed cru de lançamentos) e do registro mestre
 * por ativo (lib/ativos/actions.ts, um ativo por linha), aqui agregamos por
 * CLASSE (Ações/FIIs/Tesouro/Stocks/ETF Exterior/...), com variação do dia
 * e variação total, réplica do layout MyProfit/Status Invest que o
 * Guilherme mandou por print.
 *
 * Fonte única continua sendo `transacoes` — este arquivo só recalcula posição
 * (via calcularPosicao/ordenarTransacoes, mesmas funções puras usadas em
 * lib/ativos/actions.ts) agrupando de outro jeito, e opcionalmente filtrando
 * por corretora antes de somar (cada corretora tratada como sub-livro
 * independente do mesmo ativo).
 */

import { createClient } from "@/lib/supabase/server";
import { calcularPosicao, ordenarTransacoes, type TransacaoCalc } from "@/lib/ativos/posicao-calculo";
import { TIPOS_COTACAO_AUTOMATICA } from "@/lib/ativos/yahoo-finance";
import type { TipoAtivo } from "@/lib/ativos/actions";
import type { Corretora } from "./actions";
import { ORDEM_GRUPOS, LABEL_GRUPO, grupoDoAtivo, type GrupoPosicao } from "./grupo-classificacao";

// NÃO reexportar `GrupoPosicao` daqui, nem como `export type` — build real do
// Next/Turbopack (2026-07-20, ver §8.19/§8.21) quebrou com "Export
// GrupoPosicao doesn't exist in target module" porque o transform de Server
// Actions escaneia TODO export de um arquivo `"use server"` (inclusive
// `export type`) pra montar o módulo de referências de ações, e um export só-
// de-tipo não existe em tempo de execução. `tsc --noEmit` não pega isso (é
// checagem específica do bundler do Next, não do compilador TS) — por isso
// quem precisa do tipo `GrupoPosicao` importa direto de
// `./grupo-classificacao` (ex. PosicaoView.tsx), nunca daqui.

export type PosicaoAtivo = {
  ativoId: string;
  ticker: string;
  nome: string | null;
  tipo: TipoAtivo;
  grupo: GrupoPosicao;
  quantidade: number;
  precoMedio: number;
  /**
   * Preço médio ajustado (métrica informal do investidor, NUNCA usada pro
   * IR/lucro realizado — `precoMedio` continua sendo a única fonte oficial,
   * ver §8.26): `precoMedio − (proventos já recebidos ÷ quantidade atual)`,
   * ou seja, o custo residual das cotas que você AINDA TEM (não o gasto
   * bruto histórico, que inclui cotas já vendidas — ver correção 2026-07-20
   * nos comentários de `obterPosicaoConsolidada`). Pode ficar negativo —
   * significa que os proventos já recebidos superam o capital de verdade
   * ainda "preso" na posição atual (posição "se pagou sozinha").
   */
  precoMedioAjustado: number;
  precoAtual: number;
  /** false = `preco_atual` nunca foi definido (nasce 0 no banco) — ver §8.17. UI deve mostrar "—", não R$ 0,00. */
  precoDefinido: boolean;
  diferenca: number;
  patrimonioAtual: number;
  /** null = preço não definido, ou sem nenhum preço anterior salvo pra comparar (ver §8.17). */
  variacaoHojeValor: number | null;
  variacaoHojePct: number | null;
  /**
   * "Retorno simples acumulado" (mesma fórmula unificada de
   * lib/ativos/actions.ts) — usa `totalVendidoLiquido` (dinheiro total
   * recebido em vendas passadas), não `lucroRealizado` (ver correção §8.28).
   */
  variacaoTotalValor: number | null;
  variacaoTotalPct: number | null;
  /**
   * Lucro/prejuízo JÁ REALIZADO em vendas parciais anteriores deste ativo
   * (histórico completo, nunca zera enquanto a posição ainda tem custo médio
   * — só existe na Posição pra auditar `variacaoTotalValor`, que soma esse
   * valor ao patrimônio atual antes de comparar com o total investido bruto;
   * sem expor este campo, o número de "Variação total" fica inexplicável
   * pra quem já vendeu parte de um ativo no passado, ver §8.27).
   */
  lucroRealizado: number;
  pctDentroDaClasse: number;
  pctNaCarteira: number;
  /** Total de proventos já recebidos por este ativo (todas as corretoras — proventos não têm corretora_id, ver §8.25/§8.26). */
  dividendosRecebidos: number;
};

export type PosicaoGrupo = {
  grupo: GrupoPosicao;
  label: string;
  ativos: PosicaoAtivo[];
  patrimonioAtual: number;
  pctNaCarteira: number;
  variacaoHojeValor: number;
  variacaoHojePct: number | null;
  variacaoTotalValor: number;
  variacaoTotalPct: number | null;
  /** Quantos ativos do grupo têm `precoDefinido === false` — ver §8.17. */
  semPrecoCount: number;
};

/**
 * Ativo que já teve aporte mas está com quantidade zerada hoje (sob o filtro
 * de corretora aplicado, se houver) — "participou da carteira e saiu por
 * completo". Ver docs/MAPA-DE-DADOS.md §8.25. `dividendosRecebidos` é a
 * única exceção à regra de "Posição não lê proventos" (§8.16) — decisão
 * deliberada 2026-07-20, ver comentário em `obterPosicaoConsolidada`.
 */
export type AtivoEncerrado = {
  ativoId: string;
  ticker: string;
  nome: string | null;
  grupo: GrupoPosicao;
  totalComprado: number;
  totalVendido: number;
  lucroRealizado: number;
  dividendosRecebidos: number;
  contribuicaoTotal: number;
  /**
   * Custo ajustado (ver §8.26) = totalComprado − dividendosRecebidos, em R$
   * (NÃO dividido por quantidade — quantidade é 0 num ativo encerrado, então
   * "preço por cota" não faz sentido aqui; é o equivalente em R$ do "preço
   * médio ajustado" das posições abertas). Pode ficar negativo — mesmo
   * sentido de `precoMedioAjustado`: proventos já superaram o capital
   * investido.
   */
  custoAjustado: number;
  primeiraCompra: string | null;
  ultimaVenda: string | null;
};

export type PosicaoConsolidada = {
  grupos: PosicaoGrupo[];
  corretoras: Corretora[];
  totalCarteira: number;
  variacaoHojeValor: number;
  variacaoHojePct: number | null;
  variacaoTotalValor: number;
  variacaoTotalPct: number | null;
  /** Total de ativos em posição sem preço atual definido — ver §8.17. */
  ativosSemPrecoCount: number;
  /** Ordenado por última venda mais recente primeiro — ver §8.25. */
  ativosEncerrados: AtivoEncerrado[];
};

/**
 * Preço mais recente ANTERIOR a hoje de cada ativo cotado automaticamente,
 * agrupado por (tipo, ticker) — tabela compartilhada entre usuários.
 * "Hoje" em si vem de `ativos.preco_atual` (mesma fonte do Patrimônio
 * atual) — comparar sempre contra esse valor, e não contra o penúltimo
 * ponto salvo, evita o descompasso descrito em §8.17: o cron grava aqui uma
 * vez por dia, mas o botão "Atualizar agora" só atualiza `preco_atual`
 * (não esta tabela), então os "2 últimos pontos daqui" podiam ficar
 * defasados em relação ao preço já exibido no Patrimônio.
 */
async function obterPrecoAnteriorMercado(pares: { tipo: TipoAtivo; ticker: string }[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (pares.length === 0) return mapa;

  const supabase = await createClient();
  const tickers = [...new Set(pares.map((p) => p.ticker))];
  const hojeStr = new Date().toISOString().slice(0, 10);

  // Janela de 15 dias corridos é folga suficiente pra cron diário pular
  // fim de semana/feriado e ainda achar um ponto anterior a hoje.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 15);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("ativo_preco_diario_mercado")
    .select("tipo, ticker, data, preco")
    .in("ticker", tickers)
    .gte("data", cutoffStr)
    .lt("data", hojeStr)
    .order("data", { ascending: false });

  if (error) throw new Error(`obterPrecoAnteriorMercado: falha ao ler ativo_preco_diario_mercado — ${error.message}`);

  for (const row of data ?? []) {
    const chave = `${row.tipo}:${row.ticker}`;
    // Já vem ordenado por data desc — a primeira ocorrência de cada chave é a mais recente.
    if (!mapa.has(chave)) mapa.set(chave, Number(row.preco));
  }

  return mapa;
}

/**
 * Mesma ideia de `obterPrecoAnteriorMercado`, mas pra ativos de preço
 * manual: preço mais recente salvo ANTES de hoje, por ativo_id — sem corte
 * de data (decisão 2026-07-16: "comparar com o último preço salvo, seja de
 * quando for", já que atualização manual pode ficar dias/semanas parada).
 */
async function obterPrecoAnteriorManual(ativoIds: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (ativoIds.length === 0) return mapa;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return mapa;

  const hojeStr = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("ativo_preco_diario_manual")
    .select("ativo_id, data, preco")
    .eq("profile_id", user.id)
    .in("ativo_id", ativoIds)
    .lt("data", hojeStr)
    .order("data", { ascending: false });

  if (error) throw new Error(`obterPrecoAnteriorManual: falha ao ler ativo_preco_diario_manual — ${error.message}`);

  for (const row of data ?? []) {
    if (!mapa.has(row.ativo_id)) mapa.set(row.ativo_id, Number(row.preco));
  }

  return mapa;
}

/**
 * Posição consolidada por classe — motor da sub-aba Posição. `corretoraId`
 * opcional filtra as transações antes de recalcular a posição (cada
 * corretora é um sub-livro independente do mesmo ativo, ver
 * docs/MAPA-DE-DADOS.md §8.16); `null`/omitido soma todas as corretoras.
 */
export async function obterPosicaoConsolidada(corretoraId?: string | null): Promise<PosicaoConsolidada> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const vazio: PosicaoConsolidada = {
    grupos: [],
    corretoras: [],
    totalCarteira: 0,
    variacaoHojeValor: 0,
    variacaoHojePct: null,
    variacaoTotalValor: 0,
    variacaoTotalPct: null,
    ativosSemPrecoCount: 0,
    ativosEncerrados: [],
  };
  if (!user) return vazio;

  const [ativosRes, transacoesRes, corretorasRes, proventosRes] = await Promise.all([
    supabase
      .from("ativos")
      .select("id, ticker, nome, tipo, subtipo_renda_fixa, subtipo_internacional, preco_atual, preco_atualizado_em")
      .eq("profile_id", user.id),
    supabase
      .from("transacoes")
      .select(
        "id, ativo_id, corretora_id, tipo, data, quantidade, preco_unitario, custos, fator_proporcao, valor_capitalizado, created_at"
      )
      .eq("profile_id", user.id),
    supabase.from("corretoras").select("id, nome").eq("profile_id", user.id).order("nome"),
    // Exceção deliberada à regra "Posição não lê proventos" (§8.16): usada
    // pra "Dividendos" tanto nas posições abertas (coluna por ativo, ver
    // §8.26) quanto em Ativos encerrados (§8.25) — proventos não têm
    // corretora_id (não são atribuíveis a uma corretora específica), então
    // essa coluna soma TUDO que o ativo já pagou, independente do filtro de
    // corretora selecionado.
    supabase.from("proventos").select("ativo_id, valor_total").eq("profile_id", user.id),
  ]);

  // Ver docs/MAPA-DE-DADOS.md §8.17: sem isso, uma coluna faltando no banco
  // (ex.: migração não rodada) fazia a Posição virar "carteira vazia" sem
  // nenhuma pista da causa real — agora o erro do Postgrest sobe pra tela
  // de erro do Next em vez de sumir em silêncio.
  if (ativosRes.error) throw new Error(`obterPosicaoConsolidada: falha ao ler ativos — ${ativosRes.error.message}`);
  if (transacoesRes.error) throw new Error(`obterPosicaoConsolidada: falha ao ler transações — ${transacoesRes.error.message}`);
  if (corretorasRes.error) throw new Error(`obterPosicaoConsolidada: falha ao ler corretoras — ${corretorasRes.error.message}`);
  if (proventosRes.error) throw new Error(`obterPosicaoConsolidada: falha ao ler proventos — ${proventosRes.error.message}`);

  const ativos = ativosRes.data ?? [];
  const todasTransacoes = transacoesRes.data ?? [];
  const corretoras = corretorasRes.data ?? [];

  const dividendosPorAtivo = new Map<string, number>();
  for (const p of proventosRes.data ?? []) {
    const atual = dividendosPorAtivo.get(p.ativo_id as string) ?? 0;
    dividendosPorAtivo.set(p.ativo_id as string, atual + Number(p.valor_total));
  }

  const transacoesFiltradas = corretoraId
    ? todasTransacoes.filter((t) => t.corretora_id === corretoraId)
    : todasTransacoes;

  // Posição (quantidade/preço médio/lucro realizado/total investido bruto)
  // de cada ativo, já considerando o filtro de corretora — mesmo cálculo de
  // lib/ativos/actions.ts#obterAtivosComPosicao, só que sobre o subconjunto
  // de transações filtrado.
  type PosicaoBase = {
    ativoId: string;
    ticker: string;
    nome: string | null;
    tipo: TipoAtivo;
    subtipoRendaFixa: string | null;
    subtipoInternacional: string | null;
    precoAtual: number;
    precoDefinido: boolean;
    quantidade: number;
    precoMedio: number;
    lucroRealizado: number;
    totalInvestidoBruto: number;
    totalVendidoLiquido: number;
    primeiraCompra: string | null;
    ultimaVenda: string | null;
  };

  const todasAsPosicoes: PosicaoBase[] = ativos.map((ativo) => {
    // Ver docs/MAPA-DE-DADOS.md §8.22: sem `fator_proporcao`/`valor_capitalizado`
    // aqui, um desdobramento/grupamento/bonificação lançado no Livro-razão
    // seria um no-op silencioso na Posição — o motor de cálculo
    // (`aplicarTransacaoNaPosicao`) já sabe tratar esses tipos, só precisa
    // receber os campos.
    const transacoesDoAtivo: (TransacaoCalc & { createdAt: string })[] = transacoesFiltradas
      .filter((t) => t.ativo_id === ativo.id)
      .map((t) => ({
        tipo: t.tipo as TransacaoCalc["tipo"],
        data: t.data as string,
        quantidade: t.quantidade !== null ? Number(t.quantidade) : null,
        precoUnitario: t.preco_unitario !== null ? Number(t.preco_unitario) : null,
        custos: t.custos !== null ? Number(t.custos) : null,
        fatorProporcao: t.fator_proporcao !== null ? Number(t.fator_proporcao) : null,
        valorCapitalizado: t.valor_capitalizado !== null ? Number(t.valor_capitalizado) : null,
        createdAt: t.created_at as string,
      }));

    const ordenadas = ordenarTransacoes(transacoesDoAtivo);
    const { quantidade, precoMedio, lucroRealizado, totalInvestidoBruto, totalVendidoLiquido } =
      calcularPosicao(ordenadas);

    // Ver docs/MAPA-DE-DADOS.md §8.25 — só usado pela seção "Ativos
    // encerrados" (coluna "Período"), não afeta nenhum outro cálculo.
    const datasCompra = ordenadas.filter((t) => t.tipo === "compra").map((t) => t.data);
    const datasVenda = ordenadas.filter((t) => t.tipo === "venda").map((t) => t.data);
    const primeiraCompra = datasCompra.length > 0 ? datasCompra.reduce((a, b) => (a < b ? a : b)) : null;
    const ultimaVenda = datasVenda.length > 0 ? datasVenda.reduce((a, b) => (a > b ? a : b)) : null;

    return {
      ativoId: ativo.id,
      ticker: ativo.ticker,
      nome: ativo.nome,
      tipo: ativo.tipo as TipoAtivo,
      subtipoRendaFixa: ativo.subtipo_renda_fixa,
      subtipoInternacional: ativo.subtipo_internacional,
      precoAtual: Number(ativo.preco_atual),
      precoDefinido: ativo.preco_atualizado_em !== null,
      quantidade,
      precoMedio,
      lucroRealizado,
      totalInvestidoBruto,
      totalVendidoLiquido,
      primeiraCompra,
      ultimaVenda,
    };
  });

  // Só entra na Posição "de pé" quem ainda tem quantidade em carteira (sob o
  // filtro de corretora aplicado, se houver) — ativo zerado não é
  // "posição", já saiu por completo (esse vai pra "Ativos encerrados").
  const posicoesBase = todasAsPosicoes.filter((p) => p.quantidade > 0);

  // Ver docs/MAPA-DE-DADOS.md §8.25: ativo que já teve aporte (totalInvestidoBruto
  // > 0) mas está zerado hoje — "participou da carteira", não é um ativo
  // cadastrado à toa sem nenhuma transação (esses ficam de fora, quantidade
  // e totalInvestidoBruto ambos 0).
  const posicoesEncerradas = todasAsPosicoes.filter((p) => p.quantidade <= 0 && p.totalInvestidoBruto > 0);

  // Busca em lote o último preço ANTERIOR a hoje (mercado + manual) pra
  // "variação hoje" — uma query por fonte, não uma por ativo.
  const paresAutomaticos = posicoesBase
    .filter((p) => TIPOS_COTACAO_AUTOMATICA.includes(p.tipo))
    .map((p) => ({ tipo: p.tipo, ticker: p.ticker }));
  const idsManuais = posicoesBase.filter((p) => !TIPOS_COTACAO_AUTOMATICA.includes(p.tipo)).map((p) => p.ativoId);

  const [precosAnterioresMercado, precosAnterioresManuais] = await Promise.all([
    obterPrecoAnteriorMercado(paresAutomaticos),
    obterPrecoAnteriorManual(idsManuais),
  ]);

  const totalCarteira = posicoesBase.reduce((s, p) => s + p.quantidade * p.precoAtual, 0);

  const ativosCalculados: PosicaoAtivo[] = posicoesBase.map((p) => {
    const patrimonioAtual = p.quantidade * p.precoAtual;
    const diferenca = p.precoAtual - p.precoMedio;

    const precoAnterior = TIPOS_COTACAO_AUTOMATICA.includes(p.tipo)
      ? precosAnterioresMercado.get(`${p.tipo}:${p.ticker}`)
      : precosAnterioresManuais.get(p.ativoId);

    // "Hoje" é sempre `preco_atual` (mesma fonte do Patrimônio atual, ver
    // comentário em obterPrecoAnteriorMercado) — só falta o "ontem".
    let variacaoHojeValor: number | null = null;
    let variacaoHojePct: number | null = null;
    if (p.precoDefinido && precoAnterior !== undefined && precoAnterior > 0) {
      variacaoHojeValor = p.quantidade * (p.precoAtual - precoAnterior);
      variacaoHojePct = ((p.precoAtual - precoAnterior) / precoAnterior) * 100;
    }

    // Ver §8.28 (correção 2026-07-20) — "retorno simples acumulado": usa
    // `totalVendidoLiquido` (dinheiro TOTAL já embolsado em vendas — principal
    // + lucro), não `lucroRealizado` (só a fatia de LUCRO da venda). Bug
    // anterior subestimava (às vezes catastroficamente) o retorno de
    // qualquer ativo com venda parcial no passado, porque descartava o
    // principal devolvido — só olhava o lucro da venda, como se o dinheiro do
    // custo de aquisição das cotas vendidas tivesse simplesmente sumido.
    const variacaoTotalValor =
      p.totalInvestidoBruto > 0 ? patrimonioAtual + p.totalVendidoLiquido - p.totalInvestidoBruto : null;
    const variacaoTotalPct =
      p.totalInvestidoBruto > 0 ? ((patrimonioAtual + p.totalVendidoLiquido) / p.totalInvestidoBruto - 1) * 100 : null;

    // Ver §8.27 (correção 2026-07-20) — preço médio ajustado (informal, não
    // afeta IR): custo RESIDUAL das cotas que ainda estão em carteira
    // (precoMedio × quantidade = custoTotal), líquido de proventos já
    // recebidos, dividido pela quantidade atual. Equivale a
    // `precoMedio − dividendosRecebidos/quantidade`.
    //
    // Bug anterior: usava `totalInvestidoBruto` (soma bruta de TODA compra
    // já feita, incluindo cotas já vendidas no passado) em vez do custo
    // residual — pra um ativo com histórico de venda parcial isso infla o
    // preço médio ajustado pra um valor sem sentido (ex.: AZZA3 mostrava
    // R$116,26 de "ajustado" com preço médio oficial de R$28,71, porque
    // totalInvestidoBruto carregava o custo de cotas já vendidas há muito
    // tempo, dividido pela quantidade pequena que sobrou hoje).
    const dividendosRecebidos = dividendosPorAtivo.get(p.ativoId) ?? 0;
    const precoMedioAjustado = p.quantidade > 0 ? p.precoMedio - dividendosRecebidos / p.quantidade : p.precoMedio;

    return {
      ativoId: p.ativoId,
      ticker: p.ticker,
      nome: p.nome,
      tipo: p.tipo,
      grupo: grupoDoAtivo(p.tipo, p.subtipoRendaFixa, p.subtipoInternacional),
      quantidade: p.quantidade,
      precoMedio: p.precoMedio,
      precoMedioAjustado,
      precoAtual: p.precoAtual,
      precoDefinido: p.precoDefinido,
      diferenca,
      patrimonioAtual,
      variacaoHojeValor,
      variacaoHojePct,
      variacaoTotalValor,
      variacaoTotalPct,
      lucroRealizado: p.lucroRealizado,
      pctDentroDaClasse: 0, // preenchido depois de agrupar
      pctNaCarteira: totalCarteira > 0 ? (patrimonioAtual / totalCarteira) * 100 : 0,
      dividendosRecebidos,
    };
  });

  // Agrupa por classe.
  const porGrupo = new Map<GrupoPosicao, PosicaoAtivo[]>();
  for (const a of ativosCalculados) {
    const lista = porGrupo.get(a.grupo) ?? [];
    lista.push(a);
    porGrupo.set(a.grupo, lista);
  }

  const grupos: PosicaoGrupo[] = ORDEM_GRUPOS.filter((g) => porGrupo.has(g)).map((grupo) => {
    const ativosDoGrupo = porGrupo.get(grupo)!;
    const patrimonioGrupo = ativosDoGrupo.reduce((s, a) => s + a.patrimonioAtual, 0);

    // Preenche % dentro da classe agora que o total do grupo é conhecido.
    for (const a of ativosDoGrupo) {
      a.pctDentroDaClasse = patrimonioGrupo > 0 ? (a.patrimonioAtual / patrimonioGrupo) * 100 : 0;
    }

    // Variação hoje do grupo: soma valor de quem tem variação conhecida,
    // dividido pelo patrimônio de ontem desse mesmo subconjunto (ativos sem
    // preço definido ou sem preço anterior salvo ficam de fora da conta em
    // R$ e %, não distorcem o denominador).
    let somaHoje = 0;
    let somaOntem = 0;
    for (const a of ativosDoGrupo) {
      if (a.variacaoHojeValor !== null) {
        somaHoje += a.variacaoHojeValor;
        somaOntem += a.patrimonioAtual - a.variacaoHojeValor;
      }
    }
    const variacaoHojePct = somaOntem > 0 ? (somaHoje / somaOntem) * 100 : null;

    // Variação total do grupo: mesma fórmula unificada, agregada (ver §8.28 —
    // totalVendidoLiquido, não lucroRealizado).
    const somaVendidoLiquido = posicoesBase
      .filter((p) => ativosDoGrupo.some((a) => a.ativoId === p.ativoId))
      .reduce((s, p) => s + p.totalVendidoLiquido, 0);
    const somaInvestidoBruto = posicoesBase
      .filter((p) => ativosDoGrupo.some((a) => a.ativoId === p.ativoId))
      .reduce((s, p) => s + p.totalInvestidoBruto, 0);
    const variacaoTotalValor = somaInvestidoBruto > 0 ? patrimonioGrupo + somaVendidoLiquido - somaInvestidoBruto : 0;
    const variacaoTotalPct =
      somaInvestidoBruto > 0 ? ((patrimonioGrupo + somaVendidoLiquido) / somaInvestidoBruto - 1) * 100 : null;

    return {
      grupo,
      label: LABEL_GRUPO[grupo],
      ativos: ativosDoGrupo.sort((a, b) => b.patrimonioAtual - a.patrimonioAtual),
      patrimonioAtual: patrimonioGrupo,
      pctNaCarteira: totalCarteira > 0 ? (patrimonioGrupo / totalCarteira) * 100 : 0,
      variacaoHojeValor: somaHoje,
      variacaoHojePct,
      variacaoTotalValor,
      variacaoTotalPct,
      semPrecoCount: ativosDoGrupo.filter((a) => !a.precoDefinido).length,
    };
  });

  const totalHojeValor = grupos.reduce((s, g) => s + g.variacaoHojeValor, 0);
  const totalOntem = ativosCalculados.reduce(
    (s, a) => (a.variacaoHojeValor !== null ? s + (a.patrimonioAtual - a.variacaoHojeValor) : s),
    0
  );
  const totalVariacaoHojePct = totalOntem > 0 ? (totalHojeValor / totalOntem) * 100 : null;

  // Ver §8.28 — totalVendidoLiquido, não lucroRealizado (mesma correção
  // aplicada por ativo e por grupo, agora também no total da carteira).
  const totalVendidoLiquido = posicoesBase.reduce((s, p) => s + p.totalVendidoLiquido, 0);
  const totalInvestidoBruto = posicoesBase.reduce((s, p) => s + p.totalInvestidoBruto, 0);
  const totalVariacaoTotalValor =
    totalInvestidoBruto > 0 ? totalCarteira + totalVendidoLiquido - totalInvestidoBruto : 0;
  const totalVariacaoTotalPct =
    totalInvestidoBruto > 0 ? ((totalCarteira + totalVendidoLiquido) / totalInvestidoBruto - 1) * 100 : null;

  // Ver docs/MAPA-DE-DADOS.md §8.25 — "Ativos encerrados": ordenado por data
  // da última venda mais recente primeiro (linha do tempo de saídas).
  const ativosEncerrados: AtivoEncerrado[] = posicoesEncerradas
    .map((p) => {
      const dividendosRecebidos = dividendosPorAtivo.get(p.ativoId) ?? 0;
      return {
        ativoId: p.ativoId,
        ticker: p.ticker,
        nome: p.nome,
        grupo: grupoDoAtivo(p.tipo, p.subtipoRendaFixa, p.subtipoInternacional),
        totalComprado: p.totalInvestidoBruto,
        totalVendido: p.totalVendidoLiquido,
        lucroRealizado: p.lucroRealizado,
        dividendosRecebidos,
        contribuicaoTotal: p.lucroRealizado + dividendosRecebidos,
        custoAjustado: p.totalInvestidoBruto - dividendosRecebidos,
        primeiraCompra: p.primeiraCompra,
        ultimaVenda: p.ultimaVenda,
      };
    })
    .sort((a, b) => {
      if (a.ultimaVenda === b.ultimaVenda) return 0;
      if (a.ultimaVenda === null) return 1;
      if (b.ultimaVenda === null) return -1;
      return a.ultimaVenda < b.ultimaVenda ? 1 : -1;
    });

  return {
    grupos,
    corretoras,
    totalCarteira,
    variacaoHojeValor: totalHojeValor,
    variacaoHojePct: totalVariacaoHojePct,
    variacaoTotalValor: totalVariacaoTotalValor,
    variacaoTotalPct: totalVariacaoTotalPct,
    ativosSemPrecoCount: posicoesBase.filter((p) => !p.precoDefinido).length,
    ativosEncerrados,
  };
}
