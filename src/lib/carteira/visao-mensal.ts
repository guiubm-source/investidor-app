"use server";

/**
 * Livro-razão → "Visão mensal" (ver docs/MAPA-DE-DADOS.md §8.19): tabela de
 * compra/venda mês a mês, quebrada por classe do ativo (réplica do formato
 * enviado pelo Guilherme — seção "GERAL" com o total de cada mês-calendário
 * somado por TODOS os anos, seguida de uma seção por ano com o mesmo
 * detalhamento), mais a série de evolução do capital acumulado (aporte
 * líquido mês a mês) usada pelo gráfico de linha.
 *
 * Fonte única continua sendo `transacoes` — este arquivo só agrega de mais
 * um jeito (por mês/ano/classe), reaproveitando `valorCaixaTransacao`
 * (lib/ativos/posicao-calculo.ts) e `grupoDoAtivo` (grupo-classificacao.ts)
 * já usados em outros lugares, sem duplicar nenhuma fórmula.
 *
 * IMPORTANTE (ver §8.21): este arquivo tem `"use server"`, então só pode
 * exportar `async function` — os tipos e a constante `MESES_LABEL` moram em
 * `visao-mensal-tipos.ts` (módulo puro) e são só importados aqui, nunca
 * reexportados. Quem precisa deles importa direto de lá.
 */

import { createClient } from "@/lib/supabase/server";
import { valorCaixaTransacao } from "@/lib/ativos/posicao-calculo";
import type { TipoAtivo } from "@/lib/ativos/actions";
import { ORDEM_GRUPOS, LABEL_GRUPO, grupoDoAtivo, type GrupoPosicao } from "./grupo-classificacao";
import type {
  MesDado,
  LinhaTabelaMensal,
  TabelaMensal,
  GrupoVisaoMensal,
  PontoCapitalMensal,
  VisaoMensal,
} from "./visao-mensal-tipos";

type ItemAgregavel = { data: string; tipo: "compra" | "venda"; valor: number; grupo: GrupoPosicao };

function tabelaMesesVazia(): MesDado[] {
  return Array.from({ length: 12 }, () => ({ compra: 0, venda: 0 }));
}

function somarMeses(meses: MesDado[]): MesDado {
  return meses.reduce((s, m) => ({ compra: s.compra + m.compra, venda: s.venda + m.venda }), { compra: 0, venda: 0 });
}

function construirTabelaMensal(itens: ItemAgregavel[]): TabelaMensal {
  const geralMeses = tabelaMesesVazia();
  const porAnoMap = new Map<string, MesDado[]>();

  for (const it of itens) {
    const ano = it.data.slice(0, 4);
    const mesIdx = Number(it.data.slice(5, 7)) - 1;
    if (mesIdx < 0 || mesIdx > 11) continue;

    const alvoGeral = geralMeses[mesIdx];
    if (it.tipo === "compra") alvoGeral.compra += it.valor;
    else alvoGeral.venda += it.valor;

    if (!porAnoMap.has(ano)) porAnoMap.set(ano, tabelaMesesVazia());
    const alvoAno = porAnoMap.get(ano)![mesIdx];
    if (it.tipo === "compra") alvoAno.compra += it.valor;
    else alvoAno.venda += it.valor;
  }

  const geral: LinhaTabelaMensal = {
    chave: "GERAL",
    label: "Geral (todos os anos)",
    meses: geralMeses,
    totalLinha: somarMeses(geralMeses),
  };

  const porAno: LinhaTabelaMensal[] = [...porAnoMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([ano, meses]) => ({ chave: ano, label: ano, meses, totalLinha: somarMeses(meses) }));

  return { geral, porAno };
}

function construirEvolucaoCapital(itens: ItemAgregavel[]): PontoCapitalMensal[] {
  const porMes = new Map<string, MesDado>();
  for (const it of itens) {
    const anoMes = it.data.slice(0, 7);
    if (!porMes.has(anoMes)) porMes.set(anoMes, { compra: 0, venda: 0 });
    const alvo = porMes.get(anoMes)!;
    if (it.tipo === "compra") alvo.compra += it.valor;
    else alvo.venda += it.valor;
  }

  const chaves = [...porMes.keys()].sort(); // "AAAA-MM" ordena cronologicamente como string
  let acumulado = 0;
  return chaves.map((anoMes) => {
    const { compra, venda } = porMes.get(anoMes)!;
    const liquido = compra - venda;
    acumulado += liquido;
    return { anoMes, compra, venda, liquido, retirada: Math.max(0, venda - compra), acumulado };
  });
}

export async function obterVisaoMensal(): Promise<VisaoMensal> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const vazio: VisaoMensal = { total: construirTabelaMensal([]), porGrupo: [], evolucaoCapital: [] };
  if (!user) return vazio;

  const [ativosRes, transacoesRes] = await Promise.all([
    supabase.from("ativos").select("id, tipo, subtipo_renda_fixa, subtipo_internacional").eq("profile_id", user.id),
    supabase
      .from("transacoes")
      .select("ativo_id, tipo, data, quantidade, preco_unitario, custos")
      .eq("profile_id", user.id),
  ]);

  // Mesma prática de §8.17: erro do Postgrest sobe pra tela de erro do Next
  // em vez de a Visão mensal virar silenciosamente "sem dados".
  if (ativosRes.error) throw new Error(`obterVisaoMensal: falha ao ler ativos — ${ativosRes.error.message}`);
  if (transacoesRes.error) throw new Error(`obterVisaoMensal: falha ao ler transações — ${transacoesRes.error.message}`);

  const ativos = ativosRes.data ?? [];
  const transacoes = transacoesRes.data ?? [];

  const grupoPorAtivo = new Map<string, GrupoPosicao>();
  for (const a of ativos) {
    grupoPorAtivo.set(a.id, grupoDoAtivo(a.tipo as TipoAtivo, a.subtipo_renda_fixa, a.subtipo_internacional));
  }

  const itens: ItemAgregavel[] = transacoes.map((t) => {
    const tipo = t.tipo as "compra" | "venda";
    const valor = valorCaixaTransacao({
      tipo,
      data: t.data as string,
      quantidade: Number(t.quantidade),
      precoUnitario: Number(t.preco_unitario),
      custos: Number(t.custos),
    });
    return {
      data: t.data as string,
      tipo,
      valor,
      grupo: grupoPorAtivo.get(t.ativo_id) ?? "outros",
    };
  });

  const total = construirTabelaMensal(itens);
  const evolucaoCapital = construirEvolucaoCapital(itens);

  const porGrupoMap = new Map<GrupoPosicao, ItemAgregavel[]>();
  for (const it of itens) {
    const lista = porGrupoMap.get(it.grupo) ?? [];
    lista.push(it);
    porGrupoMap.set(it.grupo, lista);
  }

  const porGrupo: GrupoVisaoMensal[] = ORDEM_GRUPOS.filter((g) => porGrupoMap.has(g)).map((grupo) => ({
    grupo,
    label: LABEL_GRUPO[grupo],
    tabela: construirTabelaMensal(porGrupoMap.get(grupo)!),
  }));

  return { total, porGrupo, evolucaoCapital };
}
