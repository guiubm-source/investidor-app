"use server";

import { createClient } from "@/lib/supabase/server";
import type {
  DecisaoSelicForm,
  DolarMensalForm,
  FluxoEstrangeiroMensalForm,
  ImportarSelicForm,
  IpcaCategoriaForm,
  IpcaMensalForm,
  NovaReuniaoSelicForm,
  SelicReuniaoEditForm,
} from "./schema";
import { CATEGORIAS_IPCA, META_IPCA_CENTRO, META_IPCA_TOLERANCIA } from "./schema";
import {
  adicionarDias,
  calcularEstatisticas,
  calcularSequenciaConsecutiva,
  derivarReunioes,
  diasEntre,
  parseImportacaoSelic,
  type DecisaoTipo,
  type PontoSelic,
  type SelicEstatisticas,
  type SelicReuniaoDerivada,
} from "./selic-estatisticas";
import { obterDiretoriaBacen, presidenteBcVigente, type DiretorBacen } from "@/lib/referencia/actions";

export type AcaoResultado = { error?: string };

type Tendencia = "alta" | "queda" | "estavel" | null;

function calcularTendencia(atual: number | null, anterior: number | null): Tendencia {
  if (atual === null || anterior === null) return null;
  if (atual > anterior) return "alta";
  if (atual < anterior) return "queda";
  return "estavel";
}

/**
 * Indicadores macro (Selic, IPCA, Dólar, Fluxo estrangeiro) são dado OFICIAL,
 * igual para qualquer usuário — por isso as tabelas não têm profile_id e as
 * funções aqui não filtram por dono da linha (ver docs/MAPA-DE-DADOS.md
 * §8.3.8 e comentário no topo da seção 10 de supabase/schema.sql). Ainda
 * assim exigimos sessão ativa antes de escrever, por segurança básica.
 */

// ---------------------------------------------------------------------------
// Selic / Copom
// ---------------------------------------------------------------------------

export type SelicReuniao = SelicReuniaoDerivada;

export type SelicView = {
  reunioes: SelicReuniao[];
  proximaReuniao: SelicReuniao | null;
  ultimaTaxa: number | null;
  dataVigenciaAtual: string | null;
  diasVigente: number | null;
  tendencia: Tendencia;
  ultimaDecisao: { tipo: DecisaoTipo; variacao: number } | null;
  decisoesConsecutivas: { tipo: DecisaoTipo; quantidade: number } | null;
  presidenteBc: DiretorBacen | null;
  estatisticas: SelicEstatisticas;
};

/**
 * Motor da Selic — ver docs/MAPA-DE-DADOS.md §8.7. Todo campo derivado
 * (variação, decisão, sequência, tendência, dias vigente, estatísticas) é
 * SEMPRE recalculado aqui a partir de `indicador_selic_reunioes`, nunca lido
 * de coluna própria — cálculo puro fica em `selic-estatisticas.ts`.
 */
export async function obterSelic(): Promise<SelicView> {
  const supabase = await createClient();
  const [{ data }, diretoria] = await Promise.all([
    supabase
      .from("indicador_selic_reunioes")
      .select("id, numero_reuniao, data_inicio, data_fim, taxa_definida")
      .order("data_inicio", { ascending: true }),
    obterDiretoriaBacen(),
  ]);

  const pontos: PontoSelic[] = (data ?? []).map((r) => ({
    id: r.id,
    numeroReuniao: r.numero_reuniao,
    dataInicio: r.data_inicio,
    dataFim: r.data_fim,
    taxaDefinida: r.taxa_definida === null ? null : Number(r.taxa_definida),
  }));

  const reunioes = derivarReunioes(pontos);
  const decididas = reunioes.filter((r) => r.decidido);
  const ultima = decididas.at(-1) ?? null;
  const penultima = decididas.at(-2) ?? null;
  const proximaReuniao = reunioes.find((r) => !r.decidido) ?? null;
  const hoje = new Date().toISOString().slice(0, 10);

  return {
    reunioes,
    proximaReuniao,
    ultimaTaxa: ultima?.taxaDefinida ?? null,
    dataVigenciaAtual: ultima?.dataVigencia ?? null,
    diasVigente: ultima?.dataVigencia ? diasEntre(ultima.dataVigencia, hoje) : null,
    tendencia: calcularTendencia(ultima?.taxaDefinida ?? null, penultima?.taxaDefinida ?? null),
    ultimaDecisao: ultima?.decisaoTipo ? { tipo: ultima.decisaoTipo, variacao: ultima.variacao! } : null,
    decisoesConsecutivas: calcularSequenciaConsecutiva(reunioes),
    presidenteBc: await presidenteBcVigente(diretoria),
    estatisticas: calcularEstatisticas(reunioes),
  };
}

