"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { proventoSchema, TIPOS_PROVENTO, type ProventoForm } from "@/lib/proventos/schema";
import {
  criarProvento,
  editarProvento,
  excluirProvento,
  excluirProventosEmLote,
  obterLivroProventos,
  type LivroProventos,
} from "@/lib/proventos/actions";

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatarData = (iso: string) => {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

const rotuloProvento = (valor: string) => TIPOS_PROVENTO.find((t) => t.valor === valor)?.label ?? valor;

export type AtivoOpcao = { id: string; ticker: string };

export default function ProventosView({
  livroInicial,
  ativos,
}: {
  livroInicial: LivroProventos;
  ativos: AtivoOpcao[];
}) {
  const [livro, setLivro] = useState(livroInicial);
  const [addProvento, setAddProvento] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [confirmandoLote, setConfirmandoLote] = useState(false);
  const [excluindoLote, setExcluindoLote] = useState(false);

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

  const todosSelecionados =
    livro.lancamentos.length > 0 && livro.lancamentos.every((l) => selecionados.has(l.id));

  const alternarTodos = () => {
    setSelecionados(todosSelecionados ? new Set() : new Set(livro.lancamentos.map((l) => l.id)));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card p-3">
          <p className="text-xs text-faint">Total recebido</p>
          <p className="text-lg font-medium text-ink">{formatarMoeda(livro.totalGeral)}</p>
        </div>

        <div className="card p-3">
          <p className="text-xs text-faint mb-2">Por tipo</p>
          {livro.porTipo.length === 0 ? (
            <p className="text-xs text-faint">—</p>
          ) : (
            <div className="space-y-1">
              {livro.porTipo.map((t) => (
                <div key={t.tipo} className="flex items-center justify-between text-xs">
                  <span className="text-muted">{t.label}</span>
                  <span className="text-ink">{formatarMoeda(t.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-3">
          <p className="text-xs text-faint mb-2">Por ano</p>
          {livro.porAno.length === 0 ? (
            <p className="text-xs text-faint">—</p>
          ) : (
            <div className="space-y-1">
              {livro.porAno.map((a) => (
                <div key={a.ano} className="flex items-center justify-between text-xs">
                  <span className="text-muted">{a.ano}</span>
                  <span className="text-ink">{formatarMoeda(a.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card p-3">
        <p className="text-xs text-faint mb-2">Por ativo</p>
        {livro.porAtivo.length === 0 ? (
          <p className="text-xs text-faint">Nenhum provento registrado ainda.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {livro.porAtivo.map((a) => (
              <Link
                key={a.ativoId}
                href={`/ativos/${a.ativoId}`}
                className="flex items-center justify-between text-xs bg-surface-2 rounded-md px-3 py-2 hover:bg-border"
              >
                <span className="text-ink font-medium">{a.ativoTicker}</span>
                <span className="text-muted">{formatarMoeda(a.total)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

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
            }}
          />
        </div>
      )}

      {selecionados.size > 0 && (
        <div className="card p-3 flex items-center justify-between gap-3 bg-surface-2">
          <span className="text-xs text-muted">{selecionados.size} selecionado(s)</span>
          {confirmandoLote ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-danger">Excluir os selecionados?</span>
              <button
                className="btn btn-secondary"
                onClick={() => setConfirmandoLote(false)}
                disabled={excluindoLote}
              >
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                disabled={excluindoLote}
                onClick={async () => {
                  setExcluindoLote(true);
                  await excluirProventosEmLote([...selecionados]);
                  setSelecionados(new Set());
                  setConfirmandoLote(false);
                  await atualizar();
                  setExcluindoLote(false);
                }}
              >
                {excluindoLote ? "Excluindo..." : "Confirmar"}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button className="text-xs text-faint hover:text-ink" onClick={() => setSelecionados(new Set())}>
                Limpar seleção
              </button>
              <button className="text-xs text-danger hover:underline" onClick={() => setConfirmandoLote(true)}>
                Excluir selecionados
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[24px_90px_1fr_1fr_100px_120px] gap-2 px-4 py-2 text-xs text-faint border-b border-border items-center">
          <input
            type="checkbox"
            checked={todosSelecionados}
            onChange={alternarTodos}
            disabled={livro.lancamentos.length === 0}
            aria-label="Selecionar todos"
          />
          <span>Data</span>
          <span>Ativo</span>
          <span>Tipo</span>
          <span className="text-right">Valor</span>
          <span></span>
        </div>

        {livro.lancamentos.length === 0 && (
          <p className="text-sm text-faint px-4 py-4">Nenhum lançamento registrado ainda.</p>
        )}

        {livro.lancamentos.map((l) =>
          editando === l.id ? (
            <div key={l.id} className="px-4 py-3 border-b border-border last:border-0 bg-surface-2">
              <FormProvento
                ativos={ativos}
                valoresIniciais={{ ativo_id: l.ativoId, tipo: l.tipo as ProventoForm["tipo"], data: l.data, valor_total: l.valorTotal }}
                textoSalvar="Salvar"
                onCancelar={() => setEditando(null)}
                onSalvo={async (dados) => {
                  const resultado = await editarProvento(l.id, dados);
                  if (resultado.error) throw new Error(resultado.error);
                  await atualizar();
                  setEditando(null);
                }}
              />
            </div>
          ) : (
            <div
              key={l.id}
              className="grid grid-cols-[24px_90px_1fr_1fr_100px_120px] gap-2 items-center px-4 py-2 text-xs border-b border-border last:border-0"
            >
              <input
                type="checkbox"
                checked={selecionados.has(l.id)}
                onChange={() => alternarSelecao(l.id)}
                aria-label={`Selecionar provento de ${l.ativoTicker}`}
              />
              <span className="text-muted">{formatarData(l.data)}</span>
              <Link href={`/ativos/${l.ativoId}`} className="text-ink font-medium hover:underline">
                {l.ativoTicker}
              </Link>
              <span className="text-muted">{rotuloProvento(l.tipo)}</span>
              <span className="text-right text-ink">{formatarMoeda(l.valorTotal)}</span>
              <span className="text-right">
                <button onClick={() => setEditando(l.id)} className="text-faint hover:text-ink mr-2">
                  Editar
                </button>
                <button
                  onClick={async () => {
                    await excluirProvento(l.id);
                    await atualizar();
                  }}
                  className="text-faint hover:text-danger"
                >
                  Excluir
                </button>
              </span>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function FormProvento({
  ativos,
  valoresIniciais,
  textoSalvar = "Salvar",
  onSalvo,
  onCancelar,
}: {
  ativos: AtivoOpcao[];
  valoresIniciais?: ProventoForm;
  textoSalvar?: string;
  onSalvo: (dados: ProventoForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<ProventoForm>({
    resolver: zodResolver(proventoSchema),
    defaultValues: valoresIniciais ?? {
      ativo_id: ativos[0]?.id ?? "",
      tipo: "dividendo",
      data: new Date().toISOString().slice(0, 10),
      valor_total: 0,
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
          {TIPOS_PROVENTO.map((t) => (
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
        <label className="label">Valor total (R$)</label>
        <input
          type="number"
          step="0.01"
          {...register("valor_total", { valueAsNumber: true })}
          className="input"
        />
        {errors.valor_total?.message && <p className="field-error">{errors.valor_total.message}</p>}
      </div>

      {errors.root?.message && <p className="error-box col-span-2 md:col-span-4">{errors.root.message}</p>}

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
