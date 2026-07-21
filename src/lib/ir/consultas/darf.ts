/**
 * Orquestração da consolidação de DARF (fase 5 — ver
 * docs/MAPA-DE-DADOS.md §8.40). Sem `"use server"` — mesmo padrão das
 * demais `consultas/*.ts`. Consome a apuração de renda variável (fase 4b)
 * já pronta e os parâmetros de regra versionados (fase 1).
 */

import Decimal from "decimal.js";
import { obterVersaoRegraVigente, obterParametrosRegra } from "../regras/carregar-regras";
import { exercicioCorrente } from "./declaracao";
import { apurarRendaVariavelBrasilDoUsuario } from "./renda-variavel";
import { consolidarDarf, type ParcelaParaDarf, type ResultadoDarf } from "../motores/darf";
import type { GrupoFiscalRendaVariavel } from "../motores/renda-variavel-brasil";

const CHAVE_VALOR_MINIMO = "darf.valor_minimo_recolhimento";
const CHAVE_CODIGO_COMUM = "darf.codigo_receita_renda_variavel_comum";

/**
 * Código de receita por grupo fiscal — hoje todos os 3 grupos de renda
 * variável (ação swing, ação day, FII) caem no mesmo código consolidado da
 * versão de regra vigente (`darf.codigo_receita_renda_variavel_comum`,
 * seed atual: '6015'), que é o que já estava documentado em §8.1 pro app
 * antigo. Chaves específicas por grupo (`darf.codigo_receita_acao_swing`,
 * etc.) são checadas primeiro — se uma versão de regra futura precisar
 * diferenciar (ex.: pesquisa confirmar que FII usa código diferente), basta
 * seedar a chave específica sem tocar neste código.
 */
function chaveEspecificaPorGrupo(grupo: GrupoFiscalRendaVariavel): string {
  return `darf.codigo_receita_${grupo}`;
}

/**
 * Carrega o valor mínimo de recolhimento e resolve o código de receita de
 * cada grupo fiscal a partir da versão de regra vigente do exercício
 * corrente. Devolve `null` se faltar a versão ou o valor mínimo (§8.32.4
 * item 4: sem fallback pra "última versão qualquer").
 */
async function obterParametrosDarfVigente(): Promise<{
  valorMinimo: Decimal;
  codigoReceitaPorGrupo: Record<GrupoFiscalRendaVariavel, string>;
} | null> {
  const { exercicio } = exercicioCorrente();
  const versao = await obterVersaoRegraVigente("brasil", exercicio);
  if (!versao) return null;

  const parametros = await obterParametrosRegra(versao.id);
  const valorMinimoNum = parametros.get(CHAVE_VALOR_MINIMO)?.valorNumero ?? null;
  const codigoComum = parametros.get(CHAVE_CODIGO_COMUM)?.valorTexto ?? null;
  if (valorMinimoNum === null || codigoComum === null) return null;

  const grupos: GrupoFiscalRendaVariavel[] = ["acao_swing", "acao_day", "fii"];
  const codigoReceitaPorGrupo = Object.fromEntries(
    grupos.map((grupo) => [grupo, parametros.get(chaveEspecificaPorGrupo(grupo))?.valorTexto ?? codigoComum])
  ) as Record<GrupoFiscalRendaVariavel, string>;

  return { valorMinimo: new Decimal(valorMinimoNum), codigoReceitaPorGrupo };
}

/**
 * Consolida DARFs de renda variável Brasil do usuário logado. Devolve
 * `null` quando faltar fundação (versão de regra vigente/parâmetros) — o
 * mesmo tipo de bloqueio gracioso das demais consultas desta fase.
 */
export async function consolidarDarfRendaVariavelDoUsuario(): Promise<ResultadoDarf | null> {
  const parametrosDarf = await obterParametrosDarfVigente();
  if (!parametrosDarf) return null;

  const apuracao = await apurarRendaVariavelBrasilDoUsuario();
  if (!apuracao) return null;

  const parcelas: ParcelaParaDarf[] = apuracao.mensal
    .filter((l) => !l.pendente && l.impostoDevido !== null && l.impostoDevido.greaterThan(0))
    .map((l) => ({
      grupo: l.grupo,
      anoMes: l.anoMes,
      codigoReceita: parametrosDarf.codigoReceitaPorGrupo[l.grupo],
      valor: l.impostoDevido!,
    }));

  return consolidarDarf(parcelas, parametrosDarf.valorMinimo);
}
