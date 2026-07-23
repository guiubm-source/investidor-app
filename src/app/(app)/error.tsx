"use client";

import { useEffect } from "react";

/**
 * Error boundary do grupo (app) — ver docs/MAPA-DE-DADOS.md §8.59 (2026-07-22).
 * Sem este arquivo, um erro não tratado em qualquer Server/Client Component
 * das abas autenticadas (Carteira, Ativos, Alocação, Proventos, Indicadores,
 * Imposto de Renda, Configurações, Dashboard) derrubava a página inteira com
 * a tela de erro genérica do Next.js — sem o visual do app, sem opção de
 * tentar de novo sem recarregar. Fica no mesmo nível de `layout.tsx`, então a
 * Sidebar continua visível; só o conteúdo de `<main>` é substituído por este
 * componente (mesmo comportamento do App Router para error.tsx: o layout
 * pai não é desmontado). Precisa ser Client Component — exigência do
 * Next.js pra usar o `reset()`.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] erro não tratado numa aba autenticada:", error);
  }, [error]);

  return (
    <div className="px-6 py-10">
      <div className="max-w-md mx-auto">
        <div className="card p-8 text-center space-y-4">
          <p className="text-lg font-medium text-ink">Algo deu errado ao carregar esta página.</p>
          <p className="error-box text-left">
            {error.message || "Erro inesperado. Tente novamente em instantes."}
          </p>
          <button onClick={() => reset()} className="btn btn-primary">
            Tentar novamente
          </button>
        </div>
      </div>
    </div>
  );
}
