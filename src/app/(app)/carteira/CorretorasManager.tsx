"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { corretoraSchema, type CorretoraForm } from "@/lib/carteira/schema";
import { criarCorretora, excluirCorretora, type Corretora } from "@/lib/carteira/actions";
import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/components/ToastProvider";

export default function CorretorasManager({
  corretoras,
  onChange,
}: {
  corretoras: Corretora[];
  onChange: () => void;
}) {
  const [adicionando, setAdicionando] = useState(false);
  const [excluindo, setExcluindo] = useState<Corretora | null>(null);
  const [excluindoLoading, setExcluindoLoading] = useState(false);
  const toast = useToast();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CorretoraForm>({
    resolver: zodResolver(corretoraSchema),
    defaultValues: { nome: "" },
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      const resultado = await criarCorretora(data);
      if (resultado.error) throw new Error(resultado.error);
      reset();
      setAdicionando(false);
      onChange();
      toast.success("Corretora cadastrada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    }
  });

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-ink">Corretoras</h2>
        {!adicionando && (
          <button onClick={() => setAdicionando(true)} className="text-xs text-faint hover:text-ink">
            + Adicionar
          </button>
        )}
      </div>

      {corretoras.length === 0 && !adicionando && (
        <p className="text-xs text-faint">Nenhuma corretora cadastrada ainda.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {corretoras.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-2 text-xs bg-surface-2 border border-border rounded-md px-2 py-1 text-muted"
          >
            {c.nome}
            <button
              onClick={() => setExcluindo(c)}
              className="text-faint hover:text-danger"
              aria-label={`Excluir ${c.nome}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {adicionando && (
        <form onSubmit={onSubmit} className="flex gap-2 mt-3">
          <input {...register("nome")} className="input" placeholder="Ex: XP, Clear, Rico" autoFocus />
          <button type="submit" disabled={isSubmitting} className="btn btn-primary">
            Salvar
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              reset();
              setAdicionando(false);
            }}
          >
            Cancelar
          </button>
        </form>
      )}
      {errors.nome?.message && <p className="field-error">{errors.nome.message}</p>}

      {excluindo && (
        <ConfirmModal
          title={`Excluir a corretora ${excluindo.nome}?`}
          message="Transações já lançadas com essa corretora ficam sem corretora associada. Essa ação não pode ser desfeita."
          loading={excluindoLoading}
          onCancel={() => setExcluindo(null)}
          onConfirm={async () => {
            setExcluindoLoading(true);
            await excluirCorretora(excluindo.id);
            setExcluindoLoading(false);
            setExcluindo(null);
            onChange();
            toast.success("Corretora excluída.");
          }}
        />
      )}
    </div>
  );
}
