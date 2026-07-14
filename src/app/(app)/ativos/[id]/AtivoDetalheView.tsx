"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ativoSchema,
  classificacaoSchema,
  EXCHANGES_CRIPTO,
  precoAtualSchema,
  simboloTradingviewSchema,
  SUBTIPOS_RENDA_FIXA,
  TIPOS_ATIVO,
  type AtivoForm,
  type ClassificacaoForm,
  type PrecoAtualForm,
  type SimboloTradingviewForm,
} from "@/lib/ativos/schema";
import {
  atualizarPrecoAtual,
  atualizarSimboloTradingview,
  classificarAtivo,
  editarAtivo,
  excluirAtivo,
  obterAtivoDetalhe,
  removerClassificacao,
  type AtivoDetalhe,
  type ClasseOpcao,
} from "@/lib/ativos/actions";
import { transacaoSchema, TIPOS_TRANSACAO, type TransacaoForm } from "@/lib/carteira/schema";
import { TIPOS_PROVENTO } from "@/lib/proventos/schema";
import { criarTransacao, excluirTransacao, type Corretora } from "@/lib/carteira/actions";
import DesvioBar from "@/components/DesvioBar";
import TradingViewChart from "@/components/TradingViewChart";
import { TOLERANCIA_REBALANCEAMENTO_PP } from "@/lib/alocacao/constants";

