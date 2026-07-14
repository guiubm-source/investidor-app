"use server";

import { createClient } from "@/lib/supabase/server";
import type {
  DecisaoSelicForm,
  FluxoEstrangeiroMensalForm,
  ImportarIpcaForm,
  ImportarSelicForm,
  IpcaCompetenciaForm,
  NovaReuniaoSelicForm,
  SelicReuniaoEditForm,
} from "./schema";
import { CATEGORIAS_IPCA } from "./schema";
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
import {
  GRUPOS_IPCA,
  calcularAcumulado12m,
  calcularAcumuladoAno,
  calcularDistanciaMeta,
  calcularEstatisticasSerie,
  calcularImpactosCompetencia,
  calcularIndiceDifusao,
  calcularSequenciaAceleracaoDesaceleracao,
  calcularSituacaoBanda,
  calcularTendenciaInflacionaria,
  correlacaoGrupoComGeral,
  encontrarMetaVigente,
  grupoMaisVolatilEEstavel,
  gruposPorImpactoHistorico,
  parseImportacaoIpca,
  rankingGruposNaCompetencia,
  rankingImpactosNaCompetencia,
  type EstatisticasSerie,
  type GrupoIpca,
  type ImpactosGrupo,
  type MetaInflacaoVigente,
  type PesoIpcaVigente,
  type PontoIpca,
  type SituacaoBanda,
  type TendenciaInflacionaria,
  type VariacoesGrupos,
} from "./ipca-estatisticas";
import {
  obterDiretoriaBacen,
  obterMetasInflacao,
  obterPesosIpca,
  presidenteBcVigente,
  type DiretorBacen,
  type MetaInflacao,
  type PesoIpcaGrupo,
} from "@/lib/referencia/actions";
import {
  calcularDistanciaPct,
  calcularMediaHistorica,
  calcularMediasMoveisAtuais,
  calcularSequenciaDiasConsecutivos,
  calcularTendencia as calcularTendenciaDolar,
  calcularVariacaoAnual,
  calcularVariacaoMensal,
  calcularVariacaoPct,
  calcularVariacoesMensais,
  calcularVolatilidadeAtual,
  calcularVolatilidadeHistorica,
  correlacaoComIpca,
  correlacaoComSelic,
  encontrarMaximoHistorico,
  encontrarMinimoHistorico,
  maximoMinimoUltimos12Meses,
  reamostrarMensal,
  type MaximoMinimoHistorico,
  type MediasMoveisAtuais,
  type PontoDolar,
  type SequenciaDolar,
  type TendenciaDolar,
} from "./dolar-estatisticas";

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
// IPCA — ver docs/MAPA-DE-DADOS.md §8.8. Tabela única (geral + 9 grupos);
// impacto por grupo, acumulados, tendência, rankings, correlação e demais
// estatísticas são SEMPRE recalculados aqui (nunca armazenados) a partir de
// `indicador_ipca_mensal` + Pesos do IPCA + Metas de Inflação vigentes —
// cálculo puro fica em `ipca-estatisticas.ts`.
// ---------------------------------------------------------------------------

export type IpcaCompetencia = {
  id: string;
  anoMes: string;
  geral: number | null;
  grupos: VariacoesGrupos;
  impactos: ImpactosGrupo;
  dataDivulgacao: string | null;
  fonte: string;
  observacoes: string | null;
};

