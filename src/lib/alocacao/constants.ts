/**
 * Banda de tolerância de rebalanceamento, em pontos percentuais. Um desvio
 * dentro dessa faixa é considerado "ok" (verde); fora dela, sinaliza que
 * pode valer a pena rebalancear (vermelho). Fixo por enquanto — dá pra virar
 * ajustável em Configurações no futuro.
 */
export const TOLERANCIA_REBALANCEAMENTO_PP = 5;

/**
 * Sugestão de setores comuns, só para acelerar o cadastro (usuário pode
 * digitar qualquer nome de setor/segmento livremente).
 */
export const SETORES_SUGERIDOS_ACOES = [
  "Financeiro",
  "Consumo cíclico",
  "Consumo não cíclico",
  "Utilidade pública",
  "Materiais básicos",
  "Bens industriais",
  "Petróleo, gás e biocombustíveis",
  "Saúde",
  "Tecnologia da informação",
  "Comunicações",
];

export const SEGMENTOS_SUGERIDOS_FII = [
  "Lajes corporativas",
  "Shoppings",
  "Logística",
  "Papel (CRI)",
  "Fundo de fundos",
  "Híbrido",
  "Residencial",
];

/**
 * Alocação-alvo sugerida por perfil de risco (ponto de partida editável).
 * Baseado em práticas comuns de alocação estratégica no mercado brasileiro —
 * não é recomendação individualizada, é só um template inicial.
 */
export const SUGESTAO_ALOCACAO_POR_PERFIL: Record<
  string,
  { nome: string; peso_alvo: number }[]
> = {
  conservador: [
    { nome: "Renda fixa", peso_alvo: 75 },
    { nome: "Fundos imobiliários", peso_alvo: 10 },
    { nome: "Ações", peso_alvo: 5 },
    { nome: "Reserva de emergência", peso_alvo: 10 },
  ],
  moderado: [
    { nome: "Renda fixa", peso_alvo: 45 },
    { nome: "Ações", peso_alvo: 25 },
    { nome: "Fundos imobiliários", peso_alvo: 15 },
    { nome: "Internacional", peso_alvo: 10 },
    { nome: "Reserva de emergência", peso_alvo: 5 },
  ],
  arrojado: [
    { nome: "Ações", peso_alvo: 40 },
    { nome: "Renda fixa", peso_alvo: 20 },
    { nome: "Fundos imobiliários", peso_alvo: 15 },
    { nome: "Internacional", peso_alvo: 20 },
    { nome: "Reserva de emergência", peso_alvo: 5 },
  ],
};
