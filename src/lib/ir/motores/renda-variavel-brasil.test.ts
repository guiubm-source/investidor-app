import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { apurarRendaVariavelBrasil, type AtivoParaApuracaoRendaVariavel, type ParametrosRendaVariavelBrasil, type VendaParaApuracaoRendaVariavel } from "./renda-variavel-brasil";

/** Suíte de regressão — fase 12 (§8.47). Cobre o motor de renda variável Brasil (fase 4, §8.38). */

const parametros: ParametrosRendaVariavelBrasil = {
  isencaoSwingLimiteMensal: new Decimal(20000),
  aliquotaSwing: new Decimal(0.15),
  aliquotaDayTrade: new Decimal(0.2),
  aliquotaFii: new Decimal(0.2),
};

const venda = (p: Partial<VendaParaApuracaoRendaVariavel> & { transacaoId: string; anoMes: string }): VendaParaApuracaoRendaVariavel => ({
  quantidadeTotal: new Decimal(100),
  vendaTotalBruta: new Decimal(0),
  resultadoRealizado: new Decimal(0),
  quantidadeDayTrade: new Decimal(0),
  quantidadeComum: new Decimal(100),
  statusDayTrade: "nao_aplicavel",
  ...p,
});

describe("apurarRendaVariavelBrasil", () => {
  it("swing trade com venda <= limite mensal E lucro positivo: isento", () => {
    const ativos: AtivoParaApuracaoRendaVariavel[] = [
      {
        ativoId: "a1",
        ativoTicker: "PETR4",
        tipoRegime: "acao_fundo",
        vendas: [venda({ transacaoId: "v1", anoMes: "2026-03", vendaTotalBruta: new Decimal(15000), resultadoRealizado: new Decimal(2000) })],
      },
    ];
    const r = apurarRendaVariavelBrasil(ativos, parametros);
    const linha = r.mensal.find((l) => l.grupo === "acao_swing")!;
    expect(linha.isento).toBe(true);
    expect(linha.impostoDevido).toBeNull();
  });

  it("swing trade acima do limite mensal: tributa 15% sobre o lucro", () => {
    const ativos: AtivoParaApuracaoRendaVariavel[] = [
      {
        ativoId: "a1",
        ativoTicker: "PETR4",
        tipoRegime: "acao_fundo",
        vendas: [venda({ transacaoId: "v1", anoMes: "2026-03", vendaTotalBruta: new Decimal(25000), resultadoRealizado: new Decimal(3000) })],
      },
    ];
    const r = apurarRendaVariavelBrasil(ativos, parametros);
    const linha = r.mensal.find((l) => l.grupo === "acao_swing")!;
    expect(linha.isento).toBe(false);
    expect(linha.impostoDevido!.toNumber()).toBeCloseTo(450); // 3000 * 0.15
  });

  it("prejuízo em um mês abate lucro do mês seguinte (mesmo grupo, sem prescrição)", () => {
    const ativos: AtivoParaApuracaoRendaVariavel[] = [
      {
        ativoId: "a1",
        ativoTicker: "PETR4",
        tipoRegime: "acao_fundo",
        vendas: [
          venda({ transacaoId: "v1", anoMes: "2026-01", vendaTotalBruta: new Decimal(30000), resultadoRealizado: new Decimal(-1000) }),
          venda({ transacaoId: "v2", anoMes: "2026-02", vendaTotalBruta: new Decimal(30000), resultadoRealizado: new Decimal(3000) }),
        ],
      },
    ];
    const r = apurarRendaVariavelBrasil(ativos, parametros);
    const fev = r.mensal.find((l) => l.anoMes === "2026-02" && l.grupo === "acao_swing")!;
    expect(fev.prejuizoAnteriorAplicado.toNumber()).toBe(1000);
    expect(fev.baseCalculo.toNumber()).toBe(2000); // 3000 - 1000
    expect(fev.impostoDevido!.toNumber()).toBeCloseTo(300); // 2000 * 0.15
  });

  it("prejuízo em dezembro abate lucro de janeiro do ano seguinte (compensação atravessa o ano-calendário)", () => {
    // Ver docs/MAPA-DE-DADOS.md §8.59 (2026-07-22) — regressão pro bug já
    // corrigido na tarefa #108: a ordenação de meses usa comparação de string
    // sobre `anoMes` no formato "AAAA-MM" (zero-padded), que só é
    // cronologicamente correta se a virada de ano for testada explicitamente
    // (ex.: sem isso, um bug de ordenação por "MM" isolado, ignorando o ano,
    // passaria despercebido pelos outros testes desta suíte).
    const ativos: AtivoParaApuracaoRendaVariavel[] = [
      {
        ativoId: "a1",
        ativoTicker: "PETR4",
        tipoRegime: "acao_fundo",
        vendas: [
          venda({ transacaoId: "v1", anoMes: "2025-12", vendaTotalBruta: new Decimal(30000), resultadoRealizado: new Decimal(-1500) }),
          venda({ transacaoId: "v2", anoMes: "2026-01", vendaTotalBruta: new Decimal(30000), resultadoRealizado: new Decimal(4000) }),
        ],
      },
    ];
    const r = apurarRendaVariavelBrasil(ativos, parametros);
    const dez = r.mensal.find((l) => l.anoMes === "2025-12" && l.grupo === "acao_swing")!;
    const jan = r.mensal.find((l) => l.anoMes === "2026-01" && l.grupo === "acao_swing")!;
    expect(dez.impostoDevido).toBeNull(); // mês de prejuízo não gera imposto
    expect(jan.prejuizoAnteriorAplicado.toNumber()).toBe(1500);
    expect(jan.baseCalculo.toNumber()).toBe(2500); // 4000 - 1500
    expect(jan.impostoDevido!.toNumber()).toBeCloseTo(375); // 2500 * 0.15
  });

  it("day trade não classificado (statusDayTrade pendente): fato pendente não entra no cálculo", () => {
    const ativos: AtivoParaApuracaoRendaVariavel[] = [
      {
        ativoId: "a1",
        ativoTicker: "PETR4",
        tipoRegime: "acao_fundo",
        vendas: [venda({ transacaoId: "v1", anoMes: "2026-04", vendaTotalBruta: new Decimal(5000), resultadoRealizado: new Decimal(500), statusDayTrade: "pendente_horario" })],
      },
    ];
    const r = apurarRendaVariavelBrasil(ativos, parametros);
    const swing = r.mensal.find((l) => l.anoMes === "2026-04" && l.grupo === "acao_swing")!;
    const day = r.mensal.find((l) => l.anoMes === "2026-04" && l.grupo === "acao_day")!;
    expect(swing.pendente).toBe(true);
    expect(day.pendente).toBe(true);
    expect(swing.vendaTotalBruta.toNumber()).toBe(0); // valor pendente não entra na soma
    expect(swing.motivosPendencia.length).toBeGreaterThan(0);
  });

  it("venda dividida entre day trade e swing (mesma transação): resultado repartido proporcionalmente", () => {
    const ativos: AtivoParaApuracaoRendaVariavel[] = [
      {
        ativoId: "a1",
        ativoTicker: "PETR4",
        tipoRegime: "acao_fundo",
        vendas: [
          venda({
            transacaoId: "v1",
            anoMes: "2026-05",
            quantidadeTotal: new Decimal(100),
            vendaTotalBruta: new Decimal(10000),
            resultadoRealizado: new Decimal(1000),
            quantidadeDayTrade: new Decimal(40),
            quantidadeComum: new Decimal(60),
            statusDayTrade: "calculada_com_dados_completos",
          }),
        ],
      },
    ];
    const r = apurarRendaVariavelBrasil(ativos, parametros);
    const day = r.mensal.find((l) => l.anoMes === "2026-05" && l.grupo === "acao_day")!;
    const swing = r.mensal.find((l) => l.anoMes === "2026-05" && l.grupo === "acao_swing")!;
    expect(day.lucroBruto.toNumber()).toBeCloseTo(400); // 1000 * 40/100
    expect(swing.lucroBruto.toNumber()).toBeCloseTo(600); // 1000 * 60/100
  });

  it("FII não tem isenção por limite mensal (tributa 20% sobre qualquer lucro positivo)", () => {
    const ativos: AtivoParaApuracaoRendaVariavel[] = [
      {
        ativoId: "a2",
        ativoTicker: "HGLG11",
        tipoRegime: "fii",
        vendas: [venda({ transacaoId: "v1", anoMes: "2026-06", vendaTotalBruta: new Decimal(1000), resultadoRealizado: new Decimal(200) })],
      },
    ];
    const r = apurarRendaVariavelBrasil(ativos, parametros);
    const fii = r.mensal.find((l) => l.grupo === "fii")!;
    expect(fii.isento).toBe(false);
    expect(fii.impostoDevido!.toNumber()).toBeCloseTo(40); // 200 * 0.2
  });

  it("grupos diferentes nunca compensam prejuízo entre si", () => {
    const ativos: AtivoParaApuracaoRendaVariavel[] = [
      {
        ativoId: "a1",
        ativoTicker: "PETR4",
        tipoRegime: "acao_fundo",
        vendas: [venda({ transacaoId: "v1", anoMes: "2026-01", vendaTotalBruta: new Decimal(30000), resultadoRealizado: new Decimal(-5000) })],
      },
      {
        ativoId: "a2",
        ativoTicker: "HGLG11",
        tipoRegime: "fii",
        vendas: [venda({ transacaoId: "v2", anoMes: "2026-02", vendaTotalBruta: new Decimal(1000), resultadoRealizado: new Decimal(300) })],
      },
    ];
    const r = apurarRendaVariavelBrasil(ativos, parametros);
    const fii = r.mensal.find((l) => l.grupo === "fii")!;
    expect(fii.prejuizoAnteriorAplicado.toNumber()).toBeCloseTo(0); // prejuízo de acao_swing não abate FII (toBeCloseTo pq `.negated()` de 0 pode virar -0 em JS, matematicamente igual)
    expect(fii.impostoDevido!.toNumber()).toBeCloseTo(60); // 300 * 0.2, sem abatimento
  });
});
