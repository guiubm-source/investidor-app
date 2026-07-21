/**
 * Tipos puros do módulo de Imposto de Renda — fundação fiscal (fase 1 de 12,
 * ver docs/MAPA-DE-DADOS.md §8.32/§8.33). Arquivo sem `"use server"` de
 * propósito (mesmo motivo de `lib/ativos/posicao-calculo.ts`): só tipos,
 * nenhuma função aqui precisa ser Server Action.
 */

export type StatusVersaoRegra = "rascunho" | "validada" | "substituida";

export type VersaoRegra = {
  id: string;
  jurisdicao: "brasil" | "estados_unidos";
  exercicio: number | null;
  anoCalendario: number | null;
  nome: string;
  versao: string;
  status: StatusVersaoRegra;
  fonteOficial: string | null;
};

export type ParametroRegra = {
  chave: string;
  valorNumero: number | null;
  valorTexto: string | null;
  valorJson: unknown | null;
  unidade: string | null;
  observacao: string | null;
};

/**
 * Ciclo de vida da declaração (§8.32.11). Sem `TRANSMITIDA` — o app não
 * transmite pra Receita (§8.32.39).
 */
export type StatusDeclaracaoIR =
  | "nao_iniciada"
  | "em_configuracao"
  | "em_preenchimento"
  | "em_revisao"
  | "pronta_relatorio"
  | "relatorio_gerado";

export type DeclaracaoIR = {
  id: string;
  exercicio: number;
  anoCalendario: number;
  status: StatusDeclaracaoIR;
  versaoRegraBrasilId: string | null;
  iniciadaEm: string;
  relatorioGeradoEm: string | null;
};

export type PerfilFiscalIR = {
  id: string | null;
  declaracaoId: string;
  residenteBrasil: boolean;
  residenteDesde: string | null;
  saidaDefinitiva: boolean;
  usPerson: boolean;
  cidadaniaEua: boolean;
  greenCard: boolean;
  nonresidentAlien: boolean;
  diasPresencaEua: number | null;
  possuiDependentes: boolean;
  declaracaoConjunta: boolean;
  possuiTrust: boolean;
  possuiControladaExterior: boolean;
  confirmadoEm: string | null;
};

/**
 * Avisos de "fora de escopo" (§8.32.12/§8.32.39) — primeira versão só
 * atende titular individual, residente, sem trust/controlada. Qualquer
 * resposta que acione um destes NÃO bloqueia o uso do app, só avisa que
 * aquele aspecto específico não tem suporte ainda e recomenda validação
 * profissional.
 */
export type AvisoEscopoIR = {
  campo: keyof PerfilFiscalIR;
  titulo: string;
  descricao: string;
};
