import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { montarRelatorioCompleto } from "./relatorio-completo";
import type { CardsPrincipaisIR } from "./dashboard-fiscal";
import type { ResultadoRendaVariavelBrasil } from "./renda-variavel-brasil";
import type { ResultadoRendaFixaBrasil } from "./renda-fixa-brasil";
import type { ResultadoExteriorLei14754 } from "./exterior-lei-14754";
import type { ResultadoDarf } from "./darf";
import type { ResultadoBensDireitos } from "../consultas/bens-direitos";
import type { CapaRelatorio } from "../relatorios/tipos";

/**
 * Suíte de regressão — fase 12 (§8.32.37, ver docs/MAPA-DE-DADOS.md §8.47).
 * Formaliza os 3 cenários (26 asserções) rodados manualmente via script tsx
 * descartável na fase 11 (§8.46) — agora permanentes, cobrindo o motor de
 * agregação do PDF final.
 */

const d = (v: number) => new Decimal(v);

const cardsVazio: CardsPrincipaisIR = {
  obrigacaoDeclarar: { status: "nao_avaliada", motivos: [] },
  impostoAPagar: { status: "nao_disponivel", valor: null, motivo: "x" },
  impostoPago: { status: "nao_disponivel", valor: null, motivo: "x" },
  impostoVencido: { status: "nao_disponivel", valor: null, motivo: "x" },
  prejuizoPorGrupo: [],
  irrfDisponivel: { status: "nao_disponivel", valor: null, motivo: "x" },
  ganhoCapitalExterior: { status: "nao_disponivel", valor: null, motivo: "x" },
  impostoPagoExterior: { status: "nao_disponivel", valor: null, motivo: "x" },
  creditoExteriorAdmitido: { status: "nao_disponivel", valor: null, motivo: "x" },
  documentosSemComprovante: { status: "nao_disponivel", valor: null, motivo: "x" },
};

const capa: CapaRelatorio = {
  exercicio: 2027,
  anoCalendario: 2026,
  titularNome: "Fulano de Tal",
  titularCpf: "000.000.000-00",
  dataGeracao: new Date().toISOString(),
  perfilResumo: "residente no Brasil",
  versaoFiscalNome: "Brasil 2027 (v1)",
};

const bensVazio: ResultadoBensDireitos = { itens: [], ativosComPendencia: [] };

