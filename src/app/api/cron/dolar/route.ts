import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Cron do Dólar — busca a PTAX de fechamento diária na API pública do Bacen
 * (SGS série 1) e faz upsert em `indicador_dolar_diario`. Ver
 * docs/MAPA-DE-DADOS.md §8.9 para o desenho completo.
 *
 * A MESMA rota serve dois papéis, sem script separado:
 * - Backfill inicial: se a tabela estiver vazia, busca desde 1999-01-04
 *   (início do câmbio flutuante no Brasil).
 * - Atualização incremental diária: busca da última data salva + 1 dia até
 *   hoje (normalmente só 1 dia novo).
 *
 * Agendada via `vercel.json` (cron diário). Também pode ser chamada
 * manualmente (ex. pra completar um backfill que não terminou numa única
 * execução, já que cada chamada retoma de onde a anterior parou).
 */

export const maxDuration = 60;

const SGS_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados";
const INICIO_CAMBIO_FLUTUANTE = "1999-01-04";
// Janelas menores (~3 anos) — reduz o risco da API do Bacen truncar
// silenciosamente uma resposta muito grande sem retornar erro (ver
// correção 2026-07-15 abaixo: mesmo se isso acontecer, o cursor agora
// avança a partir da ÚLTIMA DATA REALMENTE RECEBIDA, não do fim da janela
// pedida, então um truncamento não abre mais um buraco permanente).
const JANELA_MAX_DIAS = 1095;

function autenticado(request: NextRequest): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return false;

  const header = request.headers.get("authorization");
  if (header === `Bearer ${segredo}`) return true;

  const querySecret = request.nextUrl.searchParams.get("secret");
  if (querySecret === segredo) return true;

  return false;
}

