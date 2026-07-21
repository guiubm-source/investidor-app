import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { apurarRendaFixaBrasil, type AtivoParaApuracaoRendaFixa, type ParametrosRendaFixaBrasil, type VendaParaApuracaoRendaFixa } from "./renda-fixa-brasil";

/** Suíte de regressão — fase 12 (§8.47). Cobre o motor de renda fixa direta (fase 6, §8.41). */

const parametros: ParametrosRendaFixaBrasil = {
  aliquotaAte180Dias: new Decimal(0.225),
  aliquotaAte360Dias: new Decimal(0.2),
  aliquotaAte720Dias: new Decimal(0.175),
  aliquotaAcima720Dias: new Decimal(0.15),
};

const resgate = (p: Partial<VendaParaApuracaoRendaFixa> & { transacaoId: string; anoMes: string }): VendaParaApuracaoRendaFixa => ({
  vendaTotalBruta: new Decimal(0),
  resultadoRealizado: new Decimal(0),
  diasMediosRetencao: null,
  memoriaLotes: [],
  ...p,
});

describe("apurarRendaFixaBrasil", () => {
  it("LCI/LCA/CRI/CRA (grupo isento): sempre isento, base de cálculo zero, imposto zero", () => {
    const ativos: AtivoParaApuracaoRendaFixa[] = [
      {
        ativoId: "b1",
        ativoTicker: "LCI-BANCO-X",
        grupo: "renda_fixa_isenta",
        vendas: [resgate({ transacaoId: "r1", anoMes: "2026-03", vendaTotalBruta: new Decimal(10000), resultadoRealizado: new Decimal(800), diasMediosRetencao: new Decimal(200) })],
      },
    ];
    const r = apurarRendaFixaBrasil(ativos, parametros);
    expect(r.resgates[0].isento).toBe(true);
    expect(r.resgates[0].baseCalculo.toNumber()).toBe(0);
    expect(r.resgates[0].impostoDevido!.toNumber()).toBe(0);
  });

  it("CDB/Tesouro (grupo tributável): alíquota pela tabela regressiva conforme dias médios", () => {
    const casos: [number, number][] = [
      [100, 0.225],
      [300, 0.2],
      [500, 0.175],
      [900, 0.15],
    ];
    for (const [dias, aliquotaEsperada] of casos) {
      const ativos: AtivoParaApuracaoRendaFixa[] = [
        {
          ativoId: "b1",
          ativoTicker: "CDB-X",
          grupo: "renda_fixa_tributavel",
          vendas: [resgate({ transacaoId: `r-${dias}`, anoMes: "2026-03", resultadoRealizado: new Decimal(1000), diasMediosRetencao: new Decimal(dias) })],
        },
      ];
      const r = apurarRendaFixaBrasil(ativos, parametros);
      expect(r.resgates[0].aliquota!.toNumber()).toBeCloseTo(aliquotaEsperada);
      expect(r.resgates[0].impostoDevido).toBeNull(); // retido na fonte, não é débito do usuário (nunca entra em DARF)
    }
  });

  it("resgate com prejuízo: base de cálculo nunca fica negativa (não abate outro resgate)", () => {
    const ativos: AtivoParaApuracaoRendaFixa[] = [
      {
        ativoId: "b1",
        ativoTicker: "CDB-X",
        grupo: "renda_fixa_tributavel",
        vendas: [resgate({ transacaoId: "r1", anoMes: "2026-03", resultadoRealizado: new Decimal(-500), diasMediosRetencao: new Decimal(100) })],
      },
    ];
    const r = apurarRendaFixaBrasil(ativos, parametros);
    expect(r.resgates[0].baseCalculo.toNumber()).toBe(0);
  });

  it("dois resgates do mesmo grupo/mês, sem compensação entre si (cada resgate é independente)", () => {
    const ativos: AtivoParaApuracaoRendaFixa[] = [
      {
        ativoId: "b1",
        ativoTicker: "CDB-X",
        grupo: "renda_fixa_tributavel",
        vendas: [
          resgate({ transacaoId: "r1", anoMes: "2026-03", resultadoRealizado: new Decimal(-1000), diasMediosRetencao: new Decimal(100) }),
          resgate({ transacaoId: "r2", anoMes: "2026-03", resultadoRealizado: new Decimal(2000), diasMediosRetencao: new Decimal(100) }),
        ],
      },
    ];
    const r = apurarRendaFixaBrasil(ativos, parametros);
    const linhaMensal = r.mensal.find((l) => l.anoMes === "2026-03")!;
    // Base de cálculo agregada = soma das bases individuais (0 + 2000), NUNCA (2000 - 1000)
    expect(linhaMensal.baseCalculo.toNumber()).toBe(2000);
    expect(linhaMensal.lucroBruto.toNumber()).toBe(1000); // soma bruta continua sendo -1000+2000
  });

  it("linha mensal agregada: alíquota fica null quando o mês mistura faixas diferentes", () => {
    const ativos: AtivoParaApuracaoRendaFixa[] = [
      {
        ativoId: "b1",
        ativoTicker: "CDB-X",
        grupo: "renda_fixa_tributavel",
        vendas: [
          resgate({ transacaoId: "r1", anoMes: "2026-03", resultadoRealizado: new Decimal(500), diasMediosRetencao: new Decimal(100) }), // 22.5%
          resgate({ transacaoId: "r2", anoMes: "2026-03", resultadoRealizado: new Decimal(500), diasMediosRetencao: new Decimal(900) }), // 15%
        ],
      },
    ];
    const r = apurarRendaFixaBrasil(ativos, parametros);
    const linhaMensal = r.mensal.find((l) => l.anoMes === "2026-03")!;
    expect(linhaMensal.aliquota).toBeNull();
    expect(linhaMensal.resgates).toHaveLength(2); // detalhe por resgate preservado (memória de cálculo, §8.32.38)
  });
});
