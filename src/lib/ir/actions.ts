"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { perfilFiscalSchema, bemManualSchema, type PerfilFiscalForm, type BemManualForm } from "./schema";
import { obterDeclaracaoAtual as _obterDeclaracaoAtual, type DeclaracaoComPerfil } from "./consultas/declaracao";
import type { AvisoEscopoIR, PerfilFiscalIR } from "./tipos";
import { apurarRendaVariavelBrasilDoUsuario } from "./consultas/renda-variavel";
import type { LinhaMensalRendaVariavel } from "./motores/renda-variavel-brasil";
import {
  obterBensDireitos,
  obterTabelaGruposCodigosVigente,
  type ResultadoBensDireitos,
} from "./consultas/bens-direitos";
import type { GrupoCodigoBensDireitos } from "./motores/bens-direitos";

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
  tipo: "compra" | "venda" | "desdobramento" | "grupamento" | "bonificacao";
  data: string;
  quantidade: number | null;
  preco_unitario: number | null;
  custos: number | null;
  /** Só desdobramento/grupamento (ver docs/MAPA-DE-DADOS.md §8.22). */
  fator_proporcao: number | null;
  /** Só bonificação (ver §8.22). */
  valor_capitalizado: number | null;
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

    // Ver docs/MAPA-DE-DADOS.md §8.22: eventos societários (desdobramento/
    // grupamento/bonificação) reorganizam a posição já existente — aplicados
    // ANTES das compras/vendas do mesmo dia (mesma convenção de mercado: o
    // split já vale para negociações daquele pregão). Sem isso, o preço
    // médio usado pra apurar ganho de venda ficaria com base pré-evento,
    // gerando ganho/prejuízo incorreto no relatório de IR depois de
    // qualquer desdobramento/grupamento/bonificação.
    const eventosDia = doDia.filter(
      (t) => t.tipo === "desdobramento" || t.tipo === "grupamento" || t.tipo === "bonificacao"
    );
    for (const evento of eventosDia) {
      if (evento.tipo === "desdobramento" || evento.tipo === "grupamento") {
        const fator = evento.fator_proporcao ?? 1;
        quantidade *= fator;
        if (ehRendaFixa) for (const lote of fifoRendaFixa) lote.quantidade *= fator;
      } else {
        // bonificacao: soma quantidade recebida + valor capitalizado ao
        // custo total (nunca "custo zero" isolado nas ações novas).
        quantidade += evento.quantidade ?? 0;
        custoTotal += evento.valor_capitalizado ?? 0;
        if (ehRendaFixa) fifoRendaFixa.push({ data, quantidade: evento.quantidade ?? 0 });
      }
    }

    const comprasDia = doDia.filter((t) => t.tipo === "compra");
    const vendasDia = doDia.filter((t) => t.tipo === "venda");

    const qtdCompradaDia = comprasDia.reduce((s, t) => s + (t.quantidade ?? 0), 0);
    const custoCompradoDia = comprasDia.reduce((s, t) => s + (t.quantidade ?? 0) * (t.preco_unitario ?? 0) + (t.custos ?? 0), 0);
    const qtdVendidaDia = vendasDia.reduce((s, t) => s + (t.quantidade ?? 0), 0);
    const receitaVendidaDia = vendasDia.reduce((s, t) => s + (t.quantidade ?? 0) * (t.preco_unitario ?? 0) - (t.custos ?? 0), 0);

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
  /** Prejuízo de meses/anos anteriores (mesma categoria) usado pra abater o
   * lucro deste mês — sempre >= 0. Ver §8.11: compensação de prejuízo em
   * renda variável não prescreve, então isso pode vir de qualquer ano
   * anterior, não só do mês anterior dentro do mesmo ano. */
  prejuizoAnteriorAplicado: number;
  /**
   * Ver docs/MAPA-DE-DADOS.md §8.39 (fase 4b): `acao_swing`/`acao_day`/`fii`
   * passaram a vir do motor novo (lib/ir/motores/renda-variavel-brasil.ts,
   * ledger fiscal + classificação de day trade reais), marcado "em
   * validação" na UI — as demais categorias continuam vindo da aproximação
   * antiga (`legado`) até as fases 6-8 cobrirem renda fixa/exterior/cripto.
   * Fallback: se a versão de regra vigente não existir/faltar parâmetro, a
   * categoria volta a `legado` automaticamente (ver `obterRelatorioIR`).
   */
  origemMotor: "novo_fase4" | "legado";
  /**
   * true quando pelo menos uma venda deste mês/categoria não pôde ser
   * classificada com segurança pelo motor novo (day trade pendente,
   * §8.32.31 item 8) — o valor dela fica de fora do cálculo, não é
   * aproximado. Sempre `false` em linhas `origemMotor: "legado"`.
   */
  pendente: boolean;
  motivosPendencia: string[];
};

