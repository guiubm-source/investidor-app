"use server";

import { createClient } from "@/lib/supabase/server";

export type AcaoResultado = { error?: string };

/**
 * Motor de cálculo do relatório auxiliar de Imposto de Renda. Reaproveita a
 * mesma passada cronológica de custo médio ponderado usada em
 * lib/ativos/actions.ts#calcularPosicao (fonte única de verdade, ver
 * docs/MAPA-DE-DADOS.md §3), estendida aqui para também emitir o detalhe de
 * cada venda (ganho, se foi day trade). Ver §8.6 do mapa para o desenho
 * completo desta aproximação — não é um motor de casamento de ordens real.
 *
 * ⚠️ Relatório AUXILIAR, não consultoria tributária. Confira com um contador
 * antes de declarar.
 */

type CategoriaIR =
  | "acao_swing"
  | "acao_day"
  | "fii"
  | "renda_fixa_tributavel"
  | "renda_fixa_isenta"
  | "cripto_nacional"
  | "cripto_estrangeira"
  | "internacional";

const LABEL_CATEGORIA: Record<CategoriaIR, string> = {
  acao_swing: "Ações/fundos — swing trade",
  acao_day: "Ações/fundos — day trade",
  fii: "FIIs — venda de cotas",
  renda_fixa_tributavel: "Renda fixa tributável (CDB/Tesouro/Debênture)",
  renda_fixa_isenta: "Renda fixa isenta (LCI/LCA/CRI/CRA)",
  cripto_nacional: "Cripto — exchange nacional",
  cripto_estrangeira: "Cripto — exchange estrangeira",
  internacional: "Ativos internacionais",
};

/** Categorias cuja apuração de imposto é ANUAL (não mensal) por lei. */
const CATEGORIAS_APURACAO_ANUAL: CategoriaIR[] = ["cripto_estrangeira", "internacional"];

type TransacaoRaw = {
  ativo_id: string;
  tipo: "compra" | "venda";
  data: string;
  quantidade: number;
  preco_unitario: number;
  custos: number;
  created_at: string;
};

type AtivoRaw = {
  id: string;
  ticker: string;
  tipo: string;
  subtipo_renda_fixa: string | null;
  cripto_exchange: string | null;
};

type VendaApurada = {
  ativoId: string;
  ativoTicker: string;
  categoria: CategoriaIR;
  anoMes: string;
  data: string;
  quantidade: number;
  ganho: number;
  vendaTotal: number;
  diasMediosRetencao: number | null; // só preenchido para renda_fixa
};

function categoriaDoAtivo(
  ativo: AtivoRaw,
  dayTrade: boolean
): CategoriaIR | null {
  switch (ativo.tipo) {
    case "acao":
    case "fundo":
      return dayTrade ? "acao_day" : "acao_swing";
    case "fii":
      return "fii";
    case "renda_fixa":
      return ["lci", "lca", "cri", "cra"].includes(ativo.subtipo_renda_fixa ?? "")
        ? "renda_fixa_isenta"
        : "renda_fixa_tributavel";
    case "cripto":
      return ativo.cripto_exchange === "estrangeira" ? "cripto_estrangeira" : "cripto_nacional";
    case "internacional":
      return "internacional";
    default:
      return null; // `outro` — sem regra de IR pesquisada, fica fora do relatório
  }
}

/**
 * Calcula, para um único ativo, a lista de vendas apuradas ao longo de toda
 * a história de transações (não só o ano selecionado — a compensação de
 * prejuízo dentro do ano precisa saber o que aconteceu mês a mês).
 *
 * Day trade: agrupa compra+venda do mesmo dia; o volume
 * min(comprado no dia, vendido no dia) vira day trade (preço médio do dia
 * dos dois lados); o excedente segue como swing, usando o preço médio
 * ponderado acumulado até o dia anterior. Só se aplica a ações/fundos —
 * outros tipos não têm essa distinção tributária.
 *
 * FIFO auxiliar (só para `renda_fixa`): fila de lotes de compra por data,
 * consumida na ordem em que entrou, usada só para estimar quantos dias em
 * média aquela venda ficou aplicada (tabela regressiva) — não interfere no
 * cálculo de ganho, que continua pelo custo médio ponderado.
 */
