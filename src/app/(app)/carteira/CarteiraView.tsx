"use client";

import { useState } from "react";
import type { LivroRazao } from "@/lib/carteira/actions";
import { obterPosicaoConsolidada, type PosicaoConsolidada } from "@/lib/carteira/posicao";
import LivroRazaoView, { type AtivoOpcao } from "./LivroRazaoView";
import PosicaoView from "./PosicaoView";

const ABAS = [
  { id: "posicao", label: "Posição" },
  { id: "livro_razao", label: "Livro-razão" },
] as const;
type AbaId = (typeof ABAS)[number]["id"];

/**
 * Aba Carteira — desde 2026-07-20 (ver docs/MAPA-DE-DADOS.md §8.16) virou
 * aba-mãe com duas sub-abas: Posição (visão consolidada por classe, padrão
 * MyProfit/Status Invest) como default, e Livro-razão (feed de lançamentos
 * de compra/venda) como a antiga tela única da Carteira. Ambas leem
 * `transacoes` sem duplicar dado entre si — Posição é derivada, Livro-razão
 * é onde a transação é de fato lançada/excluída.
 */
export default function CarteiraView({
  posicaoInicial,
  livroInicial,
  ativos,
}: {
  posicaoInicial: PosicaoConsolidada;
  livroInicial: LivroRazao;
  ativos: AtivoOpcao[];
}) {
  const [aba, setAba] = useState<AbaId>("posicao");
  const [posicao, setPosicao] = useState(posicaoInicial);

  const atualizarPosicao = async () => {
    const nova = await obterPosicaoConsolidada(null);
    setPosicao(nova);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {ABAS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              aba === a.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      {aba === "posicao" && <PosicaoView posicaoInicial={posicao} />}

      {aba === "livro_razao" && (
        <LivroRazaoView livroInicial={livroInicial} ativos={ativos} onLivroAtualizado={atualizarPosicao} />
      )}
    </div>
  );
}
