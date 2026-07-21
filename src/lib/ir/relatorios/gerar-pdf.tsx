"use client";

/**
 * PDF final (fase 11 — ver docs/MAPA-DE-DADOS.md §8.46). Componente
 * `@react-pdf/renderer` que renderiza a estrutura de 23 itens do §8.32.26 a
 * partir do DTO já convertido (`RelatorioCompletoUI`, `lib/ir/actions.ts`).
 * "use client": `@react-pdf/renderer` monta o PDF via `pdf(...).toBlob()`
 * no navegador — nada disto roda no servidor.
 */

import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type {
  RelatorioCompletoUI,
  SecaoRelatorioUI,
  LinhaMensalRendaVariavelUI,
  LinhaMensalRendaFixaUI,
  ResgateRendaFixaUI,
  LinhaAnualExteriorUI,
  VendaExteriorUI,
  ResultadoDarfUI,
  OperacaoAnexoUI,
  CardValorUI,
} from "../actions";

const formatarMoeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatarPct = (v: number) => `${(v * 100).toFixed(2)}%`;

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#1a1a1a" },
  capaTitulo: { fontSize: 20, marginBottom: 4 },
  capaSubtitulo: { fontSize: 11, color: "#555", marginBottom: 12 },
  h1: { fontSize: 13, marginBottom: 6, marginTop: 14, fontFamily: "Helvetica-Bold" },
  h2: { fontSize: 10, marginBottom: 4, marginTop: 8, fontFamily: "Helvetica-Bold" },
  paragrafo: { marginBottom: 4, lineHeight: 1.4 },
  aviso: { marginBottom: 3, color: "#8a6d00", fontSize: 8 },
  naoDisponivel: { fontStyle: "italic", color: "#777", marginBottom: 6 },
  tabela: { display: "flex", flexDirection: "column", marginBottom: 8, borderWidth: 1, borderColor: "#ddd" },
  linhaCabecalho: { flexDirection: "row", backgroundColor: "#f0f0f0", borderBottomWidth: 1, borderColor: "#ddd" },
  linha: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#eee" },
  celulaCabecalho: { padding: 4, fontFamily: "Helvetica-Bold", fontSize: 8 },
  celula: { padding: 4, fontSize: 8 },
  cardsGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  card: { width: "33%", padding: 6, marginBottom: 4 },
  cardTitulo: { fontSize: 7, color: "#666" },
  cardValor: { fontSize: 11 },
});

