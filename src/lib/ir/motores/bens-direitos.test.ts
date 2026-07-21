import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { resolverGrupoCodigoAtivo, custoTotalNaData, montarItemInvestimento, montarBensDireitos, type AtivoParaBensDireitos, type ItemBensDireitos } from "./bens-direitos";
import type { LinhaLedgerFiscal } from "../ledger/construir-ledger";

/** Suíte de regressão — fase 12 (§8.47). Cobre o motor de Bens e Direitos (fase 9, §8.44). */

const linha = (data: string, custoTotalDepois: number): LinhaLedgerFiscal => ({
  transacaoId: `t-${data}`,
  tipo: "compra",
  data,
  quantidadeAntes: new Decimal(0),
  quantidadeDepois: new Decimal(0),
  custoTotalAntes: new Decimal(0),
  custoTotalDepois: new Decimal(custoTotalDepois),
  precoMedioAntes: new Decimal(0),
  precoMedioDepois: new Decimal(0),
  resultadoRealizado: new Decimal(0),
  valorVendaBruto: new Decimal(0),
});

describe("resolverGrupoCodigoAtivo", () => {
  it("ação e internacional usam o MESMO grupo/código (Grupo 03/01) — só localização diferencia", () => {
    expect(resolverGrupoCodigoAtivo("acao", null)).toEqual({ grupo: "03", codigo: "01" });
    expect(resolverGrupoCodigoAtivo("internacional", null)).toEqual({ grupo: "03", codigo: "01" });
  });

  it("FII vai pro Grupo 07/03", () => {
    expect(resolverGrupoCodigoAtivo("fii", null)).toEqual({ grupo: "07", codigo: "03" });
  });

  it("renda fixa isenta (LCI/LCA/CRI/CRA) vai pro Grupo 04/03, tributável pro 04/02", () => {
    expect(resolverGrupoCodigoAtivo("renda_fixa", "lci")).toEqual({ grupo: "04", codigo: "03" });
    expect(resolverGrupoCodigoAtivo("renda_fixa", "cdb")).toEqual({ grupo: "04", codigo: "02" });
  });
});

describe("custoTotalNaData", () => {
  it("pega o custo da última linha com data <= corte", () => {
    const linhas = [linha("2026-01-10", 1000), linha("2026-06-15", 2500), linha("2027-02-01", 5000)];
    expect(custoTotalNaData(linhas, "2026-12-31").toNumber()).toBe(2500);
  });

  it("devolve 0 se o ativo só foi comprado depois da data de corte", () => {
    const linhas = [linha("2027-05-01", 1000)];
    expect(custoTotalNaData(linhas, "2026-12-31").toNumber()).toBe(0);
  });
});

describe("montarItemInvestimento", () => {
  const ativoBase: AtivoParaBensDireitos = {
    ativoId: "a1",
    ativoTicker: "PETR4",
    tipo: "acao",
    subtipoRendaFixa: null,
    localizacao: "Brasil",
    linhasLedger: [linha("2026-05-01", 1000), linha("2027-03-01", 1500)],
  };

  it("gera item quando há posição em pelo menos uma das duas datas de corte", () => {
    const item = montarItemInvestimento(ativoBase, 2026, 2027);
    expect(item).not.toBeNull();
    expect(item!.situacaoAnterior.toNumber()).toBe(1000);
    expect(item!.situacaoAtual.toNumber()).toBe(1500);
  });

  it("ativo vendido/zerado no ano ainda aparece (baixa) — não é omitido só porque situacaoAtual é zero", () => {
    const ativo: AtivoParaBensDireitos = { ...ativoBase, linhasLedger: [linha("2026-05-01", 1000), linha("2027-03-01", 0)] };
    const item = montarItemInvestimento(ativo, 2026, 2027);
    expect(item).not.toBeNull();
    expect(item!.situacaoAtual.toNumber()).toBe(0);
  });

  it("nunca existiu posição em nenhuma das duas datas: devolve null", () => {
    const ativo: AtivoParaBensDireitos = { ...ativoBase, linhasLedger: [linha("2028-01-01", 1000)] };
    const item = montarItemInvestimento(ativo, 2026, 2027);
    expect(item).toBeNull();
  });
});

describe("montarBensDireitos", () => {
  it("junta itens manuais com itens de investimento e ordena por grupo/código", () => {
    const manual: ItemBensDireitos = {
      origem: "manual",
      grupo: "01",
      codigo: "11",
      nome: "Apartamento",
      localizacao: "Brasil",
      cpfCnpj: null,
      discriminacao: null,
      situacaoAnterior: new Decimal(300000),
      situacaoAtual: new Decimal(300000),
      observacoes: null,
      statusRevisao: "pendente",
      ativoId: null,
      manualId: "m1",
    };
    const ativo: AtivoParaBensDireitos = {
      ativoId: "a1",
      ativoTicker: "PETR4",
      tipo: "acao",
      subtipoRendaFixa: null,
      localizacao: "Brasil",
      linhasLedger: [linha("2026-05-01", 1000)],
    };
    const resultado = montarBensDireitos([manual], [ativo], 2026, 2027);
    expect(resultado).toHaveLength(2);
    expect(resultado[0].grupo).toBe("01"); // imóvel (grupo 01) vem antes de ação (grupo 03)
    expect(resultado[1].grupo).toBe("03");
  });
});