export type ResumoAnualCategoria = {
  categoria: CategoriaIR;
  categoriaLabel: string;
  vendaTotal: number;
  lucroLiquido: number;
  impostoDevido: number;
  apuracaoAnual: boolean;
  /** Ver `LinhaMensal.origemMotor` — herdado das linhas mensais que compõem este resumo. */
  origemMotor: "novo_fase4" | "legado";
};

export type RelatorioIR = {
  ano: number;
  anosDisponiveis: number[];
  mensal: LinhaMensal[];
  resumoAnual: ResumoAnualCategoria[];
};

/**
 * Converte uma linha do motor novo (fase 4, Decimal, ver
 * docs/MAPA-DE-DADOS.md §8.38/§8.39) pro formato antigo `LinhaMensal`
 * (number) que a UI já sabe renderizar. Arredondamento pra `number` só
 * acontece nesta fronteira de saída — o cálculo em si (`apurarRendaVariavelBrasil`)
 * continua inteiramente em Decimal (§8.32.32).
 */
function converterLinhaRendaVariavelNova(l: LinhaMensalRendaVariavel): LinhaMensal {
  const categoria = l.grupo as CategoriaIR;
  return {
    anoMes: l.anoMes,
    categoria,
    categoriaLabel: LABEL_CATEGORIA[categoria],
    vendaTotal: l.vendaTotalBruta.toNumber(),
    lucroBruto: l.lucroBruto.toNumber(),
    isento: l.isento,
    motivoIsencao: l.motivoIsencao,
    baseCalculo: l.baseCalculo.toNumber(),
    aliquota: l.aliquota ? l.aliquota.toNumber() : null,
    impostoDevido: l.impostoDevido ? l.impostoDevido.toNumber() : null,
    apuracaoAnual: false,
    diasMediosRetencao: null,
    prejuizoAnteriorAplicado: l.prejuizoAnteriorAplicado.toNumber(),
    origemMotor: "novo_fase4",
    pendente: l.pendente,
    motivosPendencia: l.motivosPendencia,
  };
}

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
      .select("ativo_id, tipo, data, quantidade, preco_unitario, custos, fator_proporcao, valor_capitalizado, created_at")
      .eq("profile_id", user.id),
  ]);

  const ativos = (ativosRaw ?? []) as AtivoRaw[];
  const transacoes = (transacoesRaw ?? []) as TransacaoRaw[];

  // Apura TODAS as vendas (histórico completo, todos os anos) — a
  // compensação de prejuízo em renda variável não tem prazo de prescrição
  // (Receita Federal: prejuízo de qualquer ano anterior abate lucro de
  // qualquer ano seguinte, contanto que informado na ficha de Renda
  // Variável da declaração). Por isso o ledger de prejuízo por categoria
  // roda sobre a história inteira, não só o ano pedido — só FILTRAMOS o
  // que aparece em `mensal`/`resumoAnual` pro ano `ano`, mas o estado
  // acumulado sempre considera dezembro do ano anterior antes de janeiro
  // deste ano. Ver docs/MAPA-DE-DADOS.md §8.11.
  const todasVendas: VendaApurada[] = [];
  for (const ativo of ativos) {
    const transacoesDoAtivo = transacoes.filter((t) => t.ativo_id === ativo.id);
    if (transacoesDoAtivo.length === 0) continue;
    todasVendas.push(...apurarVendasDoAtivo(ativo, transacoesDoAtivo));
  }

  // Agrupa por (categoria, anoMes) usando TODO o histórico.
  const chaveMes = (v: VendaApurada) => `${v.categoria}|${v.anoMes}`;
  const gruposMes = new Map<string, VendaApurada[]>();
  for (const v of todasVendas) {
    const chave = chaveMes(v);
    const lista = gruposMes.get(chave) ?? [];
    lista.push(v);
    gruposMes.set(chave, lista);
  }

  const todasCategorias = new Set<CategoriaIR>(todasVendas.map((v) => v.categoria));
  const categoriasComVendaNoAno = new Set<CategoriaIR>(
    todasVendas.filter((v) => v.anoMes.startsWith(String(ano))).map((v) => v.categoria)
  );

  const mensal: LinhaMensal[] = [];
  const prejuizoAcumuladoPorCategoria: Partial<Record<CategoriaIR, number>> = {}; // sempre <= 0

  for (const categoria of todasCategorias) {
    const apuracaoAnual = CATEGORIAS_APURACAO_ANUAL.includes(categoria);
    const mesesDaCategoria = [...gruposMes.entries()]
      .filter(([chave]) => chave.startsWith(`${categoria}|`))
      .map(([, vs]) => vs)
      .sort((a, b) => (a[0].anoMes < b[0].anoMes ? -1 : 1));

    for (const vendasMes of mesesDaCategoria) {
      const anoMes = vendasMes[0].anoMes;
      // Processa TODO mês de TODO ano (pra manter o ledger de prejuízo
      // correto), mas só emite linha em `mensal` pro ano pedido.
      const emitirLinha = anoMes.startsWith(String(ano));

      const vendaTotal = vendasMes.reduce((s, v) => s + v.vendaTotal, 0);
      const lucroBruto = vendasMes.reduce((s, v) => s + v.ganho, 0);
      const diasValidos = vendasMes.map((v) => v.diasMediosRetencao).filter((d): d is number => d !== null);
      const diasMediosRetencao =
        diasValidos.length > 0 ? diasValidos.reduce((s, d) => s + d, 0) / diasValidos.length : null;

      if (categoria === "renda_fixa_isenta") {
        if (emitirLinha) {
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
            prejuizoAnteriorAplicado: 0,
            origemMotor: "legado",
            pendente: false,
            motivosPendencia: [],
          });
        }
        continue;
      }

      if (categoria === "renda_fixa_tributavel") {
        if (emitirLinha) {
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
            prejuizoAnteriorAplicado: 0,
            origemMotor: "legado",
            pendente: false,
            motivosPendencia: [],
          });
        }
        continue;
      }

      if (apuracaoAnual) {
        // Linha mensal só informativa — imposto de verdade sai no resumo
        // anual (ledger anual próprio, ver abaixo), que também compensa
        // prejuízo de anos anteriores da mesma categoria.
        if (emitirLinha) {
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
            prejuizoAnteriorAplicado: 0,
            origemMotor: "legado",
            pendente: false,
            motivosPendencia: [],
          });
        }
        continue;
      }

      // Categorias de apuração mensal com compensação de prejuízo: acao_swing,
      // acao_day, fii, cripto_nacional. O ledger roda sobre TODA a história
      // (loop externo não filtra por ano), então dezembro do ano anterior já
      // abateu esse `prejuizoAnterior` antes de chegarmos em janeiro do ano
      // pedido.
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

      if (emitirLinha) {
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
          prejuizoAnteriorAplicado: -Math.min(0, prejuizoAnterior),
          origemMotor: "legado",
          pendente: false,
          motivosPendencia: [],
        });
      }
    }
  }

  // ---- Fase 4b (§8.39): substitui acao_swing/acao_day/fii pelo motor novo -
  // ledger fiscal + classificação de day trade reais (fases 3/4), em vez da
  // aproximação acima (min(comprada,vendida) por dia, sem considerar
  // corretora/sequência de ordens). Fallback gracioso: se a versão de regra
  // vigente do exercício corrente não existir ou faltar algum parâmetro,
  // `apurarRendaVariavelBrasilDoUsuario` devolve `null` e as 3 categorias
  // acima (calculadas pela aproximação antiga) permanecem como estavam —
  // nunca perdemos dado por causa de uma fundação incompleta.
  const resultadoRendaVariavelNovo = await apurarRendaVariavelBrasilDoUsuario();
  if (resultadoRendaVariavelNovo) {
    const categoriasSubstituidas: CategoriaIR[] = ["acao_swing", "acao_day", "fii"];
    const mensalSemAntigas = mensal.filter((l) => !categoriasSubstituidas.includes(l.categoria));
    mensal.length = 0;
    mensal.push(...mensalSemAntigas, ...resultadoRendaVariavelNovo.mensal.filter((l) => l.anoMes.startsWith(String(ano))).map(converterLinhaRendaVariavelNova));

    for (const categoria of categoriasSubstituidas) {
      const temLinhaNoAno = mensal.some((l) => l.categoria === categoria);
      if (temLinhaNoAno) categoriasComVendaNoAno.add(categoria);
      else categoriasComVendaNoAno.delete(categoria);
    }
  }

  mensal.sort((a, b) => (a.anoMes === b.anoMes ? a.categoria.localeCompare(b.categoria) : a.anoMes < b.anoMes ? -1 : 1));

  // Resumo anual: soma o que já foi apurado mês a mês (categorias mensais,
  // já com compensação entre anos aplicada acima) e roda um ledger ANO A
  // ANO (não mês a mês) pras categorias de apuração anual — mesmo
  // princípio, prejuízo de um ano abate lucro de qualquer ano seguinte.
  const resumoAnual: ResumoAnualCategoria[] = [];
  for (const categoria of categoriasComVendaNoAno) {
    if (CATEGORIAS_APURACAO_ANUAL.includes(categoria)) {
      const vendasCategoria = todasVendas.filter(
        (v) => v.categoria === categoria && Number(v.anoMes.slice(0, 4)) <= ano
      );
      const porAno = new Map<number, VendaApurada[]>();
      for (const v of vendasCategoria) {
        const anoV = Number(v.anoMes.slice(0, 4));
        const lista = porAno.get(anoV) ?? [];
        lista.push(v);
        porAno.set(anoV, lista);
      }
      const anosOrdenados = [...porAno.keys()].sort((a, b) => a - b);

      let prejuizoAcumuladoAnual = 0; // sempre <= 0
      let vendaTotalAnoAlvo = 0;
      let lucroBrutoAnoAlvo = 0;
      let baseAnoAlvo = 0;
      for (const anoIter of anosOrdenados) {
        const vendasDoAnoIter = porAno.get(anoIter)!;
        const lucroBrutoAno = vendasDoAnoIter.reduce((s, v) => s + v.ganho, 0);
        const vendaTotalAno = vendasDoAnoIter.reduce((s, v) => s + v.vendaTotal, 0);
        const baseAno = lucroBrutoAno + prejuizoAcumuladoAnual;

        if (anoIter === ano) {
          vendaTotalAnoAlvo = vendaTotalAno;
          lucroBrutoAnoAlvo = lucroBrutoAno;
          baseAnoAlvo = baseAno;
        }
        prejuizoAcumuladoAnual = baseAno <= 0 ? baseAno : 0;
      }

      const impostoDevido = baseAnoAlvo > 0 ? baseAnoAlvo * 0.15 : 0;
      resumoAnual.push({
        categoria,
        categoriaLabel: LABEL_CATEGORIA[categoria],
        vendaTotal: vendaTotalAnoAlvo,
        lucroLiquido: lucroBrutoAnoAlvo,
        impostoDevido,
        apuracaoAnual: true,
        origemMotor: "legado",
      });
      continue;
    }

    const linhasCategoria = mensal.filter((l) => l.categoria === categoria);
    const vendaTotal = linhasCategoria.reduce((s, l) => s + l.vendaTotal, 0);
    const lucroLiquido = linhasCategoria.reduce((s, l) => s + l.lucroBruto, 0);
    const impostoDevido = linhasCategoria.reduce((s, l) => s + (l.impostoDevido ?? 0), 0);
    resumoAnual.push({
      categoria,
      categoriaLabel: LABEL_CATEGORIA[categoria],
      vendaTotal,
      lucroLiquido,
      impostoDevido,
      apuracaoAnual: false,
      origemMotor: linhasCategoria.some((l) => l.origemMotor === "novo_fase4") ? "novo_fase4" : "legado",
    });
  }

  resumoAnual.sort((a, b) => a.categoria.localeCompare(b.categoria));

  return { ano, anosDisponiveis, mensal, resumoAnual };
}

