import { z } from "zod";

/**
 * Os 9 grupos oficiais do IBGE para abertura do IPCA por categoria — mesma
 * lista usada no formulário e na exibição (ver docs/MAPA-DE-DADOS.md §8.3.7,
 * decisão de usar a classificação oficial em vez de uma lista simplificada).
 */
export const CATEGORIAS_IPCA = [
  { valor: "alimentacao_bebidas", label: "Alimentação e bebidas" },
  { valor: "habitacao", label: "Habitação" },
  { valor: "artigos_residencia", label: "Artigos de residência" },
  { valor: "vestuario", label: "Vestuário" },
  { valor: "transportes", label: "Transportes" },
  { valor: "saude_cuidados_pessoais", label: "Saúde e cuidados pessoais" },
  { valor: "despesas_pessoais", label: "Despesas pessoais" },
  { valor: "educacao", label: "Educação" },
  { valor: "comunicacao", label: "Comunicação" },
] as const;

const anoMesSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "Formato esperado: AAAA-MM");

export const decisaoSelicSchema = z.object({
  reuniao_id: z.string().uuid(),
  numero_reuniao: z.union([z.number(), z.nan()]).transform((v) => (Number.isNaN(v) ? null : v)),
  taxa_definida: z.number().min(0, "Informe uma taxa válida"),
});
export type DecisaoSelicForm = z.infer<typeof decisaoSelicSchema>;

/** Edição de uma reunião já existente na tabela (histórico — bloco 4). */
export const selicReuniaoEditSchema = z.object({
  id: z.string().uuid(),
  numero_reuniao: z.union([z.number(), z.nan()]).transform((v) => (Number.isNaN(v) ? null : v)),
  data_inicio: z.string().min(1, "Informe a data de início"),
  data_fim: z.string().min(1, "Informe a data de fim"),
  taxa_definida: z.union([z.number(), z.nan()]).transform((v) => (Number.isNaN(v) ? null : v)),
});
export type SelicReuniaoEditForm = z.infer<typeof selicReuniaoEditSchema>;

/** Criação manual de uma reunião nova (histórico — bloco 4, botão "+ Nova reunião" e "Duplicar"). */
export const novaReuniaoSelicSchema = selicReuniaoEditSchema.omit({ id: true });
export type NovaReuniaoSelicForm = z.infer<typeof novaReuniaoSelicSchema>;

/** Importação em massa (colar texto) — bloco 5. */
export const importarSelicSchema = z.object({
  texto: z.string().min(1, "Cole o histórico antes de importar"),
});
export type ImportarSelicForm = z.infer<typeof importarSelicSchema>;

/**
 * Lançamento/edição de uma competência inteira do IPCA (geral + 9 grupos) —
 * tabela única, ver docs/MAPA-DE-DADOS.md §8.8 decisão 3. Grupos são
 * opcionais (pode faltar detalhamento por grupo mesmo com o geral lançado);
 * impacto por grupo nunca é campo de formulário — é sempre calculado a
 * partir dos Pesos do IPCA vigentes (decisão 2).
 */
const percentualGrupoSchema = z.union([z.number(), z.nan()]).transform((v) => (Number.isNaN(v) ? null : v));

export const ipcaCompetenciaSchema = z.object({
  ano_mes: anoMesSchema,
  geral: z.number({ error: "Informe o índice geral do mês" }),
  alimentacao_bebidas: percentualGrupoSchema,
  habitacao: percentualGrupoSchema,
  artigos_residencia: percentualGrupoSchema,
  vestuario: percentualGrupoSchema,
  transportes: percentualGrupoSchema,
  saude_cuidados_pessoais: percentualGrupoSchema,
  despesas_pessoais: percentualGrupoSchema,
  educacao: percentualGrupoSchema,
  comunicacao: percentualGrupoSchema,
  data_divulgacao: z.union([z.string(), z.literal("")]).transform((v) => (v ? v : null)),
  observacoes: z.union([z.string(), z.literal("")]).transform((v) => (v ? v : null)),
});
export type IpcaCompetenciaForm = z.infer<typeof ipcaCompetenciaSchema>;

/** Importação em massa (colar texto) — bloco de importação da aba IPCA. */
export const importarIpcaSchema = z.object({
  texto: z.string().min(1, "Cole o histórico antes de importar"),
});
export type ImportarIpcaForm = z.infer<typeof importarIpcaSchema>;

// dolarMensalSchema foi removido — Dólar agora é diário, automático (Bacen
// SGS via cron) e somente-leitura, sem cadastro manual. Ver
// docs/MAPA-DE-DADOS.md §8.9 decisão 4.

export const fluxoEstrangeiroMensalSchema = z.object({
  ano_mes: anoMesSchema,
  saldo_liquido: z.number(),
});
export type FluxoEstrangeiroMensalForm = z.infer<typeof fluxoEstrangeiroMensalSchema>;

// META_IPCA_CENTRO/META_IPCA_TOLERANCIA (hardcoded) foram substituídas pelo
// cadastro Configurações → Metas de Inflação (tabela meta_inflacao, com
// vigência) — ver docs/MAPA-DE-DADOS.md §8.8 decisão 6 e
// src/lib/referencia/schema.ts#metaInflacaoSchema.
