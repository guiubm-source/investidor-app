"use client";

import { Fragment, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import {
  CATEGORIAS_IPCA,
  ipcaCompetenciaSchema,
  importarIpcaSchema,
  type ImportarIpcaForm,
  type IpcaCompetenciaForm,
} from "@/lib/indicadores/schema";
import {
  criarIpcaCompetencia,
  editarIpcaCompetencia,
  excluirIpcaCompetencia,
  excluirIpcaCompetencias,
  importarHistoricoIpca,
  type IpcaCompetencia,
  type IpcaView,
} from "@/lib/indicadores/actions";
import type { MetaInflacao } from "@/lib/referencia/actions";
import { encontrarMetaVigente, GRUPOS_IPCA, type GrupoIpca } from "@/lib/indicadores/ipca-estatisticas";
import { calcularMediaMovel } from "@/lib/indicadores/selic-estatisticas";
import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/components/ToastProvider";

const formatarData = (iso: string) => {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

const formatarCompetencia = (anoMes: string) => {
  const [ano, mes] = anoMes.split("-");
  return `${mes}/${ano}`;
};

function labelGrupo(grupo: GrupoIpca): string {
  return CATEGORIAS_IPCA.find((c) => c.valor === grupo)?.label ?? grupo;
}

const ABREV_GRUPO: Record<GrupoIpca, string> = {
  alimentacao_bebidas: "Alim.",
  habitacao: "Habit.",
  artigos_residencia: "Art.Res.",
  vestuario: "Vest.",
  transportes: "Transp.",
  saude_cuidados_pessoais: "Saúde",
  despesas_pessoais: "Desp.Pes.",
  educacao: "Educ.",
  comunicacao: "Comun.",
};
function labelGrupoAbreviado(grupo: GrupoIpca): string {
  return ABREV_GRUPO[grupo] ?? grupo;
}

const SITUACAO_LABEL: Record<string, string> = {
  abaixo: "Abaixo da meta",
  dentro: "Dentro da meta",
  acima: "Acima da meta",
};

const TENDENCIA_LABEL: Record<string, string> = {
  acelerando: "Acelerando ⬆",
  desacelerando: "Desacelerando ⬇",
  estavel: "Estável ➡",
};

export default function AbaIpca({ ipca, onAtualizar }: { ipca: IpcaView; onAtualizar: () => Promise<void> }) {
  return (
    <div className="space-y-4">
      <BlocoCards ipca={ipca} />
      <div className="card">
        <StatsResumoIpca ipca={ipca} />
      </div>
      <BlocoInsights insights={ipca.insights} />
      <BlocoGrafico ipca={ipca} />
      <BlocoHistorico ipca={ipca} onAtualizar={onAtualizar} />
      <BlocoImportacao onAtualizar={onAtualizar} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloco 1 — Cards resumo
// ---------------------------------------------------------------------------

function BlocoCards({ ipca }: { ipca: IpcaView }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <div className="card p-3">
        <p className="text-xs text-faint">IPCA do mês</p>
        <p className="text-lg font-medium text-ink">
          {ipca.ultimaCompetencia?.geral != null ? `${ipca.ultimaCompetencia.geral.toFixed(2)}%` : "—"}
        </p>
        <p className="text-xs text-faint">
          {ipca.ultimaCompetencia ? formatarCompetencia(ipca.ultimaCompetencia.anoMes) : "Sem lançamento"}
        </p>
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Acumulado no ano</p>
        <p className="text-lg font-medium text-ink">
          {ipca.acumuladoAno.valor != null ? `${ipca.acumuladoAno.valor.toFixed(2)}%` : "—"}
        </p>
        <p className="text-xs text-faint">{ipca.acumuladoAno.meses} mês(es) considerados</p>
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Acumulado 12 meses</p>
        <p className="text-lg font-medium text-ink">
          {ipca.acumulado12m.valor != null ? `${ipca.acumulado12m.valor.toFixed(2)}%` : "—"}
        </p>
        <p className="text-xs text-faint">
          {ipca.acumulado12m.completo ? "12 meses completos" : `${ipca.acumulado12m.meses} mês(es) disponíveis`}
        </p>
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Situação da meta</p>
        {ipca.metaVigente ? (
          <>
            <p className="text-lg font-medium text-ink">
              {ipca.situacaoBanda ? SITUACAO_LABEL[ipca.situacaoBanda] : "—"}
            </p>
            <p className="text-xs text-faint">
              Meta {ipca.metaVigente.metaCentral.toFixed(2)}% ({ipca.metaVigente.bandaInferior.toFixed(2)}%–
              {ipca.metaVigente.bandaSuperior.toFixed(2)}%)
            </p>
          </>
        ) : (
          <p className="text-sm text-faint">Nenhuma meta cadastrada</p>
        )}
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Distância da meta</p>
        <p className="text-lg font-medium text-ink">
          {ipca.distanciaMeta != null
            ? `${ipca.distanciaMeta > 0 ? "+" : ""}${ipca.distanciaMeta.toFixed(2)} p.p.`
            : "—"}
        </p>
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Tendência inflacionária</p>
        <p className="text-lg font-medium text-ink">{ipca.tendencia ? TENDENCIA_LABEL[ipca.tendencia] : "—"}</p>
        <p className="text-xs text-faint">Média móvel 3m × 6m</p>
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Maior pressão no mês</p>
        <p className="text-sm text-ink">
          {ipca.maiorPressao ? `${labelGrupo(ipca.maiorPressao.grupo)} (${ipca.maiorPressao.variacao.toFixed(2)}%)` : "—"}
        </p>
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Menor pressão no mês</p>
        <p className="text-sm text-ink">
          {ipca.menorPressao ? `${labelGrupo(ipca.menorPressao.grupo)} (${ipca.menorPressao.variacao.toFixed(2)}%)` : "—"}
        </p>
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Maior impacto no IPCA</p>
        <p className="text-sm text-ink">
          {ipca.maiorImpacto ? `${labelGrupo(ipca.maiorImpacto.grupo)} (${ipca.maiorImpacto.impacto.toFixed(2)} p.p.)` : "—"}
        </p>
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Maior impacto negativo</p>
        <p className="text-sm text-ink">
          {ipca.maiorImpactoNegativo && ipca.maiorImpactoNegativo.impacto < 0
            ? `${labelGrupo(ipca.maiorImpactoNegativo.grupo)} (${ipca.maiorImpactoNegativo.impacto.toFixed(2)} p.p.)`
            : "—"}
        </p>
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Grupo mais volátil</p>
        <p className="text-sm text-ink">
          {ipca.grupoMaisVolatil
            ? `${labelGrupo(ipca.grupoMaisVolatil.grupo)} (dp ${ipca.grupoMaisVolatil.desvioPadrao.toFixed(2)})`
            : "—"}
        </p>
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Grupo mais estável</p>
        <p className="text-sm text-ink">
          {ipca.grupoMaisEstavel
            ? `${labelGrupo(ipca.grupoMaisEstavel.grupo)} (dp ${ipca.grupoMaisEstavel.desvioPadrao.toFixed(2)})`
            : "—"}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leituras automáticas (insights gerados em lib/indicadores/actions.ts)
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
// Bloco 2 — Gráfico de evolução (Recharts — ver docs/MAPA-DE-DADOS.md §8.7/§8.8)
// + Heatmap dos 9 grupos × competências.
// ---------------------------------------------------------------------------

type PeriodoFiltro = "todos" | "12m" | "24m" | "5a" | "10a" | "personalizado";
type TipoGrafico = "linha" | "area" | "coluna";
type ModoVisualizacao = "geral" | "grupo" | "grupos";

function BlocoGrafico({ ipca }: { ipca: IpcaView }) {
  const [visao, setVisao] = useState<"grafico" | "heatmap">("grafico");
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("todos");
  const [personalizadoInicio, setPersonalizadoInicio] = useState("");
  const [personalizadoFim, setPersonalizadoFim] = useState("");
  const [modo, setModo] = useState<ModoVisualizacao>("geral");
  const [grupoSelecionado, setGrupoSelecionado] = useState<GrupoIpca>(GRUPOS_IPCA[0]);
  const [gruposSelecionados, setGruposSelecionados] = useState<Set<GrupoIpca>>(new Set([GRUPOS_IPCA[0]]));
  const [tipo, setTipo] = useState<TipoGrafico>("linha");
  const [mediaMovelAtiva, setMediaMovelAtiva] = useState(false);
  const [mediaMovelPeriodo, setMediaMovelPeriodo] = useState(3);
  const [mostrarMeta, setMostrarMeta] = useState(false);

  const competenciasAsc = useMemo(() => [...ipca.competencias].reverse(), [ipca.competencias]);

  const filtradas = useMemo(() => {
    let lista = competenciasAsc;
    const hoje = new Date().toISOString().slice(0, 7);
    if (periodo !== "todos" && periodo !== "personalizado") {
      const meses = periodo === "12m" ? 12 : periodo === "24m" ? 24 : periodo === "5a" ? 60 : 120;
      const limite = new Date();
      limite.setMonth(limite.getMonth() - meses);
      const limiteAnoMes = limite.toISOString().slice(0, 7);
      lista = lista.filter((c) => c.anoMes >= limiteAnoMes && c.anoMes <= hoje);
    } else if (periodo === "personalizado" && personalizadoInicio && personalizadoFim) {
      lista = lista.filter((c) => c.anoMes >= personalizadoInicio && c.anoMes <= personalizadoFim);
    }
    return lista;
  }, [competenciasAsc, periodo, personalizadoInicio, personalizadoFim]);

  const mediaMovel = useMemo(() => {
    if (!mediaMovelAtiva || modo !== "geral") return null;
    return calcularMediaMovel(filtradas.map((c) => c.geral), mediaMovelPeriodo);
  }, [filtradas, mediaMovelAtiva, mediaMovelPeriodo, modo]);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-faint">Evolução histórica</p>
        <div className="flex gap-1">
          <button
            onClick={() => setVisao("grafico")}
            className={`text-xs px-2 py-1 rounded ${visao === "grafico" ? "bg-accent text-white" : "text-muted"}`}
          >
            Gráfico
          </button>
          <button
            onClick={() => setVisao("heatmap")}
            className={`text-xs px-2 py-1 rounded ${visao === "heatmap" ? "bg-accent text-white" : "text-muted"}`}
          >
            Heatmap
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as PeriodoFiltro)} className="input w-auto text-xs">
          <option value="todos">Todo histórico</option>
          <option value="12m">Últimos 12 meses</option>
          <option value="24m">Últimos 24 meses</option>
          <option value="5a">5 anos</option>
          <option value="10a">10 anos</option>
          <option value="personalizado">Personalizado</option>
        </select>

        {periodo === "personalizado" && (
          <>
            <input
              type="month"
              value={personalizadoInicio}
              onChange={(e) => setPersonalizadoInicio(e.target.value)}
              className="input w-auto text-xs"
            />
            <input
              type="month"
              value={personalizadoFim}
              onChange={(e) => setPersonalizadoFim(e.target.value)}
              className="input w-auto text-xs"
            />
          </>
        )}

        {visao === "grafico" && (
          <>
            <select value={modo} onChange={(e) => setModo(e.target.value as ModoVisualizacao)} className="input w-auto text-xs">
              <option value="geral">Índice geral</option>
              <option value="grupo">Um grupo</option>
              <option value="grupos">Vários grupos</option>
            </select>

            {modo === "grupo" && (
              <select
                value={grupoSelecionado}
                onChange={(e) => setGrupoSelecionado(e.target.value as GrupoIpca)}
                className="input w-auto text-xs"
              >
                {GRUPOS_IPCA.map((g) => (
                  <option key={g} value={g}>
                    {labelGrupo(g)}
                  </option>
                ))}
              </select>
            )}

            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoGrafico)} className="input w-auto text-xs">
              <option value="linha">Linha</option>
              <option value="area">Área</option>
              <option value="coluna">Coluna</option>
            </select>

            {modo === "geral" && (
              <>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" checked={mediaMovelAtiva} onChange={(e) => setMediaMovelAtiva(e.target.checked)} />
                  Média móvel
                </label>
                {mediaMovelAtiva && (
                  <select
                    value={mediaMovelPeriodo}
                    onChange={(e) => setMediaMovelPeriodo(Number(e.target.value))}
                    className="input w-auto text-xs"
                  >
                    <option value={3}>3 meses</option>
                    <option value={6}>6 meses</option>
                    <option value={12}>12 meses</option>
                  </select>
                )}
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" checked={mostrarMeta} onChange={(e) => setMostrarMeta(e.target.checked)} />
                  Meta / faixa
                </label>
              </>
            )}
          </>
        )}
      </div>

      {modo === "grupos" && visao === "grafico" && (
        <div className="flex flex-wrap gap-2 mb-3">
          {GRUPOS_IPCA.map((g) => (
            <label key={g} className="flex items-center gap-1 text-xs text-muted">
              <input
                type="checkbox"
                checked={gruposSelecionados.has(g)}
                onChange={() =>
                  setGruposSelecionados((prev) => {
                    const novo = new Set(prev);
                    if (novo.has(g)) novo.delete(g);
                    else novo.add(g);
                    return novo;
                  })
                }
              />
              {labelGrupo(g)}
            </label>
          ))}
        </div>
      )}

      {visao === "heatmap" ? (
        filtradas.length === 0 ? (
          <p className="text-sm text-faint">Sem dados para esse período.</p>
        ) : (
          <Heatmap competencias={filtradas} />
        )
      ) : filtradas.length < 2 ? (
        <p className="text-sm text-faint">Poucos pontos para desenhar o gráfico com esse filtro (mínimo 2).</p>
      ) : (
        <GraficoIpcaRecharts
          competencias={filtradas}
          modo={modo}
          grupo={grupoSelecionado}
          grupos={gruposSelecionados}
          tipo={tipo}
          mediaMovel={mediaMovel}
          metas={mostrarMeta ? ipca.metas : null}
        />
      )}
    </div>
  );
}

