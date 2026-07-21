import type { CardsPrincipaisIR } from "./dashboard-fiscal";
import { LABEL_GRUPO_FISCAL_RENDA_VARIAVEL, type ResultadoRendaVariavelBrasil } from "./renda-variavel-brasil";
import type { ResultadoRendaFixaBrasil } from "./renda-fixa-brasil";
import type { ResultadoExteriorLei14754 } from "./exterior-lei-14754";
import type { ResultadoDarf } from "./darf";
import type { ResultadoBensDireitos } from "../consultas/bens-direitos";
import type {
  RelatorioCompletoIR,
  SecaoRelatorio,
  PendenciaRelatorio,
  OperacaoAnexo,
  CapaRelatorio,
} from "../relatorios/tipos";
import { DISCLAIMER_RELATORIO, INSTRUCOES_USO_PROGRAMA_OFICIAL } from "../relatorios/descricoes-irpf";

/**
 * Motor PURO (sem acesso a banco/rede) do PDF final — fase 11 do §8.32.37
 * (ver docs/MAPA-DE-DADOS.md §8.46). Mesmo espírito de `dashboard-fiscal.ts`
 * (fase 10): NENHUM cálculo fiscal novo, só agrega/filtra/rotula o que os
 * motores das fases 3-10 já produziram. A única "lógica" daqui é decidir
 * disponibilidade por seção e filtrar pelo ano-calendário pedido.
 */

export type InputRelatorioCompleto = {
  ano: number;
  capa: CapaRelatorio;
  cardsPrincipais: CardsPrincipaisIR;
  rendaVariavel: ResultadoRendaVariavelBrasil | null;
  rendaFixa: ResultadoRendaFixaBrasil | null;
  exterior: ResultadoExteriorLei14754 | null;
  darf: ResultadoDarf | null;
  bensDireitos: ResultadoBensDireitos;
  operacoesRendaVariavel: OperacaoAnexo[];
};

function disponivel<T>(dados: T, avisos: string[] = []): SecaoRelatorio<T> {
  return { status: "disponivel", dados, motivo: null, avisos };
}

function naoDisponivel<T>(motivo: string): SecaoRelatorio<T> {
  return { status: "nao_disponivel", dados: null, motivo, avisos: [] };
}

const MOTIVO_RENDIMENTOS_TRIBUTAVEIS =
  "Fora do escopo do app: este relatório cobre apenas rendimentos de investimentos, não rendimentos do trabalho (salário, pró-labore, aluguéis de imóveis etc.). Ver docs/MAPA-DE-DADOS.md §8.32.20.";
const MOTIVO_GANHO_CAPITAL_FORA_BOLSA =
  "Motor de ganho de capital fora de bolsa (imóveis, veículos, participações societárias fora de bolsa) ainda não construído — um dos 9 módulos manuais do §8.32.20 ainda pendentes.";
const MOTIVO_IMPOSTO_EXTERIOR_CREDITO =
  "Crédito de imposto pago no exterior ainda não calculado — mesma lacuna sinalizada no dashboard (§8.45): fase 7 cobre só o ganho de capital, não o crédito de imposto retido lá fora.";
const MOTIVO_PAGAMENTOS_DEDUCOES = "Módulo de pagamentos/deduções (§8.32.20) ainda não construído.";
const MOTIVO_DIVIDAS = "Módulo de dívidas e ônus reais (§8.32.20) ainda não construído.";
const MOTIVO_DOCUMENTOS = "Upload/vínculo de comprovantes (§8.35) ainda não construído — nenhum item tem comprovante anexado hoje.";
const MOTIVO_OBRIGATORIEDADE = "Motor de regras de obrigatoriedade de declarar ainda não construído — mesma lacuna do card do dashboard (§8.45).";

export const NOTA_21_MEMORIA_CALCULO =
  "Memória de cálculo por regime: não é uma seção separada — cada seção de apuração acima (renda fixa, renda variável, aplicações no exterior) já traz o detalhe linha a linha (base de cálculo, alíquota aplicada, prejuízo de meses/anos anteriores abatido). Os valores já resumidos (\"resumo da declaração\", \"resumo de DARFs\") são os valores PARA COPIAR nos campos oficiais; as tabelas mês a mês/ano a ano são a MEMÓRIA AUXILIAR — não cole a memória auxiliar diretamente num campo da declaração oficial.";

