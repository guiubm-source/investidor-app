"use client";

import { useState } from "react";
import Link from "next/link";
import type { ChecklistAtivoView } from "@/lib/ativos/actions";

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function formatarPct(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(2)}%`;
}

function formatarRatio(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(2)}x`;
}

function formatarNumero(v: number | null, casas = 2): string {
  if (v === null) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: 0 });
}

const GRUPOS = [
  { id: "acoes", label: "Ações/ETF" },
  { id: "fiis", label: "FIIs" },
] as const;
type GrupoId = (typeof GRUPOS)[number]["id"];

const MAX_COMPARACAO = 3;

export default function ComparativoView({
  acoesInicial,
  fiisInicial,
  grupoInicial,
}: {
  acoesInicial: ChecklistAtivoView[];
  fiisInicial: ChecklistAtivoView[];
  grupoInicial: GrupoId;
}) {
  const [grupo, setGrupo] = useState<GrupoId>(grupoInicial);
  const [selecionados, setSelecionados] = useState<string[]>([]);

  const lista = grupo === "acoes" ? acoesInicial : fiisInicial;

  const alternarSelecao = (ativoId: string) => {
    setSelecionados((atual) => {
      if (atual.includes(ativoId)) return atual.filter((id) => id !== ativoId);
      if (atual.length >= MAX_COMPARACAO) return atual;
      return [...atual, ativoId];
    });
  };

  const selecionadosDados = selecionados
    .map((id) => lista.find((a) => a.ativoId === id))
    .filter((a): a is ChecklistAtivoView => !!a);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/ativos" className="text-xs text-faint hover:text-ink">
          ← Voltar para Ativos
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-medium text-ink mb-1">Comparar ativos</h1>
        <p className="text-sm text-muted">
          Escolha até {MAX_COMPARACAO} ativos do mesmo grupo para ver o checklist comparativo lado a
          lado (ver docs/MAPA-DE-DADOS.md §8.10).
        </p>
      </div>

      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {GRUPOS.map((g) => (
          <button
            key={g.id}
            onClick={() => {
              setGrupo(g.id);
              setSelecionados([]);
            }}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              grupo === g.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-medium text-ink mb-3">
          Escolha os ativos ({selecionados.length}/{MAX_COMPARACAO})
        </h2>
        {lista.length === 0 ? (
          <p className="text-xs text-faint">
            Nenhum ativo {grupo === "acoes" ? "de ações/ETF/internacional" : "de FII"} cadastrado ainda.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {lista.map((a) => {
              const selecionado = selecionados.includes(a.ativoId);
              const desabilitado = !selecionado && selecionados.length >= MAX_COMPARACAO;
              return (
                <button
                  key={a.ativoId}
                  onClick={() => alternarSelecao(a.ativoId)}
                  disabled={desabilitado}
                  className={`text-xs rounded-full px-3 py-1.5 border transition-colors ${
                    selecionado
                      ? "bg-accent-soft border-accent text-ink"
                      : "border-border text-muted hover:text-ink disabled:opacity-40"
                  }`}
                >
                  {a.ticker}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selecionadosDados.length === 0 ? (
        <p className="text-xs text-faint">Selecione ao menos um ativo acima para ver o checklist.</p>
      ) : grupo === "acoes" ? (
        <TabelaAcoes dados={selecionadosDados} />
      ) : (
        <TabelaFiis dados={selecionadosDados} />
      )}
    </div>
  );
}

type Linha = { label: string; valor: (c: ChecklistAtivoView) => string };

function TabelaAcoes({ dados }: { dados: ChecklistAtivoView[] }) {
  const linhas: Linha[] = [
    { label: "Preço atual", valor: (c) => formatarMoeda(c.precoAtual) },
    { label: "P/L", valor: (c) => formatarRatio(c.checklistAcao?.pl ?? null) },
    { label: "PEG Ratio", valor: (c) => formatarRatio(c.checklistAcao?.pegRatio ?? null) },
    { label: "P/VP", valor: (c) => formatarRatio(c.checklistAcao?.pvp ?? null) },
    { label: "ROE", valor: (c) => formatarPct(c.checklistAcao?.roePct ?? null) },
    { label: "ROA", valor: (c) => formatarPct(c.checklistAcao?.roaPct ?? null) },
    { label: "ROIC", valor: (c) => formatarPct(c.checklistAcao?.roicPct ?? null) },
    { label: "Mg. Bruta", valor: (c) => formatarPct(c.checklistAcao?.margemBrutaPct ?? null) },
    { label: "Mg. Lucro", valor: (c) => formatarPct(c.checklistAcao?.margemLucroPct ?? null) },
    { label: "DL/PL", valor: (c) => formatarRatio(c.checklistAcao?.dlPl ?? null) },
    { label: "Dívida Bruta/EBITDA", valor: (c) => formatarRatio(c.checklistAcao?.dividaBrutaEbitda ?? null) },
    { label: "Liq. Corrente", valor: (c) => formatarRatio(c.checklistAcao?.liquidezCorrente ?? null) },
    { label: "CAGR EBIT (5 anos)", valor: (c) => formatarPct(c.checklistAcao?.cagrEbit5AnosPct ?? null) },
    { label: "CAGR Lucro (5 anos)", valor: (c) => formatarPct(c.checklistAcao?.cagrLucro5AnosPct ?? null) },
    { label: "Saldo dos Acionistas", valor: (c) => c.saldoAcionistas || "—" },
  ];

  return <TabelaComparativa dados={dados} linhas={linhas} />;
}

function TabelaFiis({ dados }: { dados: ChecklistAtivoView[] }) {
  const linhas: Linha[] = [
    { label: "Preço atual", valor: (c) => formatarMoeda(c.precoAtual) },
    { label: "P/VP", valor: (c) => formatarRatio(c.checklistFii?.pvp ?? null) },
    { label: "Nº Negócios/mês", valor: (c) => formatarNumero(c.checklistFii?.numeroNegociosMes ?? null, 0) },
    { label: "Vacância Financeira", valor: (c) => formatarPct(c.checklistFii?.vacanciaFinanceiraPct ?? null) },
    { label: "Vacância Física", valor: (c) => formatarPct(c.checklistFii?.vacanciaFisicaPct ?? null) },
    { label: "Cap Rate", valor: (c) => formatarPct(c.checklistFii?.capRatePct ?? null) },
    { label: "Dividend Yield (12m)", valor: (c) => formatarPct(c.checklistFii?.dividendYieldPct ?? null) },
    {
      label: "Valor m²/Aluguel",
      valor: (c) => (c.checklistFii?.valorM2Aluguel != null ? formatarMoeda(c.checklistFii.valorM2Aluguel) : "—"),
    },
  ];

  return <TabelaComparativa dados={dados} linhas={linhas} />;
}

function TabelaComparativa({ dados, linhas }: { dados: ChecklistAtivoView[]; linhas: Linha[] }) {
  return (
    <div className="card p-5 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="py-2 pr-4 text-faint font-medium">Métrica</th>
            {dados.map((c) => (
              <th key={c.ativoId} className="py-2 px-4 text-ink font-medium whitespace-nowrap">
                <Link href={`/ativos/${c.ativoId}`} className="hover:underline">
                  {c.ticker}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr key={linha.label} className="border-b border-border/50">
              <td className="py-1.5 pr-4 text-faint whitespace-nowrap">{linha.label}</td>
              {dados.map((c) => (
                <td key={c.ativoId} className="py-1.5 px-4 text-ink">
                  {linha.valor(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