function Tabela({ colunas, larguras, linhas }: { colunas: string[]; larguras: number[]; linhas: (string | number)[][] }) {
  return (
    <View style={styles.tabela}>
      <View style={styles.linhaCabecalho}>
        {colunas.map((c, i) => (
          <Text key={i} style={{ ...styles.celulaCabecalho, width: `${larguras[i]}%` }}>
            {c}
          </Text>
        ))}
      </View>
      {linhas.length === 0 && (
        <View style={styles.linha}>
          <Text style={{ ...styles.celula, width: "100%" }}>Nenhum item neste ano-calendário.</Text>
        </View>
      )}
      {linhas.map((linha, i) => (
        <View key={i} style={styles.linha} wrap={false}>
          {linha.map((v, j) => (
            <Text key={j} style={{ ...styles.celula, width: `${larguras[j]}%` }}>
              {String(v)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function SecaoIndisponivel({ titulo, motivo }: { titulo: string; motivo: string }) {
  return (
    <View break>
      <Text style={styles.h1}>{titulo}</Text>
      <Text style={styles.naoDisponivel}>Não disponível ainda — {motivo}</Text>
    </View>
  );
}

function Avisos({ avisos }: { avisos: string[] }) {
  if (avisos.length === 0) return null;
  return (
    <View>
      {avisos.map((a, i) => (
        <Text key={i} style={styles.aviso}>
          ⚠ {a}
        </Text>
      ))}
    </View>
  );
}

function CardValorBox({ titulo, card }: { titulo: string; card: CardValorUI }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitulo}>{titulo}</Text>
      <Text style={styles.cardValor}>{card.status === "disponivel" ? formatarMoeda(card.valor ?? 0) : "não disponível"}</Text>
    </View>
  );
}

function SecaoComOuSemDado<T>({
  titulo,
  secao,
  children,
}: {
  titulo: string;
  secao: SecaoRelatorioUI<T>;
  children: (dados: T) => React.ReactNode;
}) {
  if (secao.status === "nao_disponivel" || secao.dados === null) {
    return <SecaoIndisponivel titulo={titulo} motivo={secao.motivo ?? "motivo não informado"} />;
  }
  return (
    <View break>
      <Text style={styles.h1}>{titulo}</Text>
      <Avisos avisos={secao.avisos} />
      {children(secao.dados)}
    </View>
  );
}

function TabelaRendaVariavel({ linhas }: { linhas: LinhaMensalRendaVariavelUI[] }) {
  return (
    <Tabela
      colunas={["Grupo", "Mês", "Venda bruta", "Lucro bruto", "Prejuízo aplicado", "Base cálculo", "Alíquota", "Imposto devido", "Isento/Pendente"]}
      larguras={[16, 8, 12, 12, 12, 12, 8, 12, 8]}
      linhas={linhas.map((l) => [
        l.grupo,
        l.anoMes,
        formatarMoeda(l.vendaTotalBruta),
        formatarMoeda(l.lucroBruto),
        formatarMoeda(l.prejuizoAnteriorAplicado),
        formatarMoeda(l.baseCalculo),
        l.aliquota !== null ? formatarPct(l.aliquota) : "—",
        l.impostoDevido !== null ? formatarMoeda(l.impostoDevido) : "—",
        l.pendente ? "PENDENTE" : l.isento ? (l.motivoIsencao ?? "isento") : "—",
      ])}
    />
  );
}

function TabelaRendaFixa({ linhas }: { linhas: LinhaMensalRendaFixaUI[] }) {
  const resgates: ResgateRendaFixaUI[] = linhas.flatMap((l) => l.resgates);
  return (
    <>
      <Tabela
        colunas={["Grupo", "Mês", "Venda bruta", "Lucro bruto", "Base cálculo", "Dias médios", "Alíquota", "Imposto devido"]}
        larguras={[18, 10, 14, 14, 14, 10, 10, 10]}
        linhas={linhas.map((l) => [
          l.grupo,
          l.anoMes,
          formatarMoeda(l.vendaTotalBruta),
          formatarMoeda(l.lucroBruto),
          formatarMoeda(l.baseCalculo),
          l.diasMediosRetencao !== null ? Math.round(l.diasMediosRetencao) : "—",
          l.aliquota !== null ? formatarPct(l.aliquota) : "—",
          l.impostoDevido !== null ? formatarMoeda(l.impostoDevido) : "retido na fonte",
        ])}
      />
      {resgates.length > 0 && (
        <>
          <Text style={styles.h2}>Memória auxiliar — resgates individuais</Text>
          <Tabela
            colunas={["Ativo", "Mês", "Venda bruta", "Lucro bruto", "Dias", "Alíquota"]}
            larguras={[24, 12, 18, 18, 12, 16]}
            linhas={resgates.map((r) => [
              r.ativoTicker,
              r.anoMes,
              formatarMoeda(r.vendaTotalBruta),
              formatarMoeda(r.lucroBruto),
              r.diasMediosRetencao !== null ? Math.round(r.diasMediosRetencao) : "—",
              r.aliquota !== null ? formatarPct(r.aliquota) : "—",
            ])}
          />
        </>
      )}
    </>
  );
}

function TabelaExterior({ linhas }: { linhas: LinhaAnualExteriorUI[] }) {
  const vendas: VendaExteriorUI[] = linhas.flatMap((l) => l.vendas);
  return (
    <>
      <Tabela
        colunas={["Ano", "Venda bruta", "Lucro bruto", "Prejuízo aplicado", "Base cálculo", "Alíquota", "Imposto devido"]}
        larguras={[10, 16, 16, 16, 16, 10, 16]}
        linhas={linhas.map((l) => [
          l.ano,
          formatarMoeda(l.vendaTotalBruta),
          formatarMoeda(l.lucroBruto),
          formatarMoeda(l.prejuizoAnteriorAplicado),
          formatarMoeda(l.baseCalculo),
          formatarPct(l.aliquota),
          formatarMoeda(l.impostoDevido),
        ])}
      />
      {vendas.length > 0 && (
        <>
          <Text style={styles.h2}>Memória auxiliar — vendas por ativo</Text>
          <Tabela
            colunas={["Ativo", "Venda bruta (R$)", "Resultado (R$)"]}
            larguras={[40, 30, 30]}
            linhas={vendas.map((v) => [v.ativoTicker, formatarMoeda(v.vendaTotalBrutaReais), formatarMoeda(v.resultadoRealizadoReais)])}
          />
        </>
      )}
    </>
  );
}

function TabelaDarf({ resultado }: { resultado: ResultadoDarfUI }) {
  return (
    <>
      <Text style={styles.h2}>Guias consolidadas (valor para copiar no Sicalc)</Text>
      <Tabela
        colunas={["Código de receita", "Competência", "Valor consolidado"]}
        larguras={[34, 33, 33]}
        linhas={resultado.guias.map((g) => [g.codigoReceita, g.competenciaGeracao, formatarMoeda(g.valorConsolidado)])}
      />
      {resultado.saldosPendentes.length > 0 && (
        <>
          <Text style={styles.h2}>Saldos ainda abaixo do mínimo (não geram guia ainda)</Text>
          <Tabela
            colunas={["Código de receita", "Valor acumulado"]}
            larguras={[50, 50]}
            linhas={resultado.saldosPendentes.map((s) => [s.codigoReceita, formatarMoeda(s.valorAcumulado)])}
          />
        </>
      )}
    </>
  );
}

function TabelaOperacoes({ operacoes }: { operacoes: OperacaoAnexoUI[] }) {
  return (
    <Tabela
      colunas={["Ativo", "Categoria", "Data", "Quantidade", "Venda bruta", "Resultado"]}
      larguras={[18, 18, 14, 16, 16, 18]}
      linhas={operacoes.map((o) => [o.ativoTicker, o.categoria, o.data, o.quantidade.toLocaleString("pt-BR"), formatarMoeda(o.valorVendaBruto), formatarMoeda(o.resultadoRealizado)])}
    />
  );
}

export function Documento({ relatorio }: { relatorio: RelatorioCompletoUI }) {
  const { capa } = relatorio;
  return (
    <Document>
      <Page style={styles.page} wrap>
        <Text style={styles.capaTitulo}>Relatório de Imposto de Renda — App do Investidor</Text>
        <Text style={styles.capaSubtitulo}>
          Exercício {capa.exercicio} — ano-calendário {capa.anoCalendario}
        </Text>
        <Text style={styles.paragrafo}>Titular: {capa.titularNome ?? "não informado"}</Text>
        <Text style={styles.paragrafo}>CPF: {capa.titularCpf ?? "não informado"}</Text>
        <Text style={styles.paragrafo}>Perfil: {capa.perfilResumo}</Text>
        <Text style={styles.paragrafo}>Versão das regras fiscais: {capa.versaoFiscalNome ?? "não cadastrada pro exercício"}</Text>
        <Text style={styles.paragrafo}>Gerado em: {new Date(capa.dataGeracao).toLocaleString("pt-BR")}</Text>

        <Text style={styles.h1}>Disclaimer</Text>
        {relatorio.disclaimer.map((d, i) => (
          <Text key={i} style={styles.paragrafo}>
            • {d}
          </Text>
        ))}

        <View break>
          <Text style={styles.h1}>Instruções de uso no programa oficial</Text>
          {relatorio.instrucoesUso.map((d, i) => (
            <Text key={i} style={styles.paragrafo}>
              • {d}
            </Text>
          ))}
        </View>

        <SecaoComOuSemDado titulo="Resumo da obrigatoriedade de declarar" secao={relatorio.resumoObrigatoriedade}>
          {() => null}
        </SecaoComOuSemDado>

        <SecaoComOuSemDado titulo="Resumo da declaração" secao={relatorio.resumoDeclaracao}>
          {(cards) => (
            <View style={styles.cardsGrid}>
              <CardValorBox titulo="Imposto a pagar" card={cards.impostoAPagar} />
              <CardValorBox titulo="Imposto pago" card={cards.impostoPago} />
              <CardValorBox titulo="Imposto vencido" card={cards.impostoVencido} />
              <CardValorBox titulo="IRRF disponível" card={cards.irrfDisponivel} />
              <CardValorBox titulo="Ganho de capital exterior" card={cards.ganhoCapitalExterior} />
              <CardValorBox titulo="Imposto pago no exterior" card={cards.impostoPagoExterior} />
              <CardValorBox titulo="Crédito exterior admitido" card={cards.creditoExteriorAdmitido} />
              <CardValorBox titulo="Documentos sem comprovante" card={cards.documentosSemComprovante} />
            </View>
          )}
        </SecaoComOuSemDado>

        <View break>
          <Text style={styles.h1}>Pendências e itens sem comprovante</Text>
          {relatorio.pendencias.length === 0 ? (
            <Text style={styles.paragrafo}>Nenhuma pendência localizada.</Text>
          ) : (
            <Tabela
              colunas={["Origem", "Referência", "Descrição", "Motivos"]}
              larguras={[14, 16, 40, 30]}
              linhas={relatorio.pendencias.map((p) => [p.origem, p.referencia, p.descricao, p.motivos.join("; ")])}
            />
          )}
        </View>

        <SecaoComOuSemDado titulo="Bens e Direitos" secao={relatorio.bensDireitos}>
          {(itens) => (
            <Tabela
              colunas={["Grupo/Cód.", "Nome", "Localização", "Situação anterior", "Situação atual", "Origem"]}
              larguras={[10, 30, 18, 14, 14, 14]}
              linhas={itens.map((i) => [`${i.grupo}/${i.codigo}`, i.nome, i.localizacao ?? "—", formatarMoeda(i.situacaoAnterior), formatarMoeda(i.situacaoAtual), i.origem])}
            />
          )}
        </SecaoComOuSemDado>

        <SecaoComOuSemDado titulo="Rendimentos tributáveis" secao={relatorio.rendimentosTributaveis}>
          {() => null}
        </SecaoComOuSemDado>

        <SecaoComOuSemDado titulo="Rendimentos isentos" secao={relatorio.rendimentosIsentos}>
          {(d) => (
            <>
              <Text style={styles.h2}>Ações/FII — vendas isentas por limite mensal</Text>
              <TabelaRendaVariavel linhas={d.rendaVariavelIsenta} />
              <Text style={styles.h2}>Renda fixa isenta (LCI/LCA/CRI/CRA)</Text>
              <TabelaRendaFixa linhas={d.rendaFixaIsenta} />
            </>
          )}
        </SecaoComOuSemDado>

        <SecaoComOuSemDado titulo="Tributação exclusiva (renda fixa)" secao={relatorio.tributacaoExclusiva}>
          {(linhas) => <TabelaRendaFixa linhas={linhas} />}
        </SecaoComOuSemDado>

        <SecaoComOuSemDado titulo="Renda variável mês a mês" secao={relatorio.rendaVariavelMensal}>
          {(linhas) => <TabelaRendaVariavel linhas={linhas} />}
        </SecaoComOuSemDado>

        <SecaoComOuSemDado titulo="Ganho de capital (fora de bolsa)" secao={relatorio.ganhoCapitalForaBolsa}>
          {() => null}
        </SecaoComOuSemDado>

        <SecaoComOuSemDado titulo="Aplicações financeiras no exterior" secao={relatorio.aplicacoesExterior}>
          {(linhas) => <TabelaExterior linhas={linhas} />}
        </SecaoComOuSemDado>

        <SecaoComOuSemDado titulo="Imposto pago no exterior e crédito admitido" secao={relatorio.impostoPagoExteriorCredito}>
          {() => null}
        </SecaoComOuSemDado>

        <SecaoComOuSemDado titulo="Pagamentos e deduções" secao={relatorio.pagamentosDeducoes}>
          {() => null}
        </SecaoComOuSemDado>

        <SecaoComOuSemDado titulo="Dívidas e ônus reais" secao={relatorio.dividas}>
          {() => null}
        </SecaoComOuSemDado>

        <SecaoComOuSemDado titulo="Resumo de DARFs e pagamentos" secao={relatorio.resumoDarfs}>
          {(resultado) => <TabelaDarf resultado={resultado} />}
        </SecaoComOuSemDado>

        <View break>
          <Text style={styles.h1}>Memória de cálculo por regime</Text>
          <Text style={styles.paragrafo}>{relatorio.nota21MemoriaCalculo}</Text>
        </View>

        <SecaoComOuSemDado titulo="Anexo de operações (ações/fundos/FII)" secao={relatorio.anexoOperacoes}>
          {(ops) => <TabelaOperacoes operacoes={ops} />}
        </SecaoComOuSemDado>

        <SecaoComOuSemDado titulo="Anexo de documentos e origem dos dados" secao={relatorio.anexoDocumentos}>
          {() => null}
        </SecaoComOuSemDado>
      </Page>
    </Document>
  );
}