// ============================================================================
// Fundação fiscal (fase 1 de 12, ver docs/MAPA-DE-DADOS.md §8.32/§8.33) —
// regras versionadas, declaração e perfil fiscal (questionário inicial).
// Reaproveita `lib/ir/consultas/declaracao.ts` e `lib/ir/regras/
// carregar-regras.ts` (arquivos sem "use server", só helpers de leitura —
// ver comentário no topo desses arquivos) pra não misturar Server Actions
// com funções auxiliares no mesmo arquivo, seguindo a organização proposta
// em §8.32.29. O motor de relatório ACIMA continua 100% intocado nesta
// fase — nenhuma linha das funções antigas foi alterada.
// ============================================================================

/**
 * Declaração do exercício + perfil fiscal (se já preenchido). Cria a
 * declaração na hora (`status: em_configuracao`) se ainda não existir —
 * é o ponto de entrada da página `/imposto-renda`.
 */
export async function obterDeclaracaoAtualIR(exercicio?: number): Promise<DeclaracaoComPerfil | null> {
  const resultado = await _obterDeclaracaoAtual(exercicio, { criarSeNaoExistir: true });
  return resultado;
}

/**
 * Avisos de "fora de escopo" derivados das respostas do questionário
 * (§8.32.12/§8.32.39) — nunca bloqueiam o uso do app, só avisam que aquele
 * aspecto específico (dependentes, declaração conjunta, trust, controlada
 * no exterior) não tem suporte na primeira versão e recomendam validação
 * profissional.
 */
