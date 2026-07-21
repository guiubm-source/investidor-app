import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { construirLedgerFiscal, ordenarEventosLedgerFiscal, type EventoLedgerFiscal } from "./construir-ledger";

/**
 * Suíte de regressão — fase 12 (§8.32.37, ver docs/MAPA-DE-DADOS.md §8.47).
 * Cobre o ledger fiscal de custo médio (fase 3, §8.36) — motor puro usado
 * por TODOS os motores fiscais posteriores (renda variável, renda fixa,
 * Bens e Direitos, anexo de operações do PDF). Regressão aqui protege a
 * base de tudo.
 */

const evento = (parcial: Partial<EventoLedgerFiscal> & { transacaoId: string; tipo: EventoLedgerFiscal["tipo"]; data: string }): EventoLedgerFiscal => ({
  createdAt: `${parcial.data}T00:00:00`,
  quantidade: null,
  precoUnitario: null,
  custos: null,
  fatorProporcao: null,
  valorCapitalizado: null,
  ...parcial,
});

describe("construirLedgerFiscal", () => {
  it("calcula custo médio ponderado em duas compras e apura resultado na venda", () => {
    const eventos: EventoLedgerFiscal[] = [
      evento({ transacaoId: "c1", tipo: "compra", data: "2026-01-10", quantidade: 100, precoUnitario: 10, custos: 0 }),
      evento({ transacaoId: "c2", tipo: "compra", data: "2026-02-10", quantidade: 100, precoUnitario: 20, custos: 0 }),
      evento({ transacaoId: "v1", tipo: "venda", data: "2026-03-10", quantidade: 100, precoUnitario: 25, custos: 0 }),
    ];
    const ledger = construirLedgerFiscal(eventos);

    // preço médio depois das duas compras: (100*10 + 100*20) / 200 = 15
    const linhaVenda = ledger.linhas[2];
    expect(linhaVenda.precoMedioAntes.toNumber()).toBe(15);
    expect(linhaVenda.resultadoRealizado.toNumber()).toBe((25 - 15) * 100); // 1000
    expect(linhaVenda.valorVendaBruto.toNumber()).toBe(25 * 100);
    expect(ledger.estadoFinal.quantidade.toNumber()).toBe(100);
    expect(ledger.estadoFinal.custoTotal.toNumber()).toBe(100 * 15);
  });

  it("venda maior que o estoque disponível nunca deixa quantidade negativa (defesa do ledger)", () => {
    const eventos: EventoLedgerFiscal[] = [
      evento({ transacaoId: "c1", tipo: "compra", data: "2026-01-01", quantidade: 50, precoUnitario: 10, custos: 0 }),
      evento({ transacaoId: "v1", tipo: "venda", data: "2026-02-01", quantidade: 999, precoUnitario: 12, custos: 0 }),
    ];
    const ledger = construirLedgerFiscal(eventos);
    expect(ledger.estadoFinal.quantidade.toNumber()).toBe(0);
    expect(ledger.linhas[1].quantidadeDepois.toNumber()).toBe(0);
  });

  it("desdobramento multiplica quantidade sem alterar custo total (preço médio cai)", () => {
    const eventos: EventoLedgerFiscal[] = [
      evento({ transacaoId: "c1", tipo: "compra", data: "2026-01-01", quantidade: 10, precoUnitario: 100, custos: 0 }),
      evento({ transacaoId: "s1", tipo: "desdobramento", data: "2026-02-01", fatorProporcao: 10 }),
    ];
    const ledger = construirLedgerFiscal(eventos);
    expect(ledger.estadoFinal.quantidade.toNumber()).toBe(100);
    expect(ledger.estadoFinal.custoTotal.toNumber()).toBe(1000); // custo total não muda
    expect(ledger.linhas[1].precoMedioDepois.toNumber()).toBe(10); // 1000/100
  });

  it("bonificação soma quantidade recebida e valor capitalizado ao custo total (nunca custo zero isolado)", () => {
    const eventos: EventoLedgerFiscal[] = [
      evento({ transacaoId: "c1", tipo: "compra", data: "2026-01-01", quantidade: 100, precoUnitario: 10, custos: 0 }),
      evento({ transacaoId: "b1", tipo: "bonificacao", data: "2026-02-01", quantidade: 10, valorCapitalizado: 50 }),
    ];
    const ledger = construirLedgerFiscal(eventos);
    expect(ledger.estadoFinal.quantidade.toNumber()).toBe(110);
    expect(ledger.estadoFinal.custoTotal.toNumber()).toBe(1050); // 1000 + 50
  });

  it("ordenarEventosLedgerFiscal ordena por data e desempata por createdAt", () => {
    const eventos: EventoLedgerFiscal[] = [
      { ...evento({ transacaoId: "b", tipo: "compra", data: "2026-01-01", quantidade: 1, precoUnitario: 1, custos: 0 }), createdAt: "2026-01-01T10:00:00" },
      { ...evento({ transacaoId: "a", tipo: "compra", data: "2026-01-01", quantidade: 1, precoUnitario: 1, custos: 0 }), createdAt: "2026-01-01T09:00:00" },
    ];
    const ordenados = ordenarEventosLedgerFiscal(eventos);
    expect(ordenados.map((e) => e.transacaoId)).toEqual(["a", "b"]);
  });
});
