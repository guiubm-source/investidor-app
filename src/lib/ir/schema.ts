import { z } from "zod";

/**
 * Questionário inicial (§8.32.12) — fase 1 cobre só os campos que já têm
 * tabela própria (`ir_perfis_fiscais`). As demais perguntas do questionário
 * completo (renda de trabalho, aluguel, atividade rural, bens, dívidas
 * etc.) entram junto dos módulos manuais correspondentes em fases futuras
 * (§8.32.20) — não faz sentido perguntar algo que nenhum motor/tabela ainda
 * processa.
 */
export const perfilFiscalSchema = z.object({
  residente_brasil: z.boolean(),
  residente_desde: z.union([z.string(), z.literal("")]).transform((v) => (v ? v : null)),
  saida_definitiva: z.boolean(),
  us_person: z.boolean(),
  cidadania_eua: z.boolean(),
  green_card: z.boolean(),
  nonresident_alien: z.boolean(),
  dias_presenca_eua: z.union([z.number(), z.nan(), z.literal("")]).transform((v) => {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    return null;
  }),
  possui_dependentes: z.boolean(),
  declaracao_conjunta: z.boolean(),
  possui_trust: z.boolean(),
  possui_controlada_exterior: z.boolean(),
});
export type PerfilFiscalForm = z.infer<typeof perfilFiscalSchema>;
/** Forma RAW do formulário (antes do `.transform()`) — usada pelo `useForm` no client, mesmo padrão de `ProventoFormInput` em ProventosView.tsx. */
export type PerfilFiscalFormInput = z.input<typeof perfilFiscalSchema>;