const rotuloTipo = (valor: string) => TIPOS_ATIVO.find((t) => t.valor === valor)?.label ?? valor;
const rotuloProvento = (valor: string) => TIPOS_PROVENTO.find((t) => t.valor === valor)?.label ?? valor;

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatarData = (iso: string) => {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
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

export default function AtivoDetalheView({
  ativoInicial,
  classesSetores,
  corretoras,
}: {
  ativoInicial: AtivoDetalhe;
  classesSetores: ClasseOpcao[];
  corretoras: Corretora[];
}) {
  const router = useRouter();
  const [ativo, setAtivo] = useState(ativoInicial);
  const [editandoIdentidade, setEditandoIdentidade] = useState(false);
  const [editandoClassificacao, setEditandoClassificacao] = useState(false);
  const [editandoPreco, setEditandoPreco] = useState(false);
  const [editandoSimbolo, setEditandoSimbolo] = useState(false);
  const [addTransacao, setAddTransacao] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  const atualizar = async () => {
    const novo = await obterAtivoDetalhe(ativo.id);
    if (novo) setAtivo(novo);
  };

  const precoDefinido = ativo.precoAtualizadoEm !== null;
  const lucroPositivo = ativo.lucroNaoRealizado >= 0;

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
            }}
            onCancelar={() => setEditandoIdentidade(false)}
            onSalvo={async (dados) => {
              const resultado = await editarAtivo(ativo.id, dados);
              if (resultado.error) throw new Error(resultado.error);
              setEditandoIdentidade(false);
              await atualizar();
            }}
          />
        ) : (
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-medium text-ink">{ativo.ticker}</h1>
              <p className="text-sm text-muted">
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
          <div className="error-box flex items-center justify-between mt-3">
            <span>Excluir {ativo.ticker} por completo (transações e proventos também somem)?</span>
            <div className="flex gap-2">
              <button className="btn btn-secondary" onClick={() => setExcluindo(false)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  await excluirAtivo(ativo.id);
                  router.push("/ativos");
                }}
              >
                Confirmar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-ink">Gráfico</h2>
          {editandoSimbolo ? (
            <FormSimbolo
              valorInicial={ativo.simboloTradingviewManual ? ativo.simboloTradingview : ""}
              onCancelar={() => setEditandoSimbolo(false)}
              onSalvo={async (dados) => {
                const resultado = await atualizarSimboloTradingview(ativo.id, dados);
                if (resultado.error) throw new Error(resultado.error);
                setEditandoSimbolo(false);
                await atualizar();
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
        <h2 className="text-sm font-medium text-ink mb-3">Classificação</h2>
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
              setEditandoClassificacao(false);
              await atualizar();
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
                  onClick={async () => {
                    await removerClassificacao(ativo.id);
                    await atualizar();
                  }}
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

      <div className="card p-5">
        <h2 className="text-sm font-medium text-ink mb-3">Posição</h2>

        {!precoDefinido && (
          <div className="rounded-md bg-surface-2 border border-border px-3 py-2 mb-3 text-xs text-muted">
            Preço atual ainda não foi definido — os números de lucro abaixo ficam disponíveis assim
            que você informar o preço atual do ativo.
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
          <Metrica label="Quantidade" valor={ativo.quantidade.toLocaleString("pt-BR")} />
          <Metrica label="Preço médio" valor={formatarMoeda(ativo.precoMedio)} />
          <Metrica label="Valor aplicado" valor={formatarMoeda(ativo.valorAplicado)} />
          <Metrica label="Valor atual" valor={precoDefinido ? formatarMoeda(ativo.valorAtual) : "—"} />

          {precoDefinido ? (
            <Metrica
              label="Lucro não realizado"
              valor={`${formatarMoeda(ativo.lucroNaoRealizado)} (${lucroPositivo ? "+" : ""}${ativo.lucroNaoRealizadoPct.toFixed(1)}%)`}
              destaque={lucroPositivo ? "success" : "danger"}
            />
          ) : (
            <MetricaPendente label="Lucro não realizado" onClick={() => setEditandoPreco(true)} />
          )}

          <Metrica
            label="Lucro realizado"
            valor={formatarMoeda(ativo.lucroRealizado)}
            destaque={ativo.lucroRealizado >= 0 ? "success" : "danger"}
          />
          <Metrica label="Proventos recebidos" valor={formatarMoeda(ativo.proventosRecebidos)} />

          {precoDefinido ? (
            <Metrica
              label="Retorno total"
              valor={formatarMoeda(ativo.retornoTotal)}
              destaque={ativo.retornoTotal >= 0 ? "success" : "danger"}
            />
          ) : (
            <MetricaPendente label="Retorno total" onClick={() => setEditandoPreco(true)} />
          )}
        </div>

        {editandoPreco ? (
          <FormPrecoAtual
            valorInicial={ativo.precoAtual}
            onCancelar={() => setEditandoPreco(false)}
            onSalvo={async (dados) => {
              const resultado = await atualizarPrecoAtual(ativo.id, dados);
              if (resultado.error) throw new Error(resultado.error);
              setEditandoPreco(false);
              await atualizar();
            }}
          />
        ) : (
          <button onClick={() => setEditandoPreco(true)} className="text-xs text-faint hover:text-ink">
            Preço atual: {formatarMoeda(ativo.precoAtual)} · {formatarTempoRelativo(ativo.precoAtualizadoEm)}{" "}
            (editar)
          </button>
        )}
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-ink">Transações</h2>
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
              setAddTransacao(false);
              await atualizar();
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
                className="flex items-center justify-between text-xs bg-surface-2 rounded-md px-3 py-2"
              >
                <span className={t.tipo === "compra" ? "text-success" : "text-danger"}>
                  {t.tipo === "compra" ? "Compra" : "Venda"}
                </span>
                <span className="text-muted">{formatarData(t.data)}</span>
                <span className="text-muted">{t.quantidade.toLocaleString("pt-BR")} un</span>
                <span className="text-muted">{formatarMoeda(t.precoUnitario)}</span>
                <span className="text-faint">{t.corretoraNome ?? "—"}</span>
                <button
                  onClick={async () => {
                    await excluirTransacao(t.id);
                    await atualizar();
                  }}
                  className="text-faint hover:text-danger"
                >
                  Excluir
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-ink">Proventos</h2>
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
                className="flex items-center justify-between text-xs bg-surface-2 rounded-md px-3 py-2"
              >
                <span className="text-muted">{rotuloProvento(p.tipo)}</span>
                <span className="text-muted">{formatarData(p.data)}</span>
                <span className="text-ink">{formatarMoeda(p.valorTotal)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Metrica({
  label,
  valor,
  destaque,
}: {
  label: string;
  valor: string;
  destaque?: "success" | "danger";
}) {
  return (
    <div>
      <p className="text-faint">{label}</p>
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

function MetricaPendente({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div>
      <p className="text-faint">{label}</p>
      <button onClick={onClick} className="text-faint hover:text-ink underline underline-offset-2">
        Defina o preço atual
      </button>
    </div>
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
    setError,
  } = useForm({
    resolver: zodResolver(ativoSchema),
    defaultValues: {
      ticker: valoresIniciais.ticker ?? "",
      nome: valoresIniciais.nome ?? "",
      tipo: valoresIniciais.tipo ?? "acao",
      subtipo_renda_fixa: valoresIniciais.subtipo_renda_fixa || "",
      cripto_exchange: valoresIniciais.cripto_exchange || "",
    },
  });

  const tipoSelecionado = watch("tipo");

  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvo(data);
    } catch (e) {
      setError("root", { message: e instanceof Error ? e.message : "Erro ao salvar." });
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
      {errors.root?.message && <p className="error-box col-span-2">{errors.root.message}</p>}
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
    formState: { errors, isSubmitting },
    setError,
  } = useForm<SimboloTradingviewForm>({
    resolver: zodResolver(simboloTradingviewSchema),
    defaultValues: { simbolo_tradingview: valorInicial },
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvo(data);
    } catch (e) {
      setError("root", { message: e instanceof Error ? e.message : "Erro ao salvar." });
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
      {errors.root?.message && <p className="error-box">{errors.root.message}</p>}
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
    setError,
    setValue,
  } = useForm<ClassificacaoForm>({
    resolver: zodResolver(classificacaoSchema),
    defaultValues: {
      setor_id: valoresIniciais?.setor_id ?? "",
      peso_alvo: valoresIniciais?.peso_alvo ?? 0,
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvo(data);
    } catch (e) {
      setError("root", { message: e instanceof Error ? e.message : "Erro ao salvar." });
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
      {errors.root?.message && <p className="error-box col-span-2">{errors.root.message}</p>}
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
    setError,
  } = useForm<PrecoAtualForm>({
    resolver: zodResolver(precoAtualSchema),
    defaultValues: { preco_atual: valorInicial },
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvo(data);
    } catch (e) {
      setError("root", { message: e instanceof Error ? e.message : "Erro ao salvar." });
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
      {errors.root?.message && <p className="error-box">{errors.root.message}</p>}
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
    formState: { errors, isSubmitting },
    setError,
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
      cambio: NaN,
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvo(data);
    } catch (e) {
      setError("root", { message: e instanceof Error ? e.message : "Erro ao salvar." });
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

      <div>
        <label className="label">Quantidade</label>
        <input
          type="number"
          step="0.00000001"
          {...register("quantidade", { valueAsNumber: true })}
          className="input"
        />
        {errors.quantidade?.message && <p className="field-error">{errors.quantidade.message}</p>}
      </div>

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

      {errors.root?.message && <p className="error-box col-span-2 md:col-span-3">{errors.root.message}</p>}

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
