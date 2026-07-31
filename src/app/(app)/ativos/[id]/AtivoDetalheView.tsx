"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ativoSchema,
  classificacaoSchema,
  empresaSchema,
  EXCHANGES_CRIPTO,
  precoAtualSchema,
  resultadoTrimestralSchema,
  saldoAcionistasSchema,
  simboloTradingviewSchema,
  SUBTIPOS_INTERNACIONAL,
  SUBTIPOS_RENDA_FIXA,
  TIPOS_ATIVO,
  type AtivoForm,
  type ClassificacaoForm,
  type EmpresaForm,
  type PrecoAtualForm,
  type ResultadoTrimestralForm,
  type SaldoAcionistasForm,
  type SimboloTradingviewForm,
} from "@/lib/ativos/schema";
import {
  atualizarCotacaoAgora,
  atualizarEmpresaManual,
  atualizarPrecoAtual,
  atualizarSimboloTradingview,
  buscarDadosCadastraisAtivo,
  classificarAtivo,
  editarAtivo,
  excluirAtivo,
  excluirResultadoTrimestral,
  obterAtivoDetalhe,
  obterChecklistAtivo,
  removerClassificacao,
  salvarResultadoTrimestral,
  salvarSaldoAcionistas,
  type AtivoDetalhe,
  type ChecklistAtivoView,
  type ClasseOpcao,
  type EmpresaView,
  type ResultadoTrimestralItem,
  type TipoAtivo,
  type TransacaoItem,
} from "@/lib/ativos/actions";
import { TIPOS_CARTAO_EMPRESA } from "@/lib/ativos/empresas";
import { transacaoSchema, TIPOS_TRANSACAO, type TransacaoForm } from "@/lib/carteira/schema";
import { TIPOS_PROVENTO } from "@/lib/proventos/schema";
import { criarTransacao, excluirTransacao, type Corretora } from "@/lib/carteira/actions";
import { obterRentabilidadeHistoricaAtivo, type PontoRentabilidade } from "@/lib/ativos/preco-historico";
import DesvioBar from "@/components/DesvioBar";
import TradingViewChart from "@/components/TradingViewChart";
import SerieLinhaChart from "@/components/SerieLinhaChart";
import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/components/ToastProvider";
import { TOLERANCIA_REBALANCEAMENTO_PP } from "@/lib/alocacao/constants";
import {
  calcularSerieChecklistAcao,
  calcularSerieChecklistFii,
  gerarInsightsAcao,
  gerarInsightsFii,
  type Insight,
  type PontoSerieAcaoComPreco,
} from "@/lib/ativos/checklist-estatisticas";

const rotuloTipo = (valor: string) => TIPOS_ATIVO.find((t) => t.valor === valor)?.label ?? valor;
const rotuloProvento = (valor: string) => TIPOS_PROVENTO.find((t) => t.valor === valor)?.label ?? valor;

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Mesma formatação de `formatarMoeda`, mas respeitando a moeda de origem do
 * Checklist (ver docs/MAPA-DE-DADOS.md §8.66) — ativo internacional nunca
 * converte USD→BRL no Checklist/Preço Justo (o Guilherme lança os dados
 * trimestrais sempre em USD), então precisa rotular certo em vez de sempre
 * mostrar R$.
 */
const formatarMoedaEm = (valor: number, moeda: "BRL" | "USD") =>
  valor.toLocaleString(moeda === "USD" ? "en-US" : "pt-BR", { style: "currency", currency: moeda });

const formatarData = (iso: string) => {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

/**
 * Eventos societários (ver docs/MAPA-DE-DADOS.md §8.22) reaproveitam as
 * mesmas colunas de "Quantidade"/"Valor" da lista de transações do Ativo,
 * igual ao Livro-razão — mesmo padrão de exibição, sem duplicar a decisão
 * de layout.
 */
const labelTipoTransacaoAtivo = (tipo: TransacaoItem["tipo"]) =>
  TIPOS_TRANSACAO.find((t) => t.valor === tipo)?.label ?? tipo;

const corTipoTransacaoAtivo = (tipo: TransacaoItem["tipo"]) => {
  if (tipo === "compra") return "text-success";
  if (tipo === "venda") return "text-danger";
  return "text-accent";
};

const celulaQuantidadeAtivo = (t: TransacaoItem) => {
  if (t.tipo === "desdobramento" || t.tipo === "grupamento") return "—";
  return t.quantidade !== null ? `${t.quantidade.toLocaleString("pt-BR")} un` : "—";
};

const celulaValorAtivo = (t: TransacaoItem) => {
  if (t.tipo === "compra" || t.tipo === "venda") {
    return t.precoUnitario !== null ? formatarMoeda(t.precoUnitario) : "—";
  }
  if (t.tipo === "bonificacao") {
    return t.valorCapitalizado !== null ? `${formatarMoeda(t.valorCapitalizado)} capitalizado` : "—";
  }
  return t.fatorProporcao !== null ? `Fator ${t.fatorProporcao.toLocaleString("pt-BR")}` : "—";
};

function formatarTempoRelativo(iso: string | null): string {
  if (!iso) return "nunca atualizado";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutos = Math.floor(diffMs / 60000);
  if (minutos < 1) return "atualizado agora mesmo";
  if (minutos < 60) return `atualizado há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `atualizado há ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias < 30) return `atualizado há ${dias} dia${dias > 1 ? "s" : ""}`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `atualizado há ${meses} ${meses > 1 ? "meses" : "mês"}`;
  const anos = Math.floor(meses / 12);
  return `atualizado há ${anos} ano${anos > 1 ? "s" : ""}`;
}

// ---------------------------------------------------------------------------
// Formatação — checklist e resultados trimestrais (ver docs/MAPA-DE-DADOS.md
// §8.10). Tudo que é "—" significa dado insuficiente pro cálculo (menos de 4
// trimestres pra TTM, ou o trimestre exato de 5 anos atrás não foi lançado).
// ---------------------------------------------------------------------------
function formatarNumero(v: number | null, casas = 2): string {
  if (v === null) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: 0 });
}

function formatarNumeroCompacto(v: number | null): string {
  if (v === null) return "—";
  return v.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
}

function formatarPct(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(2)}%`;
}

function formatarRatio(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(2)}x`;
}

function trimestreAnoAnterior(anoTrimestre: string): string {
  const [anoStr, tStr] = anoTrimestre.split("-Q");
  return `${Number(anoStr) - 1}-Q${tStr}`;
}

function variacaoPct(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || anterior === 0) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