function formatarDataBr(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function adicionarDias(iso: string, dias: number): string {
  const data = new Date(`${iso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function hojeIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type LinhaSgs = { data: string; valor: string };

async function buscarJanela(inicioIso: string, fimIso: string): Promise<{ data: string; cotacao: number }[]> {
  const url = `${SGS_URL}?formato=json&dataInicial=${formatarDataBr(inicioIso)}&dataFinal=${formatarDataBr(fimIso)}`;
  const resposta = await fetch(url, { cache: "no-store" });
  if (!resposta.ok) {
    throw new Error(`API do Bacen retornou ${resposta.status} para o intervalo ${inicioIso} a ${fimIso}`);
  }
  const linhas: LinhaSgs[] = await resposta.json();
  const resultado: { data: string; cotacao: number }[] = [];
  for (const linha of linhas) {
    const [dia, mes, ano] = linha.data.split("/");
    const cotacao = Number(linha.valor);
    if (!Number.isFinite(cotacao) || cotacao <= 0) continue;
    resultado.push({ data: `${ano}-${mes}-${dia}`, cotacao });
  }
  return resultado;
}

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

/**
 * Preenche um intervalo [inicio, fim] em janelas de JANELA_MAX_DIAS,
 * avançando o cursor pela última data REALMENTE recebida (não pelo fim da
 * janela pedida) — autocorrige truncamento silencioso da API do Bacen em
 * vez de pular e deixar um buraco permanente. Usada tanto na atualização
 * incremental diária quanto no preenchimento de buracos pontuais.
 */
async function preencherIntervalo(
  supabase: SupabaseAdmin,
  inicio: string,
  fim: string
): Promise<{ inseridos: number; avisos: string[] } | { erro: string; status: number }> {
  let cursor = inicio;
  let totalInseridos = 0;
  const avisos: string[] = [];

  while (cursor <= fim) {
    const fimJanela = adicionarDias(cursor, JANELA_MAX_DIAS) > fim ? fim : adicionarDias(cursor, JANELA_MAX_DIAS);

    try {
      const linhas = await buscarJanela(cursor, fimJanela);

      if (linhas.length > 0) {
        const { error: erroUpsert } = await supabase
          .from("indicador_dolar_diario")
          .upsert(linhas, { onConflict: "data" });

        if (erroUpsert) {
          return { erro: `Erro ao gravar intervalo ${cursor} a ${fimJanela}: ${erroUpsert.message}`, status: 500 };
        }
        totalInseridos += linhas.length;

        const ultimaDataRecebida = linhas.reduce(
          (max, l) => (l.data > max ? l.data : max),
          linhas[0].data
        );
        if (ultimaDataRecebida < fimJanela) {
          avisos.push(
            `Resposta do Bacen para ${cursor} a ${fimJanela} veio incompleta — só chegou até ${ultimaDataRecebida}. Retomando dali.`
          );
        }
        cursor = adicionarDias(ultimaDataRecebida, 1);
      } else {
        avisos.push(`Sem dados do Bacen entre ${cursor} e ${fimJanela} (feriados/fim de semana ou intervalo sem pregão).`);
        cursor = adicionarDias(fimJanela, 1);
      }
    } catch (e) {
      return {
        erro: e instanceof Error ? e.message : "Erro desconhecido ao buscar dados do Bacen.",
        status: 502,
      };
    }
  }

  return { inseridos: totalInseridos, avisos };
}

const LIMIAR_BURACO_DIAS = 10; // acima disso não é feriado/fim de semana normal — é buraco de verdade

function diffDias(a: string, b: string): number {
  const ta = new Date(`${a}T00:00:00Z`).getTime();
  const tb = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((tb - ta) / 86400000);
}

/** Varre todas as datas salvas e retorna os intervalos [fim-anterior+1, começo-seguinte-1] onde falta dado. */
async function detectarBuracos(supabase: SupabaseAdmin): Promise<{ de: string; ate: string; diasFaltando: number }[]> {
  const { data: linhas, error } = await supabase
    .from("indicador_dolar_diario")
    .select("data")
    .order("data", { ascending: true })
    .range(0, 19999);

  if (error || !linhas || linhas.length < 2) return [];

  const buracos: { de: string; ate: string; diasFaltando: number }[] = [];
  for (let i = 1; i < linhas.length; i++) {
    const anterior = linhas[i - 1].data as string;
    const atual = linhas[i].data as string;
    const dias = diffDias(anterior, atual);
    if (dias > LIMIAR_BURACO_DIAS) {
      buracos.push({ de: adicionarDias(anterior, 1), ate: adicionarDias(atual, -1), diasFaltando: dias - 1 });
    }
  }
  return buracos;
}

export async function GET(request: NextRequest) {
  if (!autenticado(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const supabase = createAdminClient();
  const modo = request.nextUrl.searchParams.get("modo");

  // Modo diagnóstico: só lista buracos no histórico, não escreve nada.
  if (modo === "diagnostico") {
    const buracos = await detectarBuracos(supabase);
    return NextResponse.json({ ok: true, buracos });
  }

  // Modo preencher buracos: detecta e busca no Bacen especificamente os
  // intervalos faltantes (além da atualização incremental normal).
  if (modo === "preencherGaps") {
    const buracos = await detectarBuracos(supabase);
    const resultados: { de: string; ate: string; inseridos?: number; erro?: string }[] = [];
    for (const buraco of buracos) {
      const resultado = await preencherIntervalo(supabase, buraco.de, buraco.ate);
      if ("erro" in resultado) {
        resultados.push({ de: buraco.de, ate: buraco.ate, erro: resultado.erro });
      } else {
        resultados.push({ de: buraco.de, ate: buraco.ate, inseridos: resultado.inseridos });
      }
    }
    return NextResponse.json({ ok: true, buracosEncontrados: buracos.length, resultados });
  }

  // Modo padrão: atualização incremental (última data salva + 1 até hoje).
  const { data: ultimaLinha, error: erroConsulta } = await supabase
    .from("indicador_dolar_diario")
    .select("data")
    .order("data", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (erroConsulta) {
    return NextResponse.json({ error: `Erro ao consultar última data salva: ${erroConsulta.message}` }, { status: 500 });
  }

  const inicio = ultimaLinha ? adicionarDias(ultimaLinha.data, 1) : INICIO_CAMBIO_FLUTUANTE;
  const fim = hojeIso();

  if (inicio > fim) {
    return NextResponse.json({ ok: true, mensagem: "Já está atualizado — nenhum dia novo pra buscar.", inseridos: 0 });
  }

  const resultado = await preencherIntervalo(supabase, inicio, fim);
  if ("erro" in resultado) {
    return NextResponse.json({ error: resultado.erro }, { status: resultado.status });
  }

  return NextResponse.json({ ok: true, periodo: { inicio, fim }, inseridos: resultado.inseridos, avisos: resultado.avisos });
}
