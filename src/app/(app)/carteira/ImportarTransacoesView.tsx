"use client";

/**
 * Livro-razão → Importar por copiar/colar (ver docs/MAPA-DE-DADOS.md §8.24).
 * Client component com 2 passos visuais: cola o texto (TSV, direto de
 * planilha) → "Analisar" chama `analisarImportacaoTransacoes` (só leitura,
 * nada é gravado ainda) → revisa a pré-visualização linha a linha (pode
 * desmarcar qualquer uma) → "Confirmar importação" chama
 * `confirmarImportacaoTransacoes` só com as linhas marcadas.
 */

import { useMemo, useState } from "react";
import {
  analisarImportacaoTransacoes,
  confirmarImportacaoTransacoes,
  type AnaliseImportacao,
  type LinhaImportacaoParseada,
  type ResultadoImportacao,
} from "@/lib/carteira/importar-transacoes";
import { useToast } from "@/components/ToastProvider";

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatarData = (iso: string | null) => {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

const EXEMPLO =
  "Data de negociação\tInstituição\tMoeda\tTotal de Taxas\tAtivo\tGrupo\tQuantidade\tOperação\tTipo\tPreço sem taxas\tPreço com taxas\tTotal sem taxas\tTotal com taxas\n" +
  "26/08/2024\tAvenue\tUSD\t0\tNVDA\tAções EUA\t-5\tCrédito\tVenda\t125,2626\t125,2626\t626,31\t626,31";

function statusBadge(l: LinhaImportacaoParseada) {
  if (l.status === "ok") return <span className="text-[11px] px-2 py-0.5 rounded-full bg-success-soft text-success">OK</span>;
  if (l.status === "duplicado")
    return <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 text-faint">Duplicado</span>;
  return <span className="text-[11px] px-2 py-0.5 rounded-full bg-danger-soft text-danger">Erro</span>;
}

export default function ImportarTransacoesView({ onImportado }: { onImportado?: () => void }) {
  const [texto, setTexto] = useState("");
  const [analisando, setAnalisando] = useState(false);
  const [analise, setAnalise] = useState<AnaliseImportacao | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);
  const toast = useToast();

  const analisar = async () => {
    if (!texto.trim()) {
      toast.error("Cole as linhas da planilha antes de analisar.");
      return;
    }
    setAnalisando(true);
    setResultado(null);
    try {
      const r = await analisarImportacaoTransacoes(texto);
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
        data: l.data!,
        tipo: l.tipo!,
        quantidade: l.quantidade!,
        precoUnitario: l.precoUnitario!,
        custos: l.custos,
        cambio: l.cambio,
        ativoId: l.ativoId,
        ativoTexto: l.ativoTexto,
        ativoNovo: l.ativoNovo,
        corretoraId: l.corretoraId,
        corretoraTexto: l.instituicao,
        corretoraNova: l.corretoraNova,
      }));

    if (linhas.length === 0) {
      toast.error("Nenhuma linha selecionada pra importar.");
      return;
    }

    setConfirmando(true);
    try {
      const r = await confirmarImportacaoTransacoes(linhas);
      setResultado(r);
      onImportado?.();
      if (r.erros.length === 0) toast.success(`${r.criadas} transação(ões) importada(s).`);
      else toast.error(`${r.criadas} importada(s), ${r.erros.length} com erro — veja o resumo abaixo.`);
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
        <h3 className="text-sm font-medium text-ink mb-1">Importar transações (copiar/colar)</h3>
        <p className="text-xs text-faint">
          Cole abaixo as linhas copiadas direto da sua planilha (com o cabeçalho, tab-separado). Colunas esperadas: Data
          de negociação, Instituição, Moeda, Total de Taxas, Ativo, Grupo, Quantidade, Operação, Tipo, Preço sem taxas,
          Preço com taxas, Total sem taxas, Total com taxas. Só Compra/Venda são importadas por aqui — eventos
          societários continuam sendo lançados manualmente.
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
                  <th className="text-left py-2 px-2">Data</th>
                  <th className="text-left py-2 px-2">Ativo</th>
                  <th className="text-left py-2 px-2">Corretora</th>
                  <th className="text-left py-2 px-2">Tipo</th>
                  <th className="text-right py-2 px-2">Quantidade</th>
                  <th className="text-right py-2 px-2">Preço (BRL)</th>
                  <th className="text-right py-2 px-2">Custos (BRL)</th>
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
                    <td className="py-1.5 px-2 text-muted">{formatarData(l.data)}</td>
                    <td className="py-1.5 px-2">
                      <span className="text-ink font-medium">{l.ativoTexto || "—"}</span>
                      {l.ativoNovo && <span className="ml-1 text-[10px] text-accent">novo</span>}
                    </td>
                    <td className="py-1.5 px-2 text-muted">
                      {l.instituicao || "—"}
                      {l.corretoraNova && <span className="ml-1 text-[10px] text-accent">nova</span>}
                    </td>
                    <td className="py-1.5 px-2 text-muted">{l.tipo === "venda" ? "Venda" : l.tipo === "compra" ? "Compra" : "—"}</td>
                    <td className="py-1.5 px-2 text-right text-muted">{l.quantidade ?? "—"}</td>
                    <td className="py-1.5 px-2 text-right text-muted">
                      {l.precoUnitario !== null ? formatarMoeda(l.precoUnitario) : "—"}
                      {l.cambio !== null && l.precoOriginal !== null && (
                        <span className="block text-[10px] text-faint">
                          US$ {l.precoOriginal.toFixed(4)} · câmbio {l.cambio.toFixed(4)}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-right text-muted">{formatarMoeda(l.custos)}</td>
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
            <p className="text-ink">{resultado.criadas} transação(ões) importada(s).</p>
            {resultado.ativosCriados > 0 && <p className="text-xs text-faint">{resultado.ativosCriados} ativo(s) novo(s) cadastrado(s).</p>}
            {resultado.corretorasCriadas > 0 && (
              <p className="text-xs text-faint">{resultado.corretorasCriadas} corretora(s) nova(s) cadastrada(s).</p>
            )}
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