export async function avisosEscopoIR(perfil: PerfilFiscalIR): Promise<AvisoEscopoIR[]> {
  const avisos: AvisoEscopoIR[] = [];
  if (perfil.possuiDependentes) {
    avisos.push({
      campo: "possuiDependentes",
      titulo: "Dependentes não suportados ainda",
      descricao:
        "Esta versão prepara só a declaração individual do titular. Se você tem dependentes na declaração, valide com um contador antes de usar este relatório como apoio.",
    });
  }
  if (perfil.declaracaoConjunta) {
    avisos.push({
      campo: "declaracaoConjunta",
      titulo: "Declaração conjunta não suportada ainda",
      descricao: "O app não modela declaração conjunta na primeira versão — trate os números aqui como só a parte individual do titular.",
    });
  }
  if (perfil.possuiTrust) {
    avisos.push({
      campo: "possuiTrust",
      titulo: "Trust fora de escopo",
      descricao: "Estruturas do tipo trust não são tratadas por nenhum motor do app ainda — procure orientação profissional especializada.",
    });
  }
  if (perfil.possuiControladaExterior) {
    avisos.push({
      campo: "possuiControladaExterior",
      titulo: "Entidade controlada no exterior fora de escopo",
      descricao: "Regras de entidades controladas/offshore não são calculadas pelo app — procure orientação profissional especializada.",
    });
  }
  if (perfil.usPerson || perfil.cidadaniaEua || perfil.greenCard) {
    avisos.push({
      campo: "usPerson",
      titulo: "Perfil fora do escopo americano suportado",
      descricao:
        "O módulo americano deste app pressupõe nonresident alien, sem cidadania e sem Green Card. Com qualquer um desses marcados, a camada informativa EUA não deve ser usada sem revisão de um profissional.",
    });
  }
  return avisos;
}

