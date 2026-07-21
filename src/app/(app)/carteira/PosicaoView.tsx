"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { obterPosicaoConsolidada, type PosicaoAtivo, type PosicaoConsolidada, type AtivoEncerrado } from "@/lib/carteira/posicao";
import { LABEL_GRUPO, type GrupoPosicao } from "@/lib/carteira/grupo-classificacao";
import { atualizarTodasCotacoesAgora } from "@/lib/ativos/actions";
import { useToast } from "@/components/ToastProvider";

/**
 * Fase 4 do card de empresa/fonte única (§8.56): a Posição pode agrupar por
 * tipo de instrumento (taxonomia fixa `GrupoPosicao`, comportamento
 * original) ou por Alocação (Macro›Classe›Setor, incluindo "Não
 * classificado"). `GrupoExibicao` é a forma comum que a UI renderiza,
 * independente de qual das duas fontes (`posicao.grupos` ou
 * `posicao.gruposPorAlocacao`) está ativa — só a `chave` muda de tipo
 * (enum fixo vs. string dinâmica), por isso vira string aqui também.
 */
type ModoAgrupamento = "tipo" | "alocacao";

type GrupoExibicao = {
  chave: string;
  label: string;
  ativos: PosicaoAtivo[];
  patrimonioAtual: number;
  pctNaCarteira: number;
  variacaoHojeValor: number;
  variacaoHojePct: number | null;
  variacaoTotalValor: number;
  variacaoTotalPct: number | null;
  semPrecoCount: number;
};

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatarNumero = (valor: number) => valor.toLocaleString("pt-BR", { maximumFractionDigits: 8 });

const formatarPct = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);

const classeSinal = (v: number | null) => (v === null ? "text-faint" : v >= 0 ? "text-success" : "text-danger");

