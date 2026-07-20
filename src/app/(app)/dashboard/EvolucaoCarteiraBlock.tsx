"use client";

/**
 * Bloco "Evolução do patrimônio" do Dashboard — toggle R$ / % no mesmo
 * gráfico (decisão 2026-07-15, ver docs/MAPA-DE-DADOS.md §8.15). Client
 * component porque precisa de estado local pro toggle; os dados (R$ e %)
 * já vêm prontos do server component pai (dashboard/page.tsx), sem fetch
 * novo aqui.
 */

import { useState } from "react";
import SerieLinhaChart from "@/components/SerieLinhaChart";
import type { PontoEvolucaoCarteira } from "@/lib/ativos/preco-historico";

const formatarMoedaCompacta = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const formatarPct = (valor: number) => `${valor.toFixed(1)}%`;

export default function EvolucaoCarteiraBlock({ pontos }: { pontos: PontoEvolucaoCarteira[] }) {
  const [modo, setModo] = useState<"valor" | "pct">("valor");

  const pontosValor = pontos.map((p) => ({ data: p.data, valor: p.valorTotal }));
  const pontosPct = pontos
    .filter((p) => p.rentabilidadePct !== null)
    .map((p) => ({ data: p.data, valor: p.rentabilidadePct as number }));

  const pontosAtivos = modo === "valor" ? pontosValor : pontosPct;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-medium text-ink">Evolução do patrimônio</h2>
        <div className="flex gap-1">
          <button
            onClick={() => setModo("valor")}
            className={`text-xs px-2 py-1 rounded ${modo === "valor" ? "bg-accent text-white" : "text-muted"}`}
          >
            R$
          </button>
          <button
            onClick={() => setModo("pct")}
            className={`text-xs px-2 py-1 rounded ${modo === "pct" ? "bg-accent text-white" : "text-muted"}`}
          >
            %
          </button>
        </div>
      </div>
      <p className="text-xs text-faint mb-3">
        {modo === "valor"
          ? "Soma, dia a dia, do preço histórico × quantidade em carteira de cada ativo — não só o valor de hoje."
          : "Retorno acumulado (posição ainda em carteira + lucro já realizado em vendas, sobre tudo que já foi investido em compras) — cada ativo entra na conta a partir da sua primeira negociação e some da conta no dia da venda final."}
      </p>
      {pontosAtivos.length >= 2 ? (
        <SerieLinhaChart
          pontos={pontosAtivos}
          formatarValor={modo === "valor" ? formatarMoedaCompacta : formatarPct}
          ariaLabel={modo === "valor" ? "Evolução do patrimônio total investido" : "Retorno acumulado da carteira"}
          mostrarLinhaZero={modo === "pct"}
        />
      ) : (
        <p className="text-sm text-faint">
          Ainda não há histórico suficiente para desenhar o gráfico — volte depois de lançar
          transações e o preço dos ativos acumular alguns dias de histórico.
        </p>
      )}
    </div>
  );
}