/**
 * Salva o questionário inicial (§8.32.12) — cria ou atualiza
 * `ir_perfis_fiscais` (1 linha por declaração, `unique(declaracao_id)`) e
 * avança a declaração de `em_configuracao` pra `em_preenchimento` na
 * primeira confirmação.
 */
export async function salvarPerfilFiscalIR(declaracaoId: string, input: PerfilFiscalForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const dados = perfilFiscalSchema.safeParse(input);
  if (!dados.success) return { error: "Dados do questionário inválidos." };

  const { error: erroUpsert } = await supabase.from("ir_perfis_fiscais").upsert(
    {
      profile_id: user.id,
      declaracao_id: declaracaoId,
      residente_brasil: dados.data.residente_brasil,
      residente_desde: dados.data.residente_desde,
      saida_definitiva: dados.data.saida_definitiva,
      us_person: dados.data.us_person,
      cidadania_eua: dados.data.cidadania_eua,
      green_card: dados.data.green_card,
      nonresident_alien: dados.data.nonresident_alien,
      dias_presenca_eua: dados.data.dias_presenca_eua,
      possui_dependentes: dados.data.possui_dependentes,
      declaracao_conjunta: dados.data.declaracao_conjunta,
      possui_trust: dados.data.possui_trust,
      possui_controlada_exterior: dados.data.possui_controlada_exterior,
      confirmado_em: new Date().toISOString(),
    },
    { onConflict: "declaracao_id" }
  );

  if (erroUpsert) return { error: "Não foi possível salvar o questionário." };

  // Só avança o status na PRIMEIRA confirmação — se o titular voltar aqui
  // depois (ex.: mudou de residência no meio do ano) e refizer o
  // questionário, não faz sentido regredir uma declaração que já estava em
  // revisão de volta pra "em_preenchimento" sozinha; por ora, como a fase 1
  // não tem mais nenhuma etapa depois do questionário, atualizamos sempre —
  // isso deixará de ser correto quando as próximas fases adicionarem mais
  // status intermediários, ver dívida técnica em docs/MAPA-DE-DADOS.md §8.33.
  const { error: erroStatus } = await supabase
    .from("ir_declaracoes")
    .update({ status: "em_preenchimento" })
    .eq("id", declaracaoId)
    .eq("profile_id", user.id)
    .eq("status", "em_configuracao");

  if (erroStatus) return { error: "Perfil salvo, mas não foi possível atualizar o status da declaração." };

  revalidatePath("/imposto-renda");
  return {};
}

