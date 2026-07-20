"use client";

/**
 * Aba Proventos — dashboard (cards, gráfico mensal, categoria, donut,
 * tabelas por ativo, lançamentos) + toggle pra grade mensal/anual estilo
 * planilha (GradeProventosView.tsx). Ver docs/MAPA-DE-DADOS.md §8.23
 * (2026-07-20): DY (sobre preço atual) e Yield on Cost (sobre preço médio)
 * calculados em lib/proventos/actions.ts a partir da posição já existente —
 * nenhuma fórmula de posição é duplicada aqui, só exibida.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { proventoSchema, TIPOS_PROVENTO, type ProventoForm } from "@/lib/proventos/schema";
import {
  criarProvento,
  editarProvento,
  excluirProvento,
  excluirProventosEmLote,
  obterLivroProventos,
  type LivroProventos,
  type LancamentoProvento,
} from "@/lib/proventos/actions";
import { LABEL_GRUPO, type GrupoPosicao } from "@/lib/carteira/grupo-classificacao";
import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/components/ToastProvider";
import GradeProventosView from "./GradeProventosView";

type ProventoFormInput = z.input<typeof proventoSchema>;

const PALETA = ["#1f8f5c", "#3fcb82", "#e4574f", "#f4b942", "#4f8fe4", "#a374e0", "#e0749a", "#7fa394", "#c9d3ce"];

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatarMoedaCompacta = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const formatarPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);

const formatarData = (iso: string | null) => {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

const formatarMesCurto = (anoMes: string) => {
  const [ano, mes] = anoMes.split("-");
  const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`;
};

const rotuloProvento = (valor: string) => TIPOS_PROVENTO.find((t) => t.valor === valor)?.label ?? valor;

export type AtivoOpcao = { id: string; ticker: string };

type FiltroPeriodo = "todos" | "6m" | "12m" | "24m";
type FiltroStatus = "todos" | "recebido" | "provisionado";

export default function ProventosView({
  livroInicial,
  ativos,
}: {
  livroInicial: LivroProventos;
  ativos: AtivoOpcao[];
}) {
  const [livro, setLivro] = useState(livroInicial);
  const [aba, setAba] = useState<"dashboard" | "grade">("dashboard");
  const [addProvento, setAddProvento] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [confirmandoLote, setConfirmandoLote] = useState(false);
  const [excluindoLote, setExcluindoLote] = useState(false);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const [excluindoLoading, setExcluindoLoading] = useState(false);
  const [gruposAbertos, setGruposAbertos] = useState<Set<GrupoPosicao>>(new Set());
  const [filtroPeriodo, setFiltroPeriodo] = useState<FiltroPeriodo>("12m");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");
  const toast = useToast();

  const atualizar = async () => {
    const novo = await obterLivroProventos();
    setLivro(novo);
  };

  const alternarSelecao = (id: string) => {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  };

  const toggleGrupo = (grupo: GrupoPosicao) => {
    setGruposAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(grupo)) novo.delete(grupo);
      else novo.add(grupo);
      return novo;
    });
  };

  // ---- Gráfico mensal: recebido x provisionado, últimos 12 meses --------
  const dadosGrafico = useMemo(() => {
    const hoje = new Date();
    const chaves: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      chaves.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const porChave = new Map(chaves.map((c) => [c, { recebido: 0, provisionado: 0 }]));
    for (const l of livro.lancamentos) {
      const chave = l.dataPagamento.slice(0, 7);
      const alvo = porChave.get(chave);
      if (!alvo) continue;
      if (l.status === "recebido") alvo.recebido += l.valorTotal;
      else alvo.provisionado += l.valorTotal;
    }
    return chaves.map((c) => ({
      mes: formatarMesCurto(c),
      recebido: porChave.get(c)!.recebido,
      provisionado: porChave.get(c)!.provisionado,
    }));
  }, [livro.lancamentos]);

  const semGraficoDados = dadosGrafico.every((p) => p.recebido === 0 && p.provisionado === 0);

  // ---- Lançamentos filtrados (tabela detalhada) --------------------------
  const cutoffPeriodo = useMemo(() => {
    if (filtroPeriodo === "todos") return null;
    const meses = filtroPeriodo === "6m" ? 180 : filtroPeriodo === "12m" ? 365 : 730;
    const d = new Date();
    d.setDate(d.getDate() - meses);
    return d.toISOString().slice(0, 10);
  }, [filtroPeriodo]);

  const lancamentosFiltrados = useMemo(() => {
    return livro.lancamentos.filter((l) => {
      if (filtroStatus !== "todos" && l.status !== filtroStatus) return false;
      if (cutoffPeriodo && l.dataPagamento < cutoffPeriodo) return false;
      return true;
    });
  }, [livro.lancamentos, filtroStatus, cutoffPeriodo]);

  const todosSelecionados =
    lancamentosFiltrados.length > 0 && lancamentosFiltrados.every((l) => selecionados.has(l.id));

  const alternarTodos = () => {
    setSelecionados(todosSelecionados ? new Set() : new Set(lancamentosFiltrados.map((l) => l.id)));
  };

  const maxCategoria = Math.max(1, ...livro.porCategoria.map((c) => c.totalRecebido));

  const ativosPorGrupo = useMemo(() => {
    const mapa = new Map<GrupoPosicao, typeof livro.ativos>();
    for (const a of livro.ativos) {
      const lista = mapa.get(a.grupo) ?? [];
      lista.push(a);
      mapa.set(a.grupo, lista);
    }
    return mapa;
  }, [livro.ativos]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setAba("dashboard")}
          className={`px-3 py-2 text-sm ${aba === "dashboard" ? "text-ink border-b-2 border-accent -mb-px font-medium" : "text-faint hover:text-ink"}`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setAba("grade")}
          className={`px-3 py-2 text-sm ${aba === "grade" ? "text-ink border-b-2 border-accent -mb-px font-medium" : "text-faint hover:text-ink"}`}
        >
          Grade mensal/anual
        </button>
      </div>

      {aba === "grade" ? (
        <GradeProventosView />
      ) : (
        <>
          {/* ---- Cards de resumo ---- */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <CardResumo label="Total recebido" valor={formatarMoeda(livro.resumo.totalRecebido)} />
            <CardResumo label="Total provisionado" valor={formatarMoeda(livro.resumo.totalProvisionado)} />
            <CardResumo
              label="Total do período"
              valor={formatarMoeda(livro.resumo.totalRecebido + livro.resumo.totalProvisionado)}
            />
            <CardResumo label="Últimos 6 meses" valor={formatarMoeda(livro.resumo.ultimos6Meses)} />
            <CardResumo label="Últimos 12 meses" valor={formatarMoeda(livro.resumo.ultimos12Meses)} />
            <CardResumo label="Últimos 24 meses" valor={formatarMoeda(livro.resumo.ultimos24Meses)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="card p-3">
              <p className="text-xs text-faint">DY da carteira (sobre preço atual)</p>
              <p className="text-lg font-medium text-ink">{formatarPct(livro.resumo.dyCarteiraPrecoAtual)}</p>
              <p className="text-[11px] text-faint mt-1">Recebidos (12m) ÷ patrimônio atual</p>
            </div>
            <div className="card p-3">
              <p className="text-xs text-faint">Yield on Cost da carteira (sobre preço médio)</p>
              <p className="text-lg font-medium text-ink">{formatarPct(livro.resumo.yieldOnCostCarteira)}</p>
              <p className="text-[11px] text-faint mt-1">Recebidos (12m) ÷ valor investido</p>
            </div>
          </div>

          {/* ---- Gráfico mensal ---- */}
          <div className="card p-4">
            <h3 className="text-sm font-medium text-ink mb-3">Recebido x Provisionado — últimos 12 meses</h3>
            {semGraficoDados ? (
              <p className="text-sm text-faint">Nenhum lançamento nos últimos 12 meses.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={dadosGrafico}>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "var(--color-faint)" }} />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--color-faint)" }}
                    tickFormatter={(v) => formatarMoedaCompacta(v)}
                    width={70}
                  />
                  <RechartsTooltip
                    formatter={(v: number) => formatarMoeda(v)}
                    contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="recebido" name="Recebido" stackId="p" fill="var(--color-accent)" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="provisionado" name="Provisionado" stackId="p" fill="var(--color-faint)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ---- Categoria + donut ---- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="card p-4">
              <h3 className="text-sm font-medium text-ink mb-3">Proventos por categoria</h3>
              {livro.porCategoria.length === 0 ? (
                <p className="text-sm text-faint">Nenhum provento registrado ainda.</p>
              ) : (
                <div className="space-y-2">
                  {livro.porCategoria.map((c) => (
                    <div key={c.grupo}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-ink font-medium">{c.label}</span>
                        <span className="text-faint">
                          {formatarMoeda(c.totalRecebido)} · DY {formatarPct(c.dyPrecoAtual)} · YoC {formatarPct(c.yieldOnCost)}
                        </span>
                      </div>
                      <div className="h-2 bg-surface-2 rounded-sm overflow-hidden">
                        <div
                          className="h-full bg-accent rounded-sm"
                          style={{ width: `${(c.totalRecebido / maxCategoria) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-4">
              <h3 className="text-sm font-medium text-ink mb-3">Patrimônio por categoria</h3>
              {livro.porCategoria.filter((c) => c.patrimonioAtual > 0).length === 0 ? (
                <p className="text-sm text-faint">Sem posição atual pra distribuir.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={livro.porCategoria.filter((c) => c.patrimonioAtual > 0)}
                      dataKey="patrimonioAtual"
                      nameKey="label"
                      innerRadius="55%"
                      outerRadius="85%"
                      paddingAngle={2}
                    >
                      {livro.porCategoria
                        .filter((c) => c.patrimonioAtual > 0)
                        .map((c, i) => (
                          <Cell key={c.grupo} fill={PALETA[i % PALETA.length]} />
                        ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(v: number) => formatarMoeda(v)}
                      contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* ---- Tabelas por ativo, agrupadas por categoria ---- */}
          <div className="space-y-2">
            {[...ativosPorGrupo.entries()].map(([grupo, ativosDoGrupo]) => {
              const aberto = gruposAbertos.has(grupo);
              const totalGrupo = ativosDoGrupo.reduce((s, a) => s + a.totalRecebidoGeral, 0);
              return (
                <div key={grupo} className="card overflow-hidden">
                  <button
                    onClick={() => toggleGrupo(grupo)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-faint text-xs transition-transform ${aberto ? "rotate-90" : ""}`}>▶</span>
                      <span className="text-sm font-medium text-ink">{LABEL_GRUPO[grupo]}</span>
                    </div>
                    <span className="text-xs text-faint">{formatarMoeda(totalGrupo)}</span>
                  </button>

                  {aberto && (
                    <div className="px-4 pb-4 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-faint">
                            <th className="text-left py-1">Ativo</th>
                            <th className="text-right py-1">Quantidade</th>
                            <th className="text-right py-1">Preço médio</th>
                            <th className="text-right py-1">Preço atual</th>
                            <th className="text-right py-1">Recebido (12m)</th>
                            <th className="text-right py-1">Recebido (total)</th>
                            <th className="text-right py-1">DY</th>
                            <th className="text-right py-1">YoC</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ativosDoGrupo.map((a) => (
                            <tr key={a.ativoId} className="border-t border-border/50">
                              <td className="py-1.5">
                                <Link href={`/ativos/${a.ativoId}`} className="text-ink font-medium hover:underline">
                                  {a.ativoTicker}
                                </Link>
                              </td>
                              <td className="text-right text-muted">{a.quantidadeAtual}</td>
                              <td className="text-right text-muted">{formatarMoeda(a.precoMedio)}</td>
                              <td className="text-right text-muted">{formatarMoeda(a.precoAtual)}</td>
                              <td className="text-right text-ink">{formatarMoeda(a.totalRecebido12Meses)}</td>
                              <td className="text-right text-ink">{formatarMoeda(a.totalRecebidoGeral)}</td>
                              <td className="text-right text-muted">{formatarPct(a.dyPrecoAtual)}</td>
                              <td className="text-right text-muted">{formatarPct(a.yieldOnCost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ---- Registrar provento ---- */}
          {ativos.length === 0 ? (
            <p className="text-sm text-faint">
              Cadastre um ativo na aba{" "}
              <Link href="/ativos" className="text-accent hover:underline">
                Ativos
              </Link>{" "}
              antes de lançar proventos.
            </p>
          ) : (
            !addProvento && (
              <button onClick={() => setAddProvento(true)} className="btn btn-secondary">
                + Registrar provento
              </button>
            )
          )}

          {addProvento && (
            <div className="card p-4">
              <FormProvento
                ativos={ativos}
                onCancelar={() => setAddProvento(false)}
                onSalvo={async (dados) => {
                  const resultado = await criarProvento(dados);
                  if (resultado.error) throw new Error(resultado.error);
                  await atualizar();
                  setAddProvento(false);
                  toast.success("Provento registrado.");
                }}
              />
            </div>
          )}

          {/* ---- Filtros da tabela detalhada ---- */}
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={filtroPeriodo}
              onChange={(e) => setFiltroPeriodo(e.target.value as FiltroPeriodo)}
              className="input !w-auto text-xs"
            >
              <option value="todos">Todo o período</option>
              <option value="6m">Últimos 6 meses</option>
              <option value="12m">Últimos 12 meses</option>
              <option value="24m">Últimos 24 meses</option>
            </select>
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value as FiltroStatus)}
              className="input !w-auto text-xs"
            >
              <option value="todos">Recebidos e provisionados</option>
              <option value="recebido">Só recebidos</option>
              <option value="provisionado">Só provisionados</option>
            </select>
          </div>

          {selecionados.size > 0 && (
            <div className="card p-3 flex items-center justify-between gap-3 bg-surface-2">
              <span className="text-xs text-muted">{selecionados.size} selecionado(s)</span>
              <div className="flex items-center gap-3">
                <button className="text-xs text-faint hover:text-ink" onClick={() => setSelecionados(new Set())}>
                  Limpar seleção
                </button>
                <button className="text-xs text-danger hover:underline" onClick={() => setConfirmandoLote(true)}>
                  Excluir selecionados
                </button>
              </div>
            </div>
          )}

          {confirmandoLote && (
            <ConfirmModal
              title={`Excluir ${selecionados.size} provento(s)?`}
              message="Essa ação não pode ser desfeita."
              loading={excluindoLote}
              onCancel={() => setConfirmandoLote(false)}
              onConfirm={async () => {
                setExcluindoLote(true);
                await excluirProventosEmLote([...selecionados]);
                setSelecionados(new Set());
                setConfirmandoLote(false);
                await atualizar();
                setExcluindoLote(false);
                toast.success("Proventos excluídos.");
              }}
            />
          )}

          <div className="card overflow-hidden overflow-x-auto">
            <table className="w-full text-xs min-w-[880px]">
              <thead>
                <tr className="text-faint border-b border-border">
                  <th className="py-2 px-2">
                    <input
                      type="checkbox"
                      checked={todosSelecionados}
                      onChange={alternarTodos}
                      disabled={lancamentosFiltrados.length === 0}
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th className="text-left py-2 px-2">Data-com</th>
                  <th className="text-left py-2 px-2">Pagamento</th>
                  <th className="text-left py-2 px-2">Ativo</th>
                  <th className="text-left py-2 px-2">Tipo</th>
                  <th className="text-right py-2 px-2">Quantidade</th>
                  <th className="text-right py-2 px-2">Valor/cota</th>
                  <th className="text-right py-2 px-2">Valor total</th>
                  <th className="text-left py-2 px-2">Status</th>
                  <th className="py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {lancamentosFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-sm text-faint px-4 py-4">
                      Nenhum lançamento nesse filtro.
                    </td>
                  </tr>
                )}

                {lancamentosFiltrados.map((l) =>
                  editando === l.id ? (
                    <tr key={l.id}>
                      <td colSpan={10} className="px-4 py-3 border-b border-border bg-surface-2">
                        <FormProvento
                          ativos={ativos}
                          valoresIniciais={{
                            ativo_id: l.ativoId,
                            tipo: l.tipo as ProventoFormInput["tipo"],
                            data_com: l.dataCom ?? "",
                            data_pagamento: l.dataPagamento,
                            quantidade: l.quantidade ?? 0,
                            valor_por_cota: l.valorPorCota ?? 0,
                          }}
                          avisoLegado={l.quantidade === null}
                          textoSalvar="Salvar"
                          onCancelar={() => setEditando(null)}
                          onSalvo={async (dados) => {
                            const resultado = await editarProvento(l.id, dados);
                            if (resultado.error) throw new Error(resultado.error);
                            await atualizar();
                            setEditando(null);
                            toast.success("Provento atualizado.");
                          }}
                        />
                      </td>
                    </tr>
                  ) : (
                    <LinhaLancamento
                      key={l.id}
                      lancamento={l}
                      selecionado={selecionados.has(l.id)}
                      onSelecionar={() => alternarSelecao(l.id)}
                      onEditar={() => setEditando(l.id)}
                      onExcluir={() => setExcluindoId(l.id)}
                    />
                  )
                )}
              </tbody>
            </table>
          </div>

          {excluindoId && (
            <ConfirmModal
              title="Excluir provento?"
              message="Essa ação não pode ser desfeita."
              loading={excluindoLoading}
              onCancel={() => setExcluindoId(null)}
              onConfirm={async () => {
                setExcluindoLoading(true);
                await excluirProvento(excluindoId);
                setExcluindoLoading(false);
                setExcluindoId(null);
                await atualizar();
                toast.success("Provento excluído.");
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function CardResumo({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-faint">{label}</p>
      <p className="text-sm font-medium text-ink">{valor}</p>
    </div>
  );
}

function LinhaLancamento({
  lancamento: l,
  selecionado,
  onSelecionar,
  onEditar,
  onExcluir,
}: {
  lancamento: LancamentoProvento;
  selecionado: boolean;
  onSelecionar: () => void;
  onEditar: () => void;
  onExcluir: () => void;
}) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2 px-2">
        <input type="checkbox" checked={selecionado} onChange={onSelecionar} aria-label={`Selecionar provento de ${l.ativoTicker}`} />
      </td>
      <td className="py-2 px-2 text-muted">{formatarData(l.dataCom)}</td>
      <td className="py-2 px-2 text-muted">{formatarData(l.dataPagamento)}</td>
      <td className="py-2 px-2">
        <Link href={`/ativos/${l.ativoId}`} className="text-ink font-medium hover:underline">
          {l.ativoTicker}
        </Link>
      </td>
      <td className="py-2 px-2 text-muted">{rotuloProvento(l.tipo)}</td>
      <td className="py-2 px-2 text-right text-muted">{l.quantidade ?? "—"}</td>
      <td className="py-2 px-2 text-right text-muted">{l.valorPorCota !== null ? formatarMoeda(l.valorPorCota) : "—"}</td>
      <td className="py-2 px-2 text-right text-ink">{formatarMoeda(l.valorTotal)}</td>
      <td className="py-2 px-2">
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full ${
            l.status === "recebido" ? "bg-success-soft text-success" : "bg-surface-2 text-faint"
          }`}
        >
          {l.status === "recebido" ? "Recebido" : "Provisionado"}
        </span>
      </td>
      <td className="py-2 px-2 text-right whitespace-nowrap">
        <button onClick={onEditar} className="text-faint hover:text-ink mr-2">
          Editar
        </button>
        <button onClick={onExcluir} className="text-faint hover:text-danger">
          Excluir
        </button>
      </td>
    </tr>
  );
}

function FormProvento({
  ativos,
  valoresIniciais,
  avisoLegado = false,
  textoSalvar = "Salvar",
  onSalvo,
  onCancelar,
}: {
  ativos: AtivoOpcao[];
  valoresIniciais?: ProventoFormInput;
  avisoLegado?: boolean;
  textoSalvar?: string;
  onSalvo: (dados: ProventoForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(proventoSchema),
    defaultValues: valoresIniciais ?? {
      ativo_id: ativos[0]?.id ?? "",
      tipo: "dividendo" as const,
      data_com: "",
      data_pagamento: new Date().toISOString().slice(0, 10),
      quantidade: 0,
      valor_por_cota: 0,
    },
  });

  const toast = useToast();
  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvo(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    }
  });

  const quantidade = Number(watch("quantidade")) || 0;
  const valorPorCota = Number(watch("valor_por_cota")) || 0;
  const valorTotalPreview = quantidade * valorPorCota;

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {avisoLegado && (
        <p className="col-span-2 md:col-span-4 text-xs text-faint bg-surface-2 rounded-md px-3 py-2">
          Esse lançamento é antigo e não tem quantidade/valor por cota registrados — preencha os dois abaixo pra manter
          o Dividend Yield por cota exato (ou deixe como está e ajuste depois).
        </p>
      )}

      <div>
        <label className="label">Ativo</label>
        <select {...register("ativo_id")} className="input">
          {ativos.map((a) => (
            <option key={a.id} value={a.id}>
              {a.ticker}
            </option>
          ))}
        </select>
        {errors.ativo_id?.message && <p className="field-error">{errors.ativo_id.message}</p>}
      </div>

      <div>
        <label className="label">Tipo</label>
        <select {...register("tipo")} className="input">
          {TIPOS_PROVENTO.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Data-com (opcional)</label>
        <input type="date" {...register("data_com")} className="input" />
      </div>

      <div>
        <label className="label">Data de pagamento</label>
        <input type="date" {...register("data_pagamento")} className="input" />
        {errors.data_pagamento?.message && <p className="field-error">{errors.data_pagamento.message}</p>}
      </div>

      <div>
        <label className="label">Quantidade</label>
        <input type="number" step="0.00000001" {...register("quantidade", { valueAsNumber: true })} className="input" />
        {errors.quantidade?.message && <p className="field-error">{errors.quantidade.message}</p>}
      </div>

      <div>
        <label className="label">Valor por cota (R$)</label>
        <input type="number" step="0.000001" {...register("valor_por_cota", { valueAsNumber: true })} className="input" />
        {errors.valor_por_cota?.message && <p className="field-error">{errors.valor_por_cota.message}</p>}
      </div>

      <div>
        <label className="label">Valor total (calculado)</label>
        <p className="input flex items-center bg-surface-2 text-ink">{formatarMoeda(valorTotalPreview)}</p>
      </div>

      <div className="col-span-2 md:col-span-4 flex gap-2">
        <button type="button" onClick={onCancelar} className="btn btn-secondary flex-1">
          Cancelar
        </button>
        <button type="submit" disabled={isSubmitting} className="btn btn-primary flex-1">
          {isSubmitting ? "Salvando..." : textoSalvar}
        </button>
      </div>
    </form>
  );
}
