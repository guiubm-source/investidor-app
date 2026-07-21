"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { setorSchema, type SetorForm } from "@/lib/alocacao/schema";
import { useToast } from "@/components/ToastProvider";

/**
 * Formulário de criar/editar Setor — reutilizado pelo painel contextual
 * (`PainelContextual.tsx`, fase 3 da reformulação "Metas e estrutura",
 * §8.50/§8.51/§8.52). Antes vivia num arquivo "SetorRow.tsx" que também
 * tinha o card empilhado expansível (com a lista de Ativos do setor) — esse
 * card foi substituído pela árvore + editor contextual, então o arquivo foi
 * renomeado pra refletir que só resta o formulário aqui.
 */
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
  } = useForm<SetorForm>({
    resolver: zodResolver(setorSchema),
    defaultValues: {
      nome: valoresIniciais?.nome ?? "",
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
