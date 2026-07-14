"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  dolarMensalSchema,
  fluxoEstrangeiroMensalSchema,
  type DolarMensalForm,
  type FluxoEstrangeiroMensalForm,
} from "@/lib/indicadores/schema";
import {
  criarDolarMensal,
  criarFluxoEstrangeiroMensal,
  excluirDolarMensal,
  excluirFluxoEstrangeiroMensal,
  obterDolar,
  obterFluxoEstrangeiro,
  obterIpca,
  obterSelic,
  obterVisaoGeral,
  type DolarView,
  type FluxoEstrangeiroView,
  type IpcaView,
  type SelicView,
  type VisaoGeralView,
} from "@/lib/indicadores/actions";
import { obterDiretoriaBacen, obterPresidentesBrasil, type DiretorBacen, type PresidenteBrasil } from "@/lib/referencia/actions";
import AbaSelic from "./AbaSelic";
import AbaIpca from "./AbaIpca";

const formatarMoeda = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const SetaTendencia = ({ tendencia }: { tendencia: "alta" | "queda" | "estavel" | null }) => {
  if (tendencia === "alta") return <span className="text-danger">▲</span>;
  if (tendencia === "queda") return <span className="text-accent">▼</span>;
  if (tendencia === "estavel") return <span className="text-faint">＝</span>;
  return null;
};

const ABAS = [
  { id: "geral", label: "Visão Geral" },
  { id: "selic", label: "Selic" },
  { id: "ipca", label: "IPCA" },
  { id: "fluxo", label: "Fluxo estrangeiro" },
  { id: "dolar", label: "Dólar" },
] as const;

type AbaId = (typeof ABAS)[number]["id"];

