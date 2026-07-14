import { z } from "zod";

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
