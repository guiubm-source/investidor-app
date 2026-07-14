"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { classeSchema, type ClasseForm } from "@/lib/alocacao/schema";
import { criarSetor, editarClasse, excluirClasse, type ClasseNode } from "@/lib/alocacao/actions";
import SetorRow, { FormSetor } from "./SetorRow";

export default function ClasseRow({
  classe,
  onChange,
}: {
  classe: ClasseNode;
  onChange: () => void | Promise<void>;
}) {
  const [expandido, setExpandido] = useState(false);
  const [editando, setEditando] = useState(false);
  const [adicionandoSetor, setAdicionandoSetor] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  if (editando) {
    return (
      <div className="card p-4 mb-2">
        <FormClasse
          valoresIniciais={{ nome: classe.nome, peso_alvo: classe.pesoAlvo }}
          onCancelar={() => setEditando(false)}
          onSalvo={async (dados) => {
            const resultado = await editarClasse(classe.id, dados);
            if (resultado.error) throw new Error(resultado.error);
            await onChange();
            setEditando(false);
          }}
        />
      </div>
    );
  }

  const fora = Math.abs(classe.desvio) > 5;

  return (
    <div className="card mb-2 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={() => setExpandido((v) => !v)} className="text-faint hover:text-ink">
          {expandido ? "▾" : "▸"}
        </button>
        <span className="flex-1 text-ink font-medium">{classe.nome}</span>
        <span className="text-muted text-xs">{classe.pesoAlvo.toFixed(0)}% alvo</span>
        <span className="text-muted text-xs">{classe.pesoReal.toFixed(0)}% real</span>
        <span className={`text-xs w-16 text-right ${fora ? "text-danger" : "text-success"}`}>
          {classe.desvio >= 0 ? "+" : ""}
          {classe.desvio.toFixed(1)}pp
        </span>
        <button onClick={() => setEditando(true)} className="text-xs text-faint hover:text-ink">
          Editar
        </button>
        <button onClick={() => setExcluindo(true)} className="text-xs text-faint hover:text-danger">
          Excluir
        </button>
      </div>

      {excluindo && (
        <div className="error-box flex items-center justify-between mx-4 mb-3">
          <span>Excluir a classe {classe.nome} e tudo dentro dela?</span>
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={() => setExcluindo(false)}>
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                await excluirClasse(classe.id);
                onChange();
              }}
            >
              Confirmar
            </button>
          </div>
        </div>
      )}

      {expandido && (
        <div className="border-t border-border px-4 py-3">
          {classe.setores.length === 0 && (
            <p className="text-xs text-faint mb-2">Nenhum setor cadastrado nessa classe.</p>
          )}
          {classe.setores.length > 0 &&
            (() => {
              const somaPesoSetores = classe.setores.reduce((s, st) => s + st.pesoAlvo, 0);
              return (
                <p className={`text-xs mb-2 ml-4 ${somaPesoSetores > 100.01 ? "text-danger" : "text-faint"}`}>
                  Soma dos pesos-alvo dos setores: {somaPesoSetores.toFixed(1)}%
                  {somaPesoSetores > 100.01
                    ? ` — excede 100% em ${(somaPesoSetores - 100).toFixed(1)}pp`
                    : somaPesoSetores < 99.99
                      ? ` — faltam ${(100 - somaPesoSetores).toFixed(1)}pp pra fechar 100%`
                      : " ✓"}
                </p>
              );
            })()}
          {classe.setores.map((setor) => (
            <SetorRow key={setor.id} setor={setor} onChange={onChange} />
          ))}

          {adicionandoSetor ? (
            <div className="ml-4 mt-2 bg-surface-2 rounded-md p-3">
              <FormSetor
                onCancelar={() => setAdicionandoSetor(false)}
                onSalvo={async (dados) => {
                  const resultado = await criarSetor(classe.id, dados);
                  if (resultado.error) throw new Error(resultado.error);
                  await onChange();
                  setAdicionandoSetor(false);
                }}
              />
            </div>
          ) : (
            <button
              onClick={() => setAdicionandoSetor(true)}
              className="text-xs text-faint hover:text-ink ml-4 mt-1"
            >
              + Adicionar setor
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function FormClasse({
  valoresIniciais,
  onSalvo,
  onCancelar,
}: {
  valoresIniciais?: Partial<ClasseForm>;
  onSalvo: (dados: ClasseForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<ClasseForm>({
    resolver: zodResolver(classeSchema),
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
        <label className="label">Nome da classe</label>
        <input {...register("nome")} className="input" placeholder="Renda fixa" />
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