/** Lançamento manual linha a linha (fluxo original, continua existindo ao lado da importação em massa). */
export async function lancarDecisaoSelic(input: DecisaoSelicForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const payload: Record<string, unknown> = {
    taxa_definida: input.taxa_definida,
    decidido_em: new Date().toISOString(),
  };
  if (input.numero_reuniao !== null) payload.numero_reuniao = input.numero_reuniao;

  const { error } = await supabase.from("indicador_selic_reunioes").update(payload).eq("id", input.reuniao_id);

  if (error) return { error: "Não foi possível registrar a decisão do Copom." };
  return {};
}

/** Edição completa de uma reunião existente (bloco 4 — histórico). */
export async function editarReuniaoSelic(input: SelicReuniaoEditForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("indicador_selic_reunioes")
    .update({
      numero_reuniao: input.numero_reuniao,
      data_inicio: input.data_inicio,
      data_fim: input.data_fim,
      taxa_definida: input.taxa_definida,
    })
    .eq("id", input.id);

  if (error) return { error: "Não foi possível salvar. Confira se a data ou o número da reunião não estão duplicados." };
  return {};
}

/** Criação manual de uma reunião nova (bloco 4 — "+ Nova reunião" e "Duplicar"). */
export async function criarReuniaoSelic(input: NovaReuniaoSelicForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("indicador_selic_reunioes").insert({
    numero_reuniao: input.numero_reuniao,
    data_inicio: input.data_inicio,
    data_fim: input.data_fim,
    taxa_definida: input.taxa_definida,
    decidido_em: input.taxa_definida !== null ? new Date().toISOString() : null,
  });

  if (error) return { error: "Não foi possível criar a reunião. Confira se a data ou o número não estão duplicados." };
  return {};
}

export async function excluirReuniaoSelic(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const { error } = await supabase.from("indicador_selic_reunioes").delete().eq("id", id);
  if (error) return { error: "Não foi possível excluir a reunião." };
  return {};
}

export async function excluirReunioesSelic(ids: string[]): Promise<AcaoResultado> {
  if (ids.length === 0) return {};
  const supabase = await createClient();
  const { error } = await supabase.from("indicador_selic_reunioes").delete().in("id", ids);
  if (error) return { error: "Não foi possível excluir as reuniões selecionadas." };
  return {};
}

export type ImportacaoSelicResultado = AcaoResultado & { importados?: number; avisos?: string[] };

/**
 * Importação em massa (bloco 5) — cola texto "REUNIÃO / DATA / SELIC" (ou só
 * "DATA / SELIC"), faz upsert por `data_inicio` (já é unique na tabela).
 * `data_fim` é sempre `data_inicio + 1 dia` quando cria uma reunião nova
 * (ajustável manualmente depois). Parser puro em `selic-estatisticas.ts`.
 */
