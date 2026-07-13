import type { SuitabilityCompleto } from "./schema";

/**
 * Cálculo do perfil de investidor (suitability) a partir das respostas.
 *
 * IMPORTANTE: este é um modelo simplificado de pontuação para fins de MVP.
 * Antes de usar em produção para orientar recomendações reais de investimento,
 * valide a metodologia de pontuação com um profissional de compliance/CVM —
 * a regra de suitability (CVM Resolução 30) exige que a metodologia seja
 * tecnicamente defensável e documentada.
 */

const pontos = {
  objetivo_investimento: {
    preservacao_capital: 1,
    geracao_renda: 2,
    crescimento_patrimonio: 3,
    especulacao: 4,
  },
  horizonte_investimento: {
    curto_prazo: 1,
    medio_prazo: 2,
    longo_prazo: 3,
  },
  necessidade_liquidez: {
    imediata: 1,
    ate_1_ano: 2,
    sem_necessidade: 3,
  },
  conhecimento_mercado: {
    nenhum: 1,
    basico: 2,
    intermediario: 3,
    avancado: 4,
  },
  experienciaProduto: {
    nenhuma: 1,
    pouca: 2,
    moderada: 3,
    ampla: 4,
  },
  tolerancia_perda: {
    baixa: 1,
    media: 2,
    alta: 3,
  },
  reacao_a_perda: {
    venderia_tudo: 1,
    venderia_parte: 2,
    manteria: 3,
    compraria_mais: 4,
  },
} as const;

export type PerfilResultado = "conservador" | "moderado" | "arrojado";

export function calcularScoreSuitability(respostas: SuitabilityCompleto): number {
  const {
    objetivo_investimento,
    horizonte_investimento,
    necessidade_liquidez,
    conhecimento_mercado,
    experiencia_renda_fixa,
    experiencia_fundos,
    experiencia_acoes,
    experiencia_derivativos,
    tolerancia_perda,
    reacao_a_perda,
  } = respostas;

  const score =
    pontos.objetivo_investimento[objetivo_investimento] +
    pontos.horizonte_investimento[horizonte_investimento] +
    pontos.necessidade_liquidez[necessidade_liquidez] +
    pontos.conhecimento_mercado[conhecimento_mercado] +
    pontos.experienciaProduto[experiencia_renda_fixa] +
    pontos.experienciaProduto[experiencia_fundos] +
    pontos.experienciaProduto[experiencia_acoes] +
    pontos.experienciaProduto[experiencia_derivativos] +
    pontos.tolerancia_perda[tolerancia_perda] +
    pontos.reacao_a_perda[reacao_a_perda];

  return score;
}

/**
 * Faixas (score mínimo 10, máximo 37):
 * conservador  10–18
 * moderado     19–27
 * arrojado     28–37
 */
export function classificarPerfil(score: number): PerfilResultado {
  if (score <= 18) return "conservador";
  if (score <= 27) return "moderado";
  return "arrojado";
}