export type IpcaView = {
  competencias: IpcaCompetencia[]; // mais recente primeiro
  ultimaCompetencia: IpcaCompetencia | null;
  acumuladoAno: { valor: number | null; meses: number };
  acumulado12m: { valor: number | null; meses: number; completo: boolean };
  metaVigente: MetaInflacaoVigente | null;
  distanciaMeta: number | null;
  situacaoBanda: SituacaoBanda | null;
  tendencia: TendenciaInflacionaria | null;
  sequencia: { tipo: "aceleracao" | "desaceleracao"; quantidade: number } | null;
  estatisticasGeral: EstatisticasSerie;
  rankingGruposUltimaCompetencia: { grupo: GrupoIpca; variacao: number }[];
  rankingImpactosUltimaCompetencia: { grupo: GrupoIpca; impacto: number }[];
  maiorPressao: { grupo: GrupoIpca; variacao: number } | null;
  menorPressao: { grupo: GrupoIpca; variacao: number } | null;
  maiorImpacto: { grupo: GrupoIpca; impacto: number } | null;
  maiorImpactoNegativo: { grupo: GrupoIpca; impacto: number } | null;
  grupoMaisVolatil: { grupo: GrupoIpca; desvioPadrao: number } | null;
  grupoMaisEstavel: { grupo: GrupoIpca; desvioPadrao: number } | null;
  indiceDifusao: ReturnType<typeof calcularIndiceDifusao> | null;
  correlacoesGrupos: { grupo: GrupoIpca; correlacao: number | null }[];
  impactoHistoricoGrupos: { grupo: GrupoIpca; impactoMedio: number; impactoAcumulado: number }[];
  pesos: PesoIpcaGrupo[];
  metas: MetaInflacao[];
  insights: string[];
};

function labelGrupo(grupo: GrupoIpca): string {
  return CATEGORIAS_IPCA.find((c) => c.valor === grupo)?.label ?? grupo;
}

function gerarInsightsIpca(input: {
  tendencia: TendenciaInflacionaria | null;
  situacaoBanda: SituacaoBanda | null;
  sequencia: { tipo: "aceleracao" | "desaceleracao"; quantidade: number } | null;
  maiorPressao: { grupo: GrupoIpca; variacao: number } | null;
  menorPressao: { grupo: GrupoIpca; variacao: number } | null;
  grupoMaisVolatil: { grupo: GrupoIpca; desvioPadrao: number } | null;
  indiceDifusao: ReturnType<typeof calcularIndiceDifusao> | null;
  metaVigente: MetaInflacaoVigente | null;
}): string[] {
  const insights: string[] = [];

  if (input.tendencia === "acelerando") {
    insights.push("Tendência inflacionária de alta: a média móvel de 3 meses está acima da de 6 meses.");
  } else if (input.tendencia === "desacelerando") {
    insights.push("Tendência inflacionária de queda: a média móvel de 3 meses está abaixo da de 6 meses.");
  }

  if (input.situacaoBanda === "acima") {
    insights.push("O IPCA acumulado em 12 meses está acima do teto da banda da meta de inflação vigente.");
  } else if (input.situacaoBanda === "abaixo") {
    insights.push("O IPCA acumulado em 12 meses está abaixo do piso da banda da meta de inflação vigente.");
  } else if (input.situacaoBanda === "dentro") {
    insights.push("O IPCA acumulado em 12 meses está dentro da banda da meta de inflação vigente.");
  }

  if (input.sequencia) {
    const direcao = input.sequencia.tipo === "aceleracao" ? "em alta" : "em queda";
    insights.push(`Variação mensal ${direcao} por ${input.sequencia.quantidade} mês(es) seguido(s).`);
  }

  if (input.maiorPressao) {
    insights.push(
      `${labelGrupo(input.maiorPressao.grupo)} foi o grupo com maior pressão no mês (${input.maiorPressao.variacao.toFixed(2)}%).`
    );
  }
  if (input.menorPressao && input.menorPressao.variacao < 0) {
    insights.push(
      `${labelGrupo(input.menorPressao.grupo)} teve a maior queda de preços no mês (${input.menorPressao.variacao.toFixed(2)}%).`
    );
  }
  if (input.grupoMaisVolatil) {
    insights.push(
      `${labelGrupo(input.grupoMaisVolatil.grupo)} é historicamente o grupo mais volátil (desvio padrão de ${input.grupoMaisVolatil.desvioPadrao.toFixed(2)} p.p.).`
    );
  }
  if (input.indiceDifusao?.indice != null) {
    insights.push(`${input.indiceDifusao.indice.toFixed(0)}% dos grupos com dado lançado tiveram alta de preços no mês.`);
  }
  if (!input.metaVigente) {
    insights.push("Nenhuma meta de inflação vigente cadastrada — cadastre em Configurações → Metas de Inflação.");
  }

  return insights;
}

