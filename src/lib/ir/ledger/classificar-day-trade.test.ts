import { describe, it, expect } from "vitest";
import { classificarDayTrade, type OperacaoParaClassificacaoDayTrade } from "./classificar-day-trade";

/** Suíte de regressão — fase 12 (§8.32.47). Cobre o classificador de day trade (fase 3, §8.37). */

const op = (p: Partial<OperacaoParaClassificacaoDayTrade> & { transacaoId: string; tipo: "compra" | "venda"; quantidade: number }): OperacaoParaClassificacaoDayTrade => ({
  ativoId: "a1",
  data: "2026-05-10",
  corretoraId: "corr1",
  horarioNegociacao: null,
  ...p,
});

describe("classificarDayTrade", () => {
  it("só compra (sem venda no dia) é sempre nao_aplicavel", () => {
    const r = classificarDayTrade([op({ transacaoId: "c1", tipo: "compra", quantidade: 100 })]);
    expect(r[0].status).toBe("nao_aplicavel");
    expect(r[0].quantidadeComum.toNumber()).toBe(100);
  });

  it("compra e venda do mesmo dia/corretora com 1 ordem de cada lado: min(qtd) vira day trade", () => {
    const r = classificarDayTrade([
      op({ transacaoId: "c1", tipo: "compra", quantidade: 100, horarioNegociacao: "10:00" }),
      op({ transacaoId: "v1", tipo: "venda", quantidade: 60, horarioNegociacao: "14:00" }),
    ]);
    const c1 = r.find((x) => x.transacaoId === "c1")!;
    const v1 = r.find((x) => x.transacaoId === "v1")!;
    expect(c1.status).toBe("calculada_com_dados_completos");
    expect(c1.quantidadeDayTrade.toNumber()).toBe(60);
    expect(c1.quantidadeComum.toNumber()).toBe(40);
    expect(v1.quantidadeDayTrade.toNumber()).toBe(60);
    expect(v1.quantidadeComum.toNumber()).toBe(0);
  });

  it("sem corretora informada em alguma ordem do dia: bloqueia com pendente_corretora", () => {
    const r = classificarDayTrade([
      op({ transacaoId: "c1", tipo: "compra", quantidade: 100, corretoraId: null }),
      op({ transacaoId: "v1", tipo: "venda", quantidade: 60 }),
    ]);
    expect(r.every((x) => x.status === "pendente_corretora")).toBe(true);
    expect(r.every((x) => x.quantidadeDayTrade.toNumber() === 0)).toBe(true);
  });

  it("múltiplas ordens do mesmo lado sem horário: bloqueia com pendente_horario", () => {
    const r = classificarDayTrade([
      op({ transacaoId: "c1", tipo: "compra", quantidade: 50 }),
      op({ transacaoId: "c2", tipo: "compra", quantidade: 50 }),
      op({ transacaoId: "v1", tipo: "venda", quantidade: 60, horarioNegociacao: "14:00" }),
    ]);
    expect(r.every((x) => x.status === "pendente_horario")).toBe(true);
  });

  it("múltiplas ordens dos dois lados, todas com horário: pareia FIFO por horário", () => {
    const r = classificarDayTrade([
      op({ transacaoId: "c1", tipo: "compra", quantidade: 30, horarioNegociacao: "09:00" }),
      op({ transacaoId: "c2", tipo: "compra", quantidade: 30, horarioNegociacao: "11:00" }),
      op({ transacaoId: "v1", tipo: "venda", quantidade: 40, horarioNegociacao: "10:00" }),
    ]);
    const c1 = r.find((x) => x.transacaoId === "c1")!;
    const c2 = r.find((x) => x.transacaoId === "c2")!;
    const v1 = r.find((x) => x.transacaoId === "v1")!;
    // v1 (10:00) pareia primeiro com c1 (09:00, mais antiga): 30 unidades, sobra 10 pra c2.
    expect(c1.quantidadeDayTrade.toNumber()).toBe(30);
    expect(c2.quantidadeDayTrade.toNumber()).toBe(10);
    expect(v1.quantidadeDayTrade.toNumber()).toBe(40);
    expect(v1.quantidadeComum.toNumber()).toBe(0);
  });

  it("ativos/dias diferentes são classificados independentemente", () => {
    const r = classificarDayTrade([
      op({ transacaoId: "c1", tipo: "compra", quantidade: 10, ativoId: "a1", data: "2026-01-01" }),
      op({ transacaoId: "v1", tipo: "venda", quantidade: 10, ativoId: "a1", data: "2026-01-01" }),
      op({ transacaoId: "c2", tipo: "compra", quantidade: 20, ativoId: "a2", data: "2026-01-02" }),
    ]);
    const c2 = r.find((x) => x.transacaoId === "c2")!;
    expect(c2.status).toBe("nao_aplicavel");
  });
});
