import { describe, it, expect } from "vitest";
import {
  aplicarTransacaoNaPosicao,
  calcularPosicao,
  calcularXIRR,
  construirFluxosCaixaXIRR,
  ordenarTransacoes,
  ESTADO_POSICAO_INICIAL,
  type TransacaoCalc,
} from "./posicao-calculo";

/**
 * Suíte de regressão — §8.60 (2026-07-23): clamp de venda, desempate por
 * horário de negociação e motor XIRR (substitui o `pct` do "retorno simples
 * acumulado" no stat "Variação total" de Posição/Ativo).
 */

describe("aplicarTransacaoNaPosicao — clamp de venda", () => {
  it("venda que excede o saldo disponível usa a quantidade LIMITADA em todos os campos, inclusive totalVendidoLiquido", () => {
    // Cenário do bug: sob um filtro de corretora, uma venda de 100 unidades
    // aparece registrada num sub-livro que só tem 60 em carteira (as outras
    // 40 foram compradas em outra corretora). Antes da correção,
    // totalVendidoLiquido usava as 100 cheias (inflando o "total vendido").
    let estado = ESTADO_POSICAO_INICIAL;
    estado = aplicarTransacaoNaPosicao(estado, { tipo: "compra", data: "2026-01-01", quantidade: 60, precoUnitario: 10, custos: 0 });
    estado = aplicarTransacaoNaPosicao(estado, { tipo: "venda", data: "2026-02-01", quantidade: 100, precoUnitario: 20, custos: 0 });

    expect(estado.quantidade).toBe(0);
    // 60 unidades vendidas a 20 = 1200, não 100 * 20 = 2000.
    expect(estado.totalVendidoLiquido).toBe(1200);
    expect(estado.lucroRealizado).toBe(600); // (20 - 10) * 60
  });
});

describe("ordenarTransacoes — desempate por horário de negociação", () => {
  it("usa horarioNegociacao como desempate primário quando presente nos dois lados", () => {
    const itens = [
      { id: "venda-as-16h", data: "2026-03-10", createdAt: "2026-03-10T09:00:00Z", horarioNegociacao: "16:00" },
      { id: "compra-as-10h", data: "2026-03-10", createdAt: "2026-03-10T18:00:00Z", horarioNegociacao: "10:00" },
    ];
    const ordenado = ordenarTransacoes(itens);
    expect(ordenado.map((i) => i.id)).toEqual(["compra-as-10h", "venda-as-16h"]);
  });

  it("cai para createdAt quando falta horarioNegociacao em algum dos dois", () => {
    const itens = [
      { id: "b", data: "2026-03-10", createdAt: "2026-03-10T18:00:00Z" },
      { id: "a", data: "2026-03-10", createdAt: "2026-03-10T09:00:00Z" },
    ];
    const ordenado = ordenarTransacoes(itens);
    expect(ordenado.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("calcularXIRR", () => {
  it("retorna null com menos de 2 fluxos", () => {
    expect(calcularXIRR([{ data: "2026-01-01", valor: -1000 }])).toBeNull();
  });

  it("retorna null quando todos os fluxos têm o mesmo sinal", () => {
    expect(
      calcularXIRR([
        { data: "2026-01-01", valor: -1000 },
        { data: "2026-06-01", valor: -500 },
      ])
    ).toBeNull();
  });

  it("caso simples: -1000 hoje, +1100 em 1 ano ≈ 10% a.a.", () => {
    const r = calcularXIRR([
      { data: "2025-01-01", valor: -1000 },
      { data: "2026-01-01", valor: 1100 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(10, 0);
  });

  it("fluxos irregulares: bate com uma busca binária independente (referência de alta precisão)", () => {
    // -10000 (aporte), +2750/+4250/+3250/+2750 em datas espaçadas —
    // referência calculada separadamente por busca binária de alta precisão
    // sobre o mesmo VPL (não pelo Newton-Raphson testado aqui), como
    // segunda implementação independente pra validar o resultado: 13,332...%.
    const r = calcularXIRR([
      { data: "2023-01-01", valor: -10000 },
      { data: "2024-01-01", valor: 2750 },
      { data: "2025-01-01", valor: 4250 },
      { data: "2025-07-01", valor: 3250 },
      { data: "2026-01-01", valor: 2750 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(13.332, 2);
  });

  it("não é distorcido por reinvestimento no mesmo ativo (caso que motivou a correção)", () => {
    // Compra 100@10 (−1000), vende as 100@20 (+2000, no mesmo dia), recompra
    // 100@20 (−2000), preço fica parado em 20 — patrimônio hoje = 2000.
    // A fórmula antiga ("retorno simples acumulado") dava +33,3%, mas o
    // investidor só ganhou dinheiro na primeira perna (dobrou o capital) e
    // ficou parado na segunda. Com XIRR, um cenário equivalente MAS com as
    // pernas espaçadas no tempo deve refletir cada perna corretamente — aqui
    // testamos que o XIRR não trata os R$3000 (1000+2000) de saída como se
    // fossem capital simultâneo: usamos datas espaçadas pra evitar o caso
    // degenerado (fluxos no mesmo dia deixam o XIRR matematicamente
        // indefinido — ver comentário em calcularXIRR).
    const fluxos = [
      { data: "2024-01-01", valor: -1000 }, // compra 100@10
      { data: "2025-01-01", valor: 2000 }, // vende 100@20
      { data: "2025-01-02", valor: -2000 }, // recompra 100@20
      { data: "2026-01-02", valor: 2000 }, // valor de mercado hoje (parado em 20)
    ];
    const r = calcularXIRR(fluxos);
    expect(r).not.toBeNull();
    // Primeira perna dobrou o capital em 1 ano (~100% a.a.); segunda perna
    // ficou flat por 1 ano (~0%). O XIRR agregado deve ficar bem acima de
    // 33,3% (o número, sabidamente errado, que a fórmula antiga dava) —
    // confirma que XIRR não pune o retorno por causa do reinvestimento.
    expect(r!).toBeGreaterThan(33.3);
  });
});

describe("construirFluxosCaixaXIRR", () => {
  it("ignora eventos societários (desdobramento/grupamento/bonificação) — sem caixa de verdade", () => {
    const transacoes: TransacaoCalc[] = [
      { tipo: "compra", data: "2026-01-01", quantidade: 100, precoUnitario: 10, custos: 0 },
      { tipo: "desdobramento", data: "2026-02-01", fatorProporcao: 2 },
      { tipo: "bonificacao", data: "2026-03-01", quantidade: 10, valorCapitalizado: 0 },
    ];
    const fluxos = construirFluxosCaixaXIRR(transacoes);
    expect(fluxos).toEqual([{ data: "2026-01-01", valor: -1000 }]);
  });

  it("usa a quantidade limitada (clamp) na venda, igual ao fold de calcularPosicao", () => {
    const transacoes: TransacaoCalc[] = [
      { tipo: "compra", data: "2026-01-01", quantidade: 60, precoUnitario: 10, custos: 0 },
      { tipo: "venda", data: "2026-02-01", quantidade: 100, precoUnitario: 20, custos: 0 },
    ];
    const fluxos = construirFluxosCaixaXIRR(transacoes);
    expect(fluxos).toEqual([
      { data: "2026-01-01", valor: -600 },
      { data: "2026-02-01", valor: 1200 },
    ]);
    // Consistência: a mesma quantidade limitada usada em calcularPosicao.
    expect(calcularPosicao(transacoes).totalVendidoLiquido).toBe(1200);
  });
});