const COLUNAS_IPCA_MENSAL =
  "id, ano_mes, geral, alimentacao_bebidas, habitacao, artigos_residencia, vestuario, transportes, saude_cuidados_pessoais, despesas_pessoais, educacao, comunicacao, data_divulgacao, fonte, observacoes";

export async function obterIpca(): Promise<IpcaView> {
  const supabase = await createClient();
  const [{ data: mensalRaw }, pesos, metas] = await Promise.all([
    supabase.from("indicador_ipca_mensal").select(COLUNAS_IPCA_MENSAL).order("ano_mes", { ascending: true }),
    obterPesosIpca(),
    obterMetasInflacao(),
  ]);

  const pesosVigentes: PesoIpcaVigente[] = pesos.map((p) => ({
    grupo: p.grupo as GrupoIpca,
    pesoPct: p.pesoPct,
    vigenciaInicio: p.vigenciaInicio,
    vigenciaFim: p.vigenciaFim,
  }));
  const metasVigentes: MetaInflacaoVigente[] = metas.map((m) => ({
    metaCentral: m.metaCentral,
    bandaInferior: m.bandaInferior,
    bandaSuperior: m.bandaSuperior,
    vigenciaInicio: m.vigenciaInicio,
    vigenciaFim: m.vigenciaFim,
  }));

  const pontosAsc: PontoIpca[] = (mensalRaw ?? []).map((m) => ({
    id: m.id,
    anoMes: m.ano_mes,
    geral: m.geral === null ? null : Number(m.geral),
    grupos: Object.fromEntries(
      GRUPOS_IPCA.map((g) => [g, m[g] === null || m[g] === undefined ? null : Number(m[g])])
    ) as VariacoesGrupos,
    dataDivulgacao: m.data_divulgacao,
    fonte: m.fonte,
    observacoes: m.observacoes,
  }));

  const competenciasAsc: IpcaCompetencia[] = pontosAsc.map((p) => ({
    ...p,
    impactos: calcularImpactosCompetencia(pesosVigentes, p),
  }));
  const competencias = [...competenciasAsc].reverse();

  const ultimaCompetencia = competenciasAsc.at(-1) ?? null;
  const acumuladoAno = ultimaCompetencia
    ? calcularAcumuladoAno(pontosAsc, ultimaCompetencia.anoMes.slice(0, 4))
    : { valor: null, meses: 0 };
  const acumulado12m = calcularAcumulado12m(pontosAsc);
  const metaVigente = ultimaCompetencia ? encontrarMetaVigente(metasVigentes, ultimaCompetencia.anoMes) : null;
  const distanciaMeta = calcularDistanciaMeta(acumulado12m.valor, metaVigente?.metaCentral ?? null);
  const situacaoBanda = calcularSituacaoBanda(
    acumulado12m.valor,
    metaVigente?.bandaInferior ?? null,
    metaVigente?.bandaSuperior ?? null
  );
  const tendencia = calcularTendenciaInflacionaria(pontosAsc.map((p) => p.geral));
  const sequencia = calcularSequenciaAceleracaoDesaceleracao(pontosAsc);
  const geralValores = pontosAsc.map((p) => p.geral).filter((v): v is number => v !== null);
  const estatisticasGeral = calcularEstatisticasSerie(geralValores);

  const rankingGruposUltimaCompetencia = ultimaCompetencia ? rankingGruposNaCompetencia(ultimaCompetencia) : [];
  const rankingImpactosUltimaCompetencia = ultimaCompetencia ? rankingImpactosNaCompetencia(ultimaCompetencia.impactos) : [];
  const maiorPressao = rankingGruposUltimaCompetencia[0] ?? null;
  const menorPressao = rankingGruposUltimaCompetencia.at(-1) ?? null;
  const maiorImpacto = rankingImpactosUltimaCompetencia[0] ?? null;
  const maiorImpactoNegativo = rankingImpactosUltimaCompetencia.at(-1) ?? null;

  const { maisVolatil: grupoMaisVolatil, maisEstavel: grupoMaisEstavel } = grupoMaisVolatilEEstavel(pontosAsc);
  const indiceDifusao = ultimaCompetencia ? calcularIndiceDifusao(ultimaCompetencia) : null;
  const correlacoesGrupos = GRUPOS_IPCA.map((g) => ({ grupo: g, correlacao: correlacaoGrupoComGeral(pontosAsc, g) }));
  const impactoHistoricoGrupos = gruposPorImpactoHistorico(pontosAsc, pesosVigentes);

  const insights = gerarInsightsIpca({
    tendencia,
    situacaoBanda,
    sequencia,
    maiorPressao,
    menorPressao,
    grupoMaisVolatil,
    indiceDifusao,
    metaVigente,
  });

  return {
    competencias,
    ultimaCompetencia,
    acumuladoAno,
    acumulado12m,
    metaVigente,
    distanciaMeta,
    situacaoBanda,
    tendencia,
    sequencia,
    estatisticasGeral,
    rankingGruposUltimaCompetencia,
    rankingImpactosUltimaCompetencia,
    maiorPressao,
    menorPressao,
    maiorImpacto,
    maiorImpactoNegativo,
    grupoMaisVolatil,
    grupoMaisEstavel,
    indiceDifusao,
    correlacoesGrupos,
    impactoHistoricoGrupos,
    pesos,
    metas,
    insights,
  };
}