const CORES_GRUPOS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f97316",
];

/**
 * Agrupa as competências em segmentos onde a meta vigente é a MESMA
 * (identificada por `id`), formando os "degraus" da banda — decisão
 * 2026-07-15: a banda reflete a meta que valia em cada época, não só a
 * meta de hoje. `encontrarMetaVigente` já existe em ipca-estatisticas.ts
 * (mesma lógica usada no servidor em obterIpca()).
 */
function segmentosMetaPorCompetencia(
  competencias: IpcaCompetencia[],
  metas: MetaInflacao[]
): { anoMesInicio: string; anoMesFim: string; bandaInferior: number; bandaSuperior: number; metaCentral: number }[] {
  const segmentos: { id: string; anoMesInicio: string; anoMesFim: string; bandaInferior: number; bandaSuperior: number; metaCentral: number }[] = [];

  for (const c of competencias) {
    const vigente = encontrarMetaVigente(metas, c.anoMes) as MetaInflacao | null;
    if (!vigente) continue;
    const ultimo = segmentos[segmentos.length - 1];
    if (ultimo && ultimo.id === vigente.id) {
      ultimo.anoMesFim = c.anoMes;
    } else {
      segmentos.push({
        id: vigente.id,
        anoMesInicio: c.anoMes,
        anoMesFim: c.anoMes,
        bandaInferior: vigente.bandaInferior,
        bandaSuperior: vigente.bandaSuperior,
        metaCentral: vigente.metaCentral,
      });
    }
  }

  return segmentos;
}

