"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { macroSchema, type MacroForm } from "@/lib/alocacao/schema";
import { useToast } from "@/components/ToastProvider";

/**
 * Formulário de criar/editar Macro — reutilizado pelo empty-state e pelo
 * painel contextual (`PainelContextual.tsx`, fase 3 da reformulação "Metas
 * e estrutura", §8.50/§8.51/§8.52). Antes vivia num arquivo "MacroRow.tsx"
 * que também tinha o card empilhado expansível — esse card foi substituído
 * pela árvore + editor contextual, então o arquivo foi renomeado pra
 * refletir que só resta o formulário aqui.
 *
 * `somaOutros` (fase 4, §8.53/§16.2.7): soma do peso-alvo dos outros
 * Macros já cadastrados, sem contar o valor digitado agora, pra bloquear o
 * Salvar preventivamente se ultrapassar 100% do patrimônio total.
 */
export function FormMacro({
  valoresIniciais,
  onSalvo,
  onCancelar,
  somaOutros = 0,
}: {
  valoresIniciais?: Partial<MacroForm>;
  onSalvo: (dados: MacroForm) => void | Promise<void>;
  onCancelar: () => void;
  somaOutros?: number;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<MacroForm>({
    resolver: zodResolver(macroSchema),
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

  const pesoDigitado = watch("peso_alvo");
  const previsto = somaOutros + (Number.isFinite(pesoDigitado) ? pesoDigitado : 0);
  const excede = previsto > 100.01;

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3">
      <div>
        <label className="label">Nome do Macro</label>
        <input {...register("nome")} className="input" placeholder="Brasil" />
        {errors.nome?.message && <p className="field-error">{errors.nome.message}</p>}
      </div>
      <div>
        <label className="label">Peso-alvo no patrimônio (%)</label>
        <input
          type="number"
          step="1"
          {...register("peso_alvo", { valueAsNumber: true })}
          className="input"
        />
        {errors.peso_alvo?.message && <p className="field-error">{errors.peso_alvo.message}</p>}
      </div>
      {excede && (
        <p className="col-span-2 text-xs text-danger">
          Isso deixaria a soma dos Macros em {previsto.toFixed(1)}% — {(previsto - 100).toFixed(1)}pp acima de
          100%. Reduza este valor ou ajuste os outros Macros primeiro.
        </p>
      )}
      <div className="col-span-2 flex gap-2">
        <button type="button" onClick={onCancelar} className="btn btn-secondary flex-1">
          Cancelar
        </button>
        <button type="submit" disabled={isSubmitting || excede} className="btn btn-primary flex-1">
          {isSubmitting ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </form>
  );
}
