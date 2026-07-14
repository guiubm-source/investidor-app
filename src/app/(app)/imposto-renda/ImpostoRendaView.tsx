"use client";

import { useState } from "react";
import { obterRelatorioIR, type RelatorioIR } from "@/lib/ir/actions";

const formatarMoeda = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatarMes = (anoMes: string) => {
  const [ano, mes] = anoMes.split("-");
  return `${mes}/${ano}`;
};

export default function ImpostoRendaView({ relatorioInicial }: { relatorioInicial: RelatorioIR }) {
  const [relatorio, setRelatorio] = useState(relatorioInicial);
  const [carregando, setCarregando] = useState(false);

  const trocarAno = async (ano: number) => {
    setCarregando(true);
    const novo = await obterRelatorioIR(ano);
    setRelatorio(novo);
    setCarregando(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <label className="label mb-0">Ano</label>
        <select
          value={relatorio.ano}
          onChange={(e) => trocarAno(Number(e.target.value))}
          className="input w-32"
          disabled={carregando}
        >
          {relatorio.anosDisponiveis.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {carregando && <span className="text-xs text-faint">Recalculando...</span>}
      </div>

      <div>
        <p className="text-xs text-faint mb-2">Resumo anual por categoria</p>
        {relatorio.resumoAnual.length === 0 ? (
          <p className="text-sm text-faint">Nenhuma venda registrada em {relatorio.ano}.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {relatorio.resumoAnual.map((r) => (
              <div key={r.categoria} className="card p-3">
                <p className="text-xs text-faint mb-1">{r.categoriaLabel}</p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-faint">Vendas</p>
                    <p className="text-ink">{formatarMoeda(r.vendaTotal)}</p>
                  </div>
                  <div>
                    <p className="text-faint">Lucro líquido</p>
                    <p className={r.lucroLiquido >= 0 ? "text-success" : "text-danger"}>
                      {formatarMoeda(r.lucroLiquido)}
                    </p>
                  </div>
                  <div>
                    <p className="text-faint">Imposto devido</p>
                    <p className="text-ink">{formatarMoeda(r.impostoDevido)}</p>
                  </div>
                </div>
                {r.apuracaoAnual && (
                  <p className="text-xs text-faint mt-2">Apuração anual (15% sobre o lucro líquido do ano)</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-2 border-b border-border">
          <p className="text-xs text-faint">Detalhe mês a mês</p>
        </div>
        <div className="grid grid-cols-[70px_1fr_90px_90px_90px_60px_90px_1fr] gap-2 px-4 py-2 text-xs text-faint border-b border-border">
          <span>Mês</span>
          <span>Categoria</span>
          <span className="text-right">Vendas</span>
          <span className="text-right">Lucro</span>
          <span className="text-right">Base</span>
          <span className="text-right">Alíq.</span>
          <span className="text-right">Imposto</span>
          <span>Observação</span>
        </div>
        {relatorio.mensal.length === 0 && <p className="text-sm text-faint px-4 py-4">Nenhum lançamento neste ano.</p>}
        {relatorio.mensal.map((l, i) => (
          <div
            key={`${l.anoMes}-${l.categoria}-${i}`}
            className="grid grid-cols-[70px_1fr_90px_90px_90px_60px_90px_1fr] gap-2 items-center px-4 py-2 text-xs border-b border-border last:border-0"
          >
            <span className="text-ink">{formatarMes(l.anoMes)}</span>
            <span className="text-muted truncate">{l.categoriaLabel}</span>
            <span className="text-right text-ink">{formatarMoeda(l.vendaTotal)}</span>
            <span className={`text-right ${l.lucroBruto >= 0 ? "text-success" : "text-danger"}`}>
              {formatarMoeda(l.lucroBruto)}
            </span>
            <span className="text-right text-ink">{formatarMoeda(l.baseCalculo)}</span>
            <span className="text-right text-muted">{l.aliquota !== null ? `${(l.aliquota * 100).toFixed(1)}%` : "—"}</span>
            <span className="text-right text-ink">
              {l.impostoDevido !== null ? formatarMoeda(l.impostoDevido) : "—"}
            </span>
            <span className="text-faint truncate">
              {l.isento && l.motivoIsencao}
              {l.apuracaoAnual && "Apuração anual — ver resumo"}
              {l.categoria === "renda_fixa_tributavel" && "Retido na fonte, sem DARF"}
              {l.categoria === "renda_fixa_isenta" && l.motivoIsencao}
              {l.diasMediosRetencao !== null && ` (${Math.round(l.diasMediosRetencao)}d aplicado)`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