export async function importarHistoricoSelic(input: ImportarSelicForm): Promise<ImportacaoSelicResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { linhas, erros } = parseImportacaoSelic(input.texto);

  if (linhas.length === 0) {
    return { error: erros[0] ?? "Nenhuma linha válida encontrada para importar.", avisos: erros };
  }

  // Upsert linha a linha (não em lote): se a data já existe, preserva o
  // numero_reuniao gravado quando a linha colada não trouxe número (evita
  // apagar um número já lançado antes por causa de uma reimportação parcial).
  let importados = 0;
  const errosGravacao: string[] = [...erros];

  for (const linha of linhas) {
    const { data: existente } = await supabase
      .from("indicador_selic_reunioes")
      .select("id, numero_reuniao")
      .eq("data_inicio", linha.data)
      .maybeSingle();

    if (existente) {
      const { error } = await supabase
        .from("indicador_selic_reunioes")
        .update({
          taxa_definida: linha.taxa,
          numero_reuniao: linha.numeroReuniao ?? existente.numero_reuniao,
          decidido_em: new Date().toISOString(),
        })
        .eq("id", existente.id);
      if (error) {
        errosGravacao.push(`Data ${linha.data}: não foi possível atualizar (${error.message}).`);
        continue;
      }
    } else {
      const { error } = await supabase.from("indicador_selic_reunioes").insert({
        data_inicio: linha.data,
        data_fim: adicionarDias(linha.data, 1),
        taxa_definida: linha.taxa,
        numero_reuniao: linha.numeroReuniao,
        decidido_em: new Date().toISOString(),
      });
      if (error) {
        errosGravacao.push(`Data ${linha.data}: não foi possível inserir (${error.message}).`);
        continue;
      }
    }
    importados++;
  }

  if (importados === 0) {
    return { error: errosGravacao[0] ?? "Não foi possível importar nenhuma linha.", avisos: errosGravacao };
  }

  return { importados, avisos: errosGravacao.length > 0 ? errosGravacao : undefined };
}

// ---------------------------------------------------------------------------
// IPCA
// ---------------------------------------------------------------------------

export type IpcaMensal = {
  id: string;
  anoMes: string;
  variacaoPct: number;
  acumulado12mPct: number | null;
};

export type IpcaCategoria = {
  id: string;
  anoMes: string;
  categoria: string;
  categoriaLabel: string;
  variacaoPct: number;
};

export type IpcaView = {
  mensal: IpcaMensal[];
  categorias: IpcaCategoria[];
  ultimoMes: IpcaMensal | null;
  metaCentro: number;
  metaBanda: [number, number];
  dentroDaMeta: boolean | null;
};

export async function obterIpca(): Promise<IpcaView> {
  const supabase = await createClient();
  const [{ data: mensalRaw }, { data: categoriaRaw }] = await Promise.all([
    supabase.from("indicador_ipca_mensal").select("id, ano_mes, variacao_pct, acumulado_12m_pct").order("ano_mes", { ascending: false }),
    supabase.from("indicador_ipca_categoria").select("id, ano_mes, categoria, variacao_pct").order("ano_mes", { ascending: false }),
  ]);

  const mensal: IpcaMensal[] = (mensalRaw ?? []).map((m) => ({
    id: m.id,
    anoMes: m.ano_mes,
    variacaoPct: Number(m.variacao_pct),
    acumulado12mPct: m.acumulado_12m_pct === null ? null : Number(m.acumulado_12m_pct),
  }));

  const categorias: IpcaCategoria[] = (categoriaRaw ?? []).map((c) => ({
    id: c.id,
    anoMes: c.ano_mes,
    categoria: c.categoria,
    categoriaLabel: CATEGORIAS_IPCA.find((cat) => cat.valor === c.categoria)?.label ?? c.categoria,
    variacaoPct: Number(c.variacao_pct),
  }));

  const ultimoMes = mensal[0] ?? null;
  const bandaMin = META_IPCA_CENTRO - META_IPCA_TOLERANCIA;
  const bandaMax = META_IPCA_CENTRO + META_IPCA_TOLERANCIA;
  const dentroDaMeta =
    ultimoMes?.acumulado12mPct == null ? null : ultimoMes.acumulado12mPct >= bandaMin && ultimoMes.acumulado12mPct <= bandaMax;

  return { mensal, categorias, ultimoMes, metaCentro: META_IPCA_CENTRO, metaBanda: [bandaMin, bandaMax], dentroDaMeta };
}

export async function criarIpcaMensal(input: IpcaMensalForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("indicador_ipca_mensal").upsert(
    { ano_mes: input.ano_mes, variacao_pct: input.variacao_pct, acumulado_12m_pct: input.acumulado_12m_pct ?? null },
    { onConflict: "ano_mes" }
  );

  if (error) return { error: "Não foi possível registrar o IPCA do mês." };
  return {};
}

