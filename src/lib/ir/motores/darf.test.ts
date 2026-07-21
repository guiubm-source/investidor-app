import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { consolidarDarf, type ParcelaParaDarf } from "./darf";

/** Suíte de regressão — fase 12 (§8.47). Cobre o motor de consolidação de DARF (fase 5, §8.40). */

const parcela = (p: { codigoReceita: string; anoMes: string; valor: number; grupo?: string }): ParcelaParaDarf => ({
  grupo: p.grupo ?? "acao_swing",
  codigoReceita: p.codigoReceita,
  anoMes: p.anoMes,
  valor: new Decimal(p.valor),
});

describe("consolidarDarf", () => {
  it("uma parcela que já atinge o mínimo sozinha vira guia na própria competência", () => {
    const r = consolidarDarf([parcela({ codigoReceita: "6015", anoMes: "2026-03", valor: 50 })], new Decimal(10));
    expect(r.guias).toHaveLength(1);
    expect(r.guias[0].competenciaGeracao).toBe("2026-03");
    expect(r.guias[0].valorConsolidado.toNumber()).toBe(50);
    expect(r.saldosPendentes).toHaveLength(0);
  });

  it("parcelas abaixo do mínimo se acumulam entre competências até atingir o mínimo", () => {
    const r = consolidarDarf(
      [
        parcela({ codigoReceita: "6015", anoMes: "2026-01", valor: 3 }),
        parcela({ codigoReceita: "6015", anoMes: "2026-02", valor: 4 }),
        parcela({ codigoReceita: "6015", anoMes: "2026-03", valor: 5 }),
      ],
      new Decimal(10)
    );
    expect(r.guias).toHaveLength(1);
    expect(r.guias[0].competenciaGeracao).toBe("2026-03"); // só atinge o mínimo na 3ª competência
    expect(r.guias[0].valorConsolidado.toNumber()).toBe(12);
    expect(r.guias[0].memoria).toHaveLength(3); // memória lista as 3 parcelas que compuseram a guia
  });

  it("o que não atinge o mínimo até a última competência fica em saldosPendentes, não vira guia", () => {
    const r = consolidarDarf([parcela({ codigoReceita: "6015", anoMes: "2026-01", valor: 3 })], new Decimal(10));
    expect(r.guias).toHaveLength(0);
    expect(r.saldosPendentes).toHaveLength(1);
    expect(r.saldosPendentes[0].valorAcumulado.toNumber()).toBe(3);
  });

  it("códigos de receita diferentes nunca se misturam no acumulador", () => {
    const r = consolidarDarf(
      [
        parcela({ codigoReceita: "6015", anoMes: "2026-01", valor: 5 }),
        parcela({ codigoReceita: "0190", anoMes: "2026-01", valor: 5 }),
      ],
      new Decimal(10)
    );
    expect(r.guias).toHaveLength(0);
    expect(r.saldosPendentes).toHaveLength(2); // cada código fica com seu próprio saldo pendente de 5, nenhum vira 10
  });

  it("grupos diferentes na MESMA competência e código são somados antes de entrar no acumulador", () => {
    const r = consolidarDarf(
      [
        parcela({ codigoReceita: "6015", anoMes: "2026-01", valor: 6, grupo: "acao_swing" }),
        parcela({ codigoReceita: "6015", anoMes: "2026-01", valor: 6, grupo: "fii" }),
      ],
      new Decimal(10)
    );
    expect(r.guias).toHaveLength(1);
    expect(r.guias[0].valorConsolidado.toNumber()).toBe(12);
    expect(r.guias[0].memoria.map((m) => m.grupo).sort()).toEqual(["acao_swing", "fii"]);
  });

  it("depois de gerar uma guia, o acumulador zera e recomeça do zero pra próxima", () => {
    const r = consolidarDarf(
      [
        parcela({ codigoReceita: "6015", anoMes: "2026-01", valor: 10 }), // gera guia, zera
        parcela({ codigoReceita: "6015", anoMes: "2026-02", valor: 3 }), // não atinge sozinho
      ],
      new Decimal(10)
    );
    expect(r.guias).toHaveLength(1);
    expect(r.guias[0].competenciaGeracao).toBe("2026-01");
    expect(r.saldosPendentes).toHaveLength(1);
    expect(r.saldosPendentes[0].valorAcumulado.toNumber()).toBe(3);
  });

  it("parcela com valor zero ou negativo é ignorada (só débito relevante entra)", () => {
    const r = consolidarDarf([parcela({ codigoReceita: "6015", anoMes: "2026-01", valor: 0 }), parcela({ codigoReceita: "6015", anoMes: "2026-02", valor: -5 })], new Decimal(10));
    expect(r.guias).toHaveLength(0);
    expect(r.saldosPendentes).toHaveLength(0);
  });
});
