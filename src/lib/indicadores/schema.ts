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
  taxa_definida: z.number().min(0, "Informe uma taxa válida"),
});
export type DecisaoSelicForm = z.infer<typeof decisaoSelicSchema>;

export const ipcaMensalSchema = z.object({
  ano_mes: anoMesSchema,
  variacao_pct: z.number(),
  acumulado_12m_pct: z.number().optional(),
});
export type IpcaMensalForm = z.infer<typeof ipcaMensalSchema>;

export const ipcaCategoriaSchema = z.object({
  ano_mes: anoMesSchema,
  categoria: z.enum([
    "alimentacao_bebidas",
    "habitacao",
    "artigos_residencia",
    "vestuario",
    "transportes",
    "saude_cuidados_pessoais",
    "despesas_pessoais",
    "educacao",
    "comunicacao",
  ]),
  variacao_pct: z.number(),
});
export type IpcaCategoriaForm = z.infer<typeof ipcaCategoriaSchema>;

export const dolarMensalSchema = z.object({
  ano_mes: anoMesSchema,
  cotacao: z.number().positive("Informe uma cotação válida"),
});
export type DolarMensalForm = z.infer<typeof dolarMensalSchema>;

export const fluxoEstrangeiroMensalSchema = z.object({
  ano_mes: anoMesSchema,
  saldo_liquido: z.number(),
});
export type FluxoEstrangeiroMensalForm = z.infer<typeof fluxoEstrangeiroMensalSchema>;

/** Meta contínua de inflação vigente desde 2025 (CMN). */
export const META_IPCA_CENTRO = 3;
export const META_IPCA_TOLERANCIA = 1.5;