describe("montarRelatorioCompleto", () => {
  it("fundação totalmente ausente: seções dependentes de motor ficam indisponíveis, Bens e Direitos/disclaimer sempre presentes", () => {
    const r = montarRelatorioCompleto({
      ano: 2026,
      capa,
      cardsPrincipais: cardsVazio,
      rendaVariavel: null,
      rendaFixa: null,
      exterior: null,
      darf: null,
      bensDireitos: bensVazio,
      operacoesRendaVariavel: [],
    });
    expect(r.rendaVariavelMensal.status).toBe("nao_disponivel");
    expect(r.tributacaoExclusiva.status).toBe("nao_disponivel");
    expect(r.aplicacoesExterior.status).toBe("nao_disponivel");
    expect(r.resumoDarfs.status).toBe("nao_disponivel");
    expect(r.rendimentosIsentos.status).toBe("nao_disponivel");
    expect(r.bensDireitos.status).toBe("disponivel"); // fase 9 não depende de versão de regra
    expect(r.resumoObrigatoriedade.status).toBe("nao_disponivel"); // motor nunca construído
    expect(r.disclaimer.length).toBeGreaterThan(0);
    expect(r.instrucoesUso.length).toBeGreaterThan(0);
  });

  it("renda variável com pendência + isenção + linha de outro ano: filtra por ano e consolida pendências", () => {
    const rendaVariavel: ResultadoRendaVariavelBrasil = {
      mensal: [
        {
          grupo: "acao_swing",
          anoMes: "2026-03",
          vendaTotalBruta: d(15000),
          lucroBruto: d(2000),
          prejuizoAnteriorAplicado: d(0),
          baseCalculo: d(0),
          isento: true,
          motivoIsencao: "Vendas do mês <= R$20.000",
          aliquota: null,
          impostoDevido: d(0),
          prejuizoSaldoFinal: d(0),
          pendente: false,
          motivosPendencia: [],
        },
        {
          grupo: "acao_day",
          anoMes: "2026-05",
          vendaTotalBruta: d(0),
          lucroBruto: d(0),
          prejuizoAnteriorAplicado: d(0),
          baseCalculo: d(0),
          isento: false,
          motivoIsencao: null,
          aliquota: null,
          impostoDevido: null,
          prejuizoSaldoFinal: d(0),
          pendente: true,
          motivosPendencia: ["Day trade não classificado — pareamento pendente"],
        },
        {
          // ano diferente, não deve aparecer no relatório de 2026
          grupo: "fii",
          anoMes: "2025-12",
          vendaTotalBruta: d(9999),
          lucroBruto: d(500),
          prejuizoAnteriorAplicado: d(0),
          baseCalculo: d(500),
          isento: false,
          motivoIsencao: null,
          aliquota: d(0.2),
          impostoDevido: d(100),
          prejuizoSaldoFinal: d(0),
          pendente: false,
          motivosPendencia: [],
        },
      ],
    };

    const exterior: ResultadoExteriorLei14754 = {
      anual: [
        {
          ano: 2026,
          vendaTotalBruta: d(50000),
          lucroBruto: d(10000),
          prejuizoAnteriorAplicado: d(0),
          baseCalculo: d(10000),
          aliquota: d(0.15),
          impostoDevido: d(1500),
          prejuizoSaldoFinal: d(0),
          vendas: [{ transacaoId: "t1", ano: 2026, vendaTotalBrutaReais: d(50000), resultadoRealizadoReais: d(10000), ativoId: "a1", ativoTicker: "AAPL" }],
        },
      ],
      ativosComPendencia: [{ ativoId: "a2", ativoTicker: "TSLA", motivos: ["Câmbio faltando em uma compra de 2024-05-10"] }],
    };

    const r = montarRelatorioCompleto({
      ano: 2026,
      capa,
      cardsPrincipais: cardsVazio,
      rendaVariavel,
      rendaFixa: null,
      exterior,
      darf: null,
      bensDireitos: bensVazio,
      operacoesRendaVariavel: [],
    });

    expect(r.rendaVariavelMensal.status).toBe("disponivel");
    expect(r.rendaVariavelMensal.dados).toHaveLength(2); // só 2 linhas de 2026 (fii de 2025 filtrado fora)
    expect(r.pendencias).toHaveLength(2); // 1 renda variável + 1 exterior
    expect(r.pendencias.some((p) => p.origem === "renda_variavel" && p.referencia === "2026-05")).toBe(true);
    expect(r.pendencias.some((p) => p.origem === "exterior" && p.referencia === "TSLA")).toBe(true);
    expect(r.rendimentosIsentos.status).toBe("disponivel");
    expect(r.rendimentosIsentos.dados!.rendaVariavelIsenta).toHaveLength(1); // acao_swing de março
    expect(r.aplicacoesExterior.status).toBe("disponivel");
    expect(r.aplicacoesExterior.dados).toHaveLength(1); // 1 linha anual (ano 2026)
    expect(r.ativosComPendenciaExterior).toHaveLength(1);
    expect(r.tributacaoExclusiva.status).toBe("nao_disponivel"); // sem renda fixa ainda
  });

  it("renda fixa isenta + tributável + DARF com guia de outro ano: filtra guia por competência, preserva saldosPendentes inteiro", () => {
    const rendaFixa: ResultadoRendaFixaBrasil = {
      resgates: [],
      mensal: [
        {
          grupo: "renda_fixa_isenta",
          anoMes: "2026-02",
          vendaTotalBruta: d(10000),
          lucroBruto: d(800),
          baseCalculo: d(0),
          isento: true,
          motivoIsencao: "LCI/LCA/CRI/CRA são isentos de IR para pessoa física",
          diasMediosRetencao: d(200),
          aliquota: null,
          impostoDevido: d(0),
          resgates: [
            {
              ativoId: "b1",
              ativoTicker: "LCI-BANCO-X",
              transacaoId: "tr1",
              grupo: "renda_fixa_isenta",
              anoMes: "2026-02",
              vendaTotalBruta: d(10000),
              lucroBruto: d(800),
              baseCalculo: d(0),
              isento: true,
              motivoIsencao: "LCI/LCA/CRI/CRA são isentos de IR para pessoa física",
              diasMediosRetencao: d(200),
              aliquota: null,
              impostoDevido: d(0),
              memoriaLotes: [],
            },
          ],
        },
        {
          grupo: "renda_fixa_tributavel",
          anoMes: "2026-06",
          vendaTotalBruta: d(20000),
          lucroBruto: d(3000),
          baseCalculo: d(3000),
          isento: false,
          motivoIsencao: null,
          diasMediosRetencao: d(400),
          aliquota: d(0.175),
          impostoDevido: null,
          resgates: [],
        },
      ],
    };

    const darf: ResultadoDarf = {
      guias: [
        { codigoReceita: "6015", competenciaGeracao: "2026-04", valorConsolidado: d(500), memoria: [{ grupo: "acao_swing", anoMes: "2026-04", valor: d(500) }] },
        { codigoReceita: "6015", competenciaGeracao: "2025-11", valorConsolidado: d(300), memoria: [{ grupo: "acao_swing", anoMes: "2025-11", valor: d(300) }] },
      ],
      saldosPendentes: [{ codigoReceita: "6015", valorAcumulado: d(80), memoria: [] }],
    };

    const r = montarRelatorioCompleto({
      ano: 2026,
      capa,
      cardsPrincipais: cardsVazio,
      rendaVariavel: null,
      rendaFixa,
      exterior: null,
      darf,
      bensDireitos: bensVazio,
      operacoesRendaVariavel: [],
    });

    expect(r.tributacaoExclusiva.status).toBe("disponivel");
    expect(r.tributacaoExclusiva.dados).toHaveLength(1);
    expect(r.tributacaoExclusiva.dados![0].grupo).toBe("renda_fixa_tributavel");
    expect(r.rendimentosIsentos.dados!.rendaFixaIsenta).toHaveLength(1);
    expect(r.resumoDarfs.status).toBe("disponivel");
    expect(r.resumoDarfs.dados!.guias).toHaveLength(1); // só a guia de 2026 (2025-11 filtrada fora)
    expect(r.resumoDarfs.dados!.guias[0].competenciaGeracao).toBe("2026-04");
    expect(r.resumoDarfs.dados!.saldosPendentes).toHaveLength(1); // sempre passa, não tem corte por ano
  });
});