// ============================================================================
// Fase 9 (§8.32.37) — Bens e Direitos: itens manuais + auto-população de
// investimentos a partir do ledger fiscal. Ver docs/MAPA-DE-DADOS.md §8.43.
// ============================================================================

/** Forma pra UI (`number`, não `Decimal`) — conversão só nesta fronteira, mesmo padrão de `converterLinhaRendaVariavelNova`. */
export type ItemBensDireitosUI = {
  origem: "manual" | "investimento";
  grupo: string;
  codigo: string;
  nome: string;
  localizacao: string | null;
  cpfCnpj: string | null;
  discriminacao: string | null;
  situacaoAnterior: number;
  situacaoAtual: number;
  observacoes: string | null;
  statusRevisao: "pendente" | "revisado" | null;
  ativoId: string | null;
  manualId: string | null;
};

export type BensDireitosUI = {
  itens: ItemBensDireitosUI[];
  ativosComPendencia: { ativoId: string; ativoTicker: string; motivos: string[] }[];
};

function converterBensDireitos(r: ResultadoBensDireitos): BensDireitosUI {
  return {
    itens: r.itens.map((i) => ({
      origem: i.origem,
      grupo: i.grupo,
      codigo: i.codigo,
      nome: i.nome,
      localizacao: i.localizacao,
      cpfCnpj: i.cpfCnpj,
      discriminacao: i.discriminacao,
      situacaoAnterior: i.situacaoAnterior.toNumber(),
      situacaoAtual: i.situacaoAtual.toNumber(),
      observacoes: i.observacoes,
      statusRevisao: i.statusRevisao,
      ativoId: i.ativoId,
      manualId: i.manualId,
    })),
    ativosComPendencia: r.ativosComPendencia,
  };
}