export function montarRelatorioCompleto(input: InputRelatorioCompleto): RelatorioCompletoIR {
  const anoStr = String(input.ano);

  const rendaVariavelDoAno = (input.rendaVariavel?.mensal ?? []).filter((l) => l.anoMes.startsWith(anoStr));
  const rendaFixaDoAno = (input.rendaFixa?.mensal ?? []).filter((l) => l.anoMes.startsWith(anoStr));
  const exteriorDoAno = (input.exterior?.anual ?? []).filter((l) => l.ano === input.ano);

  const pendencias: PendenciaRelatorio[] = [];
  for (const linha of rendaVariavelDoAno) {
    if (!linha.pendente) continue;
    pendencias.push({
      origem: "renda_variavel",
      referencia: linha.anoMes,
      descricao: `${LABEL_GRUPO_FISCAL_RENDA_VARIAVEL[linha.grupo]} — ${linha.anoMes}`,
      motivos: linha.motivosPendencia,
    });
  }
  const ativosComPendenciaExterior = input.exterior?.ativosComPendencia ?? [];
  for (const ativo of ativosComPendenciaExterior) {
    pendencias.push({
      origem: "exterior",
      referencia: ativo.ativoTicker,
      descricao: `Ativo internacional ${ativo.ativoTicker} excluído da apuração de ganho de capital no exterior`,
      motivos: ativo.motivos,
    });
  }

  const rendimentosIsentos = {
    rendaVariavelIsenta: rendaVariavelDoAno.filter((l) => l.isento),
    rendaFixaIsenta: rendaFixaDoAno.filter((l) => l.grupo === "renda_fixa_isenta" || l.isento),
  };

  const tributacaoExclusiva = rendaFixaDoAno.filter((l) => l.grupo === "renda_fixa_tributavel");

  const darfDoAno: ResultadoDarf | null = input.darf
    ? {
        guias: input.darf.guias.filter((g) => g.competenciaGeracao.startsWith(anoStr)),
        saldosPendentes: input.darf.saldosPendentes,
      }
    : null;

  return {
    capa: input.capa,
    disclaimer: DISCLAIMER_RELATORIO,
    instrucoesUso: INSTRUCOES_USO_PROGRAMA_OFICIAL,
    resumoObrigatoriedade: naoDisponivel(MOTIVO_OBRIGATORIEDADE),
    resumoDeclaracao: disponivel(input.cardsPrincipais),
    pendencias,
    documentosSemComprovante: naoDisponivel(MOTIVO_DOCUMENTOS),
    bensDireitos: disponivel(input.bensDireitos.itens, [
      "Fundos genéricos (sem subtipo distinguido) e criptoativos não são auto-populados — só imóveis/veículos/participações/contas manuais e ações/FII/renda fixa/internacional com grupo-código mapeado.",
    ]),
    rendimentosTributaveis: naoDisponivel(MOTIVO_RENDIMENTOS_TRIBUTAVEIS),
    rendimentosIsentos: input.rendaVariavel || input.rendaFixa
      ? disponivel(rendimentosIsentos, [
          "Não inclui proventos/dividendos recebidos (isentos de IR) — este relatório cobre apenas ganho de capital na venda, não a distribuição de proventos em si.",
        ])
      : naoDisponivel("Nenhuma das fundações (renda variável fase 4, renda fixa fase 6) está disponível para este exercício."),
    tributacaoExclusiva: input.rendaFixa
      ? disponivel(tributacaoExclusiva)
      : naoDisponivel("Fundação de renda fixa (fase 6, parâmetros da tabela regressiva) não encontrada para este exercício."),
    rendaVariavelMensal: input.rendaVariavel
      ? disponivel(rendaVariavelDoAno)
      : naoDisponivel("Fundação de renda variável (fase 4, parâmetros de isenção/alíquota) não encontrada para este exercício."),
    ganhoCapitalForaBolsa: naoDisponivel(MOTIVO_GANHO_CAPITAL_FORA_BOLSA),
    aplicacoesExterior: input.exterior
      ? disponivel(exteriorDoAno)
      : naoDisponivel("Fundação de tributação no exterior (fase 7, alíquota Lei 14.754) não encontrada para este exercício."),
    impostoPagoExteriorCredito: naoDisponivel(MOTIVO_IMPOSTO_EXTERIOR_CREDITO),
    pagamentosDeducoes: naoDisponivel(MOTIVO_PAGAMENTOS_DEDUCOES),
    dividas: naoDisponivel(MOTIVO_DIVIDAS),
    resumoDarfs: darfDoAno
      ? disponivel(darfDoAno, [
          "Não acompanha status de pagamento (calculado → guia gerada → aguardando → pago) nem multa/juros de atraso — só o valor consolidado devido.",
        ])
      : naoDisponivel("Fundação de renda variável (pré-requisito do motor de DARF, fase 5) não encontrada para este exercício."),
    nota21MemoriaCalculo: NOTA_21_MEMORIA_CALCULO,
    anexoOperacoes: disponivel(input.operacoesRendaVariavel, [
      "Cobre só ações/fundos/FII (fase 4) — renda fixa já tem detalhe por resgate embutido na seção de tributação exclusiva/isentos, e exterior já tem detalhe por venda embutido na seção de aplicações no exterior.",
    ]),
    anexoDocumentos: naoDisponivel(MOTIVO_DOCUMENTOS),
    ativosComPendenciaExterior,
  };
}
