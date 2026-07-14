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
const JANELA_MAX_DIAS = 3650; // ~10 anos por chamada — limite prático da API do Bacen para intervalos grandes

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

export async function GET(request: NextRequest) {
  if (!autenticado(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const supabase = createAdminClient();

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
          return NextResponse.json(
            { error: `Erro ao gravar intervalo ${cursor} a ${fimJanela}: ${erroUpsert.message}`, inseridosAntes: totalInseridos },
            { status: 500 }
          );
        }
        totalInseridos += linhas.length;
      } else {
        avisos.push(`Sem dados do Bacen entre ${cursor} e ${fimJanela} (feriados/fim de semana ou intervalo sem pregão).`);
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Erro desconhecido ao buscar dados do Bacen.", inseridosAntes: totalInseridos },
        { status: 502 }
      );
    }

    cursor = adicionarDias(fimJanela, 1);
  }

  return NextResponse.json({ ok: true, periodo: { inicio, fim }, inseridos: totalInseridos, avisos });
}