/** Bens e Direitos completo (manuais + investimentos) pra uma declaração/ano-calendário. */
export async function obterBensDireitosIR(declaracaoId: string, anoCalendario: number): Promise<BensDireitosUI> {
  const resultado = await obterBensDireitos(declaracaoId, anoCalendario);
  return converterBensDireitos(resultado);
}

/** Tabela de grupos/códigos vigente — alimenta o seletor do formulário de item manual. `null` se a fundação de regras não estiver pronta pro exercício corrente. */
export async function obterTabelaGruposCodigosIR(): Promise<GrupoCodigoBensDireitos[] | null> {
  return obterTabelaGruposCodigosVigente();
}

export async function criarBemManualIR(declaracaoId: string, input: BemManualForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const dados = bemManualSchema.safeParse(input);
  if (!dados.success) return { error: "Dados do item inválidos." };

  const { error } = await supabase.from("ir_bens_direitos_manuais").insert({
    profile_id: user.id,
    declaracao_id: declaracaoId,
    grupo: dados.data.grupo,
    codigo: dados.data.codigo,
    nome: dados.data.nome,
    localizacao: dados.data.localizacao,
    cpf_cnpj: dados.data.cpf_cnpj,
    discriminacao: dados.data.discriminacao,
    situacao_anterior: dados.data.situacao_anterior,
    situacao_atual: dados.data.situacao_atual,
    observacoes: dados.data.observacoes,
    status_revisao: dados.data.status_revisao,
  });
  if (error) return { error: "Não foi possível salvar o item." };

  revalidatePath("/imposto-renda");
  return {};
}

export async function atualizarBemManualIR(id: string, input: BemManualForm): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const dados = bemManualSchema.safeParse(input);
  if (!dados.success) return { error: "Dados do item inválidos." };

  const { error } = await supabase
    .from("ir_bens_direitos_manuais")
    .update({
      grupo: dados.data.grupo,
      codigo: dados.data.codigo,
      nome: dados.data.nome,
      localizacao: dados.data.localizacao,
      cpf_cnpj: dados.data.cpf_cnpj,
      discriminacao: dados.data.discriminacao,
      situacao_anterior: dados.data.situacao_anterior,
      situacao_atual: dados.data.situacao_atual,
      observacoes: dados.data.observacoes,
      status_revisao: dados.data.status_revisao,
    })
    .eq("id", id)
    .eq("profile_id", user.id);
  if (error) return { error: "Não foi possível atualizar o item." };

  revalidatePath("/imposto-renda");
  return {};
}

export async function excluirBemManualIR(id: string): Promise<AcaoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Faça login novamente." };

  const { error } = await supabase.from("ir_bens_direitos_manuais").delete().eq("id", id).eq("profile_id", user.id);
  if (error) return { error: "Não foi possível excluir o item." };

  revalidatePath("/imposto-renda");
  return {};
}
