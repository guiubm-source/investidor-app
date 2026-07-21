import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { ultimoPrejuizoPorGrupo, montarCardsPrincipais } from "./dashboard-fiscal";

/** Suíte de regressão — fase 12 (§8.47). Cobre o motor de agregação do dashboard fiscal (fase 10, §8.45). */

describe("ultimoPrejuizoPorGrupo", () => {
  it("pega a linha mais recente por grupo, respeitando o anoLimite", () => {
    const mensal = [
      { grupo: "acao_swing", anoMes: "2025-06", prejuizoSaldoFinal: new Decimal(-1000) },
      { grupo: "acao_swing", anoMes: "2026-03", prejuizoSaldoFinal: new Decimal(-500) },
      { grupo: "acao_swing", anoMes: "2027-01", prejuizoSaldoFinal: new Decimal(-9999) }, // além do anoLimite
    ];
    const r = ultimoPrejuizoPorGrupo(mensal, 2026);
    expect(r.get("acao_swing")!.toNumber()).toBe(-500); // ignora a linha de 2027
  });

  it("grupos diferentes são rastreados independentemente", () => {
    const mensal = [
      { grupo: "acao_swing", anoMes: "2026-01", prejuizoSaldoFinal: new Decimal(-100) },
      { grupo: "fii", anoMes: "2026-02", prejuizoSaldoFinal: new Decimal(-200) },
    ];
    const r = ultimoPrejuizoPorGrupo(mensal, 2026);
    expect(r.get("acao_swing")!.toNumber()).toBe(-100);
    expect(r.get("fii")!.toNumber()).toBe(-200);
  });
});

describe("montarCardsPrincipais", () => {
  it("com fundação completa (DARF e exterior disponíveis): imposto a pagar soma os dois", () => {
    const r = montarCardsPrincipais({
      guiasDarfValorTotal: new Decimal(500),
      prejuizoPorGrupo: [],
      ganhoCapitalExteriorImpostoAno: new Decimal(300),
      ganhoCapitalExteriorDisponivel: true,
    });
    expect(r.impostoAPagar.status).toBe("disponivel");
    expect(r.impostoAPagar.valor!.toNumber()).toBe(800);
    expect(r.ganhoCapitalExterior.status).toBe("disponivel");
    expect(r.ganhoCapitalExterior.valor!.toNumber()).toBe(300);
  });

  it("DARF indisponível (fundação incompleta): imposto a pagar fica indisponível MESMO com exterior ok", () => {
    const r = montarCardsPrincipais({
      guiasDarfValorTotal: null,
      prejuizoPorGrupo: [],
      ganhoCapitalExteriorImpostoAno: new Decimal(300),
      ganhoCapitalExteriorDisponivel: true,
    });
    expect(r.impostoAPagar.status).toBe("nao_disponivel");
    expect(r.impostoAPagar.valor).toBeNull();
    expect(r.ganhoCapitalExterior.status).toBe("disponivel"); // o card do exterior continua independente
  });

  it("exterior indisponível: ganho de capital E imposto a pagar ficam indisponíveis (nunca aproximados)", () => {
    const r = montarCardsPrincipais({
      guiasDarfValorTotal: new Decimal(500),
      prejuizoPorGrupo: [],
      ganhoCapitalExteriorImpostoAno: null,
      ganhoCapitalExteriorDisponivel: false,
    });
    expect(r.ganhoCapitalExterior.status).toBe("nao_disponivel");
    expect(r.impostoAPagar.status).toBe("nao_disponivel");
  });

  it("cards de motor inexistente (pago/vencido/IRRF/crédito exterior/documentos) são sempre não disponíveis, com motivo", () => {
    const r = montarCardsPrincipais({
      guiasDarfValorTotal: new Decimal(500),
      prejuizoPorGrupo: [],
      ganhoCapitalExteriorImpostoAno: new Decimal(300),
      ganhoCapitalExteriorDisponivel: true,
    });
    for (const card of [r.impostoPago, r.impostoVencido, r.irrfDisponivel, r.impostoPagoExterior, r.creditoExteriorAdmitido, r.documentosSemComprovante]) {
      expect(card.status).toBe("nao_disponivel");
      expect(card.motivo).not.toBeNull();
      expect(card.valor).toBeNull();
    }
    expect(r.obrigacaoDeclarar.status).toBe("nao_avaliada");
  });

  it("prejuízo por grupo é repassado sem alteração (motor não recalcula, só agrega)", () => {
    const prejuizoPorGrupo = [{ grupo: "acao_swing", label: "Ações — swing trade", saldo: new Decimal(1234) }];
    const r = montarCardsPrincipais({
      guiasDarfValorTotal: null,
      prejuizoPorGrupo,
      ganhoCapitalExteriorImpostoAno: null,
      ganhoCapitalExteriorDisponivel: false,
    });
    expect(r.prejuizoPorGrupo).toBe(prejuizoPorGrupo); // mesma referência, não uma cópia recalculada
  });
});
