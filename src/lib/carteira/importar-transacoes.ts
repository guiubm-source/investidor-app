"use server";

/**
 * Livro-razão → Importar por copiar/colar (ver docs/MAPA-DE-DADOS.md §8.24).
 * Fluxo em 2 passos, sem gravar nada no primeiro:
 *   1. `analisarImportacaoTransacoes` — recebe o texto colado (TSV, direto de
 *      planilha), faz o parsing e RESOLVE cada linha (ativo/corretora
 *      existentes ou a criar, câmbio USD→BRL, duplicata) sem tocar no banco
 *      além de leituras. Devolve uma pré-visualização por linha.
 *   2. `confirmarImportacaoTransacoes` — recebe só as linhas que o usuário
 *      manteve marcadas na pré-visualização e efetivamente grava: cria
 *      ativos/corretoras novos que faltarem (reaproveitando
 *      `criarAtivo`/`criarCorretora`) e insere as transações em ORDEM
 *      CRONOLÓGICA reaproveitando `criarTransacao` (mesma validação de venda
 *      retroativa e mesmo formato de insert de sempre — nenhuma lógica de
 *      gravação duplicada aqui).
 *
 * Câmbio: convertido pra BRL na importação usando a PTAX diária que já existe
 * em `indicador_dolar_diario` (Indicadores → Dólar) — nearest prior date
 * (mesmo padrão de "preço anterior" já usado em lib/carteira/posicao.ts).
 * `transacoes.cambio` grava a taxa usada, então o valor original em USD
 * continua recuperável (preco_unitario ÷ cambio) sem precisar duplicar a
 * coluna.
 */

import { createClient } from "@/lib/supabase/server";
import { criarAtivo } from "@/lib/ativos/actions";
import { criarCorretora, criarTransacao, obterCorretoras } from "./actions";
import { normalizar, parseNumeroBR, parseDataBR, resolverAtivoNovo, detectarIndicesColuna, type AtivoNovo } from "./importar-shared";

// Parsing/classificação — reaproveita os helpers compartilhados com a
// importação de Proventos (ver docs/MAPA-DE-DADOS.md §8.30) em
// `./importar-shared.ts` (normalizar/parseNumeroBR/parseDataBR/MAPA_GRUPO).

const COLUNAS_ESPERADAS = [
  "data de negociacao",
  "instituicao",
  "moeda",
  "total de taxas",
  "ativo",
  "grupo",
  "quantidade",
  "operacao",
  "tipo",
  "preco sem taxas",
  "preco com taxas",
  "total sem taxas",
  "total com taxas",
] as const;

export type StatusLinhaImportacao = "ok" | "duplicado" | "erro";

export type LinhaImportacaoParseada = {
  linha: number;
  data: string | null;
  instituicao: string;
  moeda: string;
  ativoTexto: string;
  grupoTexto: string;
  tipo: "compra" | "venda" | null;
  quantidade: number | null;
  precoUnitario: number | null;
  custos: number;
  cambio: number | null;
  precoOriginal: number | null;
  ativoId: string | null;
  ativoNovo: AtivoNovo | null;
  corretoraId: string | null;
  corretoraNova: boolean;
  status: StatusLinhaImportacao;
  mensagem?: string;
};

export type AnaliseImportacao = {
  linhas: LinhaImportacaoParseada[];
  resumo: { total: number; ok: number; duplicado: number; erro: number };
};

