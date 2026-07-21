"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { macroSchema, type MacroForm } from "@/lib/alocacao/schema";
import { criarClasse, editarMacro, excluirMacro, type MacroNode } from "@/lib/alocacao/actions";
import ClasseRow, { FormClasse } from "./ClasseRow";
import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/components/ToastProvider";

/**
 * Nível 1 da estrutura-alvo desde a fase 1 da reformulação "Metas e
 * estrutura" (§8.50/§8.51 do mapa de dados) — mesmo padrão visual de
 * ClasseRow, um nível acima. Ainda é a UI "de cards empilhados" antiga; a
 * árvore + editor contextual do spec entram na fase 3.
 */
export default function MacroRow({
  macro,
  onChange,
}: {
  macro: MacroNode;
  onChange: () => void | Promise<void>;
}) {
  const [expandido, setExpandido] = useState(false);
  const [editando, setEditando] = useState(false);
  const [adicionandoClasse, setAdicionandoClasse] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [excluindoLoading, setExcluindoLoading] = useState(false);
  const toast = useToast();

  if (editando) {
    return (
      <div className="card p-4 mb-2">
        <FormMacro
          valoresIniciais={{ nome: macro.nome, peso_alvo: macro.pesoAlvo }}
          onCancelar={() => setEditando(false)}
          onSalvo={async (dados) => {
            const resultado = await editarMacro(macro.id, dados);
            if (resultado.error) throw new Error(resultado.error);
            await onChange();
            setEditando(false);
            toast.success("Macro atualizado.");
          }}
        />
      </div>
    );
  }

  const fora = Math.abs(macro.desvio) > 5;

  return (
    <div className="card mb-3 overflow-hidden border-l-4 border-l-accent">
      <div className="flex items-center gap-2 px-4 py-3 bg-surface-2">
        <button onClick={() => setExpandido((v) => !v)} className="text-faint hover:text-ink">
          {expandido ? "▾" : "▸"}
        </button>
        <span className="flex-1 text-ink font-semibold">{macro.nome}</span>
        <span className="text-muted text-xs">{macro.pesoAlvo.toFixed(0)}% alvo</span>
        <span className="text-muted text-xs">{macro.pesoReal.toFixed(0)}% real</span>
        <span className={`text-xs w-16 text-right ${fora ? "text-danger" : "text-success"}`}>
          {macro.desvio >= 0 ? "+" : ""}
          {macro.desvio.toFixed(1)}pp
        </span>
        <button onClick={() => setEditando(true)} className="text-xs text-faint hover:text-ink">
          Editar
        </button>
        <button onClick={() => setExcluindo(true)} className="text-xs text-faint hover:text-danger">
          Excluir
        </button>
      </div>

      {excluindo && (
        <ConfirmModal
          title={`Excluir o Macro ${macro.nome}?`}
          message="Tudo dentro dele (classes, setores e classificações dos ativos) some junto. Essa ação não pode ser desfeita."
          loading={excluindoLoading}
          onCancel={() => setExcluindo(false)}
          onConfirm={async () => {
            setExcluindoLoading(true);
            const resultado = await excluirMacro(macro.id);
            setExcluindoLoading(false);
            if (resultado.error) {
              toast.error(resultado.error);
              return;
            }
            setExcluindo(false);
            await onChange();
            toast.success("Macro excluído.");
          }}
        />
      )}

      {expandido && (
        <div className="px-4 py-3">
          {macro.classes.length === 0 && (
            <p className="text-xs text-faint mb-2">Nenhuma classe cadastrada nesse Macro.</p>
          )}
          {macro.classes.length > 0 &&
            (() => {
              const somaPesoClasses = macro.classes.reduce((s, c) => s + c.pesoAlvo, 0);
              return (
                <p className={`text-xs mb-2 ${somaPesoClasses > 100.01 ? "text-danger" : "text-faint"}`}>
                  Soma dos pesos-alvo das classes: {somaPesoClasses.toFixed(1)}%
                  {somaPesoClasses > 100.01
                    ? ` — excede 100% em ${(somaPesoClasses - 100).toFixed(1)}pp`
                    : somaPesoClasses < 99.99
                      ? ` — faltam ${(100 - somaPesoClasses).toFixed(1)}pp pra fechar 100%`
                      : " ✓"}
                </p>
              );
            })()}

          {macro.classes.map((classe) => (
            <ClasseRow key={classe.id} classe={classe} onChange={onChange} />
          ))}

          {adicionandoClasse ? (
            <div className="card p-4 mt-2">
              <FormClasse
                onCancelar={() => setAdicionandoClasse(false)}
                onSalvo={async (dados) => {
                  const resultado = await criarClasse(macro.id, dados);
                  if (resultado.error) throw new Error(resultado.error);
                  await onChange();
                  setAdicionandoClasse(false);
                  toast.success("Classe criada.");
                }}
              />
            </div>
          ) : (
            <button onClick={() => setAdicionandoClasse(true)} className="btn btn-secondary mt-2 text-xs py-1 px-3">
              + Adicionar classe
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function FormMacro({
  valoresIniciais,
  onSalvo,
  onCancelar,
}: {
  valoresIniciais?: Partial<MacroForm>;
  onSalvo: (dados: MacroForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
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
