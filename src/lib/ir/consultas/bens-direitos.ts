/**
 * Orquestração de Bens e Direitos (fase 9 — ver docs/MAPA-DE-DADOS.md
 * §8.43). Sem `"use server"` — mesmo padrão das demais `consultas/*.ts`.
 * Lê itens manuais (`ir_bens_direitos_manuais`) e monta os itens de
 * investimento a partir do ledger fiscal (fase 3) dos ativos cobertos
 * nesta fase (ações, FIIs, renda fixa direta, internacional), reaproveitando
 * a conversão cambial já existente (fase 7) pros internacionais — nunca
 * duplicando a lógica de câmbio nem o cálculo de custo médio.
 */

import Decimal from "decimal.js";
import { createClient } from "@/lib/supabase/server";
import { construirLedgerFiscal, ordenarEventosLedgerFiscal } from "../ledger/construir-ledger";
import { buscarEventosLedgerFiscalDoUsuario } from "./ledger";
import { buscarTransacoesExterior, converterEventosParaReais } from "./exterior";
import { obterVersaoRegraVigente, obterParametrosRegra } from "../regras/carregar-regras";
import { exercicioCorrente } from "./declaracao";
import {
  montarBensDireitos,
  type AtivoParaBensDireitos,
  type GrupoCodigoBensDireitos,
  type ItemBensDireitos,
} from "../motores/bens-direitos";

const CHAVE_TABELA_GRUPOS = "bens_direitos.tabela_grupos_codigos";

/**
 * Carrega a tabela de grupos/códigos vigente pro exercício corrente —
 * `null` se não houver versão de regra ou o parâmetro não estiver seedado
 * (mesmo padrão de bloqueio gracioso das fases 4-7). A UI usa isso pra
 * montar o seletor de grupo/código no formulário de item manual.
 */
export async function obterTabelaGruposCodigosVigente(): Promise<GrupoCodigoBensDireitos[] | null> {
  const { exercicio } = exercicioCorrente();
  const versao = await obterVersaoRegraVigente("brasil", exercicio);
  if (!versao) return null;

  const parametros = await obterParametrosRegra(versao.id);
  const valorJson = parametros.get(CHAVE_TABELA_GRUPOS)?.valorJson ?? null;
  if (!valorJson) return null;

  return valorJson as GrupoCodigoBensDireitos[];
}

export type ItemBemManualRaw = {
  id: string;
  grupo: string;
  codigo: string;
  nome: string;
  localizacao: string | null;
  cpf_cnpj: string | null;
  discriminacao: string | null;
  situacao_anterior: number;
  situacao_atual: number;
  observacoes: string | null;
  status_revisao: "pendente" | "revisado";
};

function mapItemManual(m: ItemBemManualRaw): ItemBensDireitos {
  return {
    origem: "manual",
    grupo: m.grupo,
    codigo: m.codigo,
    nome: m.nome,
    localizacao: m.localizacao,
    cpfCnpj: m.cpf_cnpj,
    discriminacao: m.discriminacao,
    situacaoAnterior: new Decimal(m.situacao_anterior),
    situacaoAtual: new Decimal(m.situacao_atual),
    observacoes: m.observacoes,
    statusRevisao: m.status_revisao,
    ativoId: null,
    manualId: m.id,
  };
}

export type ResultadoBensDireitos = {
  itens: ItemBensDireitos[];
  /** Ativos internacionais excluídos por falta de câmbio em algum evento — mesma regra da fase 7 (ativo inteiro fora, nunca aproximado). */
  ativosComPendencia: { ativoId: string; ativoTicker: string; motivos: string[] }[];
};

/**
 * Monta Bens e Direitos completo (itens manuais + investimentos derivados)
 * pra uma declaração específica. `anoCalendario` é o ano da declaração —
 * "situação anterior" compara com 31/12 do ano-calendário anterior.
 */
