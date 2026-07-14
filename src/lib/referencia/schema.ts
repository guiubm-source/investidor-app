import { z } from "zod";
import { CATEGORIAS_IPCA } from "@/lib/indicadores/schema";

/**
 * Cadastros de referência (dado compartilhado, sem profile_id — ver
 * docs/MAPA-DE-DADOS.md §8.7): diretoria completa do Bacen e presidentes do
 * Brasil. Cadastrados em Configurações, lidos pela aba Indicadores (filtros
 * de mandato do gráfico da Selic hoje, do IPCA depois).
 */

export const bacenDiretorSchema = z
  .object({
    nome: z.string().min(1, "Informe o nome"),
    cargo: z.string().min(1, "Informe o cargo"),
    presidente: z.boolean(),
    mandato_inicio: z.string().min(1, "Informe o início do mandato"),
    mandato_fim: z
      .union([z.string(), z.literal("")])
      .transform((v) => (v ? v : null)),
    nomeado_por: z
      .union([z.string(), z.literal("")])
      .transform((v) => (v ? v : null)),
    data_posse: z
      .union([z.string(), z.literal("")])
      .transform((v) => (v ? v : null)),
  })
  .refine((d) => d.mandato_fim === null || d.mandato_fim >= d.mandato_inicio, {
    message: "Fim do mandato não pode ser antes do início",
    path: ["mandato_fim"],
  });
export type BacenDiretorForm = z.infer<typeof bacenDiretorSchema>;

export const brasilPresidenteSchema = z
  .object({
    nome: z.string().min(1, "Informe o nome"),
    mandato_inicio: z.string().min(1, "Informe o início do mandato"),
    mandato_fim: z
      .union([z.string(), z.literal("")])
      .transform((v) => (v ? v : null)),
  })
  .refine((d) => d.mandato_fim === null || d.mandato_fim >= d.mandato_inicio, {
    message: "Fim do mandato não pode ser antes do início",
    path: ["mandato_fim"],
  });
export type BrasilPresidenteForm = z.infer<typeof brasilPresidenteSchema>;

/**
 * Pesos do IPCA e Metas de Inflação (dado compartilhado, sem profile_id,
 * mesmo padrão acima) — ver docs/MAPA-DE-DADOS.md §8.8, decisões 5/6.
 * Cadastrados em Configurações → Pesos do IPCA / Metas de Inflação, lidos
 * pela aba Indicadores (motor de cálculo do IPCA em ipca-estatisticas.ts).
 * O enum de grupo reaproveita CATEGORIAS_IPCA (fonte única de verdade da
 * lista dos 9 grupos oficiais do IBGE, ver docs/MAPA-DE-DADOS.md §8.3.7).
 */
const GRUPOS_IPCA_VALORES = CATEGORIAS_IPCA.map((c) => c.valor) as [string, ...string[]];

export const pesoIpcaGrupoSchema = z
  .object({
    grupo: z.enum(GRUPOS_IPCA_VALORES),
    peso_pct: z.number({ error: "Informe o peso (%)" }).min(0, "Peso não pode ser negativo"),
    vigencia_inicio: z.string().min(1, "Informe o início da vigência"),
    vigencia_fim: z
      .union([z.string(), z.literal("")])
      .transform((v) => (v ? v : null)),
    metodologia: z
      .union([z.string(), z.literal("")])
      .transform((v) => (v ? v : null)),
  })
  .refine((d) => d.vigencia_fim === null || d.vigencia_fim >= d.vigencia_inicio, {
    message: "Fim da vigência não pode ser antes do início",
    path: ["vigencia_fim"],
  });
export type PesoIpcaGrupoForm = z.infer<typeof pesoIpcaGrupoSchema>;

export const metaInflacaoSchema = z
  .object({
    meta_central: z.number({ error: "Informe a meta central" }),
    banda_inferior: z.number({ error: "Informe o limite inferior da banda" }),
    banda_superior: z.number({ error: "Informe o limite superior da banda" }),
    vigencia_inicio: z.string().min(1, "Informe o início da vigência"),
    vigencia_fim: z
      .union([z.string(), z.literal("")])
      .transform((v) => (v ? v : null)),
  })
  .refine((d) => d.vigencia_fim === null || d.vigencia_fim >= d.vigencia_inicio, {
    message: "Fim da vigência não pode ser antes do início",
    path: ["vigencia_fim"],
  })
  .refine((d) => d.banda_inferior <= d.meta_central && d.meta_central <= d.banda_superior, {
    message: "A meta central precisa estar entre os limites inferior e superior da banda",
    path: ["banda_superior"],
  });
export type MetaInflacaoForm = z.infer<typeof metaInflacaoSchema>;
