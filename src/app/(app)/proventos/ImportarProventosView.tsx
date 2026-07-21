"use client";

/**
 * Proventos → Importar por copiar/colar (ver docs/MAPA-DE-DADOS.md §8.30).
 * Mesmo padrão visual de 2 passos do Livro-razão
 * (`carteira/ImportarTransacoesView.tsx`, §8.24): cola o texto (TSV, direto
 * de planilha) → "Analisar" chama `analisarImportacaoProventos` (só leitura)
 * → revisa a pré-visualização linha a linha → "Confirmar importação" chama
 * `confirmarImportacaoProventos` só com as linhas marcadas.
 *
 * Diferença proposital em relação ao Livro-razão: linhas "duplicado" aqui
 * também ficam DESMARCADAS por padrão (mesmo comportamento — só "ok" nasce
 * marcado), mas note que a checkbox continua HABILITADA pra duplicado (só
 * "erro" é desabilitada) — o Guilherme decide linha a linha se quer importar
 * mesmo assim, em vez de um modal de confirmação separado.
 */

import { useMemo, useState } from "react";
import {
  analisarImportacaoProventos,
  confirmarImportacaoProventos,
  type AnaliseImportacaoProventos,
  type LinhaImportacaoProventoParseada,
  type ResultadoImportacaoProventos,
} from "@/lib/proventos/importar-proventos";
import { TIPOS_PROVENTO } from "@/lib/proventos/schema";
import { useToast } from "@/components/ToastProvider";

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatarData = (iso: string | null) => {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

const labelTipo = (tipo: string | null) => TIPOS_PROVENTO.find((t) => t.valor === tipo)?.label ?? tipo ?? "—";

const EXEMPLO =
  "Ativo\tNome do ativo\tTipo do ativo\tProvento\tData COM\tData pgto\tQtd ativos\tValor pago por cota\tTotal do pgto\tPreço medio\n" +
  "BBDC3\tBRADESCO\tAções\tJCP\t29/12/2025\t31/07/2026\t405\t0,29852\t120,9\t12,88";

function statusBadge(l: LinhaImportacaoProventoParseada) {
  if (l.status === "ok") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-success-soft text-success">OK</span>;
  if (l.status === "duplicado")
    return <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 text-faint">Duplicado</span>;
  return <span className="text-[11px] px-2 py-0.5 rounded-full bg-danger-soft text-danger">Erro</span>;
}

export default function ImportarProventosView({ onImportado }: { onImportado?: () => void }) {
  const [texto, setTexto] = useState("");
  const [analisando, setAnalisando] = useState(false);
  const [analise, setAnalise] = useState<AnaliseImportacaoProventos | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacaoProventos | null>(null);
  const toast = useToast();

  const analisar = async () => {
    if (!texto.trim()) {
      toast.error("Cole as linhas da planilha antes de analisar.");
      return;
    }
    setAnalisando(true);
    setResultado(null);
    try {
      const r = await analisarImportacaoProventos(texto);
      setAnalise(r);
      setSelecionadas(new Set(r.linhas.filter((l) => l.status === "ok").map((l) => l.linha)));
      if (r.linhas.length === 0) toast.error("Nenhuma linha reconhecida no texto colado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível analisar o texto colado.");
    } finally {
      setAnalisando(false);
    }
  };

  const alternar = (linha: number) => {
    setSelecionadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(linha)) novo.delete(linha);
      else novo.add(linha);
      return novo;
    });
  };

  const linhasSelecionaveis = useMemo(() => analise?.linhas.filter((l) => l.status !== "erro") ?? [], [analise]);
  const todasSelecionadas = linhasSelecionaveis.length > 0 && linhasSelecionaveis.every((l) => selecionadas.has(l.linha));

  const alternarTodas = () => {
    setSelecionadas(todasSelecionadas ? new Set() : new Set(linhasSelecionaveis.map((l) => l.linha)));
  };

  const confirmar = async () => {
    if (!analise) return;
    const linhas = analise.linhas
      .filter((l) => l.status !== "erro" && selecionadas.has(l.linha))
      .map((l) => ({
        ativoId: l.ativoId,
        ativoTexto: l.ativoTexto,
        ativoNovo: l.ativoNovo,
        tipo: l.tipo!,
        dataCom: l.dataCom,
        dataPagamento: l.dataPagamento!,
        quantidade: l.quantidade!,
        valorPorCota: l.valorPorCota!,
      }));

    if (linhas.length === 0) {
      toast.error("Nenhuma linha selecionada pra importar.");
      return;
    }

    setConfirmando(true);
    try {
      const r = await confirmarImportacaoProventos(linhas);
      setResultado(r);
      onImportado?.();
      if (r.erros.length === 0) toast.success(`${r.criados} provento(s) importado(s).`);
      else toast.error(`${r.criados} importado(s), ${r.erros.length} com erro — veja o resumo abaixo.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir a importação.");
    } finally {
      setConfirmando(false);
    }
  };

  const recomecar = () => {
    setTexto("");
    setAnalise(null);
    setSelecionadas(new Set());
    setResultado(null);
  };

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-medium text-ink mb-1">Importar proventos (copiar/colar)</h3>
        <p className="text-xs text-faint">
          Cole abaixo as linhas copiadas direto da sua planilha (com o cabeçalho, tab-separado). Colunas esperadas:
          Ativo, Nome do ativo, Tipo do ativo, Provento, Data COM, Data pgto, Qtd ativos, Valor pago por cota, Total do
          pgto, Preço medio. A coluna &quot;Preço medio&quot; é só de conferência e não é usada — o valor total é
          sempre recalculado (quantidade × valor por cota).
        </p>
      </div>

      {!resultado && (
        <>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={EXEMPLO}
            rows={6}
            className="input font-mono text-xs"
          />
          <div className="flex gap-2">
            <button onClick={analisar} disabled={analisando} className="btn btn-primary">
              {analisando ? "Analisando..." : "Analisar"}
            </button>
            {analise && (
              <button onClick={recomecar} className="btn btn-secondary">
                Limpar
              </button>
            )}
          </div>
        </>
      )}

      {analise && !resultado && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-xs text-faint">
            <span>{analise.resumo.total} linha(s) lidas</span>
            <span className="text-success">{analise.resumo.ok} ok</span>
            <span>{analise.resumo.duplicado} duplicada(s)</span>
            <span className="text-danger">{analise.resumo.erro} com erro</span>
          </div>

          <div className="max-h-[420px] overflow-auto border border-border rounded-md">
            <table className="w-full text-xs min-w-[900px]">
              <thead className="sticky top-0 bg-surface-2">
                <tr className="text-faint">
                  <th className="py-2 px-2">
                    <input type="checkbox" checked={todasSelecionadas} onChange={alternarTodas} aria-label="Selecionar todas" />
                  </th>
                  <th className="text-left py-2 px-2">Ativo</th>
                  <th className="text-left py-2 px-2">Tipo</th>
                  <th className="text-left py-2 px-2">Data COM</th>
                  <th className="text-left py-2 px-2">Data pgto</th>
                  <th className="text-right py-2 px-2">Qtd</th>
                  <th className="text-right py-2 px-2">Valor/cota</th>
                  <th className="text-right py-2 px-2">Total (calc.)</th>
                  <th className="text-left py-2 px-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {analise.linhas.map((l) => (
                  <tr key={l.linha} className="border-t border-border/50">
                    <td className="py-1.5 px-2">
                      <input
                        type="checkbox"
                        checked={selecionadas.has(l.linha)}
                        disabled={l.status === "erro"}
                        onChange={() => alternar(l.linha)}
                        aria-label={`Selecionar linha ${l.linha}`}
                      />
                    </td>
                    <td className="py-1.5 px-2">
                      <span className="text-ink font-medium">{l.ativoTexto || "—"}</span>
                      {l.ativoNovo && <span className="ml-1 text-[10px] text-accent">novo</span>}
                    </td>
                    <td className="py-1.5 px-2 text-muted">{labelTipo(l.tipo)}</td>
                    <td className="py-1.5 px-2 text-muted">{formatarData(l.dataCom)}</td>
                    <td className="py-1.5 px-2 text-muted">{formatarData(l.dataPagamento)}</td>
                    <td className="py-1.5 px-2 text-right text-muted">{l.quantidade ?? "—"}</td>
                    <td className="py-1.5 px-2 text-right text-muted">
                      {l.valorPorCota !== null ? l.valorPorCota.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 5 }) : "—"}
                    </td>
                    <td className="py-1.5 px-2 text-right text-muted">
                      {l.valorTotal !== null ? formatarMoeda(l.valorTotal) : "—"}
                      {l.valorTotalOriginal !== null &&
                        l.valorTotal !== null &&
                        Math.abs(l.valorTotalOriginal - l.valorTotal) > 0.01 && (
                          <span className="block text-[10px] text-faint">planilha: {formatarMoeda(l.valorTotalOriginal)}</span>
                        )}
                    </td>
                    <td className="py-1.5 px-2">
                      <div className="flex flex-col gap-0.5">
                        {statusBadge(l)}
                        {l.mensagem && <span className="text-[10px] text-faint">{l.mensagem}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <button onClick={confirmar} disabled={confirmando || selecionadas.size === 0} className="btn btn-primary">
              {confirmando ? "Importando..." : `Confirmar importação (${selecionadas.size})`}
            </button>
            <button onClick={recomecar} className="btn btn-secondary">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {resultado && (
        <div className="space-y-3">
          <div className="bg-surface-2 rounded-md p-3 text-sm space-y-1">
            <p className="text-ink">{resultado.criados} provento(s) importado(s).</p>
            {resultado.ativosCriados > 0 && <p className="text-xs text-faint">{resultado.ativosCriados} ativo(s) novo(s) cadastrado(s).</p>}
            {resultado.erros.length > 0 && (
              <div className="pt-2">
                <p className="text-xs text-danger font-medium">{resultado.erros.length} linha(s) com erro:</p>
                <ul className="text-xs text-danger list-disc list-inside">
                  {resultado.erros.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <button onClick={recomecar} className="btn btn-secondary">
            Importar outra planilha
          </button>
        </div>
      )}
    </div>
  );
}
