"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { transacaoSchema, TIPOS_TRANSACAO, type TransacaoForm } from "@/lib/carteira/schema";
import {
  criarTransacao,
  excluirTransacao,
  obterLivroRazao,
  type LivroRazao,
  type Corretora,
} from "@/lib/carteira/actions";
import CorretorasManager from "./CorretorasManager";
import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/components/ToastProvider";

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatarData = (iso: string) => {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

export type AtivoOpcao = { id: string; ticker: string; tipo: string };

/**
 * Sub-aba Livro-razão: só lançamentos de compra/venda (ver
 * docs/MAPA-DE-DADOS.md §8.16 — desde 2026-07-20 proventos não são mais
 * lidos aqui, nem lista nem resumo; a leitura/escrita de proventos é
 * exclusiva da aba Proventos). A visão consolidada por posição/classe fica
 * na sub-aba Posição, irmã desta.
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
  const [excluindoId, setExcluindoId] = useState<string | null>(null);
  const [excluindoLoading, setExcluindoLoading] = useState(false);
  const toast = useToast();

  const atualizar = async () => {
    const novo = await obterLivroRazao();
    setLivro(novo);
    onLivroAtualizado?.();
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
          <button onClick={() => setAddTransacao(true)} className="btn btn-secondary">
            + Registrar transação
          </button>
        )
      )}

      {addTransacao && (
        <div className="card p-4">
          <FormTransacao
            ativos={ativos}
            corretoras={livro.corretoras}
            onCancelar={() => setAddTransacao(false)}
            onSalvo={async (dados) => {
              const resultado = await criarTransacao(dados);
              if (resultado.error) throw new Error(resultado.error);
              setAddTransacao(false);
              await atualizar();
              toast.success("Transação registrada.");
            }}
          />
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[90px_1fr_80px_100px_100px_1fr_60px] gap-2 px-4 py-2 text-xs text-faint border-b border-border">
          <span>Data</span>
          <span>Ativo</span>
          <span>Tipo</span>
          <span className="text-right">Quantidade</span>
          <span className="text-right">Valor</span>
          <span>Corretora</span>
          <span></span>
        </div>

        {livro.lancamentos.length === 0 && (
          <p className="text-sm text-faint px-4 py-4">Nenhum lançamento registrado ainda.</p>
        )}

        {livro.lancamentos.map((l) => (
          <div
            key={l.id}
            className="grid grid-cols-[90px_1fr_80px_100px_100px_1fr_60px] gap-2 items-center px-4 py-2 text-xs border-b border-border last:border-0"
          >
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
            <button onClick={() => setExcluindoId(l.id)} className="text-faint hover:text-danger text-right">
              Excluir
            </button>
          </div>
        ))}
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
    </div>
  );
}

function FormTransacao({
  ativos,
  corretoras,
  onSalvo,
  onCancelar,
}: {
  ativos: AtivoOpcao[];
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
          {isSubmitting ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </form>
  );
}
