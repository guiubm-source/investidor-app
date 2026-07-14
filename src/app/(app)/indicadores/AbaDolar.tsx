"use client";

import { useMemo, useState } from "react";
import { calcularMediaMovel } from "@/lib/indicadores/selic-estatisticas";
import { calcularVariacaoPct, type PontoDolar } from "@/lib/indicadores/dolar-estatisticas";
import type { DolarView } from "@/lib/indicadores/actions";

const formatarData = (iso: string) => {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

const formatarPct = (v: number | null, comSinal = true) => {
  if (v === null) return "—";
  const sinal = comSinal && v > 0 ? "+" : "";
  return `${sinal}${v.toFixed(2)}%`;
};

const TENDENCIA_LABEL: Record<string, string> = {
  alta: "Alta",
  baixa: "Baixa",
  lateral: "Lateral",
};

function interpretarCorrelacao(r: number | null): string {
  if (r === null) return "sem amostra suficiente";
  const abs = Math.abs(r);
  const forca = abs >= 0.7 ? "forte" : abs >= 0.3 ? "moderada" : "fraca";
  const direcao = r >= 0 ? "positiva" : "negativa";
  return `${forca} e ${direcao}`;
}

export default function AbaDolar({ dolar, onAtualizar }: { dolar: DolarView; onAtualizar: () => Promise<void> }) {
  return (
    <div className="space-y-4">
      <BlocoCards dolar={dolar} onAtualizar={onAtualizar} />
      <BlocoInsights insights={dolar.insights} />
      <BlocoGrafico dolar={dolar} />
      <BlocoRelacoesMacro dolar={dolar} />
      <BlocoHistorico dolar={dolar} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloco 1 — Cards (Cotação e Histórico / Tendência e Estatísticas / Volatilidade)
// ---------------------------------------------------------------------------

function BlocoCards({ dolar, onAtualizar }: { dolar: DolarView; onAtualizar: () => Promise<void> }) {
  const [atualizando, setAtualizando] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-faint">
          Somente leitura — cotação diária vinda automaticamente da PTAX do Bacen (ver Configurações não se
          aplica aqui: sem cadastro manual pro Dólar).
        </p>
        <button
          onClick={async () => {
            setAtualizando(true);
            await onAtualizar();
            setAtualizando(false);
          }}
          className="text-xs text-accent hover:underline whitespace-nowrap"
        >
          {atualizando ? "Atualizando..." : "Atualizar agora"}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="card p-3">
          <p className="text-xs text-faint">Cotação atual</p>
          <p className="text-lg font-medium text-ink">{dolar.ultimo ? `R$ ${dolar.ultimo.cotacao.toFixed(4)}` : "—"}</p>
          <p className="text-xs text-faint">{dolar.ultimo ? formatarData(dolar.ultimo.data) : "Sem dado"}</p>
        </div>

        <div className="card p-3">
          <p className="text-xs text-faint">Variação diária</p>
          <p className="text-lg font-medium text-ink">{formatarPct(dolar.variacaoDiaria)}</p>
        </div>

        <div className="card p-3">
          <p className="text-xs text-faint">Variação mensal</p>
          <p className="text-lg font-medium text-ink">{formatarPct(dolar.variacaoMensal)}</p>
        </div>

        <div className="card p-3">
          <p className="text-xs text-faint">Variação anual</p>
          <p className="text-lg font-medium text-ink">{formatarPct(dolar.variacaoAnual)}</p>
        </div>

        <div className="card p-3">
          <p className="text-xs text-faint">Tendência</p>
          <p className="text-lg font-medium text-ink">{dolar.tendencia ? TENDENCIA_LABEL[dolar.tendencia] : "—"}</p>
          <p className="text-xs text-faint">Média móvel de 20 × 200 dias</p>
        </div>

        <div className="card p-3">
          <p className="text-xs text-faint">Máxima histórica</p>
          <p className="text-lg font-medium text-ink">
            {dolar.maximoHistorico ? `R$ ${dolar.maximoHistorico.valor.toFixed(4)}` : "—"}
          </p>
          <p className="text-xs text-faint">
            {dolar.maximoHistorico ? formatarData(dolar.maximoHistorico.data) : "—"}
            {dolar.distanciaMaximaPct !== null && ` — ${formatarPct(dolar.distanciaMaximaPct, false)} da cotação atual`}
          </p>
        </div>

        <div className="card p-3">
          <p className="text-xs text-faint">Mínima histórica</p>
          <p className="text-lg font-medium text-ink">
            {dolar.minimoHistorico ? `R$ ${dolar.minimoHistorico.valor.toFixed(4)}` : "—"}
          </p>
          <p className="text-xs text-faint">
            {dolar.minimoHistorico ? formatarData(dolar.minimoHistorico.data) : "—"}
            {dolar.distanciaMinimaPct !== null && ` — ${formatarPct(dolar.distanciaMinimaPct, true)} da cotação atual`}
          </p>
        </div>

        <div className="card p-3">
          <p className="text-xs text-faint">Máxima (12 meses)</p>
          <p className="text-lg font-medium text-ink">{dolar.maximo12m ? `R$ ${dolar.maximo12m.valor.toFixed(4)}` : "—"}</p>
          <p className="text-xs text-faint">{dolar.maximo12m ? formatarData(dolar.maximo12m.data) : "—"}</p>
        </div>

        <div className="card p-3">
          <p className="text-xs text-faint">Mínima (12 meses)</p>
          <p className="text-lg font-medium text-ink">{dolar.minimo12m ? `R$ ${dolar.minimo12m.valor.toFixed(4)}` : "—"}</p>
          <p className="text-xs text-faint">{dolar.minimo12m ? formatarData(dolar.minimo12m.data) : "—"}</p>
        </div>

        <div className="card p-3">
          <p className="text-xs text-faint">Média histórica</p>
          <p className="text-lg font-medium text-ink">{dolar.mediaHistorica !== null ? `R$ ${dolar.mediaHistorica.toFixed(4)}` : "—"}</p>
          <p className="text-xs text-faint">
            {dolar.distanciaMediaPct !== null && `${formatarPct(dolar.distanciaMediaPct)} vs. cotação atual`}
          </p>
        </div>

        <div className="card p-3">
          <p className="text-xs text-faint">Volatilidade (30 dias)</p>
          <p className="text-lg font-medium text-ink">{dolar.volatilidadeAtual !== null ? `${dolar.volatilidadeAtual.toFixed(2)}%` : "—"}</p>
          <p className="text-xs text-faint">Desvio padrão da variação diária</p>
        </div>

        <div className="card p-3">
          <p className="text-xs text-faint">Volatilidade histórica</p>
          <p className="text-lg font-medium text-ink">
            {dolar.volatilidadeHistorica !== null ? `${dolar.volatilidadeHistorica.toFixed(2)}%` : "—"}
          </p>
          <p className="text-xs text-faint">Desde o início do histórico carregado</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leituras automáticas
// ---------------------------------------------------------------------------

function BlocoInsights({ insights }: { insights: string[] }) {
  if (insights.length === 0) return null;
  return (
    <div className="card p-4">
      <p className="text-xs text-faint mb-2">Leituras automáticas</p>
      <ul className="text-sm text-ink space-y-1 list-disc list-inside">
        {insights.map((texto, idx) => (
          <li key={idx}>{texto}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloco 2 — Gráfico (linha + médias móveis opcionais)
// ---------------------------------------------------------------------------

type PeriodoFiltro = "30d" | "90d" | "1a" | "5a" | "10a" | "todos";

const PERIODOS_DIAS: Record<Exclude<PeriodoFiltro, "todos">, number> = {
  "30d": 30,
  "90d": 90,
  "1a": 365,
  "5a": 365 * 5,
  "10a": 365 * 10,
};

const CORES_MM: Record<number, string> = {
  5: "#3b82f6",
  20: "#f59e0b",
  50: "#ec4899",
  100: "#8b5cf6",
  200: "#10b981",
};

function BlocoGrafico({ dolar }: { dolar: DolarView }) {
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("1a");
  const [mmSelecionadas, setMmSelecionadas] = useState<Set<number>>(new Set([20, 200]));

  const pontosAsc = useMemo(() => [...dolar.pontos].reverse(), [dolar.pontos]);

  const filtrados = useMemo(() => {
    if (periodo === "todos") return pontosAsc;
    const dias = PERIODOS_DIAS[periodo];
    return pontosAsc.slice(-dias);
  }, [pontosAsc, periodo]);

  // Médias móveis calculadas sobre a série completa (pra não distorcer o início da janela filtrada), depois recortadas.
  const mediasCompletas = useMemo(() => {
    const cotacoes = pontosAsc.map((p) => p.cotacao);
    const resultado: Record<number, (number | null)[]> = {};
    for (const periodoMm of [5, 20, 50, 100, 200]) {
      if (mmSelecionadas.has(periodoMm)) resultado[periodoMm] = calcularMediaMovel(cotacoes, periodoMm);
    }
    return resultado;
  }, [pontosAsc, mmSelecionadas]);

  const offset = pontosAsc.length - filtrados.length;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-faint">Evolução USD/BRL</p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as PeriodoFiltro)} className="input w-auto text-xs">
          <option value="30d">Últimos 30 dias</option>
          <option value="90d">Últimos 90 dias</option>
          <option value="1a">Último ano</option>
          <option value="5a">Últimos 5 anos</option>
          <option value="10a">Últimos 10 anos</option>
          <option value="todos">Todo histórico</option>
        </select>

        {[5, 20, 50, 100, 200].map((p) => (
          <label key={p} className="flex items-center gap-1 text-xs text-muted">
            <input
              type="checkbox"
              checked={mmSelecionadas.has(p)}
              onChange={() =>
                setMmSelecionadas((prev) => {
                  const novo = new Set(prev);
                  if (novo.has(p)) novo.delete(p);
                  else novo.add(p);
                  return novo;
                })
              }
            />
            MM{p}
          </label>
        ))}
      </div>

      {filtrados.length < 2 ? (
        <p className="text-sm text-faint">Poucos pontos para desenhar o gráfico com esse filtro (mínimo 2).</p>
      ) : (
        <GraficoDolarSvg pontos={filtrados} mediasCompletas={mediasCompletas} offset={offset} />
      )}
    </div>
  );
}

function GraficoDolarSvg({
  pontos,
  mediasCompletas,
  offset,
}: {
  pontos: PontoDolar[];
  mediasCompletas: Record<number, (number | null)[]>;
  offset: number;
}) {
  const W = 900;
  const H = 280;
  const padL = 52;
  const padR = 12;
  const padT = 14;
  const padB = 26;

  const series = Object.entries(mediasCompletas).map(([periodo, valores]) => ({
    periodo: Number(periodo),
    valores: valores.slice(offset, offset + pontos.length),
  }));

  const todosValores = [
    ...pontos.map((p) => p.cotacao),
    ...series.flatMap((s) => s.valores).filter((v): v is number => v !== null),
  ];

  const minV = Math.min(...todosValores);
  const maxV = Math.max(...todosValores);
  const padding = Math.max(0.01, (maxV - minV) * 0.1);
  const yMin = minV - padding;
  const yMax = maxV + padding;
  const rangeV = Math.max(0.0001, yMax - yMin);

  const n = pontos.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => H - padB - ((v - yMin) / rangeV) * (H - padT - padB);

  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const xTicksIdx = n <= 4 ? pontos.map((_, i) => i) : [0, Math.floor(n / 2), n - 1];

  let dLinha = "";
  pontos.forEach((p, i) => {
    dLinha += `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.cotacao).toFixed(1)} `;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Gráfico de evolução do dólar">
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={1} />
          <text x={4} y={y(t) + 3} fontSize={9} fill="var(--color-faint)">
            R$ {t.toFixed(2)}
          </text>
        </g>
      ))}

      {xTicksIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 6} fontSize={9} fill="var(--color-faint)" textAnchor="middle">
          {formatarData(pontos[i].data)}
        </text>
      ))}

      <path d={dLinha} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} />

      {series.map((s) => {
        let d = "";
        let comecou = false;
        s.valores.forEach((v, i) => {
          if (v === null) {
            comecou = false;
            return;
          }
          d += `${comecou ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
          comecou = true;
        });
        return d ? (
          <path key={s.periodo} d={d} fill="none" stroke={CORES_MM[s.periodo]} strokeWidth={1.5} strokeDasharray="4 2" />
        ) : null;
      })}

      {series.length > 0 && (
        <g>
          <g transform={`translate(${padL}, ${padT})`}>
            <rect width={8} height={8} fill="var(--color-accent)" />
            <text x={12} y={8} fontSize={9} fill="var(--color-muted)">
              USD/BRL
            </text>
          </g>
          {series.map((s, i) => (
            <g key={s.periodo} transform={`translate(${padL + 90 + i * 70}, ${padT})`}>
              <rect width={8} height={8} fill={CORES_MM[s.periodo]} />
              <text x={12} y={8} fontSize={9} fill="var(--color-muted)">
                MM{s.periodo}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Bloco 3 — Relações Macroeconômicas (Dólar × Selic, Dólar × IPCA)
// ---------------------------------------------------------------------------

function BlocoRelacoesMacro({ dolar }: { dolar: DolarView }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-faint mb-1">Relações macroeconômicas</p>
      <p className="text-sm text-muted mb-4">
        Correlação de Pearson entre a variação mensal do Dólar e (a) a variação mensal do IPCA geral, (b) a
        Selic vigente no fechamento de cada mês. Amostra mínima de 3 meses pareados — quanto mais histórico
        carregado, mais robusto o número.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-md bg-surface-2 border border-border px-4 py-3">
          <p className="text-xs text-faint">Dólar × Selic</p>
          <p className="text-lg font-medium text-ink">{dolar.correlacaoSelic !== null ? dolar.correlacaoSelic.toFixed(2) : "—"}</p>
          <p className="text-xs text-faint">Correlação {interpretarCorrelacao(dolar.correlacaoSelic)}</p>
        </div>
        <div className="rounded-md bg-surface-2 border border-border px-4 py-3">
          <p className="text-xs text-faint">Dólar × IPCA</p>
          <p className="text-lg font-medium text-ink">{dolar.correlacaoIpca !== null ? dolar.correlacaoIpca.toFixed(2) : "—"}</p>
          <p className="text-xs text-faint">Correlação {interpretarCorrelacao(dolar.correlacaoIpca)}</p>
        </div>
      </div>
      <p className="text-xs text-faint mt-3">
        Dólar × CDI fica para quando o CDI existir como indicador no app (ver docs/MAPA-DE-DADOS.md §8.9).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloco 4 — Histórico (somente leitura: busca, filtro de período, exportar CSV)
// ---------------------------------------------------------------------------

function BlocoHistorico({ dolar }: { dolar: DolarView }) {
  const [busca, setBusca] = useState("");
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("90d");

  const filtrados = useMemo(() => {
    let lista = dolar.pontos; // já vem mais recente primeiro
    if (periodo !== "todos") {
      const dias = PERIODOS_DIAS[periodo];
      lista = lista.slice(0, dias);
    }
    if (busca.trim()) lista = lista.filter((p) => p.data.includes(busca));
    return lista;
  }, [dolar.pontos, periodo, busca]);

  const exportarCsv = () => {
    const cabecalho = "data,cotacao";
    const linhas = dolar.pontos.map((p) => `${p.data},${p.cotacao}`);
    const conteudo = [cabecalho, ...linhas].join("\n");
    const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dolar-historico.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border flex-wrap">
        <p className="text-xs text-faint">Histórico diário</p>
        <div className="flex items-center gap-2">
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value as PeriodoFiltro)} className="input w-auto text-xs">
            <option value="30d">Últimos 30 dias</option>
            <option value="90d">Últimos 90 dias</option>
            <option value="1a">Último ano</option>
            <option value="5a">Últimos 5 anos</option>
            <option value="10a">Últimos 10 anos</option>
            <option value="todos">Todo histórico</option>
          </select>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por AAAA-MM-DD"
            className="input w-44 text-xs"
          />
          <button onClick={exportarCsv} className="text-xs text-accent hover:underline whitespace-nowrap">
            Exportar CSV (histórico completo)
          </button>
        </div>
      </div>

      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface">
            <tr className="text-faint border-b border-border">
              <th className="px-4 py-2 text-left">Data</th>
              <th className="px-4 py-2 text-right">Cotação</th>
              <th className="px-4 py-2 text-right">Variação diária</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-4 text-faint">
                  Nenhum dia encontrado com esse filtro.
                </td>
              </tr>
            )}
            {filtrados.map((p, i) => {
              // filtrados está em ordem desc (mais recente primeiro) — o dia anterior é o próximo índice.
              const anterior = filtrados[i + 1] ?? null;
              const variacao = anterior ? calcularVariacaoPct(p.cotacao, anterior.cotacao) : null;
              return (
                <tr key={p.data} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 text-ink whitespace-nowrap">{formatarData(p.data)}</td>
                  <td className="px-4 py-2 text-right text-ink">R$ {p.cotacao.toFixed(4)}</td>
                  <td className="px-4 py-2 text-right text-muted">{formatarPct(variacao)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