function apurarVendasDoAtivo(ativo: AtivoRaw, transacoes: TransacaoRaw[]): VendaApurada[] {
  const ordenadas = [...transacoes].sort((a, b) => {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;
    return a.created_at < b.created_at ? -1 : 1;
  });

  // Agrupa por data para poder separar day trade de swing.
  const porData = new Map<string, TransacaoRaw[]>();
  for (const t of ordenadas) {
    const lista = porData.get(t.data) ?? [];
    lista.push(t);
    porData.set(t.data, lista);
  }
  const datasOrdenadas = [...porData.keys()].sort();

  const ehAcaoOuFundo = ativo.tipo === "acao" || ativo.tipo === "fundo";
  const ehRendaFixa = ativo.tipo === "renda_fixa";

  let quantidade = 0;
  let custoTotal = 0;
  const fifoRendaFixa: { data: string; quantidade: number }[] = [];

  const vendas: VendaApurada[] = [];

  for (const data of datasOrdenadas) {
    const doDia = porData.get(data)!;
    const comprasDia = doDia.filter((t) => t.tipo === "compra");
    const vendasDia = doDia.filter((t) => t.tipo === "venda");

    const qtdCompradaDia = comprasDia.reduce((s, t) => s + t.quantidade, 0);
    const custoCompradoDia = comprasDia.reduce((s, t) => s + t.quantidade * t.preco_unitario + t.custos, 0);
    const qtdVendidaDia = vendasDia.reduce((s, t) => s + t.quantidade, 0);
    const receitaVendidaDia = vendasDia.reduce((s, t) => s + t.quantidade * t.preco_unitario - t.custos, 0);

    const dayTradeQty = ehAcaoOuFundo ? Math.min(qtdCompradaDia, qtdVendidaDia) : 0;

    if (dayTradeQty > 0) {
      const precoMedioCompraDia = qtdCompradaDia > 0 ? custoCompradoDia / qtdCompradaDia : 0;
      const precoMedioVendaDia = qtdVendidaDia > 0 ? receitaVendidaDia / qtdVendidaDia : 0;
      const ganhoDayTrade = (precoMedioVendaDia - precoMedioCompraDia) * dayTradeQty;
      const categoria = categoriaDoAtivo(ativo, true);
      if (categoria) {
        vendas.push({
          ativoId: ativo.id,
          ativoTicker: ativo.ticker,
          categoria,
          anoMes: data.slice(0, 7),
          data,
          quantidade: dayTradeQty,
          ganho: ganhoDayTrade,
          vendaTotal: precoMedioVendaDia * dayTradeQty,
          diasMediosRetencao: null,
        });
      }
    }

    // Parte que sobra depois do day trade entra/sai da posição normalmente.
    const compraSwingQty = qtdCompradaDia - dayTradeQty;
    const vendaSwingQty = qtdVendidaDia - dayTradeQty;

    if (compraSwingQty > 0 && qtdCompradaDia > 0) {
      const precoMedioCompraDia = custoCompradoDia / qtdCompradaDia;
      custoTotal += compraSwingQty * precoMedioCompraDia;
      quantidade += compraSwingQty;
      if (ehRendaFixa) fifoRendaFixa.push({ data, quantidade: compraSwingQty });
    }

    if (vendaSwingQty > 0) {
      const precoMedioAtual = quantidade > 0 ? custoTotal / quantidade : 0;
      const precoMedioVendaDia = qtdVendidaDia > 0 ? receitaVendidaDia / qtdVendidaDia : 0;
      const ganhoSwing = (precoMedioVendaDia - precoMedioAtual) * vendaSwingQty;
      custoTotal -= precoMedioAtual * Math.min(vendaSwingQty, quantidade);
      quantidade -= Math.min(vendaSwingQty, quantidade);

      let diasMediosRetencao: number | null = null;
      if (ehRendaFixa) {
        let restante = vendaSwingQty;
        let somaDiasPonderada = 0;
        while (restante > 0 && fifoRendaFixa.length > 0) {
          const lote = fifoRendaFixa[0];
          const consumida = Math.min(restante, lote.quantidade);
          const dias = Math.max(
            0,
            Math.round((new Date(data).getTime() - new Date(lote.data).getTime()) / 86400000)
          );
          somaDiasPonderada += dias * consumida;
          lote.quantidade -= consumida;
          restante -= consumida;
          if (lote.quantidade <= 0) fifoRendaFixa.shift();
        }
        const qtdConsumida = vendaSwingQty - restante;
        diasMediosRetencao = qtdConsumida > 0 ? somaDiasPonderada / qtdConsumida : null;
      }

      const categoria = categoriaDoAtivo(ativo, false);
      if (categoria) {
        vendas.push({
          ativoId: ativo.id,
          ativoTicker: ativo.ticker,
          categoria,
          anoMes: data.slice(0, 7),
          data,
          quantidade: vendaSwingQty,
          ganho: ganhoSwing,
          vendaTotal: precoMedioVendaDia * vendaSwingQty,
          diasMediosRetencao,
        });
      }
    }
  }

  return vendas;
}