/** Lançamento/edição de uma competência inteira (upsert por ano_mes — já é unique na tabela). */
export async function criarIpcaCompetencia(input: IpcaCompetenciaForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("indicador_ipca_mensal").upsert(
    {
      ano_mes: input.ano_mes,
      geral: input.geral,
      alimentacao_bebidas: input.alimentacao_bebidas,
      habitacao: input.habitacao,
      artigos_residencia: input.artigos_residencia,
      vestuario: input.vestuario,
      transportes: input.transportes,
      saude_cuidados_pessoais: input.saude_cuidados_pessoais,
      despesas_pessoais: input.despesas_pessoais,
      educacao: input.educacao,
      comunicacao: input.comunicacao,
      data_divulgacao: input.data_divulgacao,
      observacoes: input.observacoes,
    },
    { onConflict: "ano_mes" }
  );

  if (error) return { error: "Não foi possível registrar a competência do IPCA." };
  return {};
}

export async function editarIpcaCompetencia(id: string, input: IpcaCompetenciaForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase
    .from("indicador_ipca_mensal")
    .update({
      ano_mes: input.ano_mes,
      geral: input.geral,
      alimentacao_bebidas: input.alimentacao_bebidas,
      habitacao: input.habitacao,
      artigos_residencia: input.artigos_residencia,
      vestuario: input.vestuario,
      transportes: input.transportes,
      saude_cuidados_pessoais: input.saude_cuidados_pessoais,
      despesas_pessoais: input.despesas_pessoais,
      educacao: input.educacao,
      comunicacao: input.comunicacao,
      data_divulgacao: input.data_divulgacao,
      observacoes: input.observacoes,
    })
    .eq("id", id);

  if (error) return { error: "Não foi possível salvar. Confira se a competência não está duplicada." };
  return {};
}

export async function excluirIpcaCompetencia(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const { error } = await supabase.from("indicador_ipca_mensal").delete().eq("id", id);
  if (error) return { error: "Não foi possível excluir o lançamento." };
  return {};
}