async function buscarCotacoesDolarNoIntervalo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  minData: string,
  maxData: string
): Promise<{ data: string; cotacao: number }[]> {
  const d = new Date(`${minData}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 10); // folga pra achar "dia útil anterior" perto do início do intervalo
  const desde = d.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("indicador_dolar_diario")
    .select("data, cotacao")
    .gte("data", desde)
    .lte("data", maxData)
    .order("data", { ascending: true });

  if (error) throw new Error(`analisarImportacaoTransacoes: falha ao ler indicador_dolar_diario — ${error.message}`);
  return (data ?? []).map((r) => ({ data: r.data as string, cotacao: Number(r.cotacao) }));
}

/** Cotação do dia OU do dia útil disponível mais recente ANTES dele (mesmo padrão de "preço anterior" de lib/carteira/posicao.ts). */
function cotacaoEmOuAntesDe(serie: { data: string; cotacao: number }[], data: string): number | null {
  let escolhida: number | null = null;
  for (const ponto of serie) {
    if (ponto.data > data) break;
    escolhida = ponto.cotacao;
  }
  return escolhida;
}

export async function analisarImportacaoTransacoes(textoColado: string): Promise<AnaliseImportacao> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { linhas: [], resumo: { total: 0, ok: 0, duplicado: 0, erro: 0 } };

  const linhasBrutas = textoColado
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (linhasBrutas.length === 0) return { linhas: [], resumo: { total: 0, ok: 0, duplicado: 0, erro: 0 } };

  const celulas = linhasBrutas.map((l) => l.split("\t"));
  const indicesCabecalho = detectarIndicesColuna(celulas[0], COLUNAS_ESPERADAS);
  const linhasDados = indicesCabecalho ? celulas.slice(1) : celulas;
  const idx = indicesCabecalho ?? COLUNAS_ESPERADAS.map((_, i) => i);
  const [
    iData,
    iInstituicao,
    iMoeda,
    iTaxas,
    iAtivo,
    iGrupo,
    iQuantidade,
    ,
    iTipo,
    iPrecoSem,
    ,
    ,
    ,
  ] = idx;

  const [{ data: ativosRaw, error: ativosError }, corretoras] = await Promise.all([
    supabase.from("ativos").select("id, ticker").eq("profile_id", user.id),
    obterCorretoras(),
  ]);
  if (ativosError) throw new Error(`analisarImportacaoTransacoes: falha ao ler ativos — ${ativosError.message}`);

  const ativoPorTicker = new Map((ativosRaw ?? []).map((a) => [normalizar(a.ticker as string), a.id as string]));
  const corretoraPorNome = new Map(corretoras.map((c) => [normalizar(c.nome), c.id]));

  // Duplicata contra o banco (mesmo critério de existeTransacaoDuplicada em
  // lib/carteira/actions.ts: ativo+data+tipo+quantidade+preço) — buscado em
  // lote (1 query) em vez de 1 query por linha.
  const { data: transacoesExistentes, error: transacoesError } = await supabase
    .from("transacoes")
    .select("ativo_id, data, tipo, quantidade, preco_unitario")
    .eq("profile_id", user.id)
    .in("tipo", ["compra", "venda"]);
  if (transacoesError) throw new Error(`analisarImportacaoTransacoes: falha ao ler transações — ${transacoesError.message}`);

  const vistos = new Set<string>(
    (transacoesExistentes ?? []).map(
      (t) => `${t.ativo_id}|${t.data}|${t.tipo}|${Number(t.quantidade)}|${Number(t.preco_unitario).toFixed(4)}`
    )
  );

  // Câmbio: só busca o intervalo de datas realmente necessário (linhas em USD).
  const datasParseadas = linhasDados
    .map((c) => parseDataBR((c[iData] ?? "").trim()))
    .filter((d): d is string => d !== null);
  let cotacoesDolar: { data: string; cotacao: number }[] = [];
  if (datasParseadas.length > 0) {
    const minData = datasParseadas.reduce((a, b) => (a < b ? a : b));
    const maxData = datasParseadas.reduce((a, b) => (a > b ? a : b));
    cotacoesDolar = await buscarCotacoesDolarNoIntervalo(supabase, minData, maxData);
  }

  const linhas: LinhaImportacaoParseada[] = linhasDados.map((celulasLinha, i) => {
    const numeroLinha = i + 1 + (indicesCabecalho ? 1 : 0);
    const cell = (n: number) => (celulasLinha[n] ?? "").trim();

    const data = parseDataBR(cell(iData));
    const instituicao = cell(iInstituicao);
    const moeda = cell(iMoeda).toUpperCase();
    const totalTaxasOriginal = parseNumeroBR(cell(iTaxas)) ?? 0;
    const ativoTexto = cell(iAtivo).toUpperCase();
    const grupoTexto = cell(iGrupo);
    const quantidadeRaw = parseNumeroBR(cell(iQuantidade));
    const tipoTexto = normalizar(cell(iTipo));
    const precoSemTaxas = parseNumeroBR(cell(iPrecoSem));

    const base: LinhaImportacaoParseada = {
      linha: numeroLinha,
      data,
      instituicao,
      moeda,
      ativoTexto,
      grupoTexto,
      tipo: null,
      quantidade: null,
      precoUnitario: null,
      custos: 0,
      cambio: null,
      precoOriginal: null,
      ativoId: null,
      ativoNovo: null,
      corretoraId: null,
      corretoraNova: false,
      status: "erro",
    };

    if (!data) return { ...base, mensagem: `Data inválida: "${cell(iData)}"` };
    if (!ativoTexto) return { ...base, mensagem: "Ativo em branco" };
    if (tipoTexto !== "compra" && tipoTexto !== "venda") {
      return { ...base, mensagem: `Tipo "${cell(iTipo)}" não reconhecido — só Compra/Venda são importadas por aqui` };
    }
    if (quantidadeRaw === null || quantidadeRaw === 0) {
      return { ...base, mensagem: `Quantidade inválida: "${cell(iQuantidade)}"` };
    }
    if (precoSemTaxas === null || precoSemTaxas < 0) {
      return { ...base, mensagem: `Preço inválido: "${cell(iPrecoSem)}"` };
    }
    if (moeda !== "BRL" && moeda !== "USD") {
      return { ...base, mensagem: `Moeda "${moeda}" não suportada (só BRL/USD por enquanto)` };
    }

    const quantidade = Math.abs(quantidadeRaw);
    const tipo = tipoTexto as "compra" | "venda";

    let cambio: number | null = null;
    let precoUnitario = precoSemTaxas;
    let custos = totalTaxasOriginal;
    if (moeda === "USD") {
      cambio = cotacaoEmOuAntesDe(cotacoesDolar, data);
      if (cambio === null) {
        return { ...base, tipo, quantidade, mensagem: `Câmbio USD/BRL não encontrado para ${data} ou datas anteriores` };
      }
      precoUnitario = Math.round(precoSemTaxas * cambio * 10000) / 10000;
      custos = Math.round(totalTaxasOriginal * cambio * 100) / 100;
    } else {
      precoUnitario = Math.round(precoSemTaxas * 10000) / 10000;
      custos = Math.round(totalTaxasOriginal * 100) / 100;
    }

    const ativoId = ativoPorTicker.get(normalizar(ativoTexto)) ?? null;
    let ativoNovo: AtivoNovo | null = null;
    if (!ativoId) {
      const resolvido = resolverAtivoNovo(grupoTexto);
      if (!resolvido) {
        return {
          ...base,
          tipo,
          quantidade,
          precoUnitario,
          custos,
          cambio,
          precoOriginal: precoSemTaxas,
          mensagem: `Ativo "${ativoTexto}" não cadastrado e categoria "${grupoTexto}" não reconhecida — cadastre manualmente antes de importar`,
        };
      }
      ativoNovo = resolvido;
    }

    const corretoraId = instituicao ? corretoraPorNome.get(normalizar(instituicao)) ?? null : null;
    const corretoraNova = instituicao !== "" && corretoraId === null;

    const chaveDuplicata = ativoId
      ? `${ativoId}|${data}|${tipo}|${quantidade}|${precoUnitario.toFixed(4)}`
      : `novo:${normalizar(ativoTexto)}|${normalizar(instituicao)}|${data}|${tipo}|${quantidade}|${precoUnitario.toFixed(4)}`;

    if (vistos.has(chaveDuplicata)) {
      return {
        ...base,
        tipo,
        quantidade,
        precoUnitario,
        custos,
        cambio,
        precoOriginal: precoSemTaxas,
        ativoId,
        ativoNovo,
        corretoraId,
        corretoraNova,
        status: "duplicado",
        mensagem: "Já existe uma transação igual (mesmo ativo, data, tipo, quantidade e preço)",
      };
    }
    vistos.add(chaveDuplicata);

    return {
      ...base,
      tipo,
      quantidade,
      precoUnitario,
      custos,
      cambio,
      precoOriginal: precoSemTaxas,
      ativoId,
      ativoNovo,
      corretoraId,
      corretoraNova,
      status: "ok",
      mensagem: undefined,
    };
  });

  const resumo = {
    total: linhas.length,
    ok: linhas.filter((l) => l.status === "ok").length,
    duplicado: linhas.filter((l) => l.status === "duplicado").length,
    erro: linhas.filter((l) => l.status === "erro").length,
  };

  return { linhas, resumo };
}

export type LinhaImportacaoConfirmar = {
  data: string;
  tipo: "compra" | "venda";
  quantidade: number;
  precoUnitario: number;
  custos: number;
  cambio: number | null;
  ativoId: string | null;
  ativoTexto: string;
  ativoNovo: AtivoNovo | null;
  corretoraId: string | null;
  corretoraTexto: string;
  corretoraNova: boolean;
};

export type ResultadoImportacao = {
  criadas: number;
  ativosCriados: number;
  corretorasCriadas: number;
  erros: string[];
};

/**
 * Grava de fato — só chamada com as linhas que sobraram marcadas na
 * pré-visualização. Ordena por data ANTES de inserir: uma venda precisa
 * encontrar a compra correspondente já na base na hora em que
 * `criarTransacao` valida "quantidade disponível na data" (mesma regra de
 * ponto-no-tempo de sempre, ver §8.11) — sem essa ordem, importar uma venda
 * antiga antes da compra que a originou seria rejeitado por "saldo
 * insuficiente" mesmo a carteira fechando positiva no final.
 */
export async function confirmarImportacaoTransacoes(linhas: LinhaImportacaoConfirmar[]): Promise<ResultadoImportacao> {
  const ordenadas = [...linhas].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  const ativoIdPorTicker = new Map<string, string>();
  const corretoraIdPorNome = new Map<string, string>();
  let ativosCriados = 0;
  let corretorasCriadas = 0;
  let criadas = 0;
  const erros: string[] = [];

  for (const linha of ordenadas) {
    let ativoId = linha.ativoId;

    if (!ativoId && linha.ativoNovo) {
      const chave = normalizar(linha.ativoTexto);
      ativoId = ativoIdPorTicker.get(chave) ?? null;
      if (!ativoId) {
        const resultado = await criarAtivo({
          ticker: linha.ativoTexto,
          nome: undefined,
          tipo: linha.ativoNovo.tipo,
          subtipo_renda_fixa: linha.ativoNovo.subtipoRendaFixa,
          cripto_exchange: null,
          subtipo_internacional: linha.ativoNovo.subtipoInternacional,
        });
        if (resultado.error || !resultado.id) {
          erros.push(`Ativo ${linha.ativoTexto}: ${resultado.error ?? "não foi possível criar"}`);
          continue;
        }
        ativoId = resultado.id;
        ativoIdPorTicker.set(chave, ativoId);
        ativosCriados++;
      }
    }

    if (!ativoId) {
      erros.push(`Linha de ${linha.ativoTexto} em ${linha.data}: ativo não resolvido, pulada.`);
      continue;
    }

    let corretoraId = linha.corretoraId;
    if (!corretoraId && linha.corretoraNova) {
      const chave = normalizar(linha.corretoraTexto);
      corretoraId = corretoraIdPorNome.get(chave) ?? null;
      if (!corretoraId) {
        await criarCorretora({ nome: linha.corretoraTexto });
        const lista = await obterCorretoras();
        const achada = lista.find((c) => normalizar(c.nome) === chave);
        if (achada) {
          corretoraId = achada.id;
          corretoraIdPorNome.set(chave, achada.id);
          corretorasCriadas++;
        }
      }
    }

    const resultado = await criarTransacao(
      {
        ativo_id: ativoId,
        corretora_id: corretoraId,
        tipo: linha.tipo,
        data: linha.data,
        quantidade: linha.quantidade,
        preco_unitario: linha.precoUnitario,
        custos: linha.custos,
        fator_proporcao: null,
        valor_capitalizado: null,
        cambio: linha.cambio,
        // Detalhe fiscal opcional (§8.32.27.1, fase 2) — importação em lote
        // não coleta esses campos, ficam null/default até edição manual.
        moeda: "BRL",
        horario_negociacao: null,
        numero_nota: null,
        numero_ordem: null,
        mercado: null,
        corretagem: null,
        emolumentos: null,
        taxa_liquidacao: null,
        outras_taxas: null,
      },
      { confirmarDuplicata: true }
    );

    if (resultado.error) erros.push(`${linha.ativoTexto} em ${linha.data}: ${resultado.error}`);
    else criadas++;
  }

  return { criadas, ativosCriados, corretorasCriadas, erros };
}
