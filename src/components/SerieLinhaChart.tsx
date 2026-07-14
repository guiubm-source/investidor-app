/**
 * Gráfico de linha genérico (SVG puro, sem dependência externa) — mesmo
 * padrão visual dos gráficos de Indicadores (ver GraficoDolarSvg em
 * src/app/(app)/indicadores/AbaDolar.tsx), extraído aqui pra ser reaproveitado
 * por qualquer série histórica simples (rentabilidade de ativo, evolução de
 * patrimônio, etc.) sem duplicar a lógica de escala/eixos. Ver
 * docs/MAPA-DE-DADOS.md §8.12.
 */
export type PontoSerie = { data: string; valor: number };

function formatarDataCurta(iso: string) {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano.slice(2)}`;
}

export default function SerieLinhaChart({
  pontos,
  corLinha = "var(--color-accent)",
  formatarValor = (v: number) => v.toFixed(2),
  ariaLabel = "Gráfico de série histórica",
  mostrarLinhaZero = false,
}: {
  pontos: PontoSerie[];
  corLinha?: string;
  formatarValor?: (v: number) => string;
  ariaLabel?: string;
  mostrarLinhaZero?: boolean;
}) {
  const W = 900;
  const H = 260;
  const padL = 60;
  const padR = 12;
  const padT = 14;
  const padB = 26;

  if (pontos.length < 2) {
    return <p className="text-sm text-faint">Poucos pontos para desenhar o gráfico (mínimo 2).</p>;
  }

  const valores = pontos.map((p) => p.valor);
  const minV = Math.min(...valores);
  const maxV = Math.max(...valores);
  const padding = Math.max(0.01, (maxV - minV) * 0.1);
  const yMin = mostrarLinhaZero ? Math.min(0, minV - padding) : minV - padding;
  const yMax = mostrarLinhaZero ? Math.max(0, maxV + padding) : maxV + padding;
  const rangeV = Math.max(0.0001, yMax - yMin);

  const n = pontos.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => H - padB - ((v - yMin) / rangeV) * (H - padT - padB);

  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const xTicksIdx = n <= 4 ? pontos.map((_, i) => i) : [0, Math.floor(n / 2), n - 1];

  let d = "";
  pontos.forEach((p, i) => {
    d += `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.valor).toFixed(1)} `;
  });

  const linhaZeroVisivel = mostrarLinhaZero && yMin < 0 && yMax > 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={ariaLabel}>
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={1} />
          <text x={4} y={y(t) + 3} fontSize={9} fill="var(--color-faint)">
            {formatarValor(t)}
          </text>
        </g>
      ))}

      {linhaZeroVisivel && (
        <line
          x1={padL}
          x2={W - padR}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--color-border-strong)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}

      {xTicksIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 6} fontSize={9} fill="var(--color-faint)" textAnchor="middle">
          {formatarDataCurta(pontos[i].data)}
        </text>
      ))}

      <path d={d} fill="none" stroke={corLinha} strokeWidth={1.5} />
    </svg>
  );
}