function TooltipIpca({
  active,
  payload,
  label,
  series,
}: TooltipProps<number, string> & { series: { key: string; label: string; cor: string }[] }) {
  if (!active || !payload || payload.length === 0 || typeof label !== "string") return null;
  return (
    <div className="rounded-md border border-border-strong bg-surface-2 px-3 py-2 shadow-sm">
      <p className="text-xs text-ink mb-1">{formatarCompetencia(label)}</p>
      {series.map((s) => {
        const v = payload.find((p) => p.dataKey === s.key)?.value as number | undefined;
        if (v == null) return null;
        return (
          <p key={s.key} className="text-xs" style={{ color: s.cor }}>
            {s.label}: {v.toFixed(2)}%
          </p>
        );
      })}
      {(() => {
        const mm = payload.find((p) => p.dataKey === "mediaMovel")?.value as number | undefined;
        return mm != null ? <p className="text-xs text-muted">Média móvel: {mm.toFixed(2)}%</p> : null;
      })()}
      {(() => {
        const meta = payload.find((p) => p.dataKey === "metaCentral")?.value as number | undefined;
        return meta != null ? <p className="text-xs text-faint">Meta central: {meta.toFixed(2)}%</p> : null;
      })()}
    </div>
  );
}

function GraficoIpcaRecharts({
  competencias,
  modo,
  grupo,
  grupos,
  tipo,
  mediaMovel,
  metas,
}: {
  competencias: IpcaCompetencia[];
  modo: ModoVisualizacao;
  grupo: GrupoIpca;
  grupos: Set<GrupoIpca>;
  tipo: TipoGrafico;
  mediaMovel: (number | null)[] | null;
  metas: IpcaView["metas"] | null;
}) {
  type Serie = { key: string; label: string; cor: string };
  const series: Serie[] = useMemo(() => {
    if (modo === "geral") {
      return [{ key: "geral", label: "IPCA geral", cor: "var(--color-accent)" }];
    }
    if (modo === "grupo") {
      return [{ key: "valor", label: labelGrupo(grupo), cor: "var(--color-accent)" }];
    }
    const lista = GRUPOS_IPCA.filter((g) => grupos.has(g));
    return lista.map((g, i) => ({ key: g, label: labelGrupo(g), cor: CORES_GRUPOS[i % CORES_GRUPOS.length] }));
  }, [modo, grupo, grupos]);

  const dados = useMemo(() => {
    return competencias.map((c, i) => {
      const linha: Record<string, number | string | null> = { anoMes: c.anoMes };
      if (modo === "geral") linha.geral = c.geral;
      else if (modo === "grupo") linha.valor = c.grupos[grupo];
      else for (const g of GRUPOS_IPCA) if (grupos.has(g)) linha[g] = c.grupos[g];
      linha.mediaMovel = mediaMovel ? mediaMovel[i] : null;
      return linha;
    });
  }, [competencias, modo, grupo, grupos, mediaMovel]);

  const segmentosMeta = useMemo(() => {
    if (!metas) return [];
    return segmentosMetaPorCompetencia(competencias, metas);
  }, [competencias, metas]);

  if (series.length === 0) {
    return <p className="text-sm text-faint">Sem dados suficientes para desenhar.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={dados} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="anoMes"
          tickFormatter={formatarCompetencia}
          tick={{ fontSize: 10, fill: "var(--color-faint)" }}
          axisLine={{ stroke: "var(--color-border)" }}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          tickFormatter={(v: number) => `${v.toFixed(1)}%`}
          tick={{ fontSize: 10, fill: "var(--color-faint)" }}
          axisLine={false}
          tickLine={false}
          width={48}
          domain={["auto", "auto"]}
        />
        <RechartsTooltip content={<TooltipIpca series={series} />} cursor={{ stroke: "var(--color-border-strong)", strokeDasharray: "3 3" }} />

        {segmentosMeta.map((s) => (
          <ReferenceArea
            key={`banda-${s.anoMesInicio}`}
            x1={s.anoMesInicio}
            x2={s.anoMesFim}
            y1={s.bandaInferior}
            y2={s.bandaSuperior}
            fill="var(--color-accent)"
            fillOpacity={0.08}
            stroke="none"
            ifOverflow="extendDomain"
          />
        ))}
        {segmentosMeta.map((s) => (
          <ReferenceLine
            key={`centro-${s.anoMesInicio}`}
            segment={[
              { x: s.anoMesInicio, y: s.metaCentral },
              { x: s.anoMesFim, y: s.metaCentral },
            ]}
            stroke="var(--color-muted)"
            strokeDasharray="2 2"
            strokeWidth={1}
            ifOverflow="extendDomain"
          />
        ))}

        {tipo === "coluna" &&
          series.map((s) => <Bar key={s.key} dataKey={s.key} fill={s.cor} fillOpacity={0.75} name={s.label} />)}

        {tipo === "area" &&
          series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.cor}
              strokeWidth={2}
              fill={s.cor}
              fillOpacity={0.15}
              dot={{ r: 2.5, fill: s.cor, strokeWidth: 0 }}
              name={s.label}
              connectNulls
            />
          ))}

        {tipo === "linha" &&
          series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.cor}
              strokeWidth={2}
              dot={{ r: 2.5, fill: s.cor, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              name={s.label}
              connectNulls
            />
          ))}

        {mediaMovel && (
          <Line
            type="monotone"
            dataKey="mediaMovel"
            stroke="var(--color-muted)"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            dot={false}
            connectNulls
            name="Média móvel"
          />
        )}

        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: "var(--color-muted)" }} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function Heatmap({ competencias }: { competencias: IpcaCompetencia[] }) {
  const todosValores = competencias
    .flatMap((c) => GRUPOS_IPCA.map((g) => c.grupos[g]))
    .filter((v): v is number => v !== null);
  const max = todosValores.length ? Math.max(...todosValores.map((v) => Math.abs(v))) : 1;

  const cor = (v: number | null) => {
    if (v === null) return "var(--color-surface-2)";
    const intensidade = Math.min(1, Math.abs(v) / (max || 1));
    if (v >= 0) return `rgba(239, 68, 68, ${0.15 + intensidade * 0.65})`;
    return `rgba(16, 185, 129, ${0.15 + intensidade * 0.65})`;
  };

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse w-full">
        <thead>
          <tr>
            <th className="text-left text-faint pr-2 pb-1 sticky left-0 bg-surface">Grupo</th>
            {competencias.map((c) => (
              <th key={c.id} className="text-faint px-1 pb-1 font-normal whitespace-nowrap">
                {formatarCompetencia(c.anoMes)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GRUPOS_IPCA.map((g) => (
            <tr key={g}>
              <td className="text-ink pr-2 py-0.5 whitespace-nowrap sticky left-0 bg-surface">{labelGrupo(g)}</td>
              {competencias.map((c) => {
                const v = c.grupos[g];
                return (
                  <td
                    key={c.id}
                    className="text-center py-0.5 px-1"
                    style={{ backgroundColor: cor(v) }}
                    title={`${formatarCompetencia(c.anoMes)} — ${labelGrupo(g)}: ${v != null ? v.toFixed(2) + "%" : "—"}`}
                  >
                    {v != null ? v.toFixed(1) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloco 3 — Histórico de competências
// ---------------------------------------------------------------------------

function BlocoHistorico({ ipca, onAtualizar }: { ipca: IpcaView; onAtualizar: () => Promise<void> }) {
  const [busca, setBusca] = useState("");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [editando, setEditando] = useState<string | null>(null);
  const [criandoNova, setCriandoNova] = useState<{ base?: IpcaCompetencia } | null>(null);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const [excluindoLoading, setExcluindoLoading] = useState(false);
  const [confirmandoLote, setConfirmandoLote] = useState(false);
  const [excluindoLote, setExcluindoLote] = useState(false);
  const toast = useToast();

  const filtradas = busca.trim() ? ipca.competencias.filter((c) => c.anoMes.includes(busca)) : ipca.competencias;

  const alternarSelecao = (id: string) => {
    setSelecionados((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  };

  const exportarCsv = () => {
    const cabecalho = ["competencia", "geral", ...GRUPOS_IPCA, "data_divulgacao"].join(",");
    const linhas = filtradas.map((c) =>
      [c.anoMes, c.geral ?? "", ...GRUPOS_IPCA.map((g) => c.grupos[g] ?? ""), c.dataDivulgacao ?? ""].join(",")
    );
    const conteudo = [cabecalho, ...linhas].join("\n");
    const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ipca-historico.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalColunas = 4 + GRUPOS_IPCA.length + 1;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border flex-wrap">
        <p className="text-xs text-faint">Histórico de competências</p>
        <div className="flex items-center gap-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por AAAA-MM"
            className="input w-40 text-xs"
          />
          {selecionados.size > 0 && (
            <button onClick={() => setConfirmandoLote(true)} className="text-xs text-danger hover:underline">
              Excluir selecionados ({selecionados.size})
            </button>
          )}
          <button onClick={exportarCsv} className="text-xs text-muted hover:underline">
            Exportar CSV
          </button>
          <button onClick={() => setCriandoNova({})} className="text-xs text-accent hover:underline">
            + Nova competência
          </button>
        </div>
      </div>

      {confirmandoLote && (
        <ConfirmModal
          title={`Excluir ${selecionados.size} competência(s)?`}
          message="Essa ação não pode ser desfeita."
          loading={excluindoLote}
          onCancel={() => setConfirmandoLote(false)}
          onConfirm={async () => {
            setExcluindoLote(true);
            await excluirIpcaCompetencias(Array.from(selecionados));
            setSelecionados(new Set());
            setConfirmandoLote(false);
            await onAtualizar();
            setExcluindoLote(false);
            toast.success("Competências excluídas.");
          }}
        />
      )}

      {criandoNova && (
        <div className="px-4 py-3 border-b border-border">
          <FormIpcaCompetencia
            inicial={criandoNova.base}
            onSalvar={async (dados) => {
              const resultado = await criarIpcaCompetencia(dados);
              if (resultado.error) throw new Error(resultado.error);
              setCriandoNova(null);
              await onAtualizar();
              toast.success("Competência criada.");
            }}
            onCancelar={() => setCriandoNova(null)}
          />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-faint border-b border-border">
              <th className="px-2 py-2 text-left"></th>
              <th className="px-2 py-2 text-left">Competência</th>
              <th className="px-2 py-2 text-right">Geral</th>
              {GRUPOS_IPCA.map((g) => (
                <th key={g} className="px-2 py-2 text-right whitespace-nowrap" title={labelGrupo(g)}>
                  {labelGrupoAbreviado(g)}
                </th>
              ))}
              <th className="px-2 py-2 text-left">Divulgação</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 && (
              <tr>
                <td colSpan={totalColunas} className="px-4 py-4 text-faint">
                  Nenhuma competência encontrada.
                </td>
              </tr>
            )}
            {filtradas.map((c) => (
              <Fragment key={c.id}>
                <tr className="border-b border-border last:border-0">
                  <td className="px-2 py-2">
                    <input type="checkbox" checked={selecionados.has(c.id)} onChange={() => alternarSelecao(c.id)} />
                  </td>
                  <td className="px-2 py-2 text-ink whitespace-nowrap">{formatarCompetencia(c.anoMes)}</td>
                  <td className="px-2 py-2 text-right text-ink">{c.geral != null ? `${c.geral.toFixed(2)}%` : "—"}</td>
                  {GRUPOS_IPCA.map((g) => (
                    <td key={g} className="px-2 py-2 text-right text-muted">
                      {c.grupos[g] != null ? c.grupos[g]!.toFixed(2) : "—"}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-faint whitespace-nowrap">
                    {c.dataDivulgacao ? formatarData(c.dataDivulgacao) : "—"}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2 justify-end whitespace-nowrap">
                      <button onClick={() => setEditando(editando === c.id ? null : c.id)} className="text-accent hover:underline">
                        Editar
                      </button>
                      <button onClick={() => setCriandoNova({ base: { ...c, id: "" } })} className="text-faint hover:text-ink">
                        Duplicar
                      </button>
                      <button
                        onClick={() => setExcluindoId(c.id)}
                        className="text-faint hover:text-danger"
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
                {editando === c.id && (
                  <tr>
                    <td colSpan={totalColunas} className="px-4 pb-3 pt-1">
                      <FormIpcaCompetencia
                        idExistente={c.id}
                        inicial={c}
                        onSalvar={async (dados) => {
                          const resultado = await editarIpcaCompetencia(c.id, dados);
                          if (resultado.error) throw new Error(resultado.error);
                          setEditando(null);
                          await onAtualizar();
                          toast.success("Competência atualizada.");
                        }}
                        onCancelar={() => setEditando(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {excluindoId && (
        <ConfirmModal
          title="Excluir competência?"
          message="Essa ação não pode ser desfeita."
          loading={excluindoLoading}
          onCancel={() => setExcluindoId(null)}
          onConfirm={async () => {
            setExcluindoLoading(true);
            await excluirIpcaCompetencia(excluindoId);
            setExcluindoLoading(false);
            setExcluindoId(null);
            await onAtualizar();
            toast.success("Competência excluída.");
          }}
        />
      )}

      <div className="border-t border-border">
        <StatsResumoIpca ipca={ipca} />
      </div>
    </div>
  );
}

function FormIpcaCompetencia({
  inicial,
  idExistente,
  onSalvar,
  onCancelar,
}: {
  inicial?: IpcaCompetencia;
  idExistente?: string;
  onSalvar: (dados: IpcaCompetenciaForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(ipcaCompetenciaSchema),
    defaultValues: {
      ano_mes: inicial?.anoMes ?? "",
      geral: inicial?.geral ?? NaN,
      alimentacao_bebidas: inicial?.grupos.alimentacao_bebidas ?? NaN,
      habitacao: inicial?.grupos.habitacao ?? NaN,
      artigos_residencia: inicial?.grupos.artigos_residencia ?? NaN,
      vestuario: inicial?.grupos.vestuario ?? NaN,
      transportes: inicial?.grupos.transportes ?? NaN,
      saude_cuidados_pessoais: inicial?.grupos.saude_cuidados_pessoais ?? NaN,
      despesas_pessoais: inicial?.grupos.despesas_pessoais ?? NaN,
      educacao: inicial?.grupos.educacao ?? NaN,
      comunicacao: inicial?.grupos.comunicacao ?? NaN,
      data_divulgacao: inicial?.dataDivulgacao ?? "",
      observacoes: inicial?.observacoes ?? "",
    },
  });

  const toast = useToast();
  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvar(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    }
  });

  return (
    <form onSubmit={onSubmit} className="rounded-md bg-surface-2 border border-border p-3 space-y-3" key={idExistente}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className="label">Competência (AAAA-MM)</label>
          <input {...register("ano_mes")} placeholder="2026-06" className="input" />
          {errors.ano_mes?.message && <p className="field-error">{errors.ano_mes.message}</p>}
        </div>
        <div>
          <label className="label">Índice geral (%)</label>
          <input type="number" step="0.0001" {...register("geral", { valueAsNumber: true })} className="input" />
          {errors.geral?.message && <p className="field-error">{errors.geral.message}</p>}
        </div>
        <div>
          <label className="label">Data de divulgação</label>
          <input type="date" {...register("data_divulgacao")} className="input" />
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="label">Observações</label>
          <input {...register("observacoes")} className="input" />
        </div>
      </div>

      <div>
        <p className="label mb-1">Grupos (%, opcional)</p>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
          {CATEGORIAS_IPCA.map((c) => (
            <div key={c.valor}>
              <label className="text-xs text-faint">{c.label}</label>
              <input
                type="number"
                step="0.0001"
                {...register(c.valor as keyof IpcaCompetenciaForm, { valueAsNumber: true })}
                className="input"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={onCancelar} className="btn btn-secondary flex-1">
          Cancelar
        </button>
        <button type="submit" disabled={isSubmitting} className="btn btn-primary flex-1">
          {isSubmitting ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </form>
  );
}

function StatsResumoIpca({ ipca }: { ipca: IpcaView }) {
  const e = ipca.estatisticasGeral;
  if (e.media === null) return null;

  const itens: { label: string; valor: string }[] = [
    { label: "Média histórica", valor: `${e.media.toFixed(2)}%` },
    { label: "Mediana", valor: `${e.mediana!.toFixed(2)}%` },
    { label: "Desvio padrão", valor: `${e.desvioPadrao!.toFixed(2)} p.p.` },
    { label: "Amplitude", valor: `${e.amplitude!.toFixed(2)} p.p.` },
    { label: "Máximo histórico", valor: `${e.maximo!.toFixed(2)}%` },
    { label: "Mínimo histórico", valor: `${e.minimo!.toFixed(2)}%` },
    { label: "Meses com alta", valor: `${e.mesesPositivos}` },
    { label: "Meses com deflação", valor: `${e.mesesNegativos}` },
    {
      label: "Sequência atual",
      valor: ipca.sequencia
        ? `${ipca.sequencia.quantidade} mês(es) ${ipca.sequencia.tipo === "aceleracao" ? "em alta" : "em queda"}`
        : "—",
    },
    {
      label: "Índice de difusão (mês)",
      valor: ipca.indiceDifusao?.indice != null ? `${ipca.indiceDifusao.indice.toFixed(0)}%` : "—",
    },
  ];

  const correlacoesOrdenadas = [...ipca.correlacoesGrupos]
    .filter((c) => c.correlacao !== null)
    .sort((a, b) => (b.correlacao ?? 0) - (a.correlacao ?? 0));

  return (
    <div className="px-4 py-3 space-y-4">
      <div>
        <p className="text-xs text-faint mb-2">Estatísticas do histórico (índice geral)</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {itens.map((it) => (
            <div key={it.label}>
              <p className="text-xs text-faint">{it.label}</p>
              <p className="text-sm text-ink">{it.valor}</p>
            </div>
          ))}
        </div>
      </div>

      {correlacoesOrdenadas.length > 0 && (
        <div>
          <p className="text-xs text-faint mb-2">Correlação de cada grupo com o IPCA geral</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            {correlacoesOrdenadas.map((c) => (
              <p key={c.grupo} className="text-ink">
                {labelGrupo(c.grupo)}: <span className="text-muted">{c.correlacao!.toFixed(2)}</span>
              </p>
            ))}
          </div>
        </div>
      )}

      {ipca.impactoHistoricoGrupos.length > 0 && (
        <div>
          <p className="text-xs text-faint mb-2">Impacto acumulado por grupo (histórico)</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            {ipca.impactoHistoricoGrupos.map((g) => (
              <p key={g.grupo} className="text-ink">
                {labelGrupo(g.grupo)}: <span className="text-muted">{g.impactoAcumulado.toFixed(2)} p.p.</span>
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloco 4 — Importação (colar texto)
// ---------------------------------------------------------------------------

function BlocoImportacao({ onAtualizar }: { onAtualizar: () => Promise<void> }) {
  const [aberto, setAberto] = useState(false);
  const [resultado, setResultado] = useState<{ importados?: number; avisos?: string[]; error?: string } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<ImportarIpcaForm>({ resolver: zodResolver(importarIpcaSchema) });

  const onSubmit = handleSubmit(async (data) => {
    const r = await importarHistoricoIpca(data);
    setResultado(r);
    if (!r.error) {
      reset();
      await onAtualizar();
    }
  });

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-faint">Importar histórico</p>
        <button onClick={() => setAberto((v) => !v)} className="text-xs text-accent hover:underline">
          {aberto ? "Fechar" : "Importar histórico"}
        </button>
      </div>
      <p className="text-sm text-muted mb-3">
        Cole linhas no formato <code className="text-xs">COMPETÊNCIA | GERAL | 9 grupos</code> (grupos
        opcionais), separadas por pipe, tab ou 2+ espaços — direto do Excel ou de uma tabela do IBGE. Impacto
        por grupo nunca é colado: é sempre calculado a partir dos Pesos do IPCA cadastrados em Configurações.
      </p>

      {aberto && (
        <form onSubmit={onSubmit} className="space-y-2">
          <textarea
            {...register("texto")}
            rows={6}
            placeholder={"06/2026 | 0,24 | 0,10 | 0,30 | 0,05 | -0,12 | 0,40 | 0,15 | 0,20 | 0,08 | 0,02\n05/2026 | 0,18 | ..."}
            className="input w-full font-mono text-xs"
          />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={isSubmitting} className="btn btn-primary">
              {isSubmitting ? "Importando..." : "Importar"}
            </button>
          </div>
        </form>
      )}

      {resultado && (
        <div className="mt-3 text-xs">
          {resultado.error && <p className="text-danger">{resultado.error}</p>}
          {resultado.importados !== undefined && (
            <p className="text-success">{resultado.importados} linha(s) importada(s) com sucesso.</p>
          )}
          {resultado.avisos && resultado.avisos.length > 0 && (
            <div className="mt-1 text-faint">
              <p>Avisos:</p>
              <ul className="list-disc list-inside">
                {resultado.avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
