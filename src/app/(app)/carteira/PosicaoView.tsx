"use client";

import { useState } from "react";
import Link from "next/link";
import { obterPosicaoConsolidada, type GrupoPosicao, type PosicaoAtivo, type PosicaoConsolidada } from "@/lib/carteira/posicao";

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatarNumero = (valor: number) => valor.toLocaleString("pt-BR", { maximumFractionDigits: 8 });

const formatarPct = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);

const classeSinal = (v: number | null) => (v === null ? "text-faint" : v >= 0 ? "text-success" : "text-danger");

const OPCOES_LINHAS_POR_PAGINA = [10, 25, 50, 100] as const;

type SortKey =
  | "ticker"
  | "precoMedio"
  | "precoAtual"
  | "diferenca"
  | "quantidade"
  | "patrimonioAtual"
  | "variacaoHoje"
  | "variacaoTotal"
  | "pctDentroDaClasse"
  | "pctNaCarteira";

type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

function valorOrdenavel(a: PosicaoAtivo, key: SortKey): number | string {
  switch (key) {
    case "ticker":
      return a.ticker;
    case "precoMedio":
      return a.precoMedio;
    case "precoAtual":
      return a.precoAtual;
    case "diferenca":
      return a.diferenca;
    case "quantidade":
      return a.quantidade;
    case "patrimonioAtual":
      return a.patrimonioAtual;
    case "variacaoHoje":
      return a.variacaoHojeValor ?? -Infinity;
    case "variacaoTotal":
      return a.variacaoTotalValor ?? -Infinity;
    case "pctDentroDaClasse":
      return a.pctDentroDaClasse;
    case "pctNaCarteira":
      return a.pctNaCarteira;
  }
}

function exportarCsv(posicao: PosicaoConsolidada) {
  const cabecalho = [
    "classe",
    "ativo",
    "quantidade",
    "preco_medio",
    "preco_atual",
    "diferenca",
    "patrimonio_atual",
    "variacao_hoje_valor",
    "variacao_hoje_pct",
    "variacao_total_valor",
    "variacao_total_pct",
    "pct_dentro_da_classe",
    "pct_na_carteira",
  ].join(",");

  const linhas = posicao.grupos.flatMap((g) =>
    g.ativos.map((a) =>
      [
        g.label,
        a.ticker,
        a.quantidade,
        a.precoMedio.toFixed(2),
        a.precoAtual.toFixed(2),
        a.diferenca.toFixed(2),
        a.patrimonioAtual.toFixed(2),
        a.variacaoHojeValor?.toFixed(2) ?? "",
        a.variacaoHojePct?.toFixed(2) ?? "",
        a.variacaoTotalValor?.toFixed(2) ?? "",
        a.variacaoTotalPct?.toFixed(2) ?? "",
        a.pctDentroDaClasse.toFixed(2),
        a.pctNaCarteira.toFixed(2),
      ].join(",")
    )
  );

  const conteudo = [cabecalho, ...linhas].join("\n");
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "posicao-carteira.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Sub-aba Posição — visão consolidada por classe (ver docs/MAPA-DE-DADOS.md
 * §8.16), réplica do layout MyProfit/Status Invest de referência: seções
 * colapsáveis por classe, cada uma com resumo HOJE/TOTAL + badge de % da
 * carteira, tabela ordenável e paginada por classe, filtro de
 * corretora/banco e exportação CSV. Dados vêm de
 * `lib/carteira/posicao.ts#obterPosicaoConsolidada`, que já lê `transacoes`
 * (fonte única) — esta view só formata/ordena/pagina.
 */