/** Tabela regressiva de renda fixa (dias corridos) — só informativo, retido na fonte. */
function aliquotaRendaFixaPorDias(dias: number): number {
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.2;
  if (dias <= 720) return 0.175;
  return 0.15;
}

/** Tabela progressiva de cripto (sobre o ganho apurado). */
function aliquotaCripto(baseCalculo: number): number {
  if (baseCalculo <= 5_000_000) return 0.15;
  if (baseCalculo <= 10_000_000) return 0.175;
  if (baseCalculo <= 30_000_000) return 0.2;
  return 0.225;
}

export type LinhaMensal = {
  anoMes: string;
  categoria: CategoriaIR;
  categoriaLabel: string;
  vendaTotal: number;
  lucroBruto: number;
  isento: boolean;
  motivoIsencao: string | null;
  baseCalculo: number;
  aliquota: number | null;
  impostoDevido: number | null;
  apuracaoAnual: boolean;
  diasMediosRetencao: number | null;
};

export type ResumoAnualCategoria = {
  categoria: CategoriaIR;
  categoriaLabel: string;
  vendaTotal: number;
  lucroLiquido: number;
  impostoDevido: number;
  apuracaoAnual: boolean;
};

export type RelatorioIR = {
  ano: number;
  anosDisponiveis: number[];
  mensal: LinhaMensal[];
  resumoAnual: ResumoAnualCategoria[];
};

export async function obterAnosDisponiveis(): Promise<number[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [new Date().getFullYear()];

  const { data } = await supabase.from("transacoes").select("data").eq("profile_id", user.id).eq("tipo", "venda");
  const anos = new Set((data ?? []).map((t) => Number((t.data as string).slice(0, 4))));
  anos.add(new Date().getFullYear());
  return [...anos].sort((a, b) => b - a);
}

