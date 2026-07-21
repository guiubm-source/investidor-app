import { z } from "zod";

/** Nível 1 da estrutura-alvo desde a fase 1 da reformulação "Metas e estrutura" (§8.50/§8.51) — mesmo shape de classeSchema. */
export const macroSchema = z.object({
  nome: z.string().trim().min(1, "Informe um nome"),
  peso_alvo: z.number().min(0, "Deve ser entre 0 e 100").max(100, "Deve ser entre 0 e 100"),
});
export type MacroForm = z.infer<typeof macroSchema>;

export const classeSchema = z.object({
  nome: z.string().trim().min(1, "Informe um nome"),
  peso_alvo: z.number().min(0, "Deve ser entre 0 e 100").max(100, "Deve ser entre 0 e 100"),
});
export type ClasseForm = z.infer<typeof classeSchema>;

export const setorSchema = z.object({
  nome: z.string().trim().min(1, "Informe um nome"),
  peso_alvo: z.number().min(0, "Deve ser entre 0 e 100").max(100, "Deve ser entre 0 e 100"),
});
export type SetorForm = z.infer<typeof setorSchema>;