export async function obterBensDireitos(declaracaoId: string, anoCalendario: number): Promise<ResultadoBensDireitos> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { itens: [], ativosComPendencia: [] };

  const { data: manuaisRaw, error: erroManuais } = await supabase
    .from("ir_bens_direitos_manuais")
    .select(
      "id, grupo, codigo, nome, localizacao, cpf_cnpj, discriminacao, situacao_anterior, situacao_atual, observacoes, status_revisao"
    )
    .eq("profile_id", user.id)
    .eq("declaracao_id", declaracaoId);
  if (erroManuais) throw new Error(`obterBensDireitos: falha ao ler ir_bens_direitos_manuais — ${erroManuais.message}`);

  const itensManuais = ((manuaisRaw ?? []) as ItemBemManualRaw[]).map(mapItemManual);

  // Ativos domésticos cobertos nesta fase — moeda sempre BRL, sem conversão.
  const { data: ativosNacionaisRaw, error: erroNacionais } = await supabase
    .from("ativos")
    .select("id, ticker, tipo, subtipo_renda_fixa")
    .eq("profile_id", user.id)
    .in("tipo", ["acao", "fii", "renda_fixa"]);
  if (erroNacionais) throw new Error(`obterBensDireitos: falha ao ler ativos (nacionais) — ${erroNacionais.message}`);

  const eventosPorAtivo = await buscarEventosLedgerFiscalDoUsuario();

  const ativosParaMotor: AtivoParaBensDireitos[] = [];
  for (const a of ativosNacionaisRaw ?? []) {
    const ativoId = a.id as string;
    const eventos = eventosPorAtivo.get(ativoId);
    if (!eventos || eventos.length === 0) continue;

    const ledger = construirLedgerFiscal(ordenarEventosLedgerFiscal(eventos));
    ativosParaMotor.push({
      ativoId,
      ativoTicker: a.ticker as string,
      tipo: a.tipo as "acao" | "fii" | "renda_fixa",
      subtipoRendaFixa: a.subtipo_renda_fixa as string | null,
      localizacao: null,
      linhasLedger: ledger.linhas,
    });
  }

  // Ativos internacionais — reaproveita a conversão cambial da fase 7
  // (nunca duplicar a lógica de câmbio, ver comentário no topo do arquivo).
  const { data: internacionaisRaw, error: erroInternacionais } = await supabase
    .from("ativos")
    .select("id, ticker")
    .eq("profile_id", user.id)
    .eq("tipo", "internacional");
  if (erroInternacionais) throw new Error(`obterBensDireitos: falha ao ler ativos (internacionais) — ${erroInternacionais.message}`);

  const ativosComPendencia: { ativoId: string; ativoTicker: string; motivos: string[] }[] = [];
  const idsInternacionais = (internacionaisRaw ?? []).map((a) => a.id as string);
  const transacoesInternacionaisPorAtivo = await buscarTransacoesExterior(supabase, user.id, idsInternacionais);

  for (const a of internacionaisRaw ?? []) {
    const ativoId = a.id as string;
    const ativoTicker = a.ticker as string;
    const brutas = transacoesInternacionaisPorAtivo.get(ativoId);
    if (!brutas || brutas.length === 0) continue;

    const { eventos, pendente, motivos } = converterEventosParaReais(brutas);
    if (pendente) {
      ativosComPendencia.push({ ativoId, ativoTicker, motivos });
      continue;
    }

    const ledger = construirLedgerFiscal(ordenarEventosLedgerFiscal(eventos));
    ativosParaMotor.push({
      ativoId,
      ativoTicker,
      tipo: "internacional",
      subtipoRendaFixa: null,
      localizacao: "Exterior",
      linhasLedger: ledger.linhas,
    });
  }

  const itens = montarBensDireitos(itensManuais, ativosParaMotor, anoCalendario - 1, anoCalendario);
  return { itens, ativosComPendencia };
}