export async function excluirIpcaCompetencias(ids: string[]): Promise<AcaoResultado> {
  if (ids.length === 0) return {};
  const supabase = await createClient();
  const { error } = await supabase.from("indicador_ipca_mensal").delete().in("id", ids);
  if (error) return { error: "Não foi possível excluir as competências selecionadas." };
  return {};
}

export type ImportacaoIpcaResultado = AcaoResultado & { importados?: number; avisos?: string[] };

/**
 * Importação em massa — cola texto "COMPETÊNCIA | GERAL | 9 grupos", faz
 * upsert por `ano_mes`. Grupos ausentes na linha colada preservam o valor já
 * gravado (mesma lógica de preservação usada em `importarHistoricoSelic`
 * para `numero_reuniao` — evita apagar detalhamento por grupo já lançado por
 * causa de uma reimportação parcial). Parser puro em `ipca-estatisticas.ts`.
 */
export async function importarHistoricoIpca(input: ImportarIpcaForm): Promise<ImportacaoIpcaResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { linhas, erros } = parseImportacaoIpca(input.texto);

  if (linhas.length === 0) {
    return { error: erros[0] ?? "Nenhuma linha válida encontrada para importar.", avisos: erros };
  }

  let importados = 0;
  const errosGravacao: string[] = [...erros];
  // Coluna montada em runtime a partir de GRUPOS_IPCA — widened para `string`
  // (não template literal) de propósito: o parser de tipos do supabase-js
  // tenta interpretar strings de `.select()` como literal type, e falha
  // (ParserError) quando a lista de colunas é dinâmica.
  const colunasComGrupos: string = ["id"].concat(GRUPOS_IPCA).join(", ");

  for (const linha of linhas) {
    const { data: existente } = await supabase
      .from("indicador_ipca_mensal")
      .select(colunasComGrupos)
      .eq("ano_mes", linha.anoMes)
      .maybeSingle();

    const existenteRecord = existente as Record<string, number | string | null> | null;
    const payloadGrupos: Record<string, number | null> = {};
    for (const grupo of GRUPOS_IPCA) {
      const daLinha = linha.grupos[grupo];
      payloadGrupos[grupo] =
        daLinha !== undefined ? daLinha : existenteRecord ? ((existenteRecord[grupo] as number | null) ?? null) : null;
    }

    if (existenteRecord) {
      const { error } = await supabase
        .from("indicador_ipca_mensal")
        .update({ geral: linha.geral, ...payloadGrupos })
        .eq("id", existenteRecord.id as string);
      if (error) {
        errosGravacao.push(`Competência ${linha.anoMes}: não foi possível atualizar (${error.message}).`);
        continue;
      }
    } else {
      const { error } = await supabase.from("indicador_ipca_mensal").insert({
        ano_mes: linha.anoMes,
        geral: linha.geral,
        ...payloadGrupos,
      });
      if (error) {
        errosGravacao.push(`Competência ${linha.anoMes}: não foi possível inserir (${error.message}).`);
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
// Dólar — ver docs/MAPA-DE-DADOS.md §8.9. Granularidade diária, preenchida
// automaticamente por cron (src/app/api/cron/dolar/route.ts) a partir da
// PTAX do Bacen — SOMENTE LEITURA aqui (sem criar/editar/excluir). Variação
// diária/mensal/anual, máxima/mínima histórica, média/desvio padrão, médias
// móveis, tendência, sequência de dias consecutivos, volatilidade e as
// correlações com Selic/IPCA são SEMPRE recalculados a partir de
// `indicador_dolar_diario` — cálculo puro fica em `dolar-estatisticas.ts`.
// ---------------------------------------------------------------------------

export type DolarView = {
  pontos: PontoDolar[]; // mais recente primeiro (histórico/gráfico)
  ultimo: PontoDolar | null;
  variacaoDiaria: number | null;
  variacaoMensal: number | null;
  variacaoAnual: number | null;
  maximoHistorico: MaximoMinimoHistorico | null;
  minimoHistorico: MaximoMinimoHistorico | null;
  maximo12m: MaximoMinimoHistorico | null;
  minimo12m: MaximoMinimoHistorico | null;
  mediaHistorica: number | null;
  distanciaMaximaPct: number | null;
  distanciaMinimaPct: number | null;
  distanciaMediaPct: number | null;
  mediasMoveis: MediasMoveisAtuais;
  tendencia: TendenciaDolar | null;
  sequencia: SequenciaDolar | null;
  volatilidadeAtual: number | null;
  volatilidadeHistorica: number | null;
  correlacaoSelic: number | null;
  correlacaoIpca: number | null;
  insights: string[];
};

/** Último dia do mês (AAAA-MM-DD) de uma competência "AAAA-MM" — usado para achar a Selic vigente no fechamento do mês. */
function ultimoDiaDoMes(anoMes: string): string {
  const [ano, mes] = anoMes.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${anoMes}-${String(ultimoDia).padStart(2, "0")}`;
}

/** Taxa Selic vigente numa data (a mais recente reunião decidida com dataVigencia <= data). */
function selicVigenteEmData(reunioes: SelicReuniao[], dataAlvo: string): number | null {
  const candidatas = reunioes
    .filter((r) => r.decidido && r.dataVigencia !== null && r.dataVigencia <= dataAlvo)
    .sort((a, b) => (a.dataVigencia! < b.dataVigencia! ? 1 : -1));
  return candidatas[0]?.taxaDefinida ?? null;
}

function gerarInsightsDolar(input: {
  tendencia: TendenciaDolar | null;
  sequencia: SequenciaDolar | null;
  distanciaMaximaPct: number | null;
  distanciaMinimaPct: number | null;
  distanciaMediaPct: number | null;
  volatilidadeAtual: number | null;
  volatilidadeHistorica: number | null;
  correlacaoSelic: number | null;
  correlacaoIpca: number | null;
}): string[] {
  const insights: string[] = [];

  if (input.tendencia === "alta") {
    insights.push("Dólar em tendência de alta (cotação e média móvel de 20 dias acima da média móvel de 200 dias).");
  } else if (input.tendencia === "baixa") {
    insights.push("Dólar em tendência de baixa (cotação e média móvel de 20 dias abaixo da média móvel de 200 dias).");
  } else if (input.tendencia === "lateral") {
    insights.push("Dólar sem tendência definida no momento (lateralizado entre as médias móveis de curto e longo prazo).");
  }

  if (input.sequencia) {
    const direcao = input.sequencia.tipo === "alta" ? "em alta" : "em queda";
    insights.push(`Cotação ${direcao} por ${input.sequencia.quantidade} dia(s) útil(eis) seguido(s).`);
  }

  if (input.distanciaMaximaPct !== null) {
    insights.push(`Cotação atual está ${Math.abs(input.distanciaMaximaPct).toFixed(1)}% abaixo da máxima histórica.`);
  }
  if (input.distanciaMinimaPct !== null && input.distanciaMinimaPct > 0.01) {
    insights.push(`Cotação atual está ${input.distanciaMinimaPct.toFixed(1)}% acima da mínima histórica.`);
  }
  if (input.distanciaMediaPct !== null) {
    insights.push(
      input.distanciaMediaPct >= 0
        ? `Cotação está ${input.distanciaMediaPct.toFixed(1)}% acima da média histórica.`
        : `Cotação está ${Math.abs(input.distanciaMediaPct).toFixed(1)}% abaixo da média histórica.`
    );
  }

  if (input.volatilidadeAtual !== null && input.volatilidadeHistorica !== null && input.volatilidadeHistorica > 0) {
    if (input.volatilidadeAtual > input.volatilidadeHistorica * 1.2) {
      insights.push("Volatilidade recente acima do normal histórico — mercado mais instável que o de costume.");
    } else if (input.volatilidadeAtual < input.volatilidadeHistorica * 0.8) {
      insights.push("Volatilidade recente abaixo do normal histórico — mercado mais calmo que o de costume.");
    }
  }

  if (input.correlacaoSelic !== null) {
    insights.push(`Correlação com a Selic (reamostrada mensalmente): ${input.correlacaoSelic.toFixed(2)}.`);
  }
  if (input.correlacaoIpca !== null) {
    insights.push(`Correlação com o IPCA (reamostrado mensalmente): ${input.correlacaoIpca.toFixed(2)}.`);
  }

  return insights;
}

const DOLAR_VIEW_VAZIA: DolarView = {
  pontos: [],
  ultimo: null,
  variacaoDiaria: null,
  variacaoMensal: null,
  variacaoAnual: null,
  maximoHistorico: null,
  minimoHistorico: null,
  maximo12m: null,
  minimo12m: null,
  mediaHistorica: null,
  distanciaMaximaPct: null,
  distanciaMinimaPct: null,
  distanciaMediaPct: null,
  mediasMoveis: { mm5: null, mm20: null, mm50: null, mm100: null, mm200: null },
  tendencia: null,
  sequencia: null,
  volatilidadeAtual: null,
  volatilidadeHistorica: null,
  correlacaoSelic: null,
  correlacaoIpca: null,
  insights: [
    "Ainda não há cotações do dólar carregadas — o cron diário faz o backfill inicial (desde 1999) na primeira execução.",
  ],
};

export async function obterDolar(): Promise<DolarView> {
  const supabase = await createClient();
  const [{ data }, selic, ipca] = await Promise.all([
    supabase.from("indicador_dolar_diario").select("data, cotacao").order("data", { ascending: true }),
    obterSelic(),
    obterIpca(),
  ]);

  const pontosAsc: PontoDolar[] = (data ?? []).map((d) => ({ data: d.data, cotacao: Number(d.cotacao) }));
  if (pontosAsc.length === 0) return DOLAR_VIEW_VAZIA;

  const cotacoesAsc = pontosAsc.map((p) => p.cotacao);
  const ultimo = pontosAsc[pontosAsc.length - 1];
  const penultimo = pontosAsc[pontosAsc.length - 2] ?? null;

  const maximoHistorico = encontrarMaximoHistorico(pontosAsc);
  const minimoHistorico = encontrarMinimoHistorico(pontosAsc);
  const { maximo: maximo12m, minimo: minimo12m } = maximoMinimoUltimos12Meses(pontosAsc);
  const mediaHistorica = calcularMediaHistorica(pontosAsc);

  const mensal = reamostrarMensal(pontosAsc);
  const variacoesMensais = calcularVariacoesMensais(mensal);

  const ipcaMensalPares = ipca.competencias.map((c) => ({ anoMes: c.anoMes, geral: c.geral }));
  const correlacaoIpca = correlacaoComIpca(variacoesMensais, ipcaMensalPares);

  const selicVigentePorMes = variacoesMensais
    .map((v) => ({ anoMes: v.anoMes, taxa: selicVigenteEmData(selic.reunioes, ultimoDiaDoMes(v.anoMes)) }))
    .filter((s): s is { anoMes: string; taxa: number } => s.taxa !== null);
  const correlacaoSelic = correlacaoComSelic(variacoesMensais, selicVigentePorMes);

  const distanciaMaximaPct = calcularDistanciaPct(ultimo.cotacao, maximoHistorico?.valor ?? null);
  const distanciaMinimaPct = calcularDistanciaPct(ultimo.cotacao, minimoHistorico?.valor ?? null);
  const distanciaMediaPct = calcularDistanciaPct(ultimo.cotacao, mediaHistorica);
  const tendencia = calcularTendenciaDolar(cotacoesAsc);
  const sequencia = calcularSequenciaDiasConsecutivos(pontosAsc);
  const volatilidadeAtual = calcularVolatilidadeAtual(pontosAsc);
  const volatilidadeHistorica = calcularVolatilidadeHistorica(pontosAsc);

  const insights = gerarInsightsDolar({
    tendencia,
    sequencia,
    distanciaMaximaPct,
    distanciaMinimaPct,
    distanciaMediaPct,
    volatilidadeAtual,
    volatilidadeHistorica,
    correlacaoSelic,
    correlacaoIpca,
  });

  return {
    pontos: [...pontosAsc].reverse(),
    ultimo,
    variacaoDiaria: calcularVariacaoPct(ultimo.cotacao, penultimo?.cotacao ?? null),
    variacaoMensal: calcularVariacaoMensal(pontosAsc),
    variacaoAnual: calcularVariacaoAnual(pontosAsc),
    maximoHistorico,
    minimoHistorico,
    maximo12m,
    minimo12m,
    mediaHistorica,
    distanciaMaximaPct,
    distanciaMinimaPct,
    distanciaMediaPct,
    mediasMoveis: calcularMediasMoveisAtuais(cotacoesAsc),
    tendencia,
    sequencia,
    volatilidadeAtual,
    volatilidadeHistorica,
    correlacaoSelic,
    correlacaoIpca,
    insights,
  };
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

  // DolarView.tendencia usa "alta"/"baixa"/"lateral" (ver dolar-estatisticas.ts),
  // diferente do tipo genérico Tendencia ("alta"/"queda"/"estavel") usado pelos
  // outros três indicadores no painel — mapeamento só pra exibição aqui.
  const dolarTendenciaMapeada: Tendencia =
    dolar.tendencia === "alta" ? "alta" : dolar.tendencia === "baixa" ? "queda" : dolar.tendencia === "lateral" ? "estavel" : null;

  const painel: PainelItem[] = [
    {
      label: "Selic",
      valor: selic.ultimaTaxa !== null ? `${selic.ultimaTaxa.toFixed(2)}% a.a.` : "—",
      tendencia: selic.tendencia,
    },
    {
      label: "IPCA (12m)",
      valor: ipca.acumulado12m.valor != null ? `${ipca.acumulado12m.valor.toFixed(2)}%` : "—",
      tendencia: null,
    },
    {
      label: "Dólar",
      valor: dolar.ultimo ? `R$ ${dolar.ultimo.cotacao.toFixed(2)}` : "—",
      tendencia: dolarTendenciaMapeada,
    },
    {
      label: "Fluxo estrangeiro",
      valor: fluxo.ultimo ? fluxo.ultimo.saldoLiquido.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—",
      tendencia: fluxo.tendencia,
    },
  ];

  // Leitura interpretativa combinada — heurística simples e transparente,
  // não é recomendação de investimento (ver docs/MAPA-DE-DADOS.md §8.3.3).
  const ipcaDentroDaMeta = ipca.situacaoBanda === null ? null : ipca.situacaoBanda === "dentro";
  const sinaisDados = [selic.tendencia, ipcaDentroDaMeta, dolar.tendencia, fluxo.tendencia].some((v) => v !== null);

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

  if (ipcaDentroDaMeta === false) {
    pontosCautela++;
    observacoes.push("IPCA acumulado em 12 meses fora da banda da meta de inflação vigente");
  } else if (ipcaDentroDaMeta === true) {
    pontosFavoraveis++;
    observacoes.push("IPCA acumulado em 12 meses dentro da banda da meta de inflação vigente");
  }

  if (dolarTendenciaMapeada === "alta") {
    pontosCautela++;
    observacoes.push("Dólar em alta (pressiona inflação de importados e custo de dívida em moeda estrangeira)");
  } else if (dolarTendenciaMapeada === "queda") {
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