const formatarData = (iso: string | null) => {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

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
    "preco_medio_ajustado",
    "preco_atual",
    "diferenca",
    "patrimonio_atual",
    "variacao_hoje_valor",
    "variacao_hoje_pct",
    "lucro_realizado",
    "variacao_total_valor",
    "variacao_total_pct",
    "dividendos_recebidos",
    "pct_dentro_da_classe",
    "pct_na_carteira",
    // Colunas só preenchidas pra linhas de "Ativos encerrados" (ver §8.25) —
    // ficam em branco nas linhas de posição aberta, pra manter as duas
    // seções no mesmo arquivo/schema em vez de exportar 2 CSVs separados.
    "total_comprado",
    "total_vendido",
    "contribuicao_total",
    "custo_ajustado",
    "primeira_compra",
    "ultima_venda",
  ].join(",");

  const linhasAbertas = posicao.grupos.flatMap((g) =>
    g.ativos.map((a) =>
      [
        g.label,
        a.ticker,
        a.quantidade,
        a.precoMedio.toFixed(2),
        a.precoMedioAjustado.toFixed(2),
        a.precoAtual.toFixed(2),
        a.diferenca.toFixed(2),
        a.patrimonioAtual.toFixed(2),
        a.variacaoHojeValor?.toFixed(2) ?? "",
        a.variacaoHojePct?.toFixed(2) ?? "",
        a.lucroRealizado.toFixed(2),
        a.variacaoTotalValor?.toFixed(2) ?? "",
        a.variacaoTotalPct?.toFixed(2) ?? "",
        a.dividendosRecebidos.toFixed(2),
        a.pctDentroDaClasse.toFixed(2),
        a.pctNaCarteira.toFixed(2),
        "",
        "",
        "",
        "",
        "",
        "",
      ].join(",")
    )
  );

  const linhasEncerradas = posicao.ativosEncerrados.map((a) =>
    [
      "Ativos encerrados",
      a.ticker,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      a.lucroRealizado.toFixed(2),
      "",
      "",
      a.dividendosRecebidos.toFixed(2),
      "",
      "",
      a.totalComprado.toFixed(2),
      a.totalVendido.toFixed(2),
      a.contribuicaoTotal.toFixed(2),
      a.custoAjustado.toFixed(2),
      a.primeiraCompra ?? "",
      a.ultimaVenda ?? "",
    ].join(",")
  );

  const conteudo = [cabecalho, ...linhasAbertas, ...linhasEncerradas].join("\n");
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
  const [atualizandoCotacoes, setAtualizandoCotacoes] = useState(false);
  const [modoAgrupamento, setModoAgrupamento] = useState<ModoAgrupamento>("tipo");
  const [colapsados, setColapsados] = useState<Set<string>>(new Set());
  const [encerradosColapsado, setEncerradosColapsado] = useState(false);
  const [sortPorGrupo, setSortPorGrupo] = useState<Record<string, SortState>>({});
  const [paginaPorGrupo, setPaginaPorGrupo] = useState<Record<string, number>>({});
  const [linhasPorGrupo, setLinhasPorGrupo] = useState<Record<string, number>>({});
  const toast = useToast();

  // Não reseta os mapas de estado (colapsados/sort/página) ao trocar de modo
  // — as chaves de "por tipo" (GrupoPosicao) e "por Alocação" (composta,
  // ver posicao.ts) nunca colidem, então preferências deixadas num modo
  // simplesmente ficam paradas (e corretas) quando o usuário volta pra ele.
  const gruposExibidos: GrupoExibicao[] = useMemo(
    () =>
      modoAgrupamento === "tipo"
        ? posicao.grupos.map((g) => ({ chave: g.grupo, ...g }))
        : posicao.gruposPorAlocacao,
    [modoAgrupamento, posicao]
  );

  const aplicarFiltroCorretora = async (corretoraId: string) => {
    setCorretoraFiltro(corretoraId);
    setCarregando(true);
    const nova = await obterPosicaoConsolidada(corretoraId || null);
    setPosicao(nova);
    setCarregando(false);
  };

  /**
   * Botão "Atualizar cotações" (ver docs/MAPA-DE-DADOS.md §8.49) — chama o
   * mesmo motor do cron (`atualizarTodasCotacoes`), que também backfilla o
   * histórico compartilhado usado pela "Variação hoje". Depois de rodar,
   * recarrega a posição consolidada pra refletir os novos preços/variações
   * sem precisar dar F5.
   */
  const atualizarCotacoes = async () => {
    setAtualizandoCotacoes(true);
    try {
      const resultado = await atualizarTodasCotacoesAgora();
      if (resultado.error) {
        toast.error(resultado.error);
        return;
      }
      const r = resultado.resumo!;
      const falhasTotais = r.falhas.length + r.historico.falhas.length;
      if (falhasTotais === 0) {
        toast.success(`${r.atualizados} cotação${r.atualizados !== 1 ? "ões" : ""} atualizada${r.atualizados !== 1 ? "s" : ""}.`);
      } else {
        toast.error(
          `${r.atualizados} atualizada(s), ${falhasTotais} falha(s) (ex.: ${[...r.falhas, ...r.historico.falhas].slice(0, 3).join("; ")}).`
        );
      }
      const nova = await obterPosicaoConsolidada(corretoraFiltro || null);
      setPosicao(nova);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar cotações.");
    } finally {
      setAtualizandoCotacoes(false);
    }
  };

  const toggleGrupo = (grupo: string) => {
    setColapsados((atual) => {
      const novo = new Set(atual);
      if (novo.has(grupo)) novo.delete(grupo);
      else novo.add(grupo);
      return novo;
    });
  };

  const alternarSort = (grupo: string, key: SortKey) => {
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
        <FiltroECsv
          posicao={posicao}
          corretoraFiltro={corretoraFiltro}
          onFiltroChange={aplicarFiltroCorretora}
          carregando={carregando}
          onAtualizarCotacoes={atualizarCotacoes}
          atualizandoCotacoes={atualizandoCotacoes}
        />
        {posicao.ativosEncerrados.length === 0 ? (
          <p className="text-sm text-faint">
            Nenhuma posição em carteira ainda. Registre compras na sub-aba Livro-razão.
          </p>
        ) : (
          <p className="text-sm text-faint">
            Nenhuma posição aberta no momento — mas você já tem ativos que passaram pela carteira, veja abaixo.
          </p>
        )}
        {posicao.ativosEncerrados.length > 0 && (
          <SecaoAtivosEncerrados
            ativos={posicao.ativosEncerrados}
            colapsado={encerradosColapsado}
            onToggle={() => setEncerradosColapsado((v) => !v)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ResumoTotal posicao={posicao} />
      <FiltroECsv
        posicao={posicao}
        corretoraFiltro={corretoraFiltro}
        onFiltroChange={aplicarFiltroCorretora}
        carregando={carregando}
        onAtualizarCotacoes={atualizarCotacoes}
        atualizandoCotacoes={atualizandoCotacoes}
      />

      <div className="flex items-center gap-2 text-xs">
        <span className="text-faint">Agrupar:</span>
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setModoAgrupamento("tipo")}
            className={`px-3 py-1.5 transition-colors ${
              modoAgrupamento === "tipo" ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-2"
            }`}
          >
            Por tipo de ativo
          </button>
          <button
            onClick={() => setModoAgrupamento("alocacao")}
            className={`px-3 py-1.5 border-l border-border transition-colors ${
              modoAgrupamento === "alocacao" ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-2"
            }`}
          >
            Por Alocação
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {gruposExibidos.map((grupo) => {
          const colapsado = colapsados.has(grupo.chave);
          const sort = sortPorGrupo[grupo.chave] ?? null;
          const pagina = paginaPorGrupo[grupo.chave] ?? 1;
          const linhasPagina = linhasPorGrupo[grupo.chave] ?? 10;

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
            <div key={grupo.chave} className="card overflow-hidden">
              <button
                onClick={() => toggleGrupo(grupo.chave)}
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
                          <ColunaOrdenavel label="Ativo" sortKey="ticker" sort={sort} onClick={() => alternarSort(grupo.chave, "ticker")} />
                          <ColunaOrdenavel label="Preço médio" sortKey="precoMedio" sort={sort} onClick={() => alternarSort(grupo.chave, "precoMedio")} align="right" />
                          <th className="py-2 pr-3 text-right" title="Custo de aquisição líquido de proventos já recebidos (dividendo/JCP/rendimento/aluguel), dividido pela quantidade atual — indicador informal, não usado no IR.">
                            Preço médio ajustado
                          </th>
                          <ColunaOrdenavel label="Preço atual" sortKey="precoAtual" sort={sort} onClick={() => alternarSort(grupo.chave, "precoAtual")} align="right" />
                          <ColunaOrdenavel label="Diferença" sortKey="diferenca" sort={sort} onClick={() => alternarSort(grupo.chave, "diferenca")} align="right" />
                          <ColunaOrdenavel label="Quantidade" sortKey="quantidade" sort={sort} onClick={() => alternarSort(grupo.chave, "quantidade")} align="right" />
                          <ColunaOrdenavel label="Patrimônio atual" sortKey="patrimonioAtual" sort={sort} onClick={() => alternarSort(grupo.chave, "patrimonioAtual")} align="right" />
                          <ColunaOrdenavel label="Variação hoje" sortKey="variacaoHoje" sort={sort} onClick={() => alternarSort(grupo.chave, "variacaoHoje")} align="right" />
                          <th className="py-2 pr-3 text-right" title="Lucro/prejuízo já realizado em vendas parciais anteriores deste ativo (histórico completo). Entra na conta de Variação total ao lado.">
                            Lucro realizado
                          </th>
                          <ColunaOrdenavel
                            label="Variação total"
                            sortKey="variacaoTotal"
                            sort={sort}
                            onClick={() => alternarSort(grupo.chave, "variacaoTotal")}
                            align="right"
                            title="Patrimônio atual + Lucro realizado (coluna ao lado) − total investido bruto (todo aporte já feito neste ativo, incluindo cotas já vendidas no passado) — retorno acumulado desde a primeira compra."
                          />
                          <th className="py-2 pr-3 text-right">Dividendos</th>
                          <ColunaOrdenavel label="% classe" sortKey="pctDentroDaClasse" sort={sort} onClick={() => alternarSort(grupo.chave, "pctDentroDaClasse")} align="right" />
                          <ColunaOrdenavel label="% carteira" sortKey="pctNaCarteira" sort={sort} onClick={() => alternarSort(grupo.chave, "pctNaCarteira")} align="right" />
                          <th className="py-2 pr-4"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {ativosPagina.map((a) => (
                          <tr key={a.ativoId} className="border-b border-border/50 last:border-0">
                            <td className="py-1.5 pl-4 pr-3 text-ink font-medium">
                              <Link href={`/ativos/${a.ativoId}`} className="hover:underline underline-offset-2">
                                {a.ticker}
                              </Link>
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
                            <td className="py-1.5 pr-3 text-right text-muted">{formatarMoeda(a.precoMedioAjustado)}</td>
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
                            <td className={`py-1.5 pr-3 text-right ${classeSinal(a.lucroRealizado)}`}>{formatarMoeda(a.lucroRealizado)}</td>
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
                            <td className="py-1.5 pr-3 text-right text-muted">{formatarMoeda(a.dividendosRecebidos)}</td>
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
                          setLinhasPorGrupo((atual) => ({ ...atual, [grupo.chave]: Number(e.target.value) }));
                          setPaginaPorGrupo((atual) => ({ ...atual, [grupo.chave]: 1 }));
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
                          onClick={() => setPaginaPorGrupo((atual) => ({ ...atual, [grupo.chave]: paginaAtual - 1 }))}
                          className="hover:text-ink disabled:opacity-30"
                        >
                          ← Anterior
                        </button>
                        <span>
                          Página {paginaAtual} de {totalPaginas}
                        </span>
                        <button
                          disabled={paginaAtual >= totalPaginas}
                          onClick={() => setPaginaPorGrupo((atual) => ({ ...atual, [grupo.chave]: paginaAtual + 1 }))}
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

      {posicao.ativosEncerrados.length > 0 && (
        <SecaoAtivosEncerrados
          ativos={posicao.ativosEncerrados}
          colapsado={encerradosColapsado}
          onToggle={() => setEncerradosColapsado((v) => !v)}
        />
      )}
    </div>
  );
}

/**
 * Ver docs/MAPA-DE-DADOS.md §8.25 — ativos que já participaram da carteira
 * (tiveram aporte) e estão zerados hoje, sempre no final da lista de
 * classes (depois de "Outros"), ordenados por data da última venda mais
 * recente primeiro.
 */
function SecaoAtivosEncerrados({
  ativos,
  colapsado,
  onToggle,
}: {
  ativos: AtivoEncerrado[];
  colapsado: boolean;
  onToggle: () => void;
}) {
  const totalContribuicao = ativos.reduce((s, a) => s + a.contribuicaoTotal, 0);

  return (
    <div className="card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className={`text-faint text-xs transition-transform ${colapsado ? "" : "rotate-90"}`}>▶</span>
          <span className="text-sm font-medium text-ink">Ativos encerrados</span>
          <span className="text-xs text-faint">
            {ativos.length} ativo{ativos.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="text-right text-xs">
          <p className="text-faint">Contribuição total ao patrimônio</p>
          <p className={classeSinal(totalContribuicao)}>{formatarMoeda(totalContribuicao)}</p>
        </div>
      </button>

      {!colapsado && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="text-faint text-left border-b border-t border-border">
                <th className="py-2 pl-4 pr-3">Ativo</th>
                <th className="py-2 pr-3 text-left">Categoria</th>
                <th className="py-2 pr-3 text-right">Comprado</th>
                <th className="py-2 pr-3 text-right">Vendido</th>
                <th className="py-2 pr-3 text-right">Lucro realizado</th>
                <th className="py-2 pr-3 text-right">Dividendos</th>
                <th className="py-2 pr-3 text-right">Contribuição total</th>
                <th className="py-2 pr-3 text-right" title="Total comprado − dividendos/proventos já recebidos — indicador informal, não usado no IR.">
                  Custo ajustado
                </th>
                <th className="py-2 pr-3 text-left">Período</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {ativos.map((a) => (
                <tr key={a.ativoId} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pl-4 pr-3 text-ink font-medium">
                    <Link href={`/ativos/${a.ativoId}`} className="hover:underline underline-offset-2">
                      {a.ticker}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 text-muted">{LABEL_GRUPO[a.grupo]}</td>
                  <td className="py-1.5 pr-3 text-right text-muted">{formatarMoeda(a.totalComprado)}</td>
                  <td className="py-1.5 pr-3 text-right text-muted">{formatarMoeda(a.totalVendido)}</td>
                  <td className={`py-1.5 pr-3 text-right ${classeSinal(a.lucroRealizado)}`}>{formatarMoeda(a.lucroRealizado)}</td>
                  <td className="py-1.5 pr-3 text-right text-muted">{formatarMoeda(a.dividendosRecebidos)}</td>
                  <td className={`py-1.5 pr-3 text-right font-medium ${classeSinal(a.contribuicaoTotal)}`}>
                    {formatarMoeda(a.contribuicaoTotal)}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-muted">{formatarMoeda(a.custoAjustado)}</td>
                  <td className="py-1.5 pr-3 text-muted">
                    {formatarData(a.primeiraCompra)} → {formatarData(a.ultimaVenda)}
                  </td>
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
      )}
    </div>
  );
}

function ColunaOrdenavel({
  label,
  sortKey,
  sort,
  onClick,
  align = "left",
  title,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onClick: () => void;
  align?: "left" | "right";
  title?: string;
}) {
  const ativo = sort?.key === sortKey;
  return (
    <th className={`py-2 ${align === "right" ? "text-right pr-3" : "pl-4 pr-3 text-left"}`} title={title}>
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
  onAtualizarCotacoes,
  atualizandoCotacoes,
}: {
  posicao: PosicaoConsolidada;
  corretoraFiltro: string;
  onFiltroChange: (corretoraId: string) => void;
  carregando: boolean;
  onAtualizarCotacoes: () => void;
  atualizandoCotacoes: boolean;
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

      <div className="flex items-center gap-3">
        <button
          onClick={onAtualizarCotacoes}
          disabled={atualizandoCotacoes}
          className="btn btn-secondary text-xs py-1 px-3 disabled:opacity-60"
          title="Busca a cotação mais recente (Yahoo Finance) de todos os ativos com cotação automática e atualiza o histórico usado pela Variação hoje."
        >
          {atualizandoCotacoes ? "Atualizando..." : "Atualizar cotações"}
        </button>
        <button onClick={() => exportarCsv(posicao)} className="text-xs text-accent hover:underline whitespace-nowrap">
          Exportar CSV
        </button>
      </div>
    </div>
  );
}