export async function excluirIpcaMensal(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const { error } = await supabase.from("indicador_ipca_mensal").delete().eq("id", id);
  if (error) return { error: "Não foi possível excluir o lançamento." };
  return {};
}

export async function criarIpcaCategoria(input: IpcaCategoriaForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("indicador_ipca_categoria")
    .upsert(
      { ano_mes: input.ano_mes, categoria: input.categoria, variacao_pct: input.variacao_pct },
      { onConflict: "ano_mes,categoria" }
    );

  if (error) return { error: "Não foi possível registrar o IPCA da categoria." };
  return {};
}

export async function excluirIpcaCategoria(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const { error } = await supabase.from("indicador_ipca_categoria").delete().eq("id", id);
  if (error) return { error: "Não foi possível excluir o lançamento." };
  return {};
}

// ---------------------------------------------------------------------------
// Dólar
// ---------------------------------------------------------------------------

export type DolarMensal = { id: string; anoMes: string; cotacao: number };
export type DolarView = { mensal: DolarMensal[]; ultimo: DolarMensal | null; tendencia: Tendencia };

export async function obterDolar(): Promise<DolarView> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("indicador_dolar_mensal")
    .select("id, ano_mes, cotacao")
    .order("ano_mes", { ascending: false });

  const mensal: DolarMensal[] = (data ?? []).map((d) => ({ id: d.id, anoMes: d.ano_mes, cotacao: Number(d.cotacao) }));
  const ultimo = mensal[0] ?? null;
  const penultimo = mensal[1] ?? null;

  return { mensal, ultimo, tendencia: calcularTendencia(ultimo?.cotacao ?? null, penultimo?.cotacao ?? null) };
}

export async function criarDolarMensal(input: DolarMensalForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("indicador_dolar_mensal")
    .upsert({ ano_mes: input.ano_mes, cotacao: input.cotacao }, { onConflict: "ano_mes" });

  if (error) return { error: "Não foi possível registrar a cotação do mês." };
  return {};
}

export async function excluirDolarMensal(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const { error } = await supabase.from("indicador_dolar_mensal").delete().eq("id", id);
  if (error) return { error: "Não foi possível excluir o lançamento." };
  return {};
}

// ---------------------------------------------------------------------------
// Fluxo estrangeiro
// ---------------------------------------------------------------------------

export type FluxoEstrangeiroMensal = { id: string; anoMes: string; saldoLiquido: number };
export type FluxoEstrangeiroView = {
  mensal: FluxoEstrangeiroMensal[];
  ultimo: FluxoEstrangeiroMensal | null;
  tendencia: Tendencia;
};

export async function obterFluxoEstrangeiro(): Promise<FluxoEstrangeiroView> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("indicador_fluxo_estrangeiro_mensal")
    .select("id, ano_mes, saldo_liquido")
    .order("ano_mes", { ascending: false });

  const mensal: FluxoEstrangeiroMensal[] = (data ?? []).map((f) => ({
    id: f.id,
    anoMes: f.ano_mes,
    saldoLiquido: Number(f.saldo_liquido),
  }));
  const ultimo = mensal[0] ?? null;
  const penultimo = mensal[1] ?? null;

  return {
    mensal,
    ultimo,
    tendencia: calcularTendencia(ultimo?.saldoLiquido ?? null, penultimo?.saldoLiquido ?? null),
  };
}

export async function criarFluxoEstrangeiroMensal(input: FluxoEstrangeiroMensalForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("indicador_fluxo_estrangeiro_mensal")
    .upsert({ ano_mes: input.ano_mes, saldo_liquido: input.saldo_liquido }, { onConflict: "ano_mes" });

  if (error) return { error: "Não foi possível registrar o fluxo do mês." };
  return {};
}

export async function excluirFluxoEstrangeiroMensal(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const { error } = await supabase.from("indicador_fluxo_estrangeiro_mensal").delete().eq("id", id);
  if (error) return { error: "Não foi possível excluir o lançamento." };
  return {};
}

