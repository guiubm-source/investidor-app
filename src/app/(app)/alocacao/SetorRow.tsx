"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { setorSchema, type SetorForm } from "@/lib/alocacao/schema";
import { editarSetor, excluirSetor, type SetorNode } from "@/lib/alocacao/actions";

export default function SetorRow({
  setor,
  onChange,
}: {
  setor: SetorNode;
  onChange: () => void | Promise<void>;
}) {
  const [expandido, setExpandido] = useState(false);
  const [editando, setEditando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  if (editando) {
    return (
      <div className="px-3 py-2 bg-surface-2 rounded-md ml-4">
        <FormSetor
          valoresIniciais={{ nome: setor.nome, peso_alvo: setor.pesoAlvo }}
          onCancelar={() => setEditando(false)}
          onSalvo={async (dados) => {
            const resultado = await editarSetor(setor.id, dados);
            if (resultado.error) throw new Error(resultado.error);
            await onChange();
            setEditando(false);
          }}
        />
      </div>
    );
  }

  const fora = Math.abs(setor.desvio) > 5;

  return (
    <div className="ml-4 border-l border-border pl-3">
      <div className="flex items-center gap-2 py-2 text-sm">
        <button onClick={() => setExpandido((v) => !v)} className="text-faint hover:text-ink">
          {expandido ? "▾" : "▸"}
        </button>
        <span className="flex-1 text-ink">{setor.nome}</span>
        <span className="text-muted text-xs">{setor.pesoAlvo.toFixed(0)}% alvo</span>
        <span className="text-muted text-xs">{setor.pesoReal.toFixed(0)}% real</span>
        <span className={`text-xs w-16 text-right ${fora ? "text-danger" : "text-success"}`}>
          {setor.desvio >= 0 ? "+" : ""}
          {setor.desvio.toFixed(1)}pp
        </span>
        <button onClick={() => setEditando(true)} className="text-xs text-faint hover:text-ink">
          Editar
        </button>
        <button onClick={() => setExcluindo(true)} className="text-xs text-faint hover:text-danger">
          Excluir
        </button>
      </div>

      {excluindo && (
        <div className="error-box flex items-center justify-between mb-2">
          <span>Excluir o setor {setor.nome}? Os ativos classificados nele ficam sem classificação.</span>
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={() => setExcluindo(false)}>
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                await excluirSetor(setor.id);
                onChange();
              }}
            >
              Confirmar
            </button>
          </div>
        </div>
      )}

      {expandido && (
        <div className="bg-surface rounded-md border border-border mb-2">
          {setor.ativos.length === 0 ? (
            <p className="text-xs text-faint px-3 py-3">
              Nenhum ativo classificado neste setor ainda. Classifique ativos na aba Ativos.
            </p>
          ) : (
            setor.ativos.map((ativo) => {
              const ativoFora = Math.abs(ativo.desvio) > 5;
              return (
                <Link
                  key={ativo.id}
                  href={`/ativos/${ativo.id}`}
                  className="grid grid-cols-[1fr_70px_70px_70px] gap-2 items-center px-3 py-2 text-sm border-b border-border last:border-0 hover:bg-surface-2 transition-colors"
                >
                  <span className="text-ink font-medium">{ativo.ticker}</span>
                  <span className="text-right text-muted">{ativo.pesoAlvo.toFixed(0)}%</span>
                  <span className="text-right text-muted">{ativo.pesoReal.toFixed(0)}%</span>
                  <span className={`text-right ${ativoFora ? "text-danger" : "text-success"}`}>
                    {ativo.desvio >= 0 ? "+" : ""}
                    {ativo.desvio.toFixed(1)}pp
                  </span>
                </Link>
              );
            })
          )}
          <Link href="/ativos" className="block text-xs text-faint hover:text-ink px-3 py-2">
            Gerenciar ativos →
          </Link>
        </div>
      )}
    </div>
  );
}

export function FormSetor({
  valoresIniciais,
  onSalvo,
  onCancelar,
}: {
  valoresIniciais?: Partial<SetorForm>;
  onSalvo: (dados: SetorForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<SetorForm>({
    resolver: zodResolver(setorSchema),
    defaultValues: {
      nome: valoresIniciais?.nome ?? "",
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

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
      <div>
        <label className="label">Nome do setor/segmento</label>
        <input {...register("nome")} className="input" placeholder="Financeiro" />
        {errors.nome?.message && <p className="field-error">{errors.nome.message}</p>}
      </div>
      <div>
        <label className="label">Peso-alvo na classe (%)</label>
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
