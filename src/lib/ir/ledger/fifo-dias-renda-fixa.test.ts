import { describe, it, expect } from "vitest";
import { calcularDiasMediosRetencao } from "./fifo-dias-renda-fixa";
import type { EventoLedgerFiscal } from "./construir-ledger";

/** Suíte de regressão — fase 12 (§8.47). Cobre o FIFO auxiliar de dias de retenção (fase 6, §8.41). */

const evento = (p: Partial<EventoLedgerFiscal> & { transacaoId: string; tipo: EventoLedgerFiscal["tipo"]; data: string }): EventoLedgerFiscal => ({
  createdAt: `${p.data}T00:00:00`,
  quantidade: null,
  precoUnitario: null,
  custos: null,
  fatorProporcao: null,
  valorCapitalizado: null,
  ...p,
});

describe("calcularDiasMediosRetencao", () => {
  it("um único lote consumido: dias = diferença exata de datas", () => {
    const eventos: EventoLedgerFiscal[] = [
      evento({ transacaoId: "c1", tipo: "compra", data: "2026-01-01", quantidade: 100 }),
      evento({ transacaoId: "v1", tipo: "venda", data: "2026-07-01", quantidade: 100 }),
    ];
    const r = calcularDiasMediosRetencao(eventos);
    const resultado = r.get("v1")!;
    const diasEsperados = Math.round((new Date("2026-07-01").getTime() - new Date("2026-01-01").getTime()) / 86_400_000);
    expect(resultado.diasMediosRetencao!.toNumber()).toBe(diasEsperados);
    expect(resultado.memoria).toHaveLength(1);
    expect(resultado.memoria[0].quantidadeConsumida.toNumber()).toBe(100);
  });

  it("consome 2 lotes de datas diferentes: média ponderada por quantidade", () => {
    const eventos: EventoLedgerFiscal[] = [
      evento({ transacaoId: "c1", tipo: "compra", data: "2026-01-01", quantidade: 100 }), // vira 200 dias até a venda
      evento({ transacaoId: "c2", tipo: "compra", data: "2026-06-01", quantidade: 100 }), // vira menos dias
      evento({ transacaoId: "v1", tipo: "venda", data: "2026-07-20", quantidade: 150 }),
    ];
    const r = calcularDiasMediosRetencao(eventos);
    const resultado = r.get("v1")!;
    expect(resultado.memoria).toHaveLength(2); // consumiu os 2 lotes (100 do primeiro + 50 do segundo)
    expect(resultado.memoria[0].quantidadeConsumida.toNumber()).toBe(100);
    expect(resultado.memoria[1].quantidadeConsumida.toNumber()).toBe(50);
  });

  it("venda maior que o total disponível: consome o que existe, resto fica sem lote (defesa)", () => {
    const eventos: EventoLedgerFiscal[] = [
      evento({ transacaoId: "c1", tipo: "compra", data: "2026-01-01", quantidade: 50 }),
      evento({ transacaoId: "v1", tipo: "venda", data: "2026-02-01", quantidade: 999 }),
    ];
    const r = calcularDiasMediosRetencao(eventos);
    const resultado = r.get("v1")!;
    expect(resultado.memoria).toHaveLength(1);
    expect(resultado.memoria[0].quantidadeConsumida.toNumber()).toBe(50);
    expect(resultado.diasMediosRetencao).not.toBeNull();
  });

  it("desdobramento multiplica a quantidade de todos os lotes sem alterar a data", () => {
    const eventos: EventoLedgerFiscal[] = [
      evento({ transacaoId: "c1", tipo: "compra", data: "2026-01-01", quantidade: 10 }),
      evento({ transacaoId: "s1", tipo: "desdobramento", data: "2026-02-01", fatorProporcao: 10 }),
      evento({ transacaoId: "v1", tipo: "venda", data: "2026-03-01", quantidade: 100 }),
    ];
    const r = calcularDiasMediosRetencao(eventos);
    const resultado = r.get("v1")!;
    expect(resultado.memoria).toHaveLength(1);
    expect(resultado.memoria[0].quantidadeConsumida.toNumber()).toBe(100);
    expect(resultado.memoria[0].dataLote).toBe("2026-01-01"); // data do lote original preservada
  });

  it("bonificação entra como lote novo na data do evento (não herda data de compra anterior)", () => {
    const eventos: EventoLedgerFiscal[] = [
      evento({ transacaoId: "c1", tipo: "compra", data: "2026-01-01", quantidade: 10 }),
      evento({ transacaoId: "b1", tipo: "bonificacao", data: "2026-04-01", quantidade: 5 }),
      evento({ transacaoId: "v1", tipo: "venda", data: "2026-05-01", quantidade: 15 }),
    ];
    const r = calcularDiasMediosRetencao(eventos);
    const resultado = r.get("v1")!;
    expect(resultado.memoria).toHaveLength(2);
    expect(resultado.memoria[1].dataLote).toBe("2026-04-01");
  });
});
