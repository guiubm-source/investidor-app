"use server";

/**
 * Proventos → Importar por copiar/colar (ver docs/MAPA-DE-DADOS.md §8.30).
 * Mesmo padrão em 2 passos da importação de transações do Livro-razão
 * (§8.24, `lib/carteira/importar-transacoes.ts`), reaproveitando os mesmos
 * helpers de parsing/classificação (`lib/carteira/importar-shared.ts`):
 *   1. `analisarImportacaoProventos` — recebe o texto colado (TSV, direto de
 *      planilha), faz o parsing e RESOLVE cada linha (ativo existente ou a
 *      criar, tipo de provento, duplicata) sem gravar nada além de leituras.
 *   2. `confirmarImportacaoProventos` — recebe só as linhas marcadas na
 *      pré-visualização e grava de fato: cria ativos que faltarem
 *      (reaproveitando `criarAtivo`) e insere os proventos reaproveitando
 *      `criarProvento` (mesmo cálculo de valor_total de sempre — nenhuma
 *      lógica de gravação duplicada aqui).
 *
 * Diferenças em relação à importação de transações:
 * - Proventos não têm corretora (a tabela não tem essa coluna, ver §8.16) —
 *   não existe resolução/criação de corretora aqui.
 * - Duplicata NÃO é pulada sozinha: fica marcada na pré-visualização mas
 *   desmarcada por padrão — o Guilherme decide linha a linha (decisão
 *   2026-07-20, diferente da importação de transações, que pula sozinho).
 * - A coluna "Preço médio" da planilha é ignorada de propósito — só serve
 *   de contexto pro Guilherme conferir a linha, não alimenta nada no banco
 *   (ativo criado na hora nasce com preco_atual = 0, igual qualquer ativo
 *   novo cadastrado manualmente, ver §8.17).
 * - `valor_total` É SEMPRE recalculado (quantidade × valor_por_cota),
 *   nunca lido direto da coluna "Total do pgto" colada — mesma regra da
 *   aba Proventos como um todo (§8.23). O valor colado só é usado pra
 *   mostrar um aviso de conferência se divergir do calculado (arredondamento
 *   da planilha, por exemplo).
 */

import { createClient } from "@/lib/supabase/server";
import { criarAtivo } from "@/lib/ativos/actions";
import { criarProvento } from "./actions";
import { TIPOS_PROVENTO, type ProventoForm } from "./schema";
import {
  normalizar,
  parseNumeroBR,
  parseDataBR,
  resolverAtivoNovo,
  detectarIndicesColuna,
  type AtivoNovo,
} from "@/lib/carteira/importar-shared";

const COLUNAS_ESPERADAS = [
  "ativo",
  "nome do ativo",
  "tipo do ativo",
  "provento",
  "data com",
  "data pgto",
  "qtd ativos",
  "valor pago por cota",
  "total do pgto",
  "preco medio",
] as const;

/** "Provento" colado → `tipo` interno (ver TIPOS_PROVENTO em ./schema.ts). */
const MAPA_TIPO_PROVENTO: Record<string, (typeof TIPOS_PROVENTO)[number]["valor"]> = {
  dividendo: "dividendo",
  dividendos: "dividendo",
  jcp: "jcp",
  "juros sobre capital proprio": "jcp",
  rendimento: "rendimento",
  rendimentos: "rendimento",
  aluguel: "aluguel",
  "aluguel de acoes": "aluguel",
  reembolso: "reembolso",
  outro: "outro",
  outros: "outro",
};

export type StatusLinhaImportacaoProvento = "ok" | "duplicado" | "erro";

export type LinhaImportacaoProventoParseada = {
  linha: number;
  ativoTexto: string;
  nomeAtivo: string;
  tipoAtivoTexto: string;
  tipoProventoTexto: string;
  tipo: (typeof TIPOS_PROVENTO)[number]["valor"] | null;
  dataCom: string | null;
  dataPagamento: string | null;
  quantidade: number | null;
  valorPorCota: number | null;
  /** Recalculado (quantidade × valor_por_cota) — nunca o valor colado direto. */
  valorTotal: number | null;
  /** Valor da coluna "Total do pgto" colada, só pra comparar com `valorTotal` na pré-visualização. */
  valorTotalOriginal: number | null;
  ativoId: string | null;
  ativoNovo: AtivoNovo | null;
  status: StatusLinhaImportacaoProvento;
  mensagem?: string;
};