export default function PosicaoView({ posicaoInicial }: { posicaoInicial: PosicaoConsolidada }) {
  const [posicao, setPosicao] = useState(posicaoInicial);
  const [corretoraFiltro, setCorretoraFiltro] = useState<string>("");
  const [carregando, setCarregando] = useState(false);
  const [colapsados, setColapsados] = useState<Set<GrupoPosicao>>(new Set());
  const [sortPorGrupo, setSortPorGrupo] = useState<Partial<Record<GrupoPosicao, SortState>>>({});
  const [paginaPorGrupo, setPaginaPorGrupo] = useState<Partial<Record<GrupoPosicao, number>>>({});
  const [linhasPorGrupo, setLinhasPorGrupo] = useState<Partial<Record<GrupoPosicao, number>>>({});

  const aplicarFiltroCorretora = async (corretoraId: string) => {
    setCorretoraFiltro(corretoraId);
    setCarregando(true);
    const nova = await obterPosicaoConsolidada(corretoraId || null);
    setPosicao(nova);
    setCarregando(false);
  };

  const toggleGrupo = (grupo: GrupoPosicao) => {
    setColapsados((atual) => {
      const novo = new Set(atual);
      if (novo.has(grupo)) novo.delete(grupo);
      else novo.add(grupo);
      return novo;
    });
  };

  const alternarSort = (grupo: GrupoPosicao, key: SortKey) => {
    setSortPorGrupo((atual) => {
      const estadoAtual = atual[grupo];
      const novoDir: "asc" | "desc" = estadoAtual?.key === key && estadoAtual.dir === "asc" ? "desc" : "asc";
      return { ...atual, [grupo]: { key, dir: novoDir } };
    });
    setPaginaPorGrupo((atual) => ({ ...atual, [grupo]: 1 }));
  };

  if (posicao.grupos.length === 0) {
    return (
      <div className="space-y-4">
        <FiltroECsv posicao={posicao} corretoraFiltro={corretoraFiltro} onFiltroChange={aplicarFiltroCorretora} carregando={carregando} />
        <p className="text-sm text-faint">
          Nenhuma posição em carteira ainda. Registre compras na sub-aba Livro-razão.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ResumoTotal posicao={posicao} />
      <FiltroECsv posicao={posicao} corretoraFiltro={corretoraFiltro} onFiltroChange={aplicarFiltroCorretora} carregando={carregando} />

      <div className="space-y-3">
        {posicao.grupos.map((grupo) => {
          const colapsado = colapsados.has(grupo.grupo);
          const sort = sortPorGrupo[grupo.grupo] ?? null;
          const pagina = paginaPorGrupo[grupo.grupo] ?? 1;
          const linhasPagina = linhasPorGrupo[grupo.grupo] ?? 10;

          const ativosOrdenados = sort
            ? [...grupo.ativos].sort((a, b) => {
                const va = valorOrdenavel(a, sort.key);
                const vb = valorOrdenavel(b, sort.key);
                const cmp = typeof va === "string" && typeof vb === "string" ? va.localeCompare(vb) : (va as number) - (vb as number);
                return sort.dir === "asc" ? cmp : -cmp;
              })
            : grupo.ativos;

          const totalPaginas = Math.max(1, Math.ceil(ativosOrdenados.length / linhasPagina));
          const paginaAtual = Math.min(pagina, totalPaginas);
          const inicio = (paginaAtual - 1) * linhasPagina;
          const ativosPagina = ativosOrdenados.slice(inicio, inicio + linhasPagina);

          return (
            <div key={grupo.grupo} className="card overflow-hidden">
              <button
                onClick={() => toggleGrupo(grupo.grupo)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2 transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-faint text-xs transition-transform ${colapsado ? "" : "rotate-90"}`}>▶</span>
                  <span className="text-sm font-medium text-ink">{grupo.label}</span>
                  <span className="text-xs text-faint">{grupo.ativos.length} ativo{grupo.ativos.length !== 1 ? "s" : ""}</span>
                  {grupo.semPrecoCount > 0 && (
                    <span
                      className="text-[10px] text-faint border border-border rounded-full px-1.5 py-0.5"
                      title="Preço atual nunca foi definido pra este(s) ativo(s) — valores ficam como “—” até você definir."
                    >
                      ⚠ {grupo.semPrecoCount} sem preço
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs">
                  <div className="text-right hidden sm:block">
                    <p className="text-faint">Hoje</p>
                    <p className={classeSinal(grupo.variacaoHojePct)}>
                      {formatarMoeda(grupo.variacaoHojeValor)} ({formatarPct(grupo.variacaoHojePct)})
                    </p>
                  </div>
                  <div className="text-right hidden md:block">
                    <p className="text-faint">Total</p>
                    <p className={classeSinal(grupo.variacaoTotalPct)}>
                      {formatarMoeda(grupo.variacaoTotalValor)} ({formatarPct(grupo.variacaoTotalPct)})
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-faint">Patrimônio</p>
                    <p className="text-ink">{formatarMoeda(grupo.patrimonioAtual)}</p>
                  </div>
                  <span className="rounded-full bg-accent/15 text-accent px-2 py-1 font-medium whitespace-nowrap">
                    {grupo.pctNaCarteira.toFixed(1)}% da carteira
                  </span>
                </div>
              </button>

              {!colapsado && (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs whitespace-nowrap">
                      <thead>
                        <tr className="text-faint text-left border-b border-t border-border">
                          <ColunaOrdenavel label="Ativo" sortKey="ticker" sort={sort} onClick={() => alternarSort(grupo.grupo, "ticker")} />
                          <ColunaOrdenavel label="Preço médio" sortKey="precoMedio" sort={sort} onClick={() => alternarSort(grupo.grupo, "precoMedio")} align="right" />
                          <ColunaOrdenavel label="Preço atual" sortKey="precoAtual" sort={sort} onClick={() => alternarSort(grupo.grupo, "precoAtual")} align="right" />
                          <ColunaOrdenavel label="Diferença" sortKey="diferenca" sort={sort} onClick={() => alternarSort(grupo.grupo, "diferenca")} align="right" />
                          <ColunaOrdenavel label="Quantidade" sortKey="quantidade" sort={sort} onClick={() => alternarSort(grupo.grupo, "quantidade")} align="right" />
                          <ColunaOrdenavel label="Patrimônio atual" sortKey="patrimonioAtual" sort={sort} onClick={() => alternarSort(grupo.grupo, "patrimonioAtual")} align="right" />
                          <ColunaOrdenavel label="Variação hoje" sortKey="variacaoHoje" sort={sort} onClick={() => alternarSort(grupo.grupo, "variacaoHoje")} align="right" />
                          <ColunaOrdenavel label="Variação total" sortKey="variacaoTotal" sort={sort} onClick={() => alternarSort(grupo.grupo, "variacaoTotal")} align="right" />
                          <ColunaOrdenavel label="% classe" sortKey="pctDentroDaClasse" sort={sort} onClick={() => alternarSort(grupo.grupo, "pctDentroDaClasse")} align="right" />
                          <ColunaOrdenavel label="% carteira" sortKey="pctNaCarteira" sort={sort} onClick={() => alternarSort(grupo.grupo, "pctNaCarteira")} align="right" />
                          <th className="py-2 pr-4"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {ativosPagina.map((a) => (
                          <tr key={a.ativoId} className="border-b border-border/50 last:border-0">
                            <td className="py-1.5 pl-4 pr-3 text-ink font-medium">
                              {a.ticker}
                              {!a.precoDefinido && (
                                <Link
                                  href={`/ativos/${a.ativoId}`}
                                  className="block text-[10px] text-faint hover:text-ink font-normal underline underline-offset-2"
                                >
                                  sem preço · definir
                                </Link>
                              )}
                            </td>
                            <td className="py-1.5 pr-3 text-right text-muted">{formatarMoeda(a.precoMedio)}</td>
                            <td className="py-1.5 pr-3 text-right text-muted">{a.precoDefinido ? formatarMoeda(a.precoAtual) : "—"}</td>
                            <td className={`py-1.5 pr-3 text-right ${a.precoDefinido ? classeSinal(a.diferenca) : "text-faint"}`}>
                              {a.precoDefinido ? formatarMoeda(a.diferenca) : "—"}
                            </td>
                            <td className="py-1.5 pr-3 text-right text-muted">{formatarNumero(a.quantidade)}</td>
                            <td className="py-1.5 pr-3 text-right text-ink">{a.precoDefinido ? formatarMoeda(a.patrimonioAtual) : "—"}</td>
                            <td className={`py-1.5 pr-3 text-right ${classeSinal(a.variacaoHojeValor)}`}>
                              {a.variacaoHojeValor === null ? (
                                "—"
                              ) : (
                                <>
                                  {formatarMoeda(a.variacaoHojeValor)}
                                  <span className="block text-[10px]">{formatarPct(a.variacaoHojePct)}</span>
                                </>
                              )}
                            </td>
                            <td className={`py-1.5 pr-3 text-right ${classeSinal(a.variacaoTotalValor)}`}>
                              {a.variacaoTotalValor === null ? (
                                "—"
                              ) : (
                                <>
                                  {formatarMoeda(a.variacaoTotalValor)}
                                  <span className="block text-[10px]">{formatarPct(a.variacaoTotalPct)}</span>
                                </>
                              )}
                            </td>
                            <td className="py-1.5 pr-3 text-right text-muted">{a.pctDentroDaClasse.toFixed(1)}%</td>
                            <td className="py-1.5 pr-3 text-right text-muted">{a.pctNaCarteira.toFixed(1)}%</td>
                            <td className="py-1.5 pr-4 text-right">
                              <Link href={`/ativos/${a.ativoId}`} className="text-faint hover:text-ink" title="Ver ativo">
                                →
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-border text-xs text-faint flex-wrap">
                    <div className="flex items-center gap-2">
                      <span>Linhas por página:</span>
                      <select
                        value={linhasPagina}
                        onChange={(e) => {
                          setLinhasPorGrupo((atual) => ({ ...atual, [grupo.grupo]: Number(e.target.value) }));
                          setPaginaPorGrupo((atual) => ({ ...atual, [grupo.grupo]: 1 }));
                        }}
                        className="input w-auto text-xs py-0.5"
                      >
                        {OPCOES_LINHAS_POR_PAGINA.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>

                    {totalPaginas > 1 && (
                      <div className="flex items-center gap-2">
                        <button
                          disabled={paginaAtual <= 1}
                          onClick={() => setPaginaPorGrupo((atual) => ({ ...atual, [grupo.grupo]: paginaAtual - 1 }))}
                          className="hover:text-ink disabled:opacity-30"
                        >
                          ← Anterior
                        </button>
                        <span>
                          Página {paginaAtual} de {totalPaginas}
                        </span>
                        <button
                          disabled={paginaAtual >= totalPaginas}
                          onClick={() => setPaginaPorGrupo((atual) => ({ ...atual, [grupo.grupo]: paginaAtual + 1 }))}
                          className="hover:text-ink disabled:opacity-30"
                        >
                          Próxima →
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ColunaOrdenavel({
  label,
  sortKey,
  sort,
  onClick,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onClick: () => void;
  align?: "left" | "right";
}) {
  const ativo = sort?.key === sortKey;
  return (
    <th className={`py-2 ${align === "right" ? "text-right pr-3" : "pl-4 pr-3 text-left"}`}>
      <button onClick={onClick} className={`hover:text-ink ${ativo ? "text-ink" : ""}`}>
        {label}
        {ativo && <span className="ml-0.5">{sort?.dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function ResumoTotal({ posicao }: { posicao: PosicaoConsolidada }) {
  return (
    <div className="card p-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div>
          <p className="text-faint">Patrimônio total</p>
          <p className="text-ink text-sm font-medium">{formatarMoeda(posicao.totalCarteira)}</p>
        </div>
        <div>
          <p className="text-faint">Variação hoje</p>
          <p className={`text-sm font-medium ${classeSinal(posicao.variacaoHojePct)}`}>
            {formatarMoeda(posicao.variacaoHojeValor)} ({formatarPct(posicao.variacaoHojePct)})
          </p>
        </div>
        <div>
          <p className="text-faint">Variação total</p>
          <p className={`text-sm font-medium ${classeSinal(posicao.variacaoTotalPct)}`}>
            {formatarMoeda(posicao.variacaoTotalValor)} ({formatarPct(posicao.variacaoTotalPct)})
          </p>
        </div>
        <div>
          <p className="text-faint">Classes na carteira</p>
          <p className="text-ink text-sm font-medium">{posicao.grupos.length}</p>
        </div>
      </div>

      {posicao.ativosSemPrecoCount > 0 && (
        <p className="text-[10px] text-faint mt-3 pt-3 border-t border-border">
          ⚠ {posicao.ativosSemPrecoCount} ativo{posicao.ativosSemPrecoCount !== 1 ? "s" : ""} em carteira sem preço
          atual definido — contam como R$ 0,00 de patrimônio nos totais acima (subestimando o valor real da
          carteira) até você definir o preço na página de cada ativo.
        </p>
      )}
    </div>
  );
}

function FiltroECsv({
  posicao,
  corretoraFiltro,
  onFiltroChange,
  carregando,
}: {
  posicao: PosicaoConsolidada;
  corretoraFiltro: string;
  onFiltroChange: (corretoraId: string) => void;
  carregando: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <select
        value={corretoraFiltro}
        onChange={(e) => onFiltroChange(e.target.value)}
        disabled={carregando || posicao.corretoras.length === 0}
        className="input w-auto text-xs"
      >
        <option value="">Todas as corretoras/bancos</option>
        {posicao.corretoras.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
      </select>

      <button onClick={() => exportarCsv(posicao)} className="text-xs text-accent hover:underline whitespace-nowrap">
        Exportar CSV
      </button>
    </div>
  );
}