function formatarVariacao(v: number | null): string {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function classeVariacao(v: number | null): string {
  if (v === null) return "text-faint";
  return v >= 0 ? "text-success" : "text-danger";
}

const ABAS = [
  { id: "geral", label: "Visão geral" },
  { id: "trimestrais", label: "Resultados trimestrais" },
] as const;
type AbaId = (typeof ABAS)[number]["id"];

export default function AtivoDetalheView({
  ativoInicial,
  classesSetores,
  corretoras,
  checklistInicial,
  rentabilidadeInicial,
}: {
  ativoInicial: AtivoDetalhe;
  classesSetores: ClasseOpcao[];
  corretoras: Corretora[];
  checklistInicial: ChecklistAtivoView | null;
  rentabilidadeInicial: PontoRentabilidade[];
}) {
  const router = useRouter();
  const [ativo, setAtivo] = useState(ativoInicial);
  const [checklist, setChecklist] = useState(checklistInicial);
  const [rentabilidade, setRentabilidade] = useState(rentabilidadeInicial);
  const [aba, setAba] = useState<AbaId>("geral");
  const [editandoIdentidade, setEditandoIdentidade] = useState(false);
  const [editandoClassificacao, setEditandoClassificacao] = useState(false);
  const [editandoPreco, setEditandoPreco] = useState(false);
  const [editandoSimbolo, setEditandoSimbolo] = useState(false);
  const [addTransacao, setAddTransacao] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [excluindoAtivoLoading, setExcluindoAtivoLoading] = useState(false);
  const [excluindoTransacaoId, setExcluindoTransacaoId] = useState<string | null>(null);
  const [excluindoTransacaoLoading, setExcluindoTransacaoLoading] = useState(false);
  const [atualizandoCotacao, setAtualizandoCotacao] = useState(false);
  const [removendoClassificacao, setRemovendoClassificacao] = useState(false);
  const [removendoClassificacaoLoading, setRemovendoClassificacaoLoading] = useState(false);
  const toast = useToast();

  const atualizar = async () => {
    const novo = await obterAtivoDetalhe(ativo.id);
    if (novo) setAtivo(novo);
  };

  const atualizarChecklist = async () => {
    const novo = await obterChecklistAtivo(ativo.id);
    setChecklist(novo);
  };

  const atualizarRentabilidade = async () => {
    const nova = await obterRentabilidadeHistoricaAtivo(ativo.id);
    setRentabilidade(nova);
  };

  const atualizarTudo = async () => {
    await Promise.all([atualizar(), atualizarChecklist(), atualizarRentabilidade()]);
  };

  const precoDefinido = ativo.precoAtualizadoEm !== null;
  const lucroPositivo = ativo.lucroNaoRealizado >= 0;
  const temChecklist = checklist !== null && checklist.grupo !== null;
  // Ativo zerado com histórico (ver docs/MAPA-DE-DADOS.md, item "estado
  // ativo encerrado") — quantidade 0 mas já recebeu proventos ou já teve
  // lucro/prejuízo realizado em vendas. Sem isso, a grade de Posição mistura
  // "R$ 0,00" de posição zerada com números reais de histórico, o que pode
  // parecer um bug visual (era exatamente o cenário do print que motivou
  // esta rodada de correções).
  const posicaoEncerrada = ativo.quantidade === 0 && (ativo.proventosRecebidos > 0 || ativo.lucroRealizado !== 0);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/ativos" className="text-xs text-faint hover:text-ink">
          ← Voltar para Ativos
        </Link>
      </div>

      <div className="card p-5">
        {editandoIdentidade ? (
          <FormIdentidade
            valoresIniciais={{
              ticker: ativo.ticker,
              nome: ativo.nome ?? undefined,
              tipo: ativo.tipo,
              subtipo_renda_fixa: ativo.subtipoRendaFixa as AtivoForm["subtipo_renda_fixa"],
              cripto_exchange: ativo.criptoExchange as AtivoForm["cripto_exchange"],
              subtipo_internacional: ativo.subtipoInternacional as AtivoForm["subtipo_internacional"],
            }}
            onCancelar={() => setEditandoIdentidade(false)}
            onSalvo={async (dados) => {
              const resultado = await editarAtivo(ativo.id, dados);
              if (resultado.error) throw new Error(resultado.error);
              await atualizarTudo();
              setEditandoIdentidade(false);
              toast.success("Ativo atualizado.");
            }}
          />
        ) : (
          <div className="flex items-start justify-between">
            <div>
              {/* Escala 1920x1080 (§8.61): text-2xl→text-3xl e text-sm→text-base,
                  mesmo salto usado no título da Carteira (§8.60). */}
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-3xl font-medium text-ink">{ativo.ticker}</h1>
                {posicaoEncerrada && (
                  <span
                    title="Quantidade zerada — os números abaixo são histórico acumulado da posição já encerrada, não um erro."
                    className="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 border border-border text-faint cursor-help"
                  >
                    Posição encerrada
                  </span>
                )}
              </div>
              <p className="text-base text-muted">
                {rotuloTipo(ativo.tipo)}
                {ativo.nome && ` · ${ativo.nome}`}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setEditandoIdentidade(true)}
                className="text-xs text-faint hover:text-ink"
              >
                Editar
              </button>
              <button
                onClick={() => setExcluindo(true)}
                className="text-xs text-faint hover:text-danger"
              >
                Excluir
              </button>
            </div>
          </div>
        )}

        {excluindo && (
          <ConfirmModal
            title={`Excluir ${ativo.ticker}?`}
            message="O ativo é excluído por completo — transações e proventos lançados nele também somem. Essa ação não pode ser desfeita."
            loading={excluindoAtivoLoading}
            onCancel={() => setExcluindo(false)}
            onConfirm={async () => {
              setExcluindoAtivoLoading(true);
              const resultado = await excluirAtivo(ativo.id);
              if (resultado.error) {
                setExcluindoAtivoLoading(false);
                toast.error(resultado.error);
                return;
              }
              toast.success("Ativo excluído.");
              router.push("/ativos");
            }}
          />
        )}

        {removendoClassificacao && (
          <ConfirmModal
            title="Remover classificação?"
            message="O ativo volta a aparecer como 'Não classificado' na Alocação e na Posição por Alocação. Essa ação não pode ser desfeita."
            loading={removendoClassificacaoLoading}
            onCancel={() => setRemovendoClassificacao(false)}
            onConfirm={async () => {
              setRemovendoClassificacaoLoading(true);
              const resultado = await removerClassificacao(ativo.id);
              setRemovendoClassificacaoLoading(false);
              if (resultado.error) {
                toast.error(resultado.error);
                return;
              }
              setRemovendoClassificacao(false);
              await atualizar();
              toast.success("Classificação removida.");
            }}
          />
        )}
      </div>

      {TIPOS_CARTAO_EMPRESA.includes(ativo.tipo) && (
        <CartaoEmpresa ativoId={ativo.id} tipo={ativo.tipo} empresa={ativo.empresa} onAtualizado={atualizar} />
      )}

      {temChecklist && (
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
      )}

      {aba === "geral" && (
        <>
          {/* Reordenado (ver docs/MAPA-DE-DADOS.md, item "reordenar seções +
              hero numbers"): Posição e Checklist/Preço Justo (a informação
              mais valiosa pra decidir comprar/vender) agora vêm logo no
              topo, antes de Gráfico/Classificação/Rentabilidade histórica —
              antes ficavam na 3ª e 9ª posição de 11 seções. */}
          <div className="card p-5">
            <h2 className="text-base font-medium text-ink mb-3">Posição</h2>

            {!precoDefinido && (
              <div className="rounded-md bg-surface-2 border border-border px-3 py-2 mb-3 text-xs text-muted">
                Preço atual ainda não foi definido — os números de lucro abaixo ficam disponíveis assim
                que você informar o preço atual do ativo.
              </div>
            )}

            {/* Hero numbers — os 3 KPIs mais importantes da posição, mesmo
                padrão "número-herói" (text-2xl) já usado em Carteira/
                Proventos/Indicadores/IR desde §8.60-8.64; a página do Ativo
                tinha ficado de fora desse rollout até agora. */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-4 pb-4 border-b border-border">
              <div>
                <p className="text-faint text-sm mb-1">Valor atual</p>
                <p className="text-ink text-2xl font-medium">
                  {precoDefinido ? formatarMoeda(ativo.valorAtual) : "—"}
                </p>
              </div>
              <div>
                <p className="text-faint text-sm mb-1">Lucro não realizado</p>
                {precoDefinido ? (
                  <>
                    <p className={`text-2xl font-medium ${lucroPositivo ? "text-success" : "text-danger"}`}>
                      {formatarMoeda(ativo.lucroNaoRealizado)}
                    </p>
                    <p className={`text-sm ${lucroPositivo ? "text-success" : "text-danger"}`}>
                      {lucroPositivo ? "+" : ""}
                      {ativo.lucroNaoRealizadoPct.toFixed(1)}%
                    </p>
                  </>
                ) : (
                  <button
                    onClick={() => setEditandoPreco(true)}
                    className="text-faint hover:text-ink underline underline-offset-2 text-sm"
                  >
                    Defina o preço atual
                  </button>
                )}
              </div>
              <div>
                <p className="text-faint text-sm mb-1">Retorno total</p>
                {precoDefinido ? (
                  <p className={`text-2xl font-medium ${ativo.retornoTotal >= 0 ? "text-success" : "text-danger"}`}>
                    {formatarMoeda(ativo.retornoTotal)}
                  </p>
                ) : (
                  <button
                    onClick={() => setEditandoPreco(true)}
                    className="text-faint hover:text-ink underline underline-offset-2 text-sm"
                  >
                    Defina o preço atual
                  </button>
                )}
              </div>
            </div>

            {/* Métricas de apoio (mesmo componente Metrica de antes, agora
                sem os 3 hero numbers acima pra não duplicar). */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm mb-3">
              <Metrica label="Quantidade" valor={ativo.quantidade.toLocaleString("pt-BR")} />
              <Metrica label="Preço médio" valor={formatarMoeda(ativo.precoMedio)} />
              <Metrica label="Valor aplicado" valor={formatarMoeda(ativo.valorAplicado)} />
              <Metrica
                label="Lucro realizado"
                valor={formatarMoeda(ativo.lucroRealizado)}
                destaque={ativo.lucroRealizado >= 0 ? "success" : "danger"}
              />
              <Metrica label="Proventos recebidos" valor={formatarMoeda(ativo.proventosRecebidos)} />
            </div>

            {editandoPreco ? (
              <FormPrecoAtual
                valorInicial={ativo.precoAtual}
                onCancelar={() => setEditandoPreco(false)}
                onSalvo={async (dados) => {
                  const resultado = await atualizarPrecoAtual(ativo.id, dados);
                  if (resultado.error) throw new Error(resultado.error);
                  await atualizarTudo();
                  setEditandoPreco(false);
                  toast.success("Preço atual atualizado.");
                }}
              />
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => setEditandoPreco(true)} className="text-xs text-faint hover:text-ink">
                  Preço atual: {formatarMoeda(ativo.precoAtual)} · {formatarTempoRelativo(ativo.precoAtualizadoEm)}
                  {ativo.precoFonte === "yahoo_finance" && " · fonte: Yahoo Finance"}
                  {ativo.precoFonte === "manual" && " · fonte: manual"} (editar)
                </button>
                {ativo.cotacaoAutomatica && (
                  <button
                    disabled={atualizandoCotacao}
                    onClick={async () => {
                      setAtualizandoCotacao(true);
                      const resultado = await atualizarCotacaoAgora(ativo.id);
                      if (resultado.error) {
                        setAtualizandoCotacao(false);
                        toast.error(resultado.error);
                        return;
                      }
                      await atualizarTudo();
                      setAtualizandoCotacao(false);
                      toast.success("Cotação atualizada.");
                    }}
                    className="text-xs text-accent hover:underline disabled:opacity-50"
                  >
                    {atualizandoCotacao ? "Buscando cotação..." : "Atualizar agora"}
                  </button>
                )}
              </div>
            )}
          </div>

          {checklist && checklist.grupo && (
            <SecaoChecklist ativoId={ativo.id} checklist={checklist} onAtualizado={atualizarChecklist} />
          )}

          <div className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-medium text-ink">Gráfico</h2>
              {editandoSimbolo ? (
                <FormSimbolo
                  valorInicial={ativo.simboloTradingviewManual ? ativo.simboloTradingview : ""}
                  onCancelar={() => setEditandoSimbolo(false)}
                  onSalvo={async (dados) => {
                    const resultado = await atualizarSimboloTradingview(ativo.id, dados);
                    if (resultado.error) throw new Error(resultado.error);
                    await atualizar();
                    setEditandoSimbolo(false);
                    toast.success("Símbolo do gráfico atualizado.");
                  }}
                />
              ) : (
                <button
                  onClick={() => setEditandoSimbolo(true)}
                  className="text-xs text-faint hover:text-ink"
                >
                  Símbolo: {ativo.simboloTradingview}
                  {!ativo.simboloTradingviewManual && " (automático)"} · Ajustar
                </button>
              )}
            </div>
            <TradingViewChart symbol={ativo.simboloTradingview} />
          </div>

          <div className="card p-5">
            <h2 className="text-base font-medium text-ink mb-3">Classificação</h2>
            {editandoClassificacao ? (
              <FormClassificacao
                classesSetores={classesSetores}
                valoresIniciais={
                  ativo.setorId ? { setor_id: ativo.setorId, peso_alvo: ativo.pesoAlvo ?? 0 } : undefined
                }
                onCancelar={() => setEditandoClassificacao(false)}
                onSalvo={async (dados) => {
                  const resultado = await classificarAtivo(ativo.id, dados);
                  if (resultado.error) throw new Error(resultado.error);
                  await atualizar();
                  setEditandoClassificacao(false);
                  toast.success("Classificação salva.");
                }}
              />
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  {ativo.setorNome ? (
                    <>
                      <span className="text-ink">
                        {ativo.classeNome} › {ativo.setorNome}
                      </span>
                      <span className="text-faint ml-2">peso-alvo {ativo.pesoAlvo?.toFixed(0)}%</span>
                    </>
                  ) : (
                    <span className="text-faint">Não classificado ainda.</span>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setEditandoClassificacao(true)}
                    className="text-xs text-faint hover:text-ink"
                  >
                    {ativo.setorNome ? "Editar" : "Classificar"}
                  </button>
                  {ativo.setorNome && (
                    <button
                      onClick={() => setRemovendoClassificacao(true)}
                      className="text-xs text-faint hover:text-danger"
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>
            )}

            {ativo.setorNome && ativo.pesoReal !== null && ativo.desvio !== null && (
              <div className="mt-3 pt-3 border-t border-border">
                <DesvioBar
                  label={ativo.ticker}
                  pesoAlvo={ativo.pesoAlvo ?? 0}
                  pesoReal={ativo.pesoReal}
                  desvio={ativo.desvio}
                  tolerancia={TOLERANCIA_REBALANCEAMENTO_PP}
                />
              </div>
            )}
          </div>

          {ativo.transacoes.length > 0 && (
            <div className="card p-5">
              <h2 className="text-base font-medium text-ink mb-1">Rentabilidade histórica</h2>
              <p className="text-xs text-faint mb-3">
                Retorno acumulado dia a dia (posição ainda em carteira + lucro já realizado em vendas
                parciais, sobre tudo que já foi investido em compras) — vai da primeira negociação até a
                venda final (ou até hoje, se ainda em carteira). Diferente do &ldquo;lucro não
                realizado&rdquo; acima, que só compara o preço de hoje contra o custo médio atual.
              </p>
              <SerieLinhaChart
                pontos={rentabilidade
                  .filter((p) => p.rentabilidadePct !== null)
                  .map((p) => ({ data: p.data, valor: p.rentabilidadePct as number }))}
                formatarValor={(v) => `${v.toFixed(1)}%`}
                ariaLabel={`Rentabilidade histórica de ${ativo.ticker}`}
                mostrarLinhaZero
              />
            </div>
          )}

          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-medium text-ink">Transações</h2>
              {!addTransacao && (
                <button onClick={() => setAddTransacao(true)} className="text-xs text-faint hover:text-ink">
                  + Registrar transação
                </button>
              )}
            </div>

            {addTransacao && (
              <FormTransacao
                ativoId={ativo.id}
                tipoAtivo={ativo.tipo}
                corretoras={corretoras}
                onCancelar={() => setAddTransacao(false)}
                onSalvo={async (dados) => {
                  const resultado = await criarTransacao(dados);
                  if (resultado.error) throw new Error(resultado.error);
                  await atualizar();
                  setAddTransacao(false);
                  toast.success("Transação registrada.");
                }}
              />
            )}

            {ativo.transacoes.length === 0 ? (
              <p className="text-xs text-faint">Nenhuma transação lançada ainda.</p>
            ) : (
              <div className="space-y-1">
                {ativo.transacoes.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between text-sm bg-surface-2 rounded-md px-3 py-2"
                  >
                    <span className={corTipoTransacaoAtivo(t.tipo)}>{labelTipoTransacaoAtivo(t.tipo)}</span>
                    <span className="text-muted">{formatarData(t.data)}</span>
                    <span className="text-muted">{celulaQuantidadeAtivo(t)}</span>
                    <span className="text-muted">{celulaValorAtivo(t)}</span>
                    <span className="text-faint">{t.corretoraNome ?? "—"}</span>
                    <button
                      onClick={() => setExcluindoTransacaoId(t.id)}
                      className="text-faint hover:text-danger"
                    >
                      Excluir
                    </button>
                  </div>
                ))}
              </div>
            )}

            {excluindoTransacaoId && (
              <ConfirmModal
                title="Excluir transação?"
                message="Essa ação não pode ser desfeita."
                loading={excluindoTransacaoLoading}
                onCancel={() => setExcluindoTransacaoId(null)}
                onConfirm={async () => {
                  setExcluindoTransacaoLoading(true);
                  const resultado = await excluirTransacao(excluindoTransacaoId);
                  setExcluindoTransacaoLoading(false);
                  if (resultado.error) {
                    toast.error(resultado.error);
                    return;
                  }
                  await atualizar();
                  setExcluindoTransacaoId(null);
                  toast.success("Transação excluída.");
                }}
              />
            )}
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-medium text-ink">Proventos</h2>
              <Link href="/proventos" className="text-xs text-faint hover:text-ink">
                Cadastrar na aba Proventos →
              </Link>
            </div>

            {ativo.proventos.length === 0 ? (
              <p className="text-xs text-faint">Nenhum provento registrado ainda.</p>
            ) : (
              <div className="space-y-1">
                {ativo.proventos.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between text-sm bg-surface-2 rounded-md px-3 py-2"
                  >
                    <span className="text-muted">{rotuloProvento(p.tipo)}</span>
                    <span className="text-muted">{formatarData(p.data)}</span>
                    <span className="text-ink">{formatarMoeda(p.valorTotal)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {aba === "trimestrais" && checklist && checklist.grupo && (
        <>
          <SecaoResultadosTrimestrais
            ativoId={ativo.id}
            grupo={checklist.grupo}
            resultados={checklist.resultados}
            onAtualizado={atualizarChecklist}
          />
          <PainelMonitoramento
            grupo={checklist.grupo}
            resultados={checklist.resultados}
            serieChecklistComPreco={checklist.serieChecklistComPreco}
          />
        </>
      )}
    </div>
  );
}

function Metrica({
  label,
  valor,
  destaque,
  formula,
}: {
  label: string;
  valor: string;
  destaque?: "success" | "danger";
  /** Fórmula do indicador, mostrada em tooltip nativo (title) — ver docs/MAPA-DE-DADOS.md §8.65. */
  formula?: string;
}) {
  return (
    <div>
      <p className="text-faint flex items-center gap-1">
        {label}
        {formula && (
          <span
            title={`FÓRMULA: ${formula}`}
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-border text-faint text-[9px] leading-none cursor-help shrink-0"
            aria-label={`Fórmula de ${label}: ${formula}`}
          >
            ?
          </span>
        )}
      </p>
      <p
        className={
          destaque === "success" ? "text-success" : destaque === "danger" ? "text-danger" : "text-ink"
        }
      >
        {valor}
      </p>
    </div>
  );
}

/** Card do Preço Justo (Graham/Bazin) — ver docs/MAPA-DE-DADOS.md §8.65. */
function PrecoJustoCard({
  label,
  formula,
  precoJusto,
  precoAtual,
  moeda,
}: {
  label: string;
  formula: string;
  precoJusto: number | null;
  precoAtual: number;
  /** Moeda do checklist do ativo (ver docs/MAPA-DE-DADOS.md §8.66) — internacional nunca converte, só rotula US$ em vez de R$. */
  moeda: "BRL" | "USD";
}) {
  const upside = precoJusto !== null && precoAtual > 0 ? ((precoJusto - precoAtual) / precoAtual) * 100 : null;
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-faint flex items-center gap-1">
        Preço Justo ({label})
        <span
          title={`FÓRMULA: ${formula}`}
          className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-border text-faint text-[9px] leading-none cursor-help shrink-0"
          aria-label={`Fórmula: ${formula}`}
        >
          ?
        </span>
      </p>
      <p className="text-ink text-base font-medium mt-0.5">
        {precoJusto !== null ? formatarMoedaEm(precoJusto, moeda) : "—"}
      </p>
      {upside !== null && (
        <p className={`text-xs mt-0.5 ${upside >= 0 ? "text-success" : "text-danger"}`}>
          {upside >= 0 ? "↑" : "↓"} {Math.abs(upside).toFixed(1)}% vs. preço atual
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checklist comparativo (ver docs/MAPA-DE-DADOS.md §8.10) — os índices vêm
// prontos do servidor (calcularChecklistAcao/Fii, sempre recalculados a
// partir dos resultados trimestrais); o único campo editável aqui é o Saldo
// dos Acionistas (nota de governança livre, não entra em nenhuma fórmula).
// ---------------------------------------------------------------------------
function SecaoChecklist({
  ativoId,
  checklist,
  onAtualizado,
}: {
  ativoId: string;
  checklist: ChecklistAtivoView;
  onAtualizado: () => Promise<void>;
}) {
  const [editandoSaldo, setEditandoSaldo] = useState(false);
  const toast = useToast();

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-medium text-ink">
          Checklist comparativo {checklist.grupo === "acoes" ? "— Ações/ETF" : "— FIIs"}
        </h2>
        <Link
          href={`/ativos/comparar?grupo=${checklist.grupo}`}
          className="text-xs text-faint hover:text-ink"
        >
          Comparar com outros →
        </Link>
      </div>

      {/* Idade/fonte do preço usado no cálculo (ver docs/MAPA-DE-DADOS.md
          §8.66) — mesma informação já mostrada no card Posição, reaproveitada
          aqui pra não deixar P/L, P/VP, Preço Justo etc. baseados num preço
          desatualizado sem aviso nesta seção. */}
      <p className="text-xs text-faint mb-3">
        Calculado com o preço {formatarMoedaEm(checklist.precoAtual, checklist.moeda)} ·{" "}
        {formatarTempoRelativo(checklist.precoAtualizadoEm)}
        {checklist.precoFonte === "yahoo_finance" && " · fonte: Yahoo Finance"}
        {checklist.precoFonte === "manual" && " · fonte: manual"}
        {checklist.moeda === "USD" && " · ativo internacional: valores em dólar, sem conversão"}
      </p>

      {checklist.resultados.length === 0 && (
        <div className="rounded-md bg-surface-2 border border-border px-3 py-2 mb-3 text-xs text-muted">
          Nenhum resultado trimestral lançado ainda — os índices abaixo aparecem conforme você
          preenche os dados brutos na sub-aba &quot;Resultados trimestrais&quot;.
        </div>
      )}

      {checklist.grupo === "acoes" && checklist.checklistAcao && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 text-sm mb-4">
          <Metrica label="P/L" valor={formatarRatio(checklist.checklistAcao.pl)} formula="Preço atual / LPA (lucro por ação, 12 meses)" />
          <Metrica
            label="PEG Ratio"
            valor={formatarRatio(checklist.checklistAcao.pegRatio)}
            formula="P/L / [(LPA últimos 4 trimestres / LPA dos 4 trimestres anteriores) − 1] × 100"
          />
          <Metrica label="P/VP" valor={formatarRatio(checklist.checklistAcao.pvp)} formula="Preço atual / VPA (valor patrimonial por ação)" />
          <Metrica
            label="Dividend Yield"
            valor={formatarPct(checklist.checklistAcao.dividendYieldPct)}
            formula="Dividendo por ação pago nos últimos 12 meses / Preço atual"
          />
          <Metrica label="ROE" valor={formatarPct(checklist.checklistAcao.roePct)} formula="Lucro líquido (12 meses) / Patrimônio líquido" />
          <Metrica label="ROA" valor={formatarPct(checklist.checklistAcao.roaPct)} formula="Lucro líquido (12 meses) / Ativo total" />
          <Metrica
            label="ROIC"
            valor={formatarPct(checklist.checklistAcao.roicPct)}
            formula="(EBIT − Impostos, 12 meses) / (Dívida líquida + Patrimônio líquido) — aproximação com alíquota efetiva padrão de 34%"
          />
          <Metrica label="Mg. Bruta" valor={formatarPct(checklist.checklistAcao.margemBrutaPct)} formula="Lucro bruto (12 meses) / Receita líquida (12 meses)" />
          <Metrica label="Mg. Lucro" valor={formatarPct(checklist.checklistAcao.margemLucroPct)} formula="Lucro líquido (12 meses) / Receita líquida (12 meses)" />
          <Metrica label="DL/PL" valor={formatarRatio(checklist.checklistAcao.dlPl)} formula="Dívida líquida / Patrimônio líquido" />
          <Metrica
            label="Dívida Bruta/EBITDA"
            valor={formatarRatio(checklist.checklistAcao.dividaBrutaEbitda)}
            formula="Dívida bruta / EBITDA (12 meses)"
          />
          <Metrica label="Liq. Corrente" valor={formatarRatio(checklist.checklistAcao.liquidezCorrente)} formula="Ativo circulante / Passivo circulante" />
          <Metrica
            label="CAGR EBIT (5 anos)"
            valor={formatarPct(checklist.checklistAcao.cagrEbit5AnosPct)}
            formula="[(EBIT atual / EBIT de 5 anos atrás) ^ (1/5) − 1] × 100"
          />
          <Metrica
            label="CAGR Lucro (5 anos)"
            valor={formatarPct(checklist.checklistAcao.cagrLucro5AnosPct)}
            formula="[(Lucro líquido atual / Lucro líquido de 5 anos atrás) ^ (1/5) − 1] × 100"
          />
        </div>
      )}

      {/* Indicadores de mercado do Status Invest (fase 1 — Ações, ver
          docs/MAPA-DE-DADOS.md §8.67) — complementam o checklist manual
          acima com indicadores que dependem de linhas de balanço que o app
          ainda não pede pra lançar à mão (EV/EBITDA, EV/EBIT, P/EBITDA,
          P/EBIT, P/Ativo, P/SR, P/Cap. Giro, P/Ativo Circ. Líq.,
          Passivos/Ativos, Giro Ativos, CAGR Receita 5 anos). Só aparece pra
          tipo=acao (não etf/internacional) e só depois que o cron diário
          já rodou pelo menos 1x pra esse ticker. */}
      {checklist.grupo === "acoes" && checklist.tipo === "acao" && checklist.indicadoresMercado && (
        <div className="pt-3 border-t border-border mb-4">
          <p className="text-faint text-xs mb-2">
            Indicadores de mercado (Status Invest) ·{" "}
            {formatarTempoRelativo(checklist.indicadoresMercadoData)}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-sm">
            <Metrica label="EV/EBITDA" valor={formatarRatio(checklist.indicadoresMercado.evEbitda)} />
            <Metrica label="EV/EBIT" valor={formatarRatio(checklist.indicadoresMercado.evEbit)} />
            <Metrica label="P/EBITDA" valor={formatarRatio(checklist.indicadoresMercado.pEbitda)} />
            <Metrica label="P/EBIT" valor={formatarRatio(checklist.indicadoresMercado.pEbit)} />
            <Metrica label="P/Ativo" valor={formatarRatio(checklist.indicadoresMercado.pAtivo)} />
            <Metrica label="P/SR" valor={formatarRatio(checklist.indicadoresMercado.psr)} />
            <Metrica label="P/Cap. Giro" valor={formatarRatio(checklist.indicadoresMercado.pCapitalGiro)} />
            <Metrica label="P/Ativo Circ. Líq." valor={formatarRatio(checklist.indicadoresMercado.pAtivoCirculanteLiq)} />
            <Metrica label="Passivos/Ativos" valor={formatarRatio(checklist.indicadoresMercado.passivosAtivos)} />
            <Metrica label="Giro Ativos" valor={formatarRatio(checklist.indicadoresMercado.giroAtivos)} />
            <Metrica label="CAGR Receita (5 anos)" valor={formatarPct(checklist.indicadoresMercado.cagrReceita5AnosPct)} />
          </div>
        </div>
      )}

      {checklist.grupo === "acoes" && checklist.checklistAcao && (
        <div className="pt-3 border-t border-border mb-4">
          <p className="text-faint text-xs mb-2">Preço Justo (métodos clássicos de valuation — ver docs/MAPA-DE-DADOS.md §8.65)</p>
          <div className="grid grid-cols-2 gap-3">
            <PrecoJustoCard
              label="Graham"
              formula="√(22,5 × LPA × VPA)"
              precoJusto={checklist.checklistAcao.precoJustoGraham}
              precoAtual={checklist.precoAtual}
              moeda={checklist.moeda}
            />
            <PrecoJustoCard
              label="Bazin"
              formula="Dividendo anual por ação (últimos 12 meses) / 0,06"
              precoJusto={checklist.checklistAcao.precoJustoBazin}
              precoAtual={checklist.precoAtual}
              moeda={checklist.moeda}
            />
          </div>
          <p className="text-[11px] text-faint mt-2 leading-relaxed">
            Isso não é recomendação de compra/venda — são só duas fórmulas clássicas de valuation, não
            uma previsão. Graham usa o valor patrimonial no cálculo, então tende a subestimar empresas
            com pouco patrimônio físico (ex.: tecnologia). Bazin assume 6% de yield fixo como &quot;justo&quot;,
            premissa que não se ajusta à Selic atual.
          </p>
        </div>
      )}

      {checklist.grupo === "fiis" && checklist.checklistFii && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 text-sm mb-4">
          <Metrica label="P/VP" valor={formatarRatio(checklist.checklistFii.pvp)} formula="Preço atual / Valor patrimonial por cota" />
          <Metrica label="Nº Negócios/mês" valor={formatarNumero(checklist.checklistFii.numeroNegociosMes, 0)} />
          <Metrica label="Vacância Financeira" valor={formatarPct(checklist.checklistFii.vacanciaFinanceiraPct)} />
          <Metrica label="Vacância Física" valor={formatarPct(checklist.checklistFii.vacanciaFisicaPct)} />
          <Metrica
            label="Cap Rate"
            valor={formatarPct(checklist.checklistFii.capRatePct)}
            formula="(Receita imobiliária do trimestre × 4) / Valor de avaliação dos imóveis — anualização aproximada"
          />
          <Metrica
            label="Dividend Yield (12m)"
            valor={formatarPct(checklist.checklistFii.dividendYieldPct)}
            formula="Proventos pagos nos últimos 12 meses (data-com) / Preço atual"
          />
          <Metrica
            label="Valor m²/Aluguel"
            valor={checklist.checklistFii.valorM2Aluguel !== null ? formatarMoeda(checklist.checklistFii.valorM2Aluguel) : "—"}
          />
        </div>
      )}

      {checklist.avisoYieldAtipico && (
        <div className="rounded-md bg-danger-soft border border-border px-3 py-2 mb-4 text-xs text-danger">
          O Dividend Yield acima pode estar inflado: o pagamento de {formatarData(checklist.avisoYieldAtipico.data)}
          {" "}({formatarMoeda(checklist.avisoYieldAtipico.valor)}) foi mais que o dobro da mediana dos demais
          pagamentos dos últimos 12 meses ({formatarMoeda(checklist.avisoYieldAtipico.medianaDemais)}) — pode ser
          um provento extraordinário, não o pagamento recorrente do ativo (ver docs/MAPA-DE-DADOS.md §8.65).
        </div>
      )}

      {checklist.grupo === "acoes" &&
        (editandoSaldo ? (
          <FormSaldoAcionistas
            valorInicial={checklist.saldoAcionistas}
            onCancelar={() => setEditandoSaldo(false)}
            onSalvo={async (dados) => {
              const resultado = await salvarSaldoAcionistas(ativoId, dados);
              if (resultado.error) throw new Error(resultado.error);
              await onAtualizado();
              setEditandoSaldo(false);
              toast.success("Nota de governança salva.");
            }}
          />
        ) : (
          <div className="pt-3 border-t border-border">
            <p className="text-faint text-xs mb-1">Saldo dos Acionistas (nota de governança)</p>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-ink">{checklist.saldoAcionistas || "—"}</p>
              <button
                onClick={() => setEditandoSaldo(true)}
                className="text-xs text-faint hover:text-ink shrink-0"
              >
                {checklist.saldoAcionistas ? "Editar" : "Preencher"}
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}

function FormSaldoAcionistas({
  valorInicial,
  onSalvo,
  onCancelar,
}: {
  valorInicial: string;
  onSalvo: (dados: SaldoAcionistasForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm({
    resolver: zodResolver(saldoAcionistasSchema),
    defaultValues: { saldo_acionistas: valorInicial },
  });

  const toast = useToast();
  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvo(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    }
  });

  return (
    <form onSubmit={onSubmit} className="pt-3 border-t border-border space-y-2">
      <label className="label">Saldo dos Acionistas (acordo de acionistas, alinhamento, governança)</label>
      <textarea
        {...register("saldo_acionistas")}
        className="input"
        rows={2}
        placeholder="Ex.: controle familiar com acordo de acionistas vigente até 2030..."
      />
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

// ---------------------------------------------------------------------------
// Resultados trimestrais — lançamento manual dos dados brutos (ver
// docs/MAPA-DE-DADOS.md §8.10); série histórica com variação QoQ/YoY da
// métrica-âncora de cada grupo (Lucro Líquido para ações, Receita
// Imobiliária para FIIs).
// ---------------------------------------------------------------------------
function SecaoResultadosTrimestrais({
  ativoId,
  grupo,
  resultados,
  onAtualizado,
}: {
  ativoId: string;
  grupo: "acoes" | "fiis";
  resultados: ResultadoTrimestralItem[];
  onAtualizado: () => Promise<void>;
}) {
  const [editando, setEditando] = useState<"novo" | string | null>(null);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const [excluindoLoading, setExcluindoLoading] = useState(false);
  const toast = useToast();

  const editandoItem = useMemo(
    () => (editando && editando !== "novo" ? resultados.find((r) => r.id === editando) ?? null : null),
    [editando, resultados]
  );

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-medium text-ink">Resultados trimestrais</h2>
        {editando === null && (
          <button onClick={() => setEditando("novo")} className="text-xs text-faint hover:text-ink">
            + Lançar trimestre
          </button>
        )}
      </div>

      <p className="text-xs text-muted mb-3">
        Dados brutos por trimestre (ex.: 2026-Q2) — usados para calcular automaticamente os índices do
        checklist na Visão geral (TTM = soma dos 4 trimestres mais recentes; CAGR de 5 anos exige o
        trimestre exato de 20 trimestres atrás).
      </p>

      {editando !== null && (
        <FormResultadoTrimestral
          key={editando}
          grupo={grupo}
          valoresIniciais={editandoItem}
          onCancelar={() => setEditando(null)}
          onSalvo={async (dados) => {
            const resultado = await salvarResultadoTrimestral(ativoId, dados);
            if (resultado.error) throw new Error(resultado.error);
            await onAtualizado();
            setEditando(null);
            toast.success("Resultado trimestral salvo.");
          }}
        />
      )}

      {resultados.length === 0 ? (
        <p className="text-xs text-faint">Nenhum trimestre lançado ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="text-faint text-left border-b border-border">
                <th className="py-1 pr-3">Trimestre</th>
                {grupo === "acoes" ? (
                  <>
                    <th className="py-1 pr-3">Receita Líq.</th>
                    <th className="py-1 pr-3">Lucro Líq.</th>
                    <th className="py-1 pr-3">QoQ</th>
                    <th className="py-1 pr-3">YoY</th>
                    <th className="py-1 pr-3">EBIT</th>
                    <th className="py-1 pr-3">EBITDA</th>
                    <th className="py-1 pr-3">Patrim. Líq.</th>
                    <th className="py-1 pr-3">Dív. Líq.</th>
                    <th className="py-1 pr-3">Dív. Bruta</th>
                    <th className="py-1 pr-3">Nº Ações</th>
                  </>
                ) : (
                  <>
                    <th className="py-1 pr-3">Receita Imob.</th>
                    <th className="py-1 pr-3">QoQ</th>
                    <th className="py-1 pr-3">YoY</th>
                    <th className="py-1 pr-3">VP/Cota</th>
                    <th className="py-1 pr-3">Nº Negócios/mês</th>
                    <th className="py-1 pr-3">Vacância Fin.</th>
                    <th className="py-1 pr-3">Vacância Fís.</th>
                    <th className="py-1 pr-3">Valor m²/Aluguel</th>
                  </>
                )}
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {resultados.map((r, i) => {
                const anterior = resultados[i + 1];
                const mesmoTrimestreAnoAnterior = resultados.find(
                  (o) => o.anoTrimestre === trimestreAnoAnterior(r.anoTrimestre)
                );
                const metricaAtual = grupo === "acoes" ? r.lucroLiquido : r.receitaImobiliaria;
                const metricaAnterior = grupo === "acoes" ? anterior?.lucroLiquido ?? null : anterior?.receitaImobiliaria ?? null;
                const metricaAnoAnterior =
                  grupo === "acoes"
                    ? mesmoTrimestreAnoAnterior?.lucroLiquido ?? null
                    : mesmoTrimestreAnoAnterior?.receitaImobiliaria ?? null;
                const qoq = variacaoPct(metricaAtual, metricaAnterior);
                const yoy = variacaoPct(metricaAtual, metricaAnoAnterior);

                return (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-1.5 pr-3 text-ink">{r.anoTrimestre}</td>
                    {grupo === "acoes" ? (
                      <>
                        <td className="py-1.5 pr-3 text-muted">{formatarNumeroCompacto(r.receitaLiquida)}</td>
                        <td className="py-1.5 pr-3 text-muted">{formatarNumeroCompacto(r.lucroLiquido)}</td>
                        <td className={`py-1.5 pr-3 ${classeVariacao(qoq)}`}>{formatarVariacao(qoq)}</td>
                        <td className={`py-1.5 pr-3 ${classeVariacao(yoy)}`}>{formatarVariacao(yoy)}</td>
                        <td className="py-1.5 pr-3 text-muted">{formatarNumeroCompacto(r.ebit)}</td>
                        <td className="py-1.5 pr-3 text-muted">{formatarNumeroCompacto(r.ebitda)}</td>
                        <td className="py-1.5 pr-3 text-muted">{formatarNumeroCompacto(r.patrimonioLiquido)}</td>
                        <td className="py-1.5 pr-3 text-muted">{formatarNumeroCompacto(r.dividaLiquida)}</td>
                        <td className="py-1.5 pr-3 text-muted">{formatarNumeroCompacto(r.dividaBruta)}</td>
                        <td className="py-1.5 pr-3 text-muted">{formatarNumero(r.numeroAcoes, 0)}</td>
                      </>
                    ) : (
                      <>
                        <td className="py-1.5 pr-3 text-muted">{formatarNumeroCompacto(r.receitaImobiliaria)}</td>
                        <td className={`py-1.5 pr-3 ${classeVariacao(qoq)}`}>{formatarVariacao(qoq)}</td>
                        <td className={`py-1.5 pr-3 ${classeVariacao(yoy)}`}>{formatarVariacao(yoy)}</td>
                        <td className="py-1.5 pr-3 text-muted">{formatarNumero(r.valorPatrimonialCota, 2)}</td>
                        <td className="py-1.5 pr-3 text-muted">{formatarNumero(r.numeroNegociosMes, 0)}</td>
                        <td className="py-1.5 pr-3 text-muted">{formatarPct(r.vacanciaFinanceiraPct)}</td>
                        <td className="py-1.5 pr-3 text-muted">{formatarPct(r.vacanciaFisicaPct)}</td>
                        <td className="py-1.5 pr-3 text-muted">
                          {r.valorM2Aluguel !== null ? formatarMoeda(r.valorM2Aluguel) : "—"}
                        </td>
                      </>
                    )}
                    <td className="py-1.5">
                      <button onClick={() => setEditando(r.id)} className="text-faint hover:text-ink mr-2">
                        Editar
                      </button>
                      <button
                        onClick={() => setExcluindoId(r.id)}
                        className="text-faint hover:text-danger"
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {excluindoId && (
        <ConfirmModal
          title="Excluir trimestre?"
          message="Esse lançamento de resultado trimestral some por completo. Essa ação não pode ser desfeita."
          loading={excluindoLoading}
          onCancel={() => setExcluindoId(null)}
          onConfirm={async () => {
            setExcluindoLoading(true);
            await excluirResultadoTrimestral(excluindoId);
            await onAtualizado();
            setExcluindoLoading(false);
            setExcluindoId(null);
            toast.success("Trimestre excluído.");
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel de monitoramento (ver docs/MAPA-DE-DADOS.md §8.10 decisão 11) —
// evolução histórica dos índices do checklist que não dependem do preço
// atual (gráficos de linha simples, sem lib externa, no padrão de
// components/DesvioBar.tsx) + insights automáticos em texto (regras
// transparentes de streak/recorde, sem IA). Cálculo 100% client-side a
// partir de `resultados` (já carregado), reaproveitando
// calcularSerieChecklistAcao/Fii e gerarInsightsAcao/Fii.
// ---------------------------------------------------------------------------
type GraficoMetrica = {
  label: string;
  dados: { anoTrimestre: string; valor: number | null }[];
  formatar: (v: number) => string;
};

function PainelMonitoramento({
  grupo,
  resultados,
  serieChecklistComPreco,
}: {
  grupo: "acoes" | "fiis";
  resultados: ResultadoTrimestralItem[];
  /** P/L, P/VP, PEG Ratio e Dividend Yield históricos — só ações, calculado no servidor (precisa do preço na época). Ver §8.65. */
  serieChecklistComPreco?: PontoSerieAcaoComPreco[] | null;
}) {
  if (resultados.length < 2) return null;

  const insights = grupo === "acoes" ? gerarInsightsAcao(resultados) : gerarInsightsFii(resultados);

  const graficos: GraficoMetrica[] =
    grupo === "acoes"
      ? (() => {
          const serie = calcularSerieChecklistAcao(resultados);
          const graficosBase: GraficoMetrica[] = [
            { label: "ROE", dados: serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.roePct })), formatar: (v: number) => `${v.toFixed(1)}%` },
            { label: "ROA", dados: serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.roaPct })), formatar: (v: number) => `${v.toFixed(1)}%` },
            { label: "ROIC", dados: serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.roicPct })), formatar: (v: number) => `${v.toFixed(1)}%` },
            { label: "Margem Bruta", dados: serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.margemBrutaPct })), formatar: (v: number) => `${v.toFixed(1)}%` },
            { label: "Margem Líquida", dados: serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.margemLucroPct })), formatar: (v: number) => `${v.toFixed(1)}%` },
            { label: "Dívida Líquida/PL", dados: serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.dlPl })), formatar: (v: number) => `${v.toFixed(2)}x` },
            { label: "Dívida Bruta/EBITDA", dados: serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.dividaBrutaEbitda })), formatar: (v: number) => `${v.toFixed(2)}x` },
            { label: "Liquidez Corrente", dados: serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.liquidezCorrente })), formatar: (v: number) => `${v.toFixed(2)}x` },
          ];
          // P/L, P/VP, PEG Ratio e Dividend Yield históricos (§8.65) —
          // dependem do preço na época, por isso vêm prontos do servidor em
          // vez de recalculados aqui (calcularSerieChecklistAcao não tem
          // acesso à série de preço diário).
          if (serieChecklistComPreco && serieChecklistComPreco.length >= 2) {
            graficosBase.push(
              { label: "P/L", dados: serieChecklistComPreco.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.pl })), formatar: (v: number) => `${v.toFixed(2)}x` },
              { label: "P/VP", dados: serieChecklistComPreco.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.pvp })), formatar: (v: number) => `${v.toFixed(2)}x` },
              { label: "PEG Ratio", dados: serieChecklistComPreco.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.pegRatio })), formatar: (v: number) => `${v.toFixed(2)}x` },
              { label: "Dividend Yield", dados: serieChecklistComPreco.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.dividendYieldPct })), formatar: (v: number) => `${v.toFixed(1)}%` }
            );
          }
          return graficosBase;
        })()
      : (() => {
          const serie = calcularSerieChecklistFii(resultados);
          return [
            { label: "Cap Rate", dados: serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.capRatePct })), formatar: (v: number) => `${v.toFixed(1)}%` },
            { label: "Vacância Financeira", dados: serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.vacanciaFinanceiraPct })), formatar: (v: number) => `${v.toFixed(1)}%` },
            { label: "Vacância Física", dados: serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.vacanciaFisicaPct })), formatar: (v: number) => `${v.toFixed(1)}%` },
            { label: "Nº Negócios/mês", dados: serie.map((p) => ({ anoTrimestre: p.anoTrimestre, valor: p.numeroNegociosMes })), formatar: (v: number) => v.toFixed(0) },
          ];
        })();

  return (
    <div className="card p-5">
      <h2 className="text-base font-medium text-ink mb-1">Painel de monitoramento</h2>
      <p className="text-xs text-muted mb-3">
        Evolução dos índices do checklist + insights automáticos gerados a partir do histórico lançado
        (sequências de alta/baixa e recordes). P/L, P/VP, PEG Ratio e Dividend Yield usam o preço de
        fechamento no fim de cada trimestre (ou o último preço conhecido antes disso), não o preço de hoje.
      </p>

      {insights.length > 0 && (
        <ul className="space-y-1.5 mb-4">
          {insights.map((insight, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span
                className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${
                  insight.tom === "positivo" ? "bg-success" : insight.tom === "negativo" ? "bg-danger" : "bg-faint"
                }`}
              />
              <span className="text-muted">{insight.texto}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {graficos.map((g) => (
          <MiniLineChart key={g.label} label={g.label} dados={g.dados} formatar={g.formatar} />
        ))}
      </div>
    </div>
  );
}

function MiniLineChart({ label, dados, formatar }: GraficoMetrica) {
  const validos = dados.filter((p): p is { anoTrimestre: string; valor: number } => p.valor !== null);

  if (validos.length < 2) {
    return (
      <div className="rounded-md border border-border bg-surface-2 p-3">
        <p className="text-xs text-faint mb-1">{label}</p>
        <p className="text-xs text-faint">Dados insuficientes</p>
      </div>
    );
  }

  const valores = validos.map((p) => p.valor);
  const minV = Math.min(...valores);
  const maxV = Math.max(...valores);
  const span = maxV - minV || 1;
  const largura = 200;
  const altura = 48;
  const passo = largura / (validos.length - 1);

  const pontosSvg = validos.map((p, i) => `${i * passo},${altura - ((p.valor - minV) / span) * altura}`).join(" ");

  const ultimo = validos[validos.length - 1].valor;
  const penultimo = validos[validos.length - 2].valor;
  const positivo = ultimo >= penultimo;

  return (
    <div className="rounded-md border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-faint">{label}</p>
        <p className={`text-xs font-medium ${positivo ? "text-success" : "text-danger"}`}>{formatar(ultimo)}</p>
      </div>
      <svg viewBox={`0 0 ${largura} ${altura}`} className="w-full h-12" preserveAspectRatio="none">
        <polyline
          points={pontosSvg}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={positivo ? "text-success" : "text-danger"}
        />
      </svg>
    </div>
  );
}

function FormResultadoTrimestral({
  grupo,
  valoresIniciais,
  onSalvo,
  onCancelar,
}: {
  grupo: "acoes" | "fiis";
  valoresIniciais: ResultadoTrimestralItem | null;
  onSalvo: (dados: ResultadoTrimestralForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(resultadoTrimestralSchema),
    defaultValues: {
      ano_trimestre: valoresIniciais?.anoTrimestre ?? "",
      receita_liquida: valoresIniciais?.receitaLiquida ?? NaN,
      lucro_bruto: valoresIniciais?.lucroBruto ?? NaN,
      lucro_liquido: valoresIniciais?.lucroLiquido ?? NaN,
      ebit: valoresIniciais?.ebit ?? NaN,
      ebitda: valoresIniciais?.ebitda ?? NaN,
      patrimonio_liquido: valoresIniciais?.patrimonioLiquido ?? NaN,
      ativo_total: valoresIniciais?.ativoTotal ?? NaN,
      ativo_circulante: valoresIniciais?.ativoCirculante ?? NaN,
      passivo_circulante: valoresIniciais?.passivoCirculante ?? NaN,
      divida_liquida: valoresIniciais?.dividaLiquida ?? NaN,
      divida_bruta: valoresIniciais?.dividaBruta ?? NaN,
      numero_acoes: valoresIniciais?.numeroAcoes ?? NaN,
      valor_patrimonial_cota: valoresIniciais?.valorPatrimonialCota ?? NaN,
      numero_negocios_mes: valoresIniciais?.numeroNegociosMes ?? NaN,
      vacancia_financeira_pct: valoresIniciais?.vacanciaFinanceiraPct ?? NaN,
      vacancia_fisica_pct: valoresIniciais?.vacanciaFisicaPct ?? NaN,
      receita_imobiliaria: valoresIniciais?.receitaImobiliaria ?? NaN,
      valor_avaliacao_imoveis: valoresIniciais?.valorAvaliacaoImoveis ?? NaN,
      valor_m2_aluguel: valoresIniciais?.valorM2Aluguel ?? NaN,
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

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 md:grid-cols-3 gap-3 bg-surface-2 rounded-md p-3 mb-4">
      <div>
        <label className="label">Trimestre (AAAA-Q1 a Q4)</label>
        <input
          {...register("ano_trimestre")}
          className="input"
          placeholder="2026-Q2"
          disabled={!!valoresIniciais}
        />
        {errors.ano_trimestre?.message && <p className="field-error">{errors.ano_trimestre.message}</p>}
      </div>

      {grupo === "acoes" ? (
        <>
          <div>
            <label className="label">Receita Líquida (R$)</label>
            <input type="number" step="0.01" {...register("receita_liquida", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">Lucro Bruto (R$)</label>
            <input type="number" step="0.01" {...register("lucro_bruto", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">Lucro Líquido (R$)</label>
            <input type="number" step="0.01" {...register("lucro_liquido", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">EBIT (R$)</label>
            <input type="number" step="0.01" {...register("ebit", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">EBITDA (R$)</label>
            <input type="number" step="0.01" {...register("ebitda", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">Patrimônio Líquido (R$)</label>
            <input type="number" step="0.01" {...register("patrimonio_liquido", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">Ativo Total (R$)</label>
            <input type="number" step="0.01" {...register("ativo_total", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">Ativo Circulante (R$)</label>
            <input type="number" step="0.01" {...register("ativo_circulante", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">Passivo Circulante (R$)</label>
            <input type="number" step="0.01" {...register("passivo_circulante", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">Dívida Líquida (R$)</label>
            <input type="number" step="0.01" {...register("divida_liquida", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">Dívida Bruta (R$)</label>
            <input type="number" step="0.01" {...register("divida_bruta", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">Número de Ações</label>
            <input type="number" step="1" {...register("numero_acoes", { valueAsNumber: true })} className="input" />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="label">Valor Patrimonial/Cota (R$)</label>
            <input type="number" step="0.01" {...register("valor_patrimonial_cota", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">Nº Negócios/mês</label>
            <input type="number" step="1" {...register("numero_negocios_mes", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">Vacância Financeira (%)</label>
            <input type="number" step="0.01" {...register("vacancia_financeira_pct", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">Vacância Física (%)</label>
            <input type="number" step="0.01" {...register("vacancia_fisica_pct", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">Receita Imobiliária do trimestre (R$)</label>
            <input type="number" step="0.01" {...register("receita_imobiliaria", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">Valor de Avaliação dos Imóveis (R$)</label>
            <input type="number" step="0.01" {...register("valor_avaliacao_imoveis", { valueAsNumber: true })} className="input" />
          </div>
          <div>
            <label className="label">Valor m²/Aluguel (R$)</label>
            <input type="number" step="0.01" {...register("valor_m2_aluguel", { valueAsNumber: true })} className="input" />
          </div>
        </>
      )}


      <div className="col-span-2 md:col-span-3 flex gap-2">
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

// ---------------------------------------------------------------------------
// Cartão de visita da empresa (CNPJ/nome/logo/segmento) — ver
// docs/MAPA-DE-DADOS.md §8.56. Só renderizado pra tipos elegíveis
// (TIPOS_CARTAO_EMPRESA: Ações/FIIs/ETF Brasil + Internacional). Fica
// separado do card "Classificação" (Macro/Classe/Setor) logo abaixo: este
// aqui é identidade da EMPRESA por trás do ticker, aquele é a meta de
// alocação — coisas diferentes, cada uma com sua fonte única.
// ---------------------------------------------------------------------------
function CartaoEmpresa({
  ativoId,
  tipo,
  empresa,
  onAtualizado,
}: {
  ativoId: string;
  tipo: TipoAtivo;
  empresa: EmpresaView | null;
  onAtualizado: () => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [logoComErro, setLogoComErro] = useState(false);
  const toast = useToast();

  const nomeExibicao = empresa?.nomeFantasia || empresa?.razaoSocial;
  const origemLabel =
    empresa?.origemDados === "brapi" ? "brapi.dev" : empresa?.origemDados === "yahoo" ? "Yahoo Finance" : "manual";

  const buscar = async () => {
    setBuscando(true);
    const resultado = await buscarDadosCadastraisAtivo(ativoId);
    setBuscando(false);
    if (resultado.error) {
      toast.error(resultado.error);
      return;
    }
    setLogoComErro(false);
    await onAtualizado();
    toast.success("Dados cadastrais atualizados.");
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-medium text-ink">Empresa</h2>
        {!editando && (
          <div className="flex gap-3">
            <button disabled={buscando} onClick={buscar} className="text-xs text-accent hover:underline disabled:opacity-50">
              {buscando ? "Buscando..." : empresa ? "Atualizar dados cadastrais" : "Buscar automaticamente"}
            </button>
            <button onClick={() => setEditando(true)} className="text-xs text-faint hover:text-ink">
              {empresa ? "Editar" : "Preencher manualmente"}
            </button>
          </div>
        )}
      </div>

      {editando ? (
        <FormEmpresa
          valoresIniciais={empresa}
          onCancelar={() => setEditando(false)}
          onSalvo={async (dados) => {
            const resultado = await atualizarEmpresaManual(ativoId, dados);
            if (resultado.error) throw new Error(resultado.error);
            setLogoComErro(false);
            await onAtualizado();
            setEditando(false);
            toast.success("Dados da empresa salvos.");
          }}
        />
      ) : empresa ? (
        <div className="flex items-start gap-3">
          {empresa.logoUrl && !logoComErro ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo vem de domínio externo variável (brapi.dev/Clearbit), sem otimização do next/image.
            <img
              src={empresa.logoUrl}
              alt={`Logo de ${nomeExibicao ?? "empresa"}`}
              className="w-12 h-12 rounded-md object-contain bg-surface-2 border border-border shrink-0"
              onError={() => setLogoComErro(true)}
            />
          ) : (
            <div className="w-12 h-12 rounded-md bg-surface-2 border border-border shrink-0 flex items-center justify-center text-faint text-lg">
              {(nomeExibicao ?? "?").charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm text-ink font-medium truncate">{nomeExibicao || "Nome não informado"}</p>
            {empresa.razaoSocial && empresa.nomeFantasia && empresa.razaoSocial !== empresa.nomeFantasia && (
              <p className="text-xs text-muted truncate">{empresa.razaoSocial}</p>
            )}
            <p className="text-xs text-faint mt-0.5">
              {empresa.cnpj ? `CNPJ ${empresa.cnpj}` : tipo === "internacional" ? "Empresa estrangeira (sem CNPJ)" : "CNPJ não informado"}
              {empresa.segmento && ` · ${empresa.segmento}`}
            </p>
            {empresa.descricao && <p className="text-xs text-muted mt-2 line-clamp-3">{empresa.descricao}</p>}
            <p className="text-[10px] text-faint mt-2">
              {formatarTempoRelativo(empresa.atualizadoEm)} · fonte: {origemLabel}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-faint">
          Nenhum dado cadastral ainda — busque automaticamente ou preencha à mão.
        </p>
      )}
    </div>
  );
}

function FormEmpresa({
  valoresIniciais,
  onSalvo,
  onCancelar,
}: {
  valoresIniciais: EmpresaView | null;
  onSalvo: (dados: EmpresaForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(empresaSchema),
    defaultValues: {
      cnpj: valoresIniciais?.cnpj ?? "",
      razao_social: valoresIniciais?.razaoSocial ?? "",
      nome_fantasia: valoresIniciais?.nomeFantasia ?? "",
      logo_url: valoresIniciais?.logoUrl ?? "",
      segmento: valoresIniciais?.segmento ?? "",
      descricao: valoresIniciais?.descricao ?? "",
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

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
      <div>
        <label className="label">Razão social</label>
        <input {...register("razao_social")} className="input" />
      </div>
      <div>
        <label className="label">Nome fantasia</label>
        <input {...register("nome_fantasia")} className="input" />
      </div>
      <div>
        <label className="label">CNPJ</label>
        <input {...register("cnpj")} className="input" placeholder="00.000.000/0000-00" />
      </div>
      <div>
        <label className="label">Segmento</label>
        <input {...register("segmento")} className="input" placeholder="Ex.: Financeiro" />
      </div>
      <div className="col-span-2">
        <label className="label">URL do logo</label>
        <input {...register("logo_url")} className="input" placeholder="https://..." />
        {errors.logo_url?.message && <p className="field-error">{errors.logo_url.message}</p>}
      </div>
      <div className="col-span-2">
        <label className="label">Descrição</label>
        <textarea {...register("descricao")} className="input" rows={3} />
      </div>
      <div className="col-span-2 flex gap-2">
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

function FormIdentidade({
  valoresIniciais,
  onSalvo,
  onCancelar,
}: {
  valoresIniciais: Partial<AtivoForm>;
  onSalvo: (dados: AtivoForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(ativoSchema),
    defaultValues: {
      ticker: valoresIniciais.ticker ?? "",
      nome: valoresIniciais.nome ?? "",
      tipo: valoresIniciais.tipo ?? "acao",
      subtipo_renda_fixa: valoresIniciais.subtipo_renda_fixa || "",
      cripto_exchange: valoresIniciais.cripto_exchange || "",
      subtipo_internacional: valoresIniciais.subtipo_internacional || "",
    },
  });

  const tipoSelecionado = watch("tipo");

  const toast = useToast();
  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvo(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
      <div>
        <label className="label">Ticker/código</label>
        <input {...register("ticker")} className="input" />
        {errors.ticker?.message && <p className="field-error">{errors.ticker.message}</p>}
      </div>
      <div>
        <label className="label">Nome (opcional)</label>
        <input {...register("nome")} className="input" />
      </div>
      <div className="col-span-2">
        <label className="label">Tipo</label>
        <select {...register("tipo")} className="input">
          {TIPOS_ATIVO.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {tipoSelecionado === "renda_fixa" && (
        <div className="col-span-2">
          <label className="label">Subtipo (para o relatório de IR)</label>
          <select {...register("subtipo_renda_fixa")} className="input" defaultValue="">
            <option value="">Não informar agora</option>
            {SUBTIPOS_RENDA_FIXA.map((s) => (
              <option key={s.valor} value={s.valor}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {tipoSelecionado === "cripto" && (
        <div className="col-span-2">
          <label className="label">Exchange (para o relatório de IR)</label>
          <select {...register("cripto_exchange")} className="input" defaultValue="">
            <option value="">Não informar agora</option>
            {EXCHANGES_CRIPTO.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {tipoSelecionado === "internacional" && (
        <div className="col-span-2">
          <label className="label">Ação, ETF ou REIT? (para agrupar na Posição)</label>
          <select {...register("subtipo_internacional")} className="input" defaultValue="">
            <option value="">Não informar agora</option>
            {SUBTIPOS_INTERNACIONAL.map((s) => (
              <option key={s.valor} value={s.valor}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="col-span-2 flex gap-2">
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

function FormSimbolo({
  valorInicial,
  onSalvo,
  onCancelar,
}: {
  valorInicial: string;
  onSalvo: (dados: SimboloTradingviewForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    setValue,
    formState: { isSubmitting },
  } = useForm<SimboloTradingviewForm>({
    resolver: zodResolver(simboloTradingviewSchema),
    defaultValues: { simbolo_tradingview: valorInicial },
  });

  const toast = useToast();
  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvo(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <input
        {...register("simbolo_tradingview")}
        className="input w-48"
        placeholder="BMFBOVESPA:ITSA3"
        autoFocus
      />
      <button type="submit" disabled={isSubmitting} className="btn btn-primary">
        Salvar
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setValue("simbolo_tradingview", "")}
      >
        Usar automático
      </button>
      <button type="button" className="btn btn-secondary" onClick={onCancelar}>
        Cancelar
      </button>
    </form>
  );
}

function FormClassificacao({
  classesSetores,
  valoresIniciais,
  onSalvo,
  onCancelar,
}: {
  classesSetores: ClasseOpcao[];
  valoresIniciais?: Partial<ClassificacaoForm>;
  onSalvo: (dados: ClassificacaoForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const classeInicial = useMemo(() => {
    if (!valoresIniciais?.setor_id) return classesSetores[0]?.id ?? "";
    return classesSetores.find((c) => c.setores.some((s) => s.id === valoresIniciais.setor_id))?.id ?? "";
  }, [classesSetores, valoresIniciais]);

  const [classeId, setClasseId] = useState(classeInicial);
  const setoresDaClasse = classesSetores.find((c) => c.id === classeId)?.setores ?? [];

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
  } = useForm<ClassificacaoForm>({
    resolver: zodResolver(classificacaoSchema),
    defaultValues: {
      setor_id: valoresIniciais?.setor_id ?? "",
      peso_alvo: valoresIniciais?.peso_alvo ?? 0,
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

  if (classesSetores.length === 0) {
    return (
      <p className="text-xs text-faint">
        Nenhuma classe/setor cadastrado ainda. Crie a estrutura-alvo na aba Alocação primeiro.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
      <div>
        <label className="label">Classe</label>
        <select
          className="input"
          value={classeId}
          onChange={(e) => {
            setClasseId(e.target.value);
            const primeiroSetor = classesSetores.find((c) => c.id === e.target.value)?.setores[0]?.id ?? "";
            setValue("setor_id", primeiroSetor);
          }}
        >
          {classesSetores.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Setor</label>
        <select {...register("setor_id")} className="input">
          {setoresDaClasse.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}
            </option>
          ))}
        </select>
        {errors.setor_id?.message && <p className="field-error">{errors.setor_id.message}</p>}
      </div>
      <div className="col-span-2">
        <label className="label">Peso-alvo no setor (%)</label>
        <input
          type="number"
          step="1"
          {...register("peso_alvo", { valueAsNumber: true })}
          className="input"
        />
        {errors.peso_alvo?.message && <p className="field-error">{errors.peso_alvo.message}</p>}
      </div>
      <div className="col-span-2 flex gap-2">
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

function FormPrecoAtual({
  valorInicial,
  onSalvo,
  onCancelar,
}: {
  valorInicial: number;
  onSalvo: (dados: PrecoAtualForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PrecoAtualForm>({
    resolver: zodResolver(precoAtualSchema),
    defaultValues: { preco_atual: valorInicial },
  });

  const toast = useToast();
  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvo(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2 mt-2">
      <input
        type="number"
        step="0.01"
        {...register("preco_atual", { valueAsNumber: true })}
        className="input w-32"
        autoFocus
      />
      <button type="submit" disabled={isSubmitting} className="btn btn-primary">
        Salvar
      </button>
      <button type="button" className="btn btn-secondary" onClick={onCancelar}>
        Cancelar
      </button>
      {errors.preco_atual?.message && <p className="field-error">{errors.preco_atual.message}</p>}
    </form>
  );
}

function FormTransacao({
  ativoId,
  tipoAtivo,
  corretoras,
  onSalvo,
  onCancelar,
}: {
  ativoId: string;
  tipoAtivo: string;
  corretoras: Corretora[];
  onSalvo: (dados: TransacaoForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(transacaoSchema),
    defaultValues: {
      ativo_id: ativoId,
      corretora_id: null as string | null,
      tipo: "compra" as const,
      data: new Date().toISOString().slice(0, 10),
      quantidade: 0,
      preco_unitario: 0,
      custos: 0,
      fator_proporcao: NaN,
      valor_capitalizado: NaN,
      cambio: NaN,
    },
  });

  // Ver docs/MAPA-DE-DADOS.md §8.22: eventos societários usam campos
  // diferentes de compra/venda — mesmo padrão condicional do form do
  // Livro-razão (LivroRazaoView.tsx), reaproveitado aqui.
  const tipoSelecionado = watch("tipo");
  const ehCompraOuVenda = tipoSelecionado === "compra" || tipoSelecionado === "venda";
  const ehDesdobramentoOuGrupamento = tipoSelecionado === "desdobramento" || tipoSelecionado === "grupamento";
  const ehBonificacao = tipoSelecionado === "bonificacao";

  const toast = useToast();
  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvo(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 md:grid-cols-3 gap-3 bg-surface-2 rounded-md p-3 mb-3">
      <input type="hidden" {...register("ativo_id")} />

      <div>
        <label className="label">Tipo</label>
        <select {...register("tipo")} className="input">
          {TIPOS_TRANSACAO.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Data</label>
        <input type="date" {...register("data")} className="input" />
        {errors.data?.message && <p className="field-error">{errors.data.message}</p>}
      </div>

      <div>
        <label className="label">Corretora (opcional)</label>
        <select {...register("corretora_id")} className="input">
          <option value="">—</option>
          {corretoras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>

      {(ehCompraOuVenda || ehBonificacao) && (
        <div>
          <label className="label">{ehBonificacao ? "Quantidade recebida" : "Quantidade"}</label>
          <input
            type="number"
            step="0.00000001"
            {...register("quantidade", { valueAsNumber: true })}
            className="input"
          />
          {errors.quantidade?.message && <p className="field-error">{errors.quantidade.message}</p>}
        </div>
      )}

      {ehCompraOuVenda && (
        <div>
          <label className="label">Preço unitário (R$)</label>
          <input
            type="number"
            step="0.01"
            {...register("preco_unitario", { valueAsNumber: true })}
            className="input"
          />
          {errors.preco_unitario?.message && <p className="field-error">{errors.preco_unitario.message}</p>}
        </div>
      )}

      {ehCompraOuVenda && (
        <div>
          <label className="label">Custos/taxas (R$)</label>
          <input
            type="number"
            step="0.01"
            {...register("custos", { valueAsNumber: true })}
            className="input"
          />
          {errors.custos?.message && <p className="field-error">{errors.custos.message}</p>}
        </div>
      )}

      {ehDesdobramentoOuGrupamento && (
        <div>
          <label className="label">Fator de proporção</label>
          <input
            type="number"
            step="0.000001"
            placeholder="Ex.: 2 (desdobra 1:2) ou 0,1 (agrupa 10:1)"
            {...register("fator_proporcao", { valueAsNumber: true })}
            className="input"
          />
          {errors.fator_proporcao?.message && <p className="field-error">{errors.fator_proporcao.message}</p>}
        </div>
      )}

      {ehBonificacao && (
        <div>
          <label className="label">Valor capitalizado (R$)</label>
          <input
            type="number"
            step="0.01"
            placeholder="0 se a empresa não atribuiu valor"
            {...register("valor_capitalizado", { valueAsNumber: true })}
            className="input"
          />
          {errors.valor_capitalizado?.message && <p className="field-error">{errors.valor_capitalizado.message}</p>}
        </div>
      )}

      {tipoAtivo === "internacional" && (
        <div>
          <label className="label">Câmbio do dia (para IR)</label>
          <input
            type="number"
            step="0.0001"
            {...register("cambio", { valueAsNumber: true })}
            className="input"
          />
          {errors.cambio?.message && <p className="field-error">{errors.cambio.message}</p>}
        </div>
      )}


      <div className="col-span-2 md:col-span-3 flex gap-2">
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
