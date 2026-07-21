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

/**
 * Item MANUAL de Bens e Direitos (fase 9, §8.32.20.7 — ver
 * docs/MAPA-DE-DADOS.md §8.43). Só cobre o que o app não deriva sozinho
 * (imóveis, veículos, contas, participações societárias não listadas);
 * posições de investimento nunca passam por este formulário — são
 * montadas automaticamente a partir do ledger fiscal.
 */
export const bemManualSchema = z.object({
  grupo: z.string().trim().min(1, "Selecione um grupo"),
  codigo: z.string().trim().min(1, "Selecione um código"),
  nome: z.string().trim().min(1, "Informe um nome/descrição"),
  localizacao: z.union([z.string(), z.literal("")]).transform((v) => (v ? v : null)),
  cpf_cnpj: z.union([z.string(), z.literal("")]).transform((v) => (v ? v : null)),
  discriminacao: z.union([z.string(), z.literal("")]).transform((v) => (v ? v : null)),
  situacao_anterior: z.union([z.number().min(0), z.nan()]).transform((v) => (typeof v === "number" && !Number.isNaN(v) ? v : 0)),
  situacao_atual: z.union([z.number().min(0), z.nan()]).transform((v) => (typeof v === "number" && !Number.isNaN(v) ? v : 0)),
  observacoes: z.union([z.string(), z.literal("")]).transform((v) => (v ? v : null)),
  status_revisao: z.enum(["pendente", "revisado"]).default("pendente"),
});
export type BemManualForm = z.infer<typeof bemManualSchema>;
/** Forma RAW do formulário (antes do `.transform()`) — mesmo padrão de `PerfilFiscalFormInput` acima. */
export type BemManualFormInput = z.input<typeof bemManualSchema>;