export default function IndicadoresView({
  visaoGeralInicial,
  selicInicial,
  ipcaInicial,
  dolarInicial,
  fluxoInicial,
  diretoriaBacenInicial,
  presidentesBrasilInicial,
}: {
  visaoGeralInicial: VisaoGeralView;
  selicInicial: SelicView;
  ipcaInicial: IpcaView;
  dolarInicial: DolarView;
  fluxoInicial: FluxoEstrangeiroView;
  diretoriaBacenInicial: DiretorBacen[];
  presidentesBrasilInicial: PresidenteBrasil[];
}) {
  const [aba, setAba] = useState<AbaId>("geral");
  const [visaoGeral, setVisaoGeral] = useState(visaoGeralInicial);
  const [selic, setSelic] = useState(selicInicial);
  const [ipca, setIpca] = useState(ipcaInicial);
  const [dolar, setDolar] = useState(dolarInicial);
  const [fluxo, setFluxo] = useState(fluxoInicial);
  const [diretoriaBacen, setDiretoriaBacen] = useState(diretoriaBacenInicial);
  const [presidentesBrasil, setPresidentesBrasil] = useState(presidentesBrasilInicial);

  const atualizarTudo = async () => {
    const [vg, s, i, d, f, db, pb] = await Promise.all([
      obterVisaoGeral(),
      obterSelic(),
      obterIpca(),
      obterDolar(),
      obterFluxoEstrangeiro(),
      obterDiretoriaBacen(),
      obterPresidentesBrasil(),
    ]);
    setVisaoGeral(vg);
    setSelic(s);
    setIpca(i);
    setDolar(d);
    setFluxo(f);
    setDiretoriaBacen(db);
    setPresidentesBrasil(pb);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {ABAS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              aba === a.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      {aba === "geral" && <AbaVisaoGeral visaoGeral={visaoGeral} />}
      {aba === "selic" && (
        <AbaSelic
          selic={selic}
          diretoriaBacen={diretoriaBacen}
          presidentesBrasil={presidentesBrasil}
          onAtualizar={atualizarTudo}
        />
      )}
      {aba === "ipca" && <AbaIpca ipca={ipca} onAtualizar={atualizarTudo} />}
      {aba === "fluxo" && <AbaFluxo fluxo={fluxo} onAtualizar={atualizarTudo} />}
      {aba === "dolar" && <AbaDolar dolar={dolar} onAtualizar={atualizarTudo} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visão Geral (só leitura)
// ---------------------------------------------------------------------------

function AbaVisaoGeral({ visaoGeral }: { visaoGeral: VisaoGeralView }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {visaoGeral.painel.map((item) => (
          <div key={item.label} className="card p-3">
            <p className="text-xs text-faint">{item.label}</p>
            <p className="text-lg font-medium text-ink flex items-center gap-1.5">
              {item.valor} <SetaTendencia tendencia={item.tendencia} />
            </p>
          </div>
        ))}
      </div>

      <div className="card p-4">
        <p className="text-xs text-faint mb-2">Leitura combinada</p>
        <p className="text-sm text-ink leading-relaxed">{visaoGeral.leitura}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fluxo estrangeiro
// ---------------------------------------------------------------------------

function AbaFluxo({ fluxo, onAtualizar }: { fluxo: FluxoEstrangeiroView; onAtualizar: () => Promise<void> }) {
  const [addLancamento, setAddLancamento] = useState(false);
  const { register, handleSubmit, reset, formState, setError } = useForm<FluxoEstrangeiroMensalForm>({
    resolver: zodResolver(fluxoEstrangeiroMensalSchema),
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      const resultado = await criarFluxoEstrangeiroMensal(data);
      if (resultado.error) throw new Error(resultado.error);
      setAddLancamento(false);
      reset();
      await onAtualizar();
    } catch (e) {
      setError("root", { message: e instanceof Error ? e.message : "Erro ao salvar." });
    }
  });

  return (
    <div className="space-y-4">
      <div className="card p-3 w-fit">
        <p className="text-xs text-faint">Último saldo líquido</p>
        <p className="text-lg font-medium text-ink flex items-center gap-1.5">
          {fluxo.ultimo ? formatarMoeda(fluxo.ultimo.saldoLiquido) : "—"}
          <SetaTendencia tendencia={fluxo.tendencia} />
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <p className="text-xs text-faint">Saldo líquido mensal (R$, negativo = saída)</p>
          {!addLancamento && (
            <button onClick={() => setAddLancamento(true)} className="text-xs text-accent hover:underline">
              + Lançar mês
            </button>
          )}
        </div>
        {addLancamento && (
          <form onSubmit={onSubmit} className="grid grid-cols-2 md:grid-cols-3 gap-3 px-4 py-3 border-b border-border">
            <div>
              <label className="label">Mês (AAAA-MM)</label>
              <input {...register("ano_mes")} placeholder="2026-06" className="input" />
              {formState.errors.ano_mes?.message && <p className="field-error">{formState.errors.ano_mes.message}</p>}
            </div>
            <div>
              <label className="label">Saldo líquido (R$)</label>
              <input type="number" step="0.01" {...register("saldo_liquido", { valueAsNumber: true })} className="input" />
            </div>
            <div className="flex items-end gap-2">
              <button type="button" onClick={() => setAddLancamento(false)} className="btn btn-secondary flex-1">
                Cancelar
              </button>
              <button type="submit" disabled={formState.isSubmitting} className="btn btn-primary flex-1">
                Salvar
              </button>
            </div>
            {formState.errors.root?.message && <p className="error-box col-span-2 md:col-span-3">{formState.errors.root.message}</p>}
          </form>
        )}
        <div className="grid grid-cols-[1fr_1fr_60px] gap-2 px-4 py-2 text-xs text-faint border-b border-border">
          <span>Mês</span>
          <span className="text-right">Saldo</span>
          <span></span>
        </div>
        {fluxo.mensal.length === 0 && <p className="text-sm text-faint px-4 py-4">Nenhum lançamento ainda.</p>}
        {fluxo.mensal.map((f) => (
          <div
            key={f.id}
            className="grid grid-cols-[1fr_1fr_60px] gap-2 items-center px-4 py-2 text-xs border-b border-border last:border-0"
          >
            <span className="text-ink">{f.anoMes}</span>
            <span className="text-right text-ink">{formatarMoeda(f.saldoLiquido)}</span>
            <button
              onClick={async () => {
                await excluirFluxoEstrangeiroMensal(f.id);
                await onAtualizar();
              }}
              className="text-faint hover:text-danger text-right"
            >
              Excluir
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dólar
// ---------------------------------------------------------------------------

function AbaDolar({ dolar, onAtualizar }: { dolar: DolarView; onAtualizar: () => Promise<void> }) {
  const [addLancamento, setAddLancamento] = useState(false);
  const { register, handleSubmit, reset, formState, setError } = useForm<DolarMensalForm>({
    resolver: zodResolver(dolarMensalSchema),
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      const resultado = await criarDolarMensal(data);
      if (resultado.error) throw new Error(resultado.error);
      setAddLancamento(false);
      reset();
      await onAtualizar();
    } catch (e) {
      setError("root", { message: e instanceof Error ? e.message : "Erro ao salvar." });
    }
  });

  return (
    <div className="space-y-4">
      <div className="card p-3 w-fit">
        <p className="text-xs text-faint">Última cotação</p>
        <p className="text-lg font-medium text-ink flex items-center gap-1.5">
          {dolar.ultimo ? `R$ ${dolar.ultimo.cotacao.toFixed(2)}` : "—"}
          <SetaTendencia tendencia={dolar.tendencia} />
        </p>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <p className="text-xs text-faint">Cotação mensal</p>
          {!addLancamento && (
            <button onClick={() => setAddLancamento(true)} className="text-xs text-accent hover:underline">
              + Lançar mês
            </button>
          )}
        </div>
        {addLancamento && (
          <form onSubmit={onSubmit} className="grid grid-cols-2 md:grid-cols-3 gap-3 px-4 py-3 border-b border-border">
            <div>
              <label className="label">Mês (AAAA-MM)</label>
              <input {...register("ano_mes")} placeholder="2026-06" className="input" />
              {formState.errors.ano_mes?.message && <p className="field-error">{formState.errors.ano_mes.message}</p>}
            </div>
            <div>
              <label className="label">Cotação (R$)</label>
              <input type="number" step="0.0001" {...register("cotacao", { valueAsNumber: true })} className="input" />
            </div>
            <div className="flex items-end gap-2">
              <button type="button" onClick={() => setAddLancamento(false)} className="btn btn-secondary flex-1">
                Cancelar
              </button>
              <button type="submit" disabled={formState.isSubmitting} className="btn btn-primary flex-1">
                Salvar
              </button>
            </div>
            {formState.errors.root?.message && <p className="error-box col-span-2 md:col-span-3">{formState.errors.root.message}</p>}
          </form>
        )}
        <div className="grid grid-cols-[1fr_1fr_60px] gap-2 px-4 py-2 text-xs text-faint border-b border-border">
          <span>Mês</span>
          <span className="text-right">Cotação</span>
          <span></span>
        </div>
        {dolar.mensal.length === 0 && <p className="text-sm text-faint px-4 py-4">Nenhum lançamento ainda.</p>}
        {dolar.mensal.map((d) => (
          <div
            key={d.id}
            className="grid grid-cols-[1fr_1fr_60px] gap-2 items-center px-4 py-2 text-xs border-b border-border last:border-0"
          >
            <span className="text-ink">{d.anoMes}</span>
            <span className="text-right text-ink">R$ {d.cotacao.toFixed(2)}</span>
            <button
              onClick={async () => {
                await excluirDolarMensal(d.id);
                await onAtualizar();
              }}
              className="text-faint hover:text-danger text-right"
            >
              Excluir
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