export async function obterRelatorioIR(ano: number): Promise<RelatorioIR> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const anosDisponiveis = await obterAnosDisponiveis();
  if (!user) return { ano, anosDisponiveis, mensal: [], resumoAnual: [] };

  const [{ data: ativosRaw }, { data: transacoesRaw }] = await Promise.all([
    supabase
      .from("ativos")
      .select("id, ticker, tipo, subtipo_renda_fixa, cripto_exchange")
      .eq("profile_id", user.id),
    supabase
      .from("transacoes")
      .select("ativo_id, tipo, data, quantidade, preco_unitario, custos, created_at")
      .eq("profile_id", user.id),
  ]);

  const ativos = (ativosRaw ?? []) as AtivoRaw[];
  const transacoes = (transacoesRaw ?? []) as TransacaoRaw[];

  // Apura TODAS as vendas (histórico completo) — precisamos do prejuízo
  // acumulado mês a mês dentro do ano, e o ano pode começar com posições
  // compradas em anos anteriores.
  const todasVendas: VendaApurada[] = [];
  for (const ativo of ativos) {
    const transacoesDoAtivo = transacoes.filter((t) => t.ativo_id === ativo.id);
    if (transacoesDoAtivo.length === 0) continue;
    todasVendas.push(...apurarVendasDoAtivo(ativo, transacoesDoAtivo));
  }

  const vendasDoAno = todasVendas.filter((v) => v.anoMes.startsWith(String(ano)));

  // Agrupa por (categoria, anoMes)
  const chaveMes = (v: VendaApurada) => `${v.categoria}|${v.anoMes}`;
  const gruposMes = new Map<string, VendaApurada[]>();
  for (const v of vendasDoAno) {
    const chave = chaveMes(v);
    const lista = gruposMes.get(chave) ?? [];
    lista.push(v);
    gruposMes.set(chave, lista);
  }

  const categoriasComVenda = new Set<CategoriaIR>(vendasDoAno.map((v) => v.categoria));
  const mensal: LinhaMensal[] = [];
  const prejuizoAcumuladoPorCategoria: Partial<Record<CategoriaIR, number>> = {};

  for (const categoria of categoriasComVenda) {
    const apuracaoAnual = CATEGORIAS_APURACAO_ANUAL.includes(categoria);
    const mesesDaCategoria = [...gruposMes.entries()]
      .filter(([chave]) => chave.startsWith(`${categoria}|`))
      .map(([, vs]) => vs)
      .sort((a, b) => (a[0].anoMes < b[0].anoMes ? -1 : 1));

    for (const vendasMes of mesesDaCategoria) {
      const anoMes = vendasMes[0].anoMes;
      const vendaTotal = vendasMes.reduce((s, v) => s + v.vendaTotal, 0);
      const lucroBruto = vendasMes.reduce((s, v) => s + v.ganho, 0);
      const diasValidos = vendasMes.map((v) => v.diasMediosRetencao).filter((d): d is number => d !== null);
      const diasMediosRetencao =
        diasValidos.length > 0 ? diasValidos.reduce((s, d) => s + d, 0) / diasValidos.length : null;

      if (categoria === "renda_fixa_isenta") {
        mensal.push({
          anoMes,
          categoria,
          categoriaLabel: LABEL_CATEGORIA[categoria],
          vendaTotal,
          lucroBruto,
          isento: true,
          motivoIsencao: "LCI/LCA/CRI/CRA são isentos de IR para pessoa física",
          baseCalculo: 0,
          aliquota: null,
          impostoDevido: 0,
          apuracaoAnual: false,
          diasMediosRetencao,
        });
        continue;
      }

      if (categoria === "renda_fixa_tributavel") {
        const aliquotaEstimada = diasMediosRetencao !== null ? aliquotaRendaFixaPorDias(diasMediosRetencao) : null;
        mensal.push({
          anoMes,
          categoria,
          categoriaLabel: LABEL_CATEGORIA[categoria],
          vendaTotal,
          lucroBruto,
          isento: false,
          motivoIsencao: null,
          baseCalculo: Math.max(0, lucroBruto),
          aliquota: aliquotaEstimada,
          impostoDevido: null, // retido na fonte automaticamente, sem DARF
          apuracaoAnual: false,
          diasMediosRetencao,
        });
        continue;
      }

      if (apuracaoAnual) {
        // Linha mensal só informativa — imposto de verdade sai no resumo anual.
        mensal.push({
          anoMes,
          categoria,
          categoriaLabel: LABEL_CATEGORIA[categoria],
          vendaTotal,
          lucroBruto,
          isento: false,
          motivoIsencao: null,
          baseCalculo: lucroBruto,
          aliquota: null,
          impostoDevido: null,
          apuracaoAnual: true,
          diasMediosRetencao: null,
        });
        continue;
      }

      // Categorias de apuração mensal com compensação de prejuízo: acao_swing,
      // acao_day, fii, cripto_nacional.
      const prejuizoAnterior = prejuizoAcumuladoPorCategoria[categoria] ?? 0; // sempre <= 0
      const baseAntesCompensacao = lucroBruto + prejuizoAnterior;

      let isento = false;
      let motivoIsencao: string | null = null;
      if (baseAntesCompensacao > 0) {
        if (categoria === "acao_swing" && vendaTotal <= 20_000) {
          isento = true;
          motivoIsencao = "Vendas do mês ≤ R$20.000 (isenção swing trade em ações)";
        } else if (categoria === "cripto_nacional" && vendaTotal <= 35_000) {
          isento = true;
          motivoIsencao = "Vendas do mês ≤ R$35.000 em exchange nacional";
        }
      }

      let impostoDevido = 0;
      let aliquota: number | null = null;
      if (baseAntesCompensacao <= 0) {
        prejuizoAcumuladoPorCategoria[categoria] = baseAntesCompensacao;
      } else if (isento) {
        prejuizoAcumuladoPorCategoria[categoria] = 0;
      } else {
        aliquota =
          categoria === "acao_day"
            ? 0.2
            : categoria === "acao_swing"
              ? 0.15
              : categoria === "fii"
                ? 0.2
                : aliquotaCripto(baseAntesCompensacao);
        impostoDevido = baseAntesCompensacao * aliquota;
        prejuizoAcumuladoPorCategoria[categoria] = 0;
      }

      mensal.push({
        anoMes,
        categoria,
        categoriaLabel: LABEL_CATEGORIA[categoria],
        vendaTotal,
        lucroBruto,
        isento,
        motivoIsencao,
        baseCalculo: Math.max(0, baseAntesCompensacao),
        aliquota,
        impostoDevido,
        apuracaoAnual: false,
        diasMediosRetencao: null,
      });
    }
  }

  mensal.sort((a, b) => (a.anoMes === b.anoMes ? a.categoria.localeCompare(b.categoria) : a.anoMes < b.anoMes ? -1 : 1));

  // Resumo anual: soma o que já foi apurado mês a mês (categorias mensais) e
  // recalcula do zero as categorias de apuração anual.
  const resumoAnual: ResumoAnualCategoria[] = [];
  for (const categoria of categoriasComVenda) {
    const linhasCategoria = mensal.filter((l) => l.categoria === categoria);
    const vendaTotal = linhasCategoria.reduce((s, l) => s + l.vendaTotal, 0);
    const lucroLiquido = linhasCategoria.reduce((s, l) => s + l.lucroBruto, 0);

    if (CATEGORIAS_APURACAO_ANUAL.includes(categoria)) {
      const impostoDevido = lucroLiquido > 0 ? lucroLiquido * 0.15 : 0;
      resumoAnual.push({
        categoria,
        categoriaLabel: LABEL_CATEGORIA[categoria],
        vendaTotal,
        lucroLiquido,
        impostoDevido,
        apuracaoAnual: true,
      });
      continue;
    }

    const impostoDevido = linhasCategoria.reduce((s, l) => s + (l.impostoDevido ?? 0), 0);
    resumoAnual.push({
      categoria,
      categoriaLabel: LABEL_CATEGORIA[categoria],
      vendaTotal,
      lucroLiquido,
      impostoDevido,
      apuracaoAnual: false,
    });
  }

  resumoAnual.sort((a, b) => a.categoria.localeCompare(b.categoria));

  return { ano, anosDisponiveis, mensal, resumoAnual };
}
