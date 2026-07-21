/**
 * Orquestração do PDF final (fase 11 — ver docs/MAPA-DE-DADOS.md §8.46).
 * Não recalcula NADA — só chama as consultas já prontas das fases 3-10 em
 * paralelo e entrega pro motor puro `motores/relatorio-completo.ts` montar a
 * estrutura de 23 itens do §8.32.26. Sem `"use server"`, mesmo padrão das
 * demais `consultas/*.ts`.
 */

import { createClient } from "@/lib/supabase/server";
import { obterDeclaracaoAtual, exercicioCorrente } from "./declaracao";
import { obterDashboardIR as obterDashboardCompleto } from "./dashboard";
import { obterBensDireitos } from "./bens-direitos";
import { apurarRendaVariavelBrasilDoUsuario } from "./renda-variavel";
import { apurarRendaFixaBrasilDoUsuario } from "./renda-fixa";
import { apurarGanhoCapitalExteriorDoUsuario } from "./exterior";
import { consolidarDarfRendaVariavelDoUsuario } from "./darf";
import { construirLedgerFiscalDoUsuario } from "./ledger";
import { montarRelatorioCompleto } from "../motores/relatorio-completo";
import type { RelatorioCompletoIR, OperacaoAnexo, CapaRelatorio } from "../relatorios/tipos";

const LABEL_TIPO_ATIVO_RENDA_VARIAVEL: Record<string, string> = {
  acao: "Ações/fundos",
  fundo: "Ações/fundos",
  fii: "FII",
};

function construirPerfilResumo(perfil: { residenteBrasil: boolean; nonresidentAlien: boolean } | null): string {
  if (!perfil) return "perfil não confirmado";
  return [
    perfil.residenteBrasil ? "residente no Brasil" : "não residente no Brasil",
    perfil.nonresidentAlien ? "nonresident alien nos EUA" : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

/**
 * Detalhe de vendas de ações/fundos/FII (fase 4) pro anexo de operações —
 * reaproveita o MESMO ledger fiscal (fase 3) que `apurarRendaVariavelBrasilDoUsuario`
 * já usa, só que aqui extraímos a linha bruta em vez de agregar por mês.
 * Renda fixa (resgates) e exterior (vendas) já carregam detalhe por evento
 * embutido nas próprias linhas mensais/anuais dos motores (fases 6/7) — não
 * precisam desta extração à parte.
 */
async function obterOperacoesRendaVariavelDoAno(ano: number): Promise<OperacaoAnexo[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: ativosRaw, error } = await supabase
    .from("ativos")
    .select("id, ticker, tipo")
    .eq("profile_id", user.id)
    .in("tipo", ["acao", "fundo", "fii"]);
  if (error) throw new Error(`obterOperacoesRendaVariavelDoAno: falha ao ler ativos — ${error.message}`);

  const ledgerPorAtivo = await construirLedgerFiscalDoUsuario();
  const anoStr = String(ano);

  const operacoes: OperacaoAnexo[] = [];
  for (const a of ativosRaw ?? []) {
    const ledger = ledgerPorAtivo.get(a.id as string);
    if (!ledger) continue;
    for (const linha of ledger.linhas) {
      if (linha.tipo !== "venda") continue;
      if (!linha.data.startsWith(anoStr)) continue;
      operacoes.push({
        ativoId: a.id as string,
        ativoTicker: a.ticker as string,
        categoria: LABEL_TIPO_ATIVO_RENDA_VARIAVEL[a.tipo as string] ?? (a.tipo as string),
        data: linha.data,
        quantidade: linha.quantidadeAntes.minus(linha.quantidadeDepois).abs(),
        valorVendaBruto: linha.valorVendaBruto,
        resultadoRealizado: linha.resultadoRealizado,
      });
    }
  }
  operacoes.sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : x.ativoTicker.localeCompare(y.ativoTicker)));
  return operacoes;
}

/** Relatório completo (PDF final) pro ano-calendário pedido, do usuário logado. */
export async function obterRelatorioCompletoIR(ano: number): Promise<RelatorioCompletoIR> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { exercicio } = ano === exercicioCorrente().anoCalendario ? exercicioCorrente() : { exercicio: ano + 1 };

  const [declaracaoComPerfil, { data: perfilPessoal }] = await Promise.all([
    obterDeclaracaoAtual(exercicio, { criarSeNaoExistir: true }),
    user
      ? supabase.from("profiles").select("full_name, cpf").eq("id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const [dashboard, bensDireitos, rendaVariavel, rendaFixa, exterior, darf, operacoesRendaVariavel] = await Promise.all([
    obterDashboardCompleto(ano),
    declaracaoComPerfil
      ? obterBensDireitos(declaracaoComPerfil.declaracao.id, declaracaoComPerfil.declaracao.anoCalendario)
      : Promise.resolve({ itens: [], ativosComPendencia: [] }),
    apurarRendaVariavelBrasilDoUsuario(),
    apurarRendaFixaBrasilDoUsuario(),
    apurarGanhoCapitalExteriorDoUsuario(),
    consolidarDarfRendaVariavelDoUsuario(),
    obterOperacoesRendaVariavelDoAno(ano),
  ]);

  const capa: CapaRelatorio = {
    exercicio: declaracaoComPerfil?.declaracao.exercicio ?? exercicio,
    anoCalendario: declaracaoComPerfil?.declaracao.anoCalendario ?? ano,
    titularNome: (perfilPessoal?.full_name as string | undefined) ?? null,
    titularCpf: (perfilPessoal?.cpf as string | undefined) ?? null,
    dataGeracao: new Date().toISOString(),
    perfilResumo: construirPerfilResumo(declaracaoComPerfil?.perfil ?? null),
    versaoFiscalNome: dashboard.versaoFiscalNome,
  };

  return montarRelatorioCompleto({
    ano,
    capa,
    cardsPrincipais: dashboard.cards,
    rendaVariavel,
    rendaFixa,
    exterior,
    darf,
    bensDireitos,
    operacoesRendaVariavel,
  });
}
