"use client";

/**
 * Livro-razão → "Visão mensal" (ver docs/MAPA-DE-DADOS.md §8.19): tabela de
 * compra/venda mês a mês por classe (réplica do print de referência do
 * Guilherme) + gráfico de acúmulo de capital. Client component porque o
 * dado é pesado (agrega TODO o histórico de transações) e só é buscado
 * quando o usuário abre a seção — nunca no carregamento inicial do
 * Livro-razão, pra não pagar esse custo em toda visita à aba.
 */

import { useEffect, useState } from "react";
import SerieLinhaChart from "@/components/SerieLinhaChart";
import { obterVisaoMensal } from "@/lib/carteira/visao-mensal";
import { MESES_LABEL, type VisaoMensal, type TabelaMensal } from "@/lib/carteira/visao-mensal-tipos";
import type { GrupoPosicao } from "@/lib/carteira/grupo-classificacao";

const formatarMoeda = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function VisaoMensalView() {
  const [dados, setDados] = useState<VisaoMensal | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [colapsados, setColapsados] = useState<Set<GrupoPosicao>>(new Set());

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    obterVisaoMensal()
      .then((r) => {
        if (ativo) setDados(r);
      })
      .catch((e) => {
        if (ativo) setErro(e instanceof Error ? e.message : "Não foi possível carregar a visão mensal.");
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, []);

  const toggleGrupo = (grupo: GrupoPosicao) => {
    setColapsados((atual) => {
      const novo = new Set(atual);
      if (novo.has(grupo)) novo.delete(grupo);
      else novo.add(grupo);
      return novo;
    });
  };

  if (carregando) {
    return (
      <div className="card p-4">
        <p className="text-sm text-faint">Carregando visão mensal…</p>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="card p-4">
        <p className="text-sm text-danger">{erro}</p>
      </div>
    );
  }

  if (!dados) {
    return null;
  }

  const semTransacoes = dados.total.geral.totalLinha.compra === 0 && dados.total.geral.totalLinha.venda === 0;
  if (semTransacoes) {
    return (
      <div className="card p-4">
        <p className="text-sm text-faint">Nenhuma transação lançada ainda — a visão mensal aparece aqui assim que você registrar compras/vendas.</p>
      </div>
    );
  }

  const totalAportadoLiquido = dados.evolucaoCapital.reduce((s, p) => s + p.liquido, 0);
  const totalRetirado = dados.evolucaoCapital.reduce((s, p) => s + p.retirada, 0);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium text-ink">Acúmulo de capital</h3>
        </div>
        <p className="text-xs text-faint mb-3">
          Soma corrida do aporte líquido mensal (compra − venda). Quando a venda de um mês supera o aporte
          daquele mês, o excedente conta como retirada — não rebalanceamento — na leitura abaixo.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
          <div>
            <p className="text-faint">Aportado líquido (todo o período)</p>
            <p className={`text-sm font-medium ${totalAportadoLiquido >= 0 ? "text-success" : "text-danger"}`}>
              {formatarMoeda(totalAportadoLiquido)}
            </p>
          </div>
          <div>
            <p className="text-faint">Retirado (venda &gt; aporte no mês)</p>
            <p className="text-sm font-medium text-danger">{formatarMoeda(totalRetirado)}</p>
          </div>
        </div>

        {dados.evolucaoCapital.length >= 2 ? (
          <SerieLinhaChart
            pontos={dados.evolucaoCapital.map((p) => ({ data: `${p.anoMes}-01`, valor: p.acumulado }))}
            formatarValor={formatarMoeda}
            ariaLabel="Acúmulo de capital mês a mês"
            mostrarLinhaZero
          />
        ) : (
          <p className="text-sm text-faint">Precisa de pelo menos 2 meses com transação lançada para desenhar o gráfico.</p>
        )}
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-medium text-ink mb-3">Geral — compra e venda por mês</h3>
        <TabelaMensalCards tabela={dados.total} />
      </div>

      <div className="space-y-3">
        {dados.porGrupo.map((g) => {
          // Classes começam colapsadas (default: fechado) — só "Geral" acima fica sempre visível.
          const aberto = colapsados.has(g.grupo);
          return (
            <div key={g.grupo} className="card overflow-hidden">
              <button
                onClick={() => toggleGrupo(g.grupo)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2 transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-faint text-xs transition-transform ${aberto ? "rotate-90" : ""}`}>▶</span>
                  <span className="text-sm font-medium text-ink">{g.label}</span>
                </div>
                <div className="text-right text-xs">
                  <p className="text-faint">Total do período</p>
                  <p className="text-ink">
                    {formatarMoeda(g.tabela.geral.totalLinha.compra)} compra ·{" "}
                    {formatarMoeda(g.tabela.geral.totalLinha.venda)} venda
                  </p>
                </div>
              </button>

              {aberto && (
                <div className="px-4 pb-4">
                  <TabelaMensalCards tabela={g.tabela} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TabelaMensalCards({ tabela }: { tabela: TabelaMensal }) {
  return (
    <div className="space-y-4">
      <MiniTabela linha={tabela.geral} destaque />
      {tabela.porAno.map((linha) => (
        <MiniTabela key={linha.chave} linha={linha} />
      ))}
    </div>
  );
}

function MiniTabela({ linha, destaque = false }: { linha: TabelaMensal["geral"]; destaque?: boolean }) {
  const liquido = (m: { compra: number; venda: number }) => m.compra - m.venda;
  return (
    <div className="overflow-x-auto">
      <p className={`text-xs mb-1 ${destaque ? "font-medium text-ink" : "text-faint"}`}>{linha.label}</p>
      <table className="w-full text-[11px] border border-border">
        <thead>
          <tr className="bg-surface-2 text-faint">
            <th className="py-1 px-2 text-left border-b border-border"></th>
            {MESES_LABEL.map((m) => (
              <th key={m} className="py-1 px-2 text-right border-b border-border whitespace-nowrap">
                {m}
              </th>
            ))}
            <th className="py-1 px-2 text-right border-b border-border whitespace-nowrap">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-1 px-2 text-faint border-b border-border/50">Compra</td>
            {linha.meses.map((m, i) => (
              <td key={i} className="py-1 px-2 text-right text-success border-b border-border/50 whitespace-nowrap">
                {m.compra > 0 ? formatarMoeda(m.compra) : "—"}
              </td>
            ))}
            <td className="py-1 px-2 text-right text-success border-b border-border/50 whitespace-nowrap">
              {formatarMoeda(linha.totalLinha.compra)}
            </td>
          </tr>
          <tr>
            <td className="py-1 px-2 text-faint border-b border-border/50">Venda</td>
            {linha.meses.map((m, i) => (
              <td key={i} className="py-1 px-2 text-right text-danger border-b border-border/50 whitespace-nowrap">
                {m.venda > 0 ? formatarMoeda(m.venda) : "—"}
              </td>
            ))}
            <td className="py-1 px-2 text-right text-danger border-b border-border/50 whitespace-nowrap">
              {formatarMoeda(linha.totalLinha.venda)}
            </td>
          </tr>
          <tr>
            <td className="py-1 px-2 text-faint">Líquido</td>
            {linha.meses.map((m, i) => (
              <td key={i} className="py-1 px-2 text-right text-ink whitespace-nowrap">
                {m.compra > 0 || m.venda > 0 ? formatarMoeda(liquido(m)) : "—"}
              </td>
            ))}
            <td className="py-1 px-2 text-right text-ink whitespace-nowrap">{formatarMoeda(liquido(linha.totalLinha))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
