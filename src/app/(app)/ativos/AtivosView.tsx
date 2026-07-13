"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ativoSchema, TIPOS_ATIVO, type AtivoForm } from "@/lib/ativos/schema";
import { criarAtivo, obterAtivosComPosicao, type AtivoResumo } from "@/lib/ativos/actions";

const rotuloTipo = (valor: string) => TIPOS_ATIVO.find((t) => t.valor === valor)?.label ?? valor;

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function AtivosView({ ativosIniciais }: { ativosIniciais: AtivoResumo[] }) {
  const [ativos, setAtivos] = useState(ativosIniciais);
  const [adicionando, setAdicionando] = useState(false);

  const atualizar = async () => {
    const novo = await obterAtivosComPosicao();
    setAtivos(novo);
  };

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="grid grid-cols-[1.5fr_1fr_80px_100px_80px] gap-2 px-4 py-2 text-xs text-faint border-b border-border">
          <span>Ativo</span>
          <span>Classificação</span>
          <span className="text-right">Peso-alvo</span>
          <span className="text-right">Valor atual</span>
          <span className="text-right">Não realizado</span>
        </div>

        {ativos.length === 0 && (
          <p className="text-sm text-faint px-4 py-4">Nenhum ativo cadastrado ainda.</p>
        )}

        {ativos.map((ativo) => {
          const lucroPositivo = ativo.lucroNaoRealizado >= 0;
          return (
            <Link
              key={ativo.id}
              href={`/ativos/${ativo.id}`}
              className="grid grid-cols-[1.5fr_1fr_80px_100px_80px] gap-2 px-4 py-3 text-sm border-b border-border last:border-0 hover:bg-surface-2 transition-colors"
            >
              <div className="min-w-0">
                <span className="text-ink font-medium">{ativo.ticker}</span>
                <span className="text-faint ml-2 text-xs">{rotuloTipo(ativo.tipo)}</span>
              </div>
              <span className="text-muted text-xs truncate">
                {ativo.setorNome ? `${ativo.classeNome} › ${ativo.setorNome}` : "Não classificado"}
              </span>
              <span className="text-right text-muted text-xs">
                {ativo.pesoAlvo !== null ? `${ativo.pesoAlvo.toFixed(0)}%` : "—"}
              </span>
              <span className="text-right text-ink text-xs">{formatarMoeda(ativo.valorAtual)}</span>
              <span className={`text-right text-xs ${lucroPositivo ? "text-success" : "text-danger"}`}>
                {lucroPositivo ? "+" : ""}
                {ativo.lucroNaoRealizadoPct.toFixed(1)}%
              </span>
            </Link>
          );
        })}
      </div>

      {adicionando ? (
        <div className="card p-4">
          <FormNovoAtivo
            onCancelar={() => setAdicionando(false)}
            onSalvo={async (dados) => {
              const resultado = await criarAtivo(dados);
              if (resultado.error) throw new Error(resultado.error);
              setAdicionando(false);
              await atualizar();
            }}
          />
        </div>
      ) : (
        <button onClick={() => setAdicionando(true)} className="btn btn-secondary">
          + Novo ativo
        </button>
      )}
    </div>
  );
}

function FormNovoAtivo({
  onSalvo,
  onCancelar,
}: {
  onSalvo: (dados: AtivoForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<AtivoForm>({
    resolver: zodResolver(ativoSchema),
    defaultValues: { ticker: "", nome: "", tipo: "acao" },
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
        <label className="label">Ticker/código</label>
        <input {...register("ticker")} className="input" placeholder="PETR4" autoFocus />
        {errors.ticker?.message && <p className="field-error">{errors.ticker.message}</p>}
      </div>
      <div>
        <label className="label">Nome (opcional)</label>
        <input {...register("nome")} className="input" placeholder="Petrobras" />
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
      <p className="col-span-2 text-xs text-faint">
        Depois de criado, abra o ativo para classificá-lo (classe/setor/peso-alvo) e lançar
        transações.
      </p>
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