export type AnaliseImportacaoProventos = {
  linhas: LinhaImportacaoProventoParseada[];
  resumo: { total: number; ok: number; duplicado: number; erro: number };
};

export async function analisarImportacaoProventos(textoColado: string): Promise<AnaliseImportacaoProventos> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const vazio: AnaliseImportacaoProventos = { linhas: [], resumo: { total: 0, ok: 0, duplicado: 0, erro: 0 } };
  if (!user) return vazio;

  const linhasBrutas = textoColado
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (linhasBrutas.length === 0) return vazio;

  const celulas = linhasBrutas.map((l) => l.split("\t"));
  const indicesCabecalho = detectarIndicesColuna(celulas[0], COLUNAS_ESPERADAS);
  const linhasDados = indicesCabecalho ? celulas.slice(1) : celulas;
  const idx = indicesCabecalho ?? COLUNAS_ESPERADAS.map((_, i) => i);
  const [iAtivo, iNome, iTipoAtivo, iProvento, iDataCom, iDataPgto, iQtd, iValorCota, iTotalPgto] = idx;

  const { data: ativosRaw, error: ativosError } = await supabase
    .from("ativos")
    .select("id, ticker")
    .eq("profile_id", user.id);
  if (ativosError) throw new Error(`analisarImportacaoProventos: falha ao ler ativos — ${ativosError.message}`);

  const ativoPorTicker = new Map((ativosRaw ?? []).map((a) => [normalizar(a.ticker as string), a.id as string]));

  // Duplicata contra o banco: mesmo ativo + tipo + data de pagamento + valor
  // total (arredondado, ver comentário de `criarProvento`) já lançado antes.
  // Diferente da importação de transações, aqui NÃO pulamos sozinho — só
  // avisamos (decisão 2026-07-20, ver comentário no topo do arquivo).
  const { data: proventosExistentes, error: proventosError } = await supabase
    .from("proventos")
    .select("ativo_id, tipo, data_pagamento, valor_total")
    .eq("profile_id", user.id);
  if (proventosError) throw new Error(`analisarImportacaoProventos: falha ao ler proventos — ${proventosError.message}`);

  const vistos = new Set<string>(
    (proventosExistentes ?? []).map(
      (p) => `${p.ativo_id}|${p.tipo}|${p.data_pagamento}|${Number(p.valor_total).toFixed(2)}`
    )
  );
  const vistosNoLote = new Set<string>();

  const linhas: LinhaImportacaoProventoParseada[] = linhasDados.map((celulasLinha, i) => {
    const numeroLinha = i + 1 + (indicesCabecalho ? 1 : 0);
    const cell = (n: number) => (celulasLinha[n] ?? "").trim();

    const ativoTexto = cell(iAtivo).toUpperCase();
    const nomeAtivo = cell(iNome);
    const tipoAtivoTexto = cell(iTipoAtivo);
    const tipoProventoTexto = cell(iProvento);
    const dataCom = parseDataBR(cell(iDataCom));
    const dataPagamento = parseDataBR(cell(iDataPgto));
    const quantidade = parseNumeroBR(cell(iQtd));
    const valorPorCota = parseNumeroBR(cell(iValorCota));
    const valorTotalOriginal = parseNumeroBR(cell(iTotalPgto));

    const base: LinhaImportacaoProventoParseada = {
      linha: numeroLinha,
      ativoTexto,
      nomeAtivo,
      tipoAtivoTexto,
      tipoProventoTexto,
      tipo: null,
      dataCom,
      dataPagamento,
      quantidade,
      valorPorCota,
      valorTotal: null,
      valorTotalOriginal,
      ativoId: null,
      ativoNovo: null,
      status: "erro",
    };

    if (!ativoTexto) return { ...base, mensagem: "Ativo em branco" };
    if (!dataPagamento) return { ...base, mensagem: `Data de pagamento inválida: "${cell(iDataPgto)}"` };
    if (quantidade === null || quantidade <= 0) {
      return { ...base, mensagem: `Quantidade inválida: "${cell(iQtd)}"` };
    }
    if (valorPorCota === null || valorPorCota < 0) {
      return { ...base, mensagem: `Valor por cota inválido: "${cell(iValorCota)}"` };
    }

    const tipo = MAPA_TIPO_PROVENTO[normalizar(tipoProventoTexto)] ?? null;
    if (!tipo) {
      return {
        ...base,
        mensagem: `Tipo de provento "${tipoProventoTexto}" não reconhecido (esperado: Dividendo, JCP, Rendimento, Aluguel, Reembolso ou Outro)`,
      };
    }

    const valorTotal = Math.round(quantidade * valorPorCota * 100) / 100;

    const ativoId = ativoPorTicker.get(normalizar(ativoTexto)) ?? null;
    let ativoNovo: AtivoNovo | null = null;
    if (!ativoId) {
      const resolvido = resolverAtivoNovo(tipoAtivoTexto);
      if (!resolvido) {
        return {
          ...base,
          tipo,
          valorTotal,
          mensagem: `Ativo "${ativoTexto}" não cadastrado e categoria "${tipoAtivoTexto}" não reconhecida — cadastre manualmente antes de importar`,
        };
      }
      ativoNovo = resolvido;
    }

    const chaveDuplicata = ativoId
      ? `${ativoId}|${tipo}|${dataPagamento}|${valorTotal.toFixed(2)}`
      : `novo:${normalizar(ativoTexto)}|${tipo}|${dataPagamento}|${valorTotal.toFixed(2)}`;

    if (vistos.has(chaveDuplicata) || vistosNoLote.has(chaveDuplicata)) {
      return {
        ...base,
        tipo,
        valorTotal,
        ativoId,
        ativoNovo,
        status: "duplicado",
        mensagem: "Já existe um provento igual (mesmo ativo, tipo, data de pagamento e valor total)",
      };
    }
    vistosNoLote.add(chaveDuplicata);

    return {
      ...base,
      tipo,
      valorTotal,
      ativoId,
      ativoNovo,
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

export type LinhaImportacaoProventoConfirmar = {
  ativoId: string | null;
  ativoTexto: string;
  ativoNovo: AtivoNovo | null;
  tipo: (typeof TIPOS_PROVENTO)[number]["valor"];
  dataCom: string | null;
  dataPagamento: string;
  quantidade: number;
  valorPorCota: number;
};

export type ResultadoImportacaoProventos = {
  criados: number;
  ativosCriados: number;
  erros: string[];
};

export async function confirmarImportacaoProventos(
  linhas: LinhaImportacaoProventoConfirmar[]
): Promise<ResultadoImportacaoProventos> {
  const ativoIdPorTicker = new Map<string, string>();
  let ativosCriados = 0;
  let criados = 0;
  const erros: string[] = [];

  for (const linha of linhas) {
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
      erros.push(`Linha de ${linha.ativoTexto} em ${linha.dataPagamento}: ativo não resolvido, pulada.`);
      continue;
    }

    const input: ProventoForm = {
      ativo_id: ativoId,
      tipo: linha.tipo,
      data_com: linha.dataCom,
      data_pagamento: linha.dataPagamento,
      quantidade: linha.quantidade,
      valor_por_cota: linha.valorPorCota,
      // Detalhe fiscal opcional (§8.32.27.1, fase 2) — importação em lote
      // não coleta esses campos, ficam default até edição manual.
      moeda: "BRL",
      cambio: null,
      imposto_retido: 0,
      pais_fonte: "Brasil",
      fonte_pagadora_identificador: null,
    };

    const resultado = await criarProvento(input);
    if (resultado.error) erros.push(`${linha.ativoTexto} em ${linha.dataPagamento}: ${resultado.error}`);
    else criados++;
  }

  return { criados, ativosCriados, erros };
}