// ---------------------------------------------------------------------------
// Visão Geral — só leitura, combina os quatro indicadores (ver
// docs/MAPA-DE-DADOS.md §8.4: "A sub-aba Visão Geral só lê os quatro
// conjuntos de dados, nunca escreve").
// ---------------------------------------------------------------------------

export type PainelItem = { label: string; valor: string; tendencia: Tendencia };

export type VisaoGeralView = {
  painel: PainelItem[];
  leitura: string;
};

export async function obterVisaoGeral(): Promise<VisaoGeralView> {
  const [selic, ipca, dolar, fluxo] = await Promise.all([
    obterSelic(),
    obterIpca(),
    obterDolar(),
    obterFluxoEstrangeiro(),
  ]);

  const painel: PainelItem[] = [
    {
      label: "Selic",
      valor: selic.ultimaTaxa !== null ? `${selic.ultimaTaxa.toFixed(2)}% a.a.` : "—",
      tendencia: selic.tendencia,
    },
    {
      label: "IPCA (12m)",
      valor: ipca.ultimoMes?.acumulado12mPct != null ? `${ipca.ultimoMes.acumulado12mPct.toFixed(2)}%` : "—",
      tendencia: null,
    },
    {
      label: "Dólar",
      valor: dolar.ultimo ? `R$ ${dolar.ultimo.cotacao.toFixed(2)}` : "—",
      tendencia: dolar.tendencia,
    },
    {
      label: "Fluxo estrangeiro",
      valor: fluxo.ultimo ? fluxo.ultimo.saldoLiquido.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—",
      tendencia: fluxo.tendencia,
    },
  ];

  // Leitura interpretativa combinada — heurística simples e transparente,
  // não é recomendação de investimento (ver docs/MAPA-DE-DADOS.md §8.3.3).
  const sinaisDados = [selic.tendencia, ipca.dentroDaMeta, dolar.tendencia, fluxo.tendencia].some((v) => v !== null);

  if (!sinaisDados) {
    return {
      painel,
      leitura:
        "Ainda não há lançamentos suficientes para gerar uma leitura combinada. Registre ao menos dois períodos em cada indicador.",
    };
  }

  let pontosCautela = 0;
  let pontosFavoraveis = 0;
  const observacoes: string[] = [];

  if (selic.tendencia === "alta") {
    pontosCautela++;
    observacoes.push("Selic em alta (juro mais restritivo, tende a pressionar crédito e consumo)");
  } else if (selic.tendencia === "queda") {
    pontosFavoraveis++;
    observacoes.push("Selic em queda (juro mais estimulativo)");
  }

  if (ipca.dentroDaMeta === false) {
    pontosCautela++;
    observacoes.push("IPCA acumulado em 12 meses fora da banda da meta (3% ± 1,5 p.p.)");
  } else if (ipca.dentroDaMeta === true) {
    pontosFavoraveis++;
    observacoes.push("IPCA acumulado em 12 meses dentro da banda da meta");
  }

  if (dolar.tendencia === "alta") {
    pontosCautela++;
    observacoes.push("Dólar em alta (pressiona inflação de importados e custo de dívida em moeda estrangeira)");
  } else if (dolar.tendencia === "queda") {
    pontosFavoraveis++;
    observacoes.push("Dólar em queda");
  }

  if (fluxo.tendencia === "queda" && fluxo.ultimo && fluxo.ultimo.saldoLiquido < 0) {
    pontosCautela++;
    observacoes.push("Fluxo estrangeiro com saída líquida (sinal de risco percebido pelo investidor externo)");
  } else if (fluxo.ultimo && fluxo.ultimo.saldoLiquido > 0) {
    pontosFavoraveis++;
    observacoes.push("Fluxo estrangeiro com entrada líquida (sinal de confiança)");
  }

  let cenario: string;
  if (pontosCautela >= 3) cenario = "Cenário de maior cautela";
  else if (pontosFavoraveis >= 3) cenario = "Cenário mais favorável";
  else cenario = "Cenário misto, sem confluência clara";

  const leitura =
    `${cenario}: ${observacoes.join("; ")}. ` +
    "Isso é uma leitura descritiva a partir dos dados lançados, não uma recomendação de investimento — considere o contexto completo antes de qualquer decisão.";

  return { painel, leitura };
}
