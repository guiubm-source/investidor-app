"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  decisaoSelicSchema,
  importarSelicSchema,
  novaReuniaoSelicSchema,
  selicReuniaoEditSchema,
  type ImportarSelicForm,
  type NovaReuniaoSelicForm,
} from "@/lib/indicadores/schema";
import {
  criarReuniaoSelic,
  editarReuniaoSelic,
  excluirReuniaoSelic,
  excluirReunioesSelic,
  importarHistoricoSelic,
  lancarDecisaoSelic,
  type SelicView,
} from "@/lib/indicadores/actions";
import { calcularMediaMovel, type DecisaoTipo } from "@/lib/indicadores/selic-estatisticas";
import type { DiretorBacen, PresidenteBrasil } from "@/lib/referencia/actions";

const formatarData = (iso: string) => {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

const LABEL_DECISAO: Record<DecisaoTipo, string> = {
  alta: "Alta",
  reducao: "Redução",
  manutencao: "Manutenção",
};

const SETA_DECISAO: Record<DecisaoTipo, string> = {
  alta: "⬆",
  reducao: "⬇",
  manutencao: "➡",
};

export default function AbaSelic({
  selic,
  diretoriaBacen,
  presidentesBrasil,
  onAtualizar,
}: {
  selic: SelicView;
  diretoriaBacen: DiretorBacen[];
  presidentesBrasil: PresidenteBrasil[];
  onAtualizar: () => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <BlocoCards selic={selic} />
      <BlocoBancoCentral presidenteBc={selic.presidenteBc} />
      <BlocoGrafico selic={selic} diretoriaBacen={diretoriaBacen} presidentesBrasil={presidentesBrasil} />
      <BlocoHistorico selic={selic} onAtualizar={onAtualizar} />
      <BlocoImportacao onAtualizar={onAtualizar} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloco 1 — Cards resumo
// ---------------------------------------------------------------------------

function BlocoCards({ selic }: { selic: SelicView }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <div className="card p-3">
        <p className="text-xs text-faint">Taxa Selic vigente</p>
        <p className="text-lg font-medium text-ink">
          {selic.ultimaTaxa !== null ? `${selic.ultimaTaxa.toFixed(2)}% a.a.` : "—"}
        </p>
        <p className="text-xs text-faint">
          {selic.dataVigenciaAtual ? `Vigente desde ${formatarData(selic.dataVigenciaAtual)}` : "Sem decisão lançada"}
        </p>
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Última decisão</p>
        {selic.ultimaDecisao ? (
          <>
            <p className="text-lg font-medium text-ink">
              {SETA_DECISAO[selic.ultimaDecisao.tipo]} {LABEL_DECISAO[selic.ultimaDecisao.tipo]}
            </p>
            <p className="text-xs text-faint">
              {selic.ultimaDecisao.variacao > 0 ? "+" : ""}
              {selic.ultimaDecisao.variacao.toFixed(2)} p.p.
            </p>
          </>
        ) : (
          <p className="text-sm text-faint">Sem decisões suficientes</p>
        )}
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Decisões consecutivas</p>
        {selic.decisoesConsecutivas ? (
          <p className="text-lg font-medium text-ink">
            {selic.decisoesConsecutivas.quantidade}{" "}
            {selic.decisoesConsecutivas.quantidade === 1
              ? LABEL_DECISAO[selic.decisoesConsecutivas.tipo].toLowerCase()
              : `${LABEL_DECISAO[selic.decisoesConsecutivas.tipo].toLowerCase()}s`}{" "}
            seguidas
          </p>
        ) : (
          <p className="text-sm text-faint">—</p>
        )}
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Tempo da taxa atual</p>
        <p className="text-lg font-medium text-ink">
          {selic.diasVigente !== null ? `há ${selic.diasVigente} dias` : "—"}
        </p>
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Próxima reunião</p>
        <p className="text-sm text-ink">
          {selic.proximaReuniao
            ? `${selic.proximaReuniao.numeroReuniao ? `${selic.proximaReuniao.numeroReuniao}ª — ` : ""}${formatarData(
                selic.proximaReuniao.dataInicio
              )}`
            : "Todas as reuniões conhecidas já têm decisão lançada"}
        </p>
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint">Amplitude / desvio padrão</p>
        <p className="text-sm text-ink">
          {selic.estatisticas.amplitude !== null
            ? `${selic.estatisticas.amplitude.toFixed(2)} p.p. / ${selic.estatisticas.desvioPadrao!.toFixed(2)} p.p.`
            : "—"}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloco 2 — Banco Central (presidente vigente; roster completo fica em
// Configurações, aqui é só o card de referência rápida)
// ---------------------------------------------------------------------------

function BlocoBancoCentral({ presidenteBc }: { presidenteBc: SelicView["presidenteBc"] }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-faint mb-2">Presidente do Banco Central</p>
      {presidenteBc ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xs text-faint">Nome</p>
            <p className="text-ink">{presidenteBc.nome}</p>
          </div>
          <div>
            <p className="text-xs text-faint">Mandato</p>
            <p className="text-ink">
              {formatarData(presidenteBc.mandatoInicio)} – {presidenteBc.mandatoFim ? formatarData(presidenteBc.mandatoFim) : "atual"}
            </p>
          </div>
          <div>
            <p className="text-xs text-faint">Nomeado por</p>
            <p className="text-ink">{presidenteBc.nomeadoPor ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-faint">Posse</p>
            <p className="text-ink">{presidenteBc.dataPosse ? formatarData(presidenteBc.dataPosse) : "—"}</p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-faint">
          Nenhum presidente cadastrado. Cadastre em Configurações → Diretoria do Bacen.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloco 3 — Gráfico de evolução (SVG artesanal, ver docs/MAPA-DE-DADOS.md
// §8.7 — sem dependência de lib de gráficos)
// ---------------------------------------------------------------------------

type PeriodoFiltro = "todos" | "12m" | "24m" | "5a" | "10a" | "personalizado";

function BlocoGrafico({
  selic,
  diretoriaBacen,
  presidentesBrasil,
}: {
  selic: SelicView;
  diretoriaBacen: DiretorBacen[];
  presidentesBrasil: PresidenteBrasil[];
}) {
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("todos");
  const [personalizadoInicio, setPersonalizadoInicio] = useState("");
  const [personalizadoFim, setPersonalizadoFim] = useState("");
  const [mandatoBc, setMandatoBc] = useState("todos");
  const [mandatoPresidencial, setMandatoPresidencial] = useState("todos");
  const [tipoDecisao, setTipoDecisao] = useState<"todas" | DecisaoTipo>("todas");
  const [mediaMovelAtiva, setMediaMovelAtiva] = useState(false);
  const [mediaMovelPeriodo, setMediaMovelPeriodo] = useState(5);

  const presidentesBc = diretoriaBacen.filter((d) => d.presidente);

  const pontos = useMemo(() => {
    let decididas = selic.reunioes.filter((r) => r.decidido);

    const hoje = new Date().toISOString().slice(0, 10);
    if (periodo !== "todos" && periodo !== "personalizado") {
      const anos = periodo === "12m" ? 1 : periodo === "24m" ? 2 : periodo === "5a" ? 5 : 10;
      const limite = new Date();
      limite.setFullYear(limite.getFullYear() - anos);
      const limiteIso = limite.toISOString().slice(0, 10);
      decididas = decididas.filter((r) => r.dataInicio >= limiteIso && r.dataInicio <= hoje);
    } else if (periodo === "personalizado" && personalizadoInicio && personalizadoFim) {
      decididas = decididas.filter((r) => r.dataInicio >= personalizadoInicio && r.dataInicio <= personalizadoFim);
    }

    if (mandatoBc !== "todos") {
      const diretor = presidentesBc.find((d) => d.id === mandatoBc);
      if (diretor) {
        const fim = diretor.mandatoFim ?? hoje;
        decididas = decididas.filter((r) => r.dataInicio >= diretor.mandatoInicio && r.dataInicio <= fim);
      }
    }

    if (mandatoPresidencial !== "todos") {
      const presidente = presidentesBrasil.find((p) => p.id === mandatoPresidencial);
      if (presidente) {
        const fim = presidente.mandatoFim ?? hoje;
        decididas = decididas.filter((r) => r.dataInicio >= presidente.mandatoInicio && r.dataInicio <= fim);
      }
    }

    if (tipoDecisao !== "todas") {
      decididas = decididas.filter((r) => r.decisaoTipo === tipoDecisao);
    }

    return decididas;
  }, [selic.reunioes, periodo, personalizadoInicio, personalizadoFim, mandatoBc, mandatoPresidencial, tipoDecisao, presidentesBc, presidentesBrasil]);

  const mediaMovel = useMemo(() => {
    if (!mediaMovelAtiva) return [];
    return calcularMediaMovel(pontos.map((p) => p.taxaDefinida), mediaMovelPeriodo);
  }, [pontos, mediaMovelAtiva, mediaMovelPeriodo]);

  return (
    <div className="card p-4">
      <p className="text-xs text-faint mb-3">Evolução histórica</p>

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
              type="date"
              value={personalizadoInicio}
              onChange={(e) => setPersonalizadoInicio(e.target.value)}
              className="input w-auto text-xs"
            />
            <input
              type="date"
              value={personalizadoFim}
              onChange={(e) => setPersonalizadoFim(e.target.value)}
              className="input w-auto text-xs"
            />
          </>
        )}

        <select value={mandatoBc} onChange={(e) => setMandatoBc(e.target.value)} className="input w-auto text-xs">
          <option value="todos">Mandato BC: todos</option>
          {presidentesBc.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nome}
            </option>
          ))}
        </select>

        <select
          value={mandatoPresidencial}
          onChange={(e) => setMandatoPresidencial(e.target.value)}
          className="input w-auto text-xs"
        >
          <option value="todos">Mandato presidencial: todos</option>
          {presidentesBrasil.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>

        <select
          value={tipoDecisao}
          onChange={(e) => setTipoDecisao(e.target.value as "todas" | DecisaoTipo)}
          className="input w-auto text-xs"
        >
          <option value="todas">Decisão: todas</option>
          <option value="alta">Só altas</option>
          <option value="reducao">Só reduções</option>
          <option value="manutencao">Só manutenções</option>
        </select>

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
            <option value={3}>3 reuniões</option>
            <option value={5}>5 reuniões</option>
            <option value={8}>8 reuniões</option>
            <option value={12}>12 reuniões</option>
          </select>
        )}
      </div>

      {pontos.length < 2 ? (
        <p className="text-sm text-faint">Poucos pontos para desenhar o gráfico com esse filtro (mínimo 2).</p>
      ) : (
        <GraficoSvg pontos={pontos} mediaMovel={mediaMovelAtiva ? mediaMovel : null} />
      )}
    </div>
  );
}

function GraficoSvg({
  pontos,
  mediaMovel,
}: {
  pontos: SelicView["reunioes"];
  mediaMovel: (number | null)[] | null;
}) {
  const W = 900;
  const H = 260;
  const padL = 44;
  const padR = 12;
  const padT = 14;
  const padB = 26;

  const datas = pontos.map((p) => new Date(`${p.dataInicio}T00:00:00`).getTime());
  const minData = Math.min(...datas);
  const maxData = Math.max(...datas);
  const rangeData = Math.max(1, maxData - minData);

  const taxas = pontos.map((p) => p.taxaDefinida!);
  const todasTaxas = mediaMovel ? [...taxas, ...(mediaMovel.filter((v) => v !== null) as number[])] : taxas;
  const minTaxa = Math.min(...todasTaxas);
  const maxTaxa = Math.max(...todasTaxas);
  const padding = Math.max(0.25, (maxTaxa - minTaxa) * 0.15);
  const yMin = Math.max(0, minTaxa - padding);
  const yMax = maxTaxa + padding;
  const rangeTaxa = Math.max(0.01, yMax - yMin);

  const x = (t: number) => padL + ((t - minData) / rangeData) * (W - padL - padR);
  const y = (v: number) => H - padB - ((v - yMin) / rangeTaxa) * (H - padT - padB);

  const linhaPrincipal = pontos.map((p, i) => `${i === 0 ? "M" : "L"} ${x(datas[i]).toFixed(1)} ${y(p.taxaDefinida!).toFixed(1)}`).join(" ");

  let linhaMedia = "";
  if (mediaMovel) {
    let comecouSubpath = false;
    mediaMovel.forEach((v, i) => {
      if (v === null) {
        comecouSubpath = false;
        return;
      }
      linhaMedia += `${comecouSubpath ? "L" : "M"} ${x(datas[i]).toFixed(1)} ${y(v).toFixed(1)} `;
      comecouSubpath = true;
    });
  }

  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const xTicksIdx = pontos.length <= 4 ? pontos.map((_, i) => i) : [0, Math.floor(pontos.length / 2), pontos.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Gráfico de evolução da Selic">
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={1} />
          <text x={4} y={y(t) + 3} fontSize={9} fill="var(--color-faint)">
            {t.toFixed(2)}%
          </text>
        </g>
      ))}

      {xTicksIdx.map((i) => (
        <text key={i} x={x(datas[i])} y={H - 6} fontSize={9} fill="var(--color-faint)" textAnchor="middle">
          {formatarData(pontos[i].dataInicio)}
        </text>
      ))}

      {linhaMedia && <path d={linhaMedia} fill="none" stroke="var(--color-muted)" strokeWidth={1.5} strokeDasharray="4 3" />}
      <path d={linhaPrincipal} fill="none" stroke="var(--color-accent)" strokeWidth={2} />

      {pontos.map((p, i) => (
        <circle key={p.id} cx={x(datas[i])} cy={y(p.taxaDefinida!)} r={3} fill="var(--color-accent)">
          <title>
            {formatarData(p.dataInicio)}: {p.taxaDefinida!.toFixed(2)}%
          </title>
        </circle>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Bloco 4 — Histórico das reuniões
// ---------------------------------------------------------------------------

function BlocoHistorico({ selic, onAtualizar }: { selic: SelicView; onAtualizar: () => Promise<void> }) {
  const [busca, setBusca] = useState("");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [lancando, setLancando] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [criandoNova, setCriandoNova] = useState<{ base?: SelicView["reunioes"][number] } | null>(null);

  const reunioesDesc = [...selic.reunioes].reverse();
  const filtradas = busca.trim()
    ? reunioesDesc.filter(
        (r) =>
          r.dataInicio.includes(busca) ||
          (r.numeroReuniao !== null && String(r.numeroReuniao).includes(busca))
      )
    : reunioesDesc;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
    setError,
  } = useForm({
    resolver: zodResolver(decisaoSelicSchema),
    defaultValues: { reuniao_id: "", numero_reuniao: NaN, taxa_definida: NaN },
  });

  const onSubmitDecisao = handleSubmit(async (data) => {
    try {
      const resultado = await lancarDecisaoSelic(data);
      if (resultado.error) throw new Error(resultado.error);
      setLancando(null);
      reset();
      await onAtualizar();
    } catch (e) {
      setError("root", { message: e instanceof Error ? e.message : "Erro ao salvar." });
    }
  });

  const alternarSelecao = (id: string) => {
    setSelecionados((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  };

  const excluirSelecionados = async () => {
    await excluirReunioesSelic(Array.from(selecionados));
    setSelecionados(new Set());
    await onAtualizar();
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border flex-wrap">
        <p className="text-xs text-faint">Histórico das reuniões</p>
        <div className="flex items-center gap-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por data ou número"
            className="input w-48 text-xs"
          />
          {selecionados.size > 0 && (
            <button onClick={excluirSelecionados} className="text-xs text-danger hover:underline">
              Excluir selecionados ({selecionados.size})
            </button>
          )}
          <button onClick={() => setCriandoNova({})} className="text-xs text-accent hover:underline">
            + Nova reunião
          </button>
        </div>
      </div>

      {criandoNova && (
        <div className="px-4 py-3 border-b border-border">
          <FormReuniao
            inicial={criandoNova.base}
            onSalvar={async (dados) => {
              const resultado = await criarReuniaoSelic(dados);
              if (resultado.error) throw new Error(resultado.error);
              setCriandoNova(null);
              await onAtualizar();
            }}
            onCancelar={() => setCriandoNova(null)}
          />
        </div>
      )}

      <div className="grid grid-cols-[28px_70px_100px_70px_70px_90px_90px_180px] gap-2 px-4 py-2 text-xs text-faint border-b border-border">
        <span></span>
        <span>Reunião</span>
        <span>Data</span>
        <span className="text-right">Selic</span>
        <span className="text-right">Variação</span>
        <span>Decisão</span>
        <span>Vigência</span>
        <span></span>
      </div>

      {filtradas.length === 0 && <p className="text-sm text-faint px-4 py-4">Nenhuma reunião encontrada.</p>}

      {filtradas.map((r) => (
        <div key={r.id}>
          <div className="grid grid-cols-[28px_70px_100px_70px_70px_90px_90px_180px] gap-2 items-center px-4 py-2 text-xs border-b border-border last:border-0">
            <input type="checkbox" checked={selecionados.has(r.id)} onChange={() => alternarSelecao(r.id)} />
            <span className="text-ink">{r.numeroReuniao ? `${r.numeroReuniao}ª` : "—"}</span>
            <span className="text-ink">{formatarData(r.dataInicio)}</span>
            <span className="text-right text-ink">{r.taxaDefinida !== null ? `${r.taxaDefinida.toFixed(2)}%` : "—"}</span>
            <span className="text-right text-muted">
              {r.variacao !== null ? `${r.variacao > 0 ? "+" : ""}${r.variacao.toFixed(2)}` : "—"}
            </span>
            <span className="text-muted">{r.decisaoTipo ? LABEL_DECISAO[r.decisaoTipo] : "—"}</span>
            <span className="text-faint">{r.dataVigencia ? formatarData(r.dataVigencia) : "—"}</span>
            <div className="flex items-center gap-2 justify-end text-right">
              {r.taxaDefinida === null && (
                <button
                  onClick={() => {
                    reset({ reuniao_id: r.id, numero_reuniao: r.numeroReuniao ?? NaN, taxa_definida: NaN });
                    setLancando(r.id);
                  }}
                  className="text-accent hover:underline"
                >
                  Lançar
                </button>
              )}
              <button onClick={() => setEditando(editando === r.id ? null : r.id)} className="text-accent hover:underline">
                Editar
              </button>
              <button
                onClick={() => setCriandoNova({ base: { ...r, id: "", dataInicio: "", dataFim: "" } })}
                className="text-faint hover:text-ink"
              >
                Duplicar
              </button>
              <button
                onClick={async () => {
                  await excluirReuniaoSelic(r.id);
                  await onAtualizar();
                }}
                className="text-faint hover:text-danger"
              >
                Excluir
              </button>
            </div>
          </div>

          {lancando === r.id && (
            <form onSubmit={onSubmitDecisao} className="flex items-end gap-2 px-4 pb-3 pt-1 flex-wrap">
              <input type="hidden" {...register("reuniao_id")} value={r.id} />
              <div>
                <label className="label">Número da reunião (opcional)</label>
                <input type="number" {...register("numero_reuniao", { valueAsNumber: true })} className="input w-32" />
              </div>
              <div>
                <label className="label">Taxa definida (% a.a.)</label>
                <input type="number" step="0.01" {...register("taxa_definida", { valueAsNumber: true })} className="input w-32" />
                {errors.taxa_definida?.message && <p className="field-error">{errors.taxa_definida.message}</p>}
              </div>
              <button type="button" onClick={() => setLancando(null)} className="btn btn-secondary">
                Cancelar
              </button>
              <button type="submit" disabled={isSubmitting} className="btn btn-primary">
                {isSubmitting ? "Salvando..." : "Salvar"}
              </button>
              {errors.root?.message && <p className="field-error">{errors.root.message}</p>}
            </form>
          )}

          {editando === r.id && (
            <div className="px-4 pb-3 pt-1">
              <FormReuniao
                idExistente={r.id}
                inicial={r}
                onSalvar={async (dados) => {
                  const resultado = await editarReuniaoSelic({ id: r.id, ...dados });
                  if (resultado.error) throw new Error(resultado.error);
                  setEditando(null);
                  await onAtualizar();
                }}
                onCancelar={() => setEditando(null)}
              />
            </div>
          )}
        </div>
      ))}

      <StatsResumo selic={selic} />
    </div>
  );
}

function FormReuniao({
  inicial,
  idExistente,
  onSalvar,
  onCancelar,
}: {
  inicial?: SelicView["reunioes"][number];
  idExistente?: string;
  onSalvar: (dados: NovaReuniaoSelicForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm({
    resolver: zodResolver(idExistente ? selicReuniaoEditSchema.omit({ id: true }) : novaReuniaoSelicSchema),
    defaultValues: {
      numero_reuniao: inicial?.numeroReuniao ?? NaN,
      data_inicio: inicial?.dataInicio ?? "",
      data_fim: inicial?.dataFim ?? "",
      taxa_definida: inicial?.taxaDefinida ?? NaN,
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvar(data);
    } catch (e) {
      setError("root", { message: e instanceof Error ? e.message : "Erro ao salvar." });
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 md:grid-cols-5 gap-2 rounded-md bg-surface-2 border border-border p-3">
      <div>
        <label className="label">Número</label>
        <input type="number" {...register("numero_reuniao", { valueAsNumber: true })} className="input" />
      </div>
      <div>
        <label className="label">Data início</label>
        <input type="date" {...register("data_inicio")} className="input" />
        {errors.data_inicio?.message && <p className="field-error">{errors.data_inicio.message}</p>}
      </div>
      <div>
        <label className="label">Data fim</label>
        <input type="date" {...register("data_fim")} className="input" />
        {errors.data_fim?.message && <p className="field-error">{errors.data_fim.message}</p>}
      </div>
      <div>
        <label className="label">Taxa (%)</label>
        <input type="number" step="0.01" {...register("taxa_definida", { valueAsNumber: true })} className="input" />
      </div>
      <div className="flex items-end gap-2">
        <button type="button" onClick={onCancelar} className="btn btn-secondary flex-1">
          Cancelar
        </button>
        <button type="submit" disabled={isSubmitting} className="btn btn-primary flex-1">
          {isSubmitting ? "Salvando..." : "Salvar"}
        </button>
      </div>
      {errors.root?.message && <p className="error-box col-span-2 md:col-span-5">{errors.root.message}</p>}
    </form>
  );
}

function StatsResumo({ selic }: { selic: SelicView }) {
  const e = selic.estatisticas;
  if (e.maior === null) return null;

  const itens: { label: string; valor: string }[] = [
    { label: "Maior", valor: `${e.maior.toFixed(2)}%` },
    { label: "Menor", valor: `${e.menor!.toFixed(2)}%` },
    { label: "Média", valor: `${e.media!.toFixed(2)}%` },
    { label: "Mediana", valor: `${e.mediana!.toFixed(2)}%` },
    { label: "Desvio padrão", valor: `${e.desvioPadrao!.toFixed(2)} p.p.` },
    { label: "Amplitude", valor: `${e.amplitude!.toFixed(2)} p.p.` },
    { label: "Altas", valor: `${e.numAltas}` },
    { label: "Reduções", valor: `${e.numReducoes}` },
    { label: "Manutenções", valor: `${e.numManutencoes}` },
    { label: "Maior aumento", valor: e.maiorAumento !== null ? `+${e.maiorAumento.toFixed(2)} p.p.` : "—" },
    { label: "Maior redução", valor: e.maiorReducao !== null ? `${e.maiorReducao.toFixed(2)} p.p.` : "—" },
    {
      label: "Intervalo médio",
      valor: e.tempoMedioEntreReunioesDias !== null ? `${Math.round(e.tempoMedioEntreReunioesDias)} dias` : "—",
    },
    {
      label: "Vigência média",
      valor: e.tempoMedioVigenciaDias !== null ? `${Math.round(e.tempoMedioVigenciaDias)} dias` : "—",
    },
  ];

  return (
    <div className="px-4 py-3 border-t border-border">
      <p className="text-xs text-faint mb-2">Estatísticas do histórico</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {itens.map((it) => (
          <div key={it.label}>
            <p className="text-xs text-faint">{it.label}</p>
            <p className="text-sm text-ink">{it.valor}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bloco 5 — Importação (colar texto)
// ---------------------------------------------------------------------------

function BlocoImportacao({ onAtualizar }: { onAtualizar: () => Promise<void> }) {
  const [aberto, setAberto] = useState(false);
  const [resultado, setResultado] = useState<{ importados?: number; avisos?: string[]; error?: string } | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<ImportarSelicForm>({ resolver: zodResolver(importarSelicSchema) });

  const onSubmit = handleSubmit(async (data) => {
    const r = await importarHistoricoSelic(data);
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
        Cole linhas no formato <code className="text-xs">REUNIÃO&nbsp;&nbsp;DATA&nbsp;&nbsp;SELIC</code> (ou só{" "}
        <code className="text-xs">DATA&nbsp;&nbsp;SELIC</code>), separadas por tab ou 2+ espaços — direto do Excel ou de
        um site oficial. Datas repetidas atualizam o registro existente.
      </p>

      {aberto && (
        <form onSubmit={onSubmit} className="space-y-2">
          <textarea
            {...register("texto")}
            rows={6}
            placeholder={"277ª\t18/03/2026\t14,75\n276ª\t28/01/2026\t15,00"}
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
