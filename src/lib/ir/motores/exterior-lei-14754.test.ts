import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { apurarGanhoCapitalExterior, type AtivoParaApuracaoExterior, type ParametrosExteriorLei14754 } from "./exterior-lei-14754";

/** Suíte de regressão — fase 12 (§8.47). Cobre o motor de ganho de capital exterior (fase 7, §8.42). */

const parametros: ParametrosExteriorLei14754 = { aliquotaPadrao: new Decimal(0.15) };

describe("apurarGanhoCapitalExterior", () => {
  it("pool único: 2 ativos diferentes no mesmo ano somam num só resultado anual", () => {
    const ativos: AtivoParaApuracaoExterior[] = [
      { ativoId: "a1", ativoTicker: "AAPL", pendente: false, motivosPendencia: [], vendas: [{ transacaoId: "t1", ano: 2026, vendaTotalBrutaReais: new Decimal(50000), resultadoRealizadoReais: new Decimal(10000) }] },
      { ativoId: "a2", ativoTicker: "MSFT", pendente: false, motivosPendencia: [], vendas: [{ transacaoId: "t2", ano: 2026, vendaTotalBrutaReais: new Decimal(30000), resultadoRealizadoReais: new Decimal(5000) }] },
    ];
    const r = apurarGanhoCapitalExterior(ativos, parametros);
    expect(r.anual).toHaveLength(1);
    expect(r.anual[0].lucroBruto.toNumber()).toBe(15000);
    expect(r.anual[0].impostoDevido.toNumber()).toBeCloseTo(2250); // 15000 * 0.15
    expect(r.anual[0].vendas).toHaveLength(2);
  });

  it("prejuízo de um ano abate lucro do ano seguinte, sem prescrição", () => {
    const ativos: AtivoParaApuracaoExterior[] = [
      {
        ativoId: "a1",
        ativoTicker: "AAPL",
        pendente: false,
        motivosPendencia: [],
        vendas: [
          { transacaoId: "t1", ano: 2025, vendaTotalBrutaReais: new Decimal(10000), resultadoRealizadoReais: new Decimal(-4000) },
          { transacaoId: "t2", ano: 2026, vendaTotalBrutaReais: new Decimal(20000), resultadoRealizadoReais: new Decimal(10000) },
        ],
      },
    ];
    const r = apurarGanhoCapitalExterior(ativos, parametros);
    const linha2026 = r.anual.find((l) => l.ano === 2026)!;
    expect(linha2026.prejuizoAnteriorAplicado.toNumber()).toBe(4000);
    expect(linha2026.baseCalculo.toNumber()).toBe(6000); // 10000 - 4000
    expect(linha2026.impostoDevido.toNumber()).toBeCloseTo(900); // 6000 * 0.15
  });

  it("ativo com pendência (câmbio faltando) é EXCLUÍDO inteiro da apuração, não só a venda", () => {
    const ativos: AtivoParaApuracaoExterior[] = [
      { ativoId: "a1", ativoTicker: "AAPL", pendente: false, motivosPendencia: [], vendas: [{ transacaoId: "t1", ano: 2026, vendaTotalBrutaReais: new Decimal(10000), resultadoRealizadoReais: new Decimal(1000) }] },
      {
        ativoId: "a2",
        ativoTicker: "TSLA",
        pendente: true,
        motivosPendencia: ["Câmbio faltando em compra de 2024-05-10"],
        vendas: [{ transacaoId: "t2", ano: 2026, vendaTotalBrutaReais: new Decimal(99999), resultadoRealizadoReais: new Decimal(99999) }],
      },
    ];
    const r = apurarGanhoCapitalExterior(ativos, parametros);
    expect(r.ativosComPendencia).toHaveLength(1);
    expect(r.ativosComPendencia[0].ativoTicker).toBe("TSLA");
    // TSLA não entra em NENHUM cálculo, mesmo tendo vendas com valores muito maiores
    expect(r.anual[0].lucroBruto.toNumber()).toBe(1000);
    expect(r.anual[0].vendas.every((v) => v.ativoTicker !== "TSLA")).toBe(true);
  });

  it("sem vendas em nenhum ano: resultado anual vazio, sem erro", () => {
    const r = apurarGanhoCapitalExterior([], parametros);
    expect(r.anual).toHaveLength(0);
    expect(r.ativosComPendencia).toHaveLength(0);
  });
});
