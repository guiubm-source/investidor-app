"use client";

/**
 * Proventos → "Grade mensal/anual" (ver docs/MAPA-DE-DADOS.md §8.23) — tabela
 * estilo planilha por categoria, réplica do print de referência do
 * Guilherme: seção GERAL (soma de todos os anos) + uma seção por ano, com
 * subtotal trimestral e média mensal da linha TOTAL. Client component
 * porque o dado só é buscado quando o usuário abre essa visão (mesmo motivo
 * de VisaoMensalView.tsx na Carteira) — nunca no carregamento do dashboard.
 */

import { useEffect, useState } from "react";
import { obterGradeMensalProventos } from "@/lib/proventos/grade-mensal";
import { MESES_LABEL, type GradeMensalProventos, type GradeAno } from "@/lib/proventos/grade-mensal-tipos";

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function trimestres(meses: number[]): number[] {
  return [0, 1, 2, 3].map((q) => meses.slice(q * 3, q * 3 + 3).reduce((s, v) => s + v, 0));
}

export default function GradeProventosView() {
  const [dados, setDados] = useState<GradeMensalProventos | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [anoSelecionado, setAnoSelecionado] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    obterGradeMensalProventos()
      .then((r) => {
        if (!ativo) return;
        setDados(r);
        setAnoSelecionado(r.porAno[0]?.chave ?? null);
      })
      .catch((e) => {
        if (ativo) setErro(e instanceof Error ? e.message : "Não foi possível carregar a grade mensal.");
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, []);

  if (carregando) {
    return (
      <div className="card p-4">
        <p className="text-sm text-faint">Carregando grade mensal…</p>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="card p-4">
        <p className="text-sm text-danger">{erro}</p>
      </div>
    );
  }

  if (!dados || dados.geral.linhas.length === 0) {
    return (
      <div className="card p-4">
        <p className="text-sm text-faint">Nenhum provento registrado ainda — a grade aparece aqui assim que você lançar o primeiro.</p>
      </div>
    );
  }

  const anoAtivo = dados.porAno.find((a) => a.chave === anoSelecionado) ?? dados.porAno[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="text-sm font-medium text-ink mb-3">Geral — todos os anos, por categoria</h3>
        <TabelaGrade grade={dados.geral} />
      </div>

      {dados.porAno.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-medium text-ink">Por ano</h3>
            <div className="flex gap-1 flex-wrap">
              {dados.porAno.map((a) => (
                <button
                  key={a.chave}
                  onClick={() => setAnoSelecionado(a.chave)}
                  className={`text-xs px-2 py-1 rounded-md ${
                    anoAtivo?.chave === a.chave ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-ink"
                  }`}
                >
                  {a.chave}
                </button>
              ))}
            </div>
          </div>
          {anoAtivo && <TabelaGrade grade={anoAtivo} />}
        </div>
      )}
    </div>
  );
}

function TabelaGrade({ grade }: { grade: GradeAno }) {
  const linhaTotal = grade.linhas.find((l) => l.grupo === "total");

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border border-border">
          <thead>
            <tr className="bg-surface-2 text-faint">
              <th className="py-1 px-2 text-left border-b border-border whitespace-nowrap">Categoria</th>
              {MESES_LABEL.map((m) => (
                <th key={m} className="py-1 px-2 text-right border-b border-border whitespace-nowrap">
                  {m}
                </th>
              ))}
              <th className="py-1 px-2 text-right border-b border-border whitespace-nowrap">Total</th>
            </tr>
          </thead>
          <tbody>
            {grade.linhas.map((linha) => {
              const destaque = linha.grupo === "total";
              return (
                <tr key={linha.grupo} className={destaque ? "bg-surface-2 font-medium" : ""}>
                  <td className={`py-1 px-2 border-b border-border/50 whitespace-nowrap ${destaque ? "text-ink" : "text-muted"}`}>
                    {linha.label}
                  </td>
                  {linha.meses.map((v, i) => (
                    <td
                      key={i}
                      className={`py-1 px-2 text-right border-b border-border/50 whitespace-nowrap ${destaque ? "text-ink" : "text-muted"}`}
                    >
                      {v > 0 ? formatarMoeda(v) : "—"}
                    </td>
                  ))}
                  <td className={`py-1 px-2 text-right border-b border-border/50 whitespace-nowrap font-medium ${destaque ? "text-ink" : "text-muted"}`}>
                    {formatarMoeda(linha.totalLinha)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {linhaTotal && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {trimestres(linhaTotal.meses).map((v, i) => (
            <div key={i} className="bg-surface-2 rounded-md px-3 py-2">
              <p className="text-[10px] text-faint">{i + 1}º trimestre</p>
              <p className="text-xs font-medium text-ink">{formatarMoeda(v)}</p>
            </div>
          ))}
          <div className="bg-surface-2 rounded-md px-3 py-2">
            <p className="text-[10px] text-faint">Média mensal</p>
            <p className="text-xs font-medium text-ink">{formatarMoeda(linhaTotal.totalLinha / 12)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
