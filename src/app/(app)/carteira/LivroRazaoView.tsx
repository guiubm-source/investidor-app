"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { transacaoSchema, TIPOS_TRANSACAO, type TransacaoForm } from "@/lib/carteira/schema";
import {
  criarTransacao,
  editarTransacao,
  excluirTransacao,
  excluirTransacoesEmLote,
  obterLivroRazao,
  type LivroRazao,
  type Corretora,
} from "@/lib/carteira/actions";
import CorretorasManager from "./CorretorasManager";
import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/components/ToastProvider";
import VisaoMensalView from "./VisaoMensalView";
import { valorCaixaTransacao } from "@/lib/ativos/posicao-calculo";

/**
 * `TransacaoForm` (z.infer, tipo de SAÍDA do zod) tem `cambio: number | null`
 * e `corretora_id: string | null` — já pós-transform (o que `criarTransacao`/
 * `editarTransacao` recebem, e o que `onSalvo` abaixo devolve). Mas
 * `defaultValues` do `useForm` precisa dos valores CRUS dos campos, ANTES do
 * transform (`cambio` como `number` cru, podendo ser `NaN`; `corretora_id`
 * como `string`) — daí `TransacaoFormInput` (`z.input`) só para
 * `valoresIniciais`/`defaultValues`, nunca para o que `onSalvo` recebe.
 */
type TransacaoFormInput = z.input<typeof transacaoSchema>;

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatarData = (iso: string) => {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

export type AtivoOpcao = { id: string; ticker: string; tipo: string };

/**
 * Pendência de confirmação de duplicidade (ver docs/MAPA-DE-DADOS.md §8.18):
 * `criarTransacao`/`editarTransacao` devolvem `avisoDuplicata` (não é erro)
 * quando a transação enviada bate com uma já existente — a UI guarda aqui os
 * dados originais pra poder reenviar com `confirmarDuplicata: true` se o
 * usuário confirmar que quer lançar mesmo assim.
 */
type DuplicataPendente = { dados: TransacaoForm; mensagem: string; idEditando: string | null };

/**
 * Sub-aba Livro-razão: só lançamentos de compra/venda (ver
 * docs/MAPA-DE-DADOS.md §8.16 — desde 2026-07-20 proventos não são mais
 * lidos aqui, nem lista nem resumo; a leitura/escrita de proventos é
 * exclusiva da aba Proventos). A visão consolidada por posição/classe fica
 * na sub-aba Posição, irmã desta. Robustez de cadastro + filtros/edição em
 * lote adicionados em 2026-07-20 (§8.18).
 */
export default function LivroRazaoView({
  livroInicial,
  ativos,
  onLivroAtualizado,
}: {
  livroInicial: LivroRazao;
  ativos: AtivoOpcao[];
  onLivroAtualizado?: () => void;
}) {
  const [livro, setLivro] = useState(livroInicial);
  const [addTransacao, setAddTransacao] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const [excluindoLoading, setExcluindoLoading] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [confirmandoLote, setConfirmandoLote] = useState(false);
  const [excluindoLote, setExcluindoLote] = useState(false);
  const [duplicataPendente, setDuplicataPendente] = useState<DuplicataPendente | null>(null);
  const [confirmandoDuplicataLoading, setConfirmandoDuplicataLoading] = useState(false);

  const [mostrarVisaoMensal, setMostrarVisaoMensal] = useState(false);
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [filtroAtivos, setFiltroAtivos] = useState<Set<string>>(new Set());
  const [filtroCorretoras, setFiltroCorretoras] = useState<Set<string>>(new Set());
  const [filtroDataInicio, setFiltroDataInicio] = useState("");
  const [filtroDataFim, setFiltroDataFim] = useState("");

  const toast = useToast();

  const atualizar = async () => {
    const novo = await obterLivroRazao();
    setLivro(novo);
    onLivroAtualizado?.();
  };

  const ativosOrdenados = useMemo(() => [...ativos].sort((a, b) => a.ticker.localeCompare(b.ticker)), [ativos]);

  const filtroAtivo =
    filtroAtivos.size > 0 || filtroCorretoras.size > 0 || filtroDataInicio !== "" || filtroDataFim !== "";

  const lancamentosFiltrados = useMemo(() => {
    return livro.lancamentos.filter((l) => {
      if (filtroAtivos.size > 0 && !filtroAtivos.has(l.ativoId)) return false;
      if (filtroCorretoras.size > 0 && !(l.corretoraId && filtroCorretoras.has(l.corretoraId))) return false;
      if (filtroDataInicio && l.data < filtroDataInicio) return false;
      if (filtroDataFim && l.data > filtroDataFim) return false;
      return true;
    });
  }, [livro.lancamentos, filtroAtivos, filtroCorretoras, filtroDataInicio, filtroDataFim]);

  const totalFiltrado = useMemo(() => {
    let compra = 0;
    let venda = 0;
    for (const l of lancamentosFiltrados) {
      if (l.tipo === "compra") compra += valorCaixaTransacao(l);
      else venda += valorCaixaTransacao(l);
    }
    return { compra, venda, liquido: compra - venda };
  }, [lancamentosFiltrados]);

  const limparFiltros = () => {
    setFiltroAtivos(new Set());
    setFiltroCorretoras(new Set());
    setFiltroDataInicio("");
    setFiltroDataFim("");
  };

  const alternarSelecao = (id: string) => {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  };

  const todosSelecionados =
    lancamentosFiltrados.length > 0 && lancamentosFiltrados.every((l) => selecionados.has(l.id));

  const alternarTodos = () => {
    setSelecionados(todosSelecionados ? new Set() : new Set(lancamentosFiltrados.map((l) => l.id)));
  };

  /** Chamado pelo form (criar ou editar); trata o caso de duplicidade sem fechar o form. */
  const salvarTransacao = async (dados: TransacaoForm, idEditando: string | null) => {
    const resultado = idEditando ? await editarTransacao(idEditando, dados) : await criarTransacao(dados);
    if (resultado.avisoDuplicata) {
      setDuplicataPendente({ dados, mensagem: resultado.avisoDuplicata, idEditando });
      return;
    }
    if (resultado.error) throw new Error(resultado.error);
    if (idEditando) setEditando(null);
    else setAddTransacao(false);
    await atualizar();
    toast.success(idEditando ? "Transação atualizada." : "Transação registrada.");
  };

  return (
    <div className="space-y-4">
      <CorretorasManager corretoras={livro.corretoras} onChange={atualizar} />

      {ativos.length === 0 ? (
        <p className="text-sm text-faint">
          Cadastre um ativo na aba{" "}
          <Link href="/ativos" className="text-accent hover:underline">
            Ativos
          </Link>{" "}
          antes de lançar transações.
        </p>
      ) : (
        !addTransacao && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setAddTransacao(true)} className="btn btn-secondary">
              + Registrar transação
            </button>
            <button onClick={() => setMostrarFiltros((v) => !v)} className="btn btn-secondary">
              {mostrarFiltros ? "Ocultar filtros" : "Filtros"}
              {filtroAtivo && !mostrarFiltros ? " •" : ""}
            </button>
            <button onClick={() => setMostrarVisaoMensal((v) => !v)} className="btn btn-secondary">
              {mostrarVisaoMensal ? "Ocultar visão mensal" : "Visão mensal"}
            </button>
          </div>
        )
      )}

      {mostrarVisaoMensal && <VisaoMensalView />}

      {addTransacao && (
        <div className="card p-4">
          <FormTransacao
            ativos={ativos}
            corretoras={livro.corretoras}
            onCancelar={() => setAddTransacao(false)}
            onSalvo={(dados) => salvarTransacao(dados, null)}
          />
        </div>
      )}

      {mostrarFiltros && (
        <div className="card p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="label">Ativo</label>
              <select
                multiple
                className="input h-24"
                value={[...filtroAtivos]}
                onChange={(e) => setFiltroAtivos(new Set([...e.target.selectedOptions].map((o) => o.value)))}
              >
                {ativosOrdenados.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ticker}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Corretora</label>
              <select
                multiple
                className="input h-24"
                value={[...filtroCorretoras]}
                onChange={(e) => setFiltroCorretoras(new Set([...e.target.selectedOptions].map((o) => o.value)))}
              >
                {livro.corretoras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">De</label>
              <input
                type="date"
                className="input"
                value={filtroDataInicio}
                onChange={(e) => setFiltroDataInicio(e.target.value)}
              />
            </div>

            <div>
              <label className="label">Até</label>
              <input
                type="date"
                className="input"
                value={filtroDataFim}
                onChange={(e) => setFiltroDataFim(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-[11px] text-faint">Ctrl/Cmd + clique pra selecionar vários ativos/corretoras.</p>
            {filtroAtivo && (
              <button onClick={limparFiltros} className="text-xs text-faint hover:text-ink">
                Limpar filtros
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card p-3">
          <p className="text-xs text-faint">Comprado{filtroAtivo ? " (filtrado)" : ""}</p>
          <p className="text-lg font-medium text-success">{formatarMoeda(totalFiltrado.compra)}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-faint">Vendido{filtroAtivo ? " (filtrado)" : ""}</p>
          <p className="text-lg font-medium text-danger">{formatarMoeda(totalFiltrado.venda)}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-faint">Líquido (compra − venda){filtroAtivo ? " (filtrado)" : ""}</p>
          <p className="text-lg font-medium text-ink">{formatarMoeda(totalFiltrado.liquido)}</p>
        </div>
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

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[24px_90px_1fr_80px_100px_100px_1fr_110px] gap-2 px-4 py-2 text-xs text-faint border-b border-border items-center">
          <input
            type="checkbox"
            checked={todosSelecionados}
            onChange={alternarTodos}
            disabled={lancamentosFiltrados.length === 0}
            aria-label="Selecionar todos"
          />
          <span>Data</span>
          <span>Ativo</span>
          <span>Tipo</span>
          <span className="text-right">Quantidade</span>
          <span className="text-right">Valor</span>
          <span>Corretora</span>
          <span></span>
        </div>

        {lancamentosFiltrados.length === 0 && (
          <p className="text-sm text-faint px-4 py-4">
            {livro.lancamentos.length === 0
              ? "Nenhum lançamento registrado ainda."
              : "Nenhum lançamento bate com os filtros aplicados."}
          </p>
        )}

        {lancamentosFiltrados.map((l) =>
          editando === l.id ? (
            <div key={l.id} className="px-4 py-3 border-b border-border last:border-0 bg-surface-2">
              <FormTransacao
                ativos={ativos}
                corretoras={livro.corretoras}
                valoresIniciais={{
                  ativo_id: l.ativoId,
                  corretora_id: l.corretoraId,
                  tipo: l.tipo,
                  data: l.data,
                  quantidade: l.quantidade,
                  preco_unitario: l.precoUnitario,
                  custos: l.custos,
                  cambio: l.cambio ?? NaN,
                }}
                textoSalvar="Salvar"
                onCancelar={() => setEditando(null)}
                onSalvo={(dados) => salvarTransacao(dados, l.id)}
              />
            </div>
          ) : (
            <div
              key={l.id}
              className="grid grid-cols-[24px_90px_1fr_80px_100px_100px_1fr_110px] gap-2 items-center px-4 py-2 text-xs border-b border-border last:border-0"
            >
              <input
                type="checkbox"
                checked={selecionados.has(l.id)}
                onChange={() => alternarSelecao(l.id)}
                aria-label={`Selecionar transação de ${l.ativoTicker}`}
              />
              <span className="text-muted">{formatarData(l.data)}</span>
              <Link href={`/ativos/${l.ativoId}`} className="text-ink font-medium hover:underline">
                {l.ativoTicker}
              </Link>
              <span className={l.tipo === "compra" ? "text-success" : "text-danger"}>
                {l.tipo === "compra" ? "Compra" : "Venda"}
              </span>
              <span className="text-right text-muted">{l.quantidade.toLocaleString("pt-BR")}</span>
              <span className="text-right text-ink">{formatarMoeda(l.precoUnitario)}</span>
              <span className="text-faint truncate">{l.corretoraNome ?? "—"}</span>
              <span className="text-right">
                <button onClick={() => setEditando(l.id)} className="text-faint hover:text-ink mr-2">
                  Editar
                </button>
                <button onClick={() => setExcluindoId(l.id)} className="text-faint hover:text-danger">
                  Excluir
                </button>
              </span>
            </div>
          )
        )}
      </div>

      {excluindoId && (
        <ConfirmModal
          title="Excluir transação?"
          message="Essa ação não pode ser desfeita."
          loading={excluindoLoading}
          onCancel={() => setExcluindoId(null)}
          onConfirm={async () => {
            setExcluindoLoading(true);
            const resultado = await excluirTransacao(excluindoId);
            setExcluindoLoading(false);
            if (resultado.error) {
              toast.error(resultado.error);
              return;
            }
            setExcluindoId(null);
            await atualizar();
            toast.success("Transação excluída.");
          }}
        />
      )}

      {confirmandoLote && (
        <ConfirmModal
          title={`Excluir ${selecionados.size} transação(ões)?`}
          message="Essa ação não pode ser desfeita."
          loading={excluindoLote}
          onCancel={() => setConfirmandoLote(false)}
          onConfirm={async () => {
            setExcluindoLote(true);
            const resultado = await excluirTransacoesEmLote([...selecionados]);
            setExcluindoLote(false);
            if (resultado.error) {
              toast.error(resultado.error);
              return;
            }
            setSelecionados(new Set());
            setConfirmandoLote(false);
            await atualizar();
            toast.success("Transações excluídas.");
          }}
        />
      )}

      {duplicataPendente && (
        <ConfirmModal
          title="Transação duplicada?"
          message={duplicataPendente.mensagem}
          confirmLabel="Lançar mesmo assim"
          loading={confirmandoDuplicataLoading}
          onCancel={() => setDuplicataPendente(null)}
          onConfirm={async () => {
            setConfirmandoDuplicataLoading(true);
            const { dados, idEditando } = duplicataPendente;
            const resultado = idEditando
              ? await editarTransacao(idEditando, dados, { confirmarDuplicata: true })
              : await criarTransacao(dados, { confirmarDuplicata: true });
            setConfirmandoDuplicataLoading(false);
            if (resultado.error) {
              toast.error(resultado.error);
              return;
            }
            setDuplicataPendente(null);
            if (idEditando) setEditando(null);
            else setAddTransacao(false);
            await atualizar();
            toast.success(idEditando ? "Transação atualizada." : "Transação registrada.");
          }}
        />
      )}
    </div>
  );
}

function FormTransacao({
  ativos,
  corretoras,
  valoresIniciais,
  textoSalvar = "Salvar",
  onSalvo,
  onCancelar,
}: {
  ativos: AtivoOpcao[];
  corretoras: Corretora[];
  valoresIniciais?: TransacaoFormInput;
  textoSalvar?: string;
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
    defaultValues: valoresIniciais ?? {
      ativo_id: ativos[0]?.id ?? "",
      corretora_id: null as string | null,
      tipo: "compra" as const,
      data: new Date().toISOString().slice(0, 10),
      quantidade: 0,
      preco_unitario: 0,
      custos: 0,
      cambio: NaN,
    },
  });

  const ativoIdSelecionado = watch("ativo_id");
  const tipoAtivoSelecionado = ativos.find((a) => a.id === ativoIdSelecionado)?.tipo;

  const toast = useToast();
  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvo(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    }
  });

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

      {tipoAtivoSelecionado === "internacional" && (
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
