import { z } from "zod";

/**
 * Validação dos dados pessoais (etapa 2 do cadastro).
 * CPF: validamos apenas formato aqui (11 dígitos). Para produção, recomenda-se
 * validar o dígito verificador do CPF antes de gravar.
 */
export const dadosPessoaisSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(5, "Informe o nome completo"),
  cpf: z
    .string()
    .trim()
    .regex(/^\d{11}$/, "CPF deve conter 11 dígitos (somente números)"),
  birth_date: z
    .string()
    .refine((v) => {
      const data = new Date(v);
      const idade = (Date.now() - data.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      return idade >= 18;
    }, "É necessário ser maior de 18 anos"),
  phone: z
    .string()
    .trim()
    .min(10, "Informe um telefone válido com DDD"),
});
export type DadosPessoais = z.infer<typeof dadosPessoaisSchema>;

/**
 * Dados pessoais editáveis em Configurações. O CPF fica de fora de propósito:
 * é identidade do investidor e não pode ser alterado pelo próprio usuário
 * depois do cadastro (só via suporte, direto no banco).
 */
export const dadosPessoaisEditavelSchema = dadosPessoaisSchema.omit({ cpf: true });
export type DadosPessoaisEditavel = z.infer<typeof dadosPessoaisEditavelSchema>;

/**
 * Validação da situação financeira (etapa 3).
 * Os campos numéricos são preenchidos via <input type="number" /> com
 * `valueAsNumber: true` no register() do react-hook-form, então o valor
 * que chega aqui já é number (ou NaN se vazio/ inválido).
 */
export const situacaoFinanceiraSchema = z.object({
  renda_mensal: z.number().min(0, "Informe um valor válido"),
  patrimonio_total: z.number().min(0, "Informe um valor válido"),
  percentual_patrimonio_a_investir: z
    .number()
    .min(0, "Informe um valor válido")
    .max(100, "Deve ser entre 0 e 100"),
  necessidade_liquidez: z.enum(["imediata", "ate_1_ano", "sem_necessidade"]),
});
export type SituacaoFinanceira = z.infer<typeof situacaoFinanceiraSchema>;

/**
 * Objetivos e horizonte de investimento (etapa 4).
 */
export const objetivosSchema = z.object({
  objetivo_investimento: z.enum([
    "preservacao_capital",
    "geracao_renda",
    "crescimento_patrimonio",
    "especulacao",
  ]),
  horizonte_investimento: z.enum(["curto_prazo", "medio_prazo", "longo_prazo"]),
});
export type Objetivos = z.infer<typeof objetivosSchema>;

/**
 * Conhecimento e experiência com produtos financeiros (etapa 5).
 */
export const experienciaSchema = z.object({
  conhecimento_mercado: z.enum(["nenhum", "basico", "intermediario", "avancado"]),
  experiencia_renda_fixa: z.enum(["nenhuma", "pouca", "moderada", "ampla"]),
  experiencia_fundos: z.enum(["nenhuma", "pouca", "moderada", "ampla"]),
  experiencia_acoes: z.enum(["nenhuma", "pouca", "moderada", "ampla"]),
  experiencia_derivativos: z.enum(["nenhuma", "pouca", "moderada", "ampla"]),
});
export type Experiencia = z.infer<typeof experienciaSchema>;

/**
 * Tolerância a risco e perdas (etapa 6).
 */
export const toleranciaRiscoSchema = z.object({
  tolerancia_perda: z.enum(["baixa", "media", "alta"]),
  percentual_perda_aceitavel: z
    .number()
    .min(0, "Informe um valor válido")
    .max(100),
  reacao_a_perda: z.enum([
    "venderia_tudo",
    "venderia_parte",
    "manteria",
    "compraria_mais",
  ]),
});
export type ToleranciaRisco = z.infer<typeof toleranciaRiscoSchema>;

/** União de todas as etapas do questionário de suitability. */
export const suitabilityCompletoSchema = objetivosSchema
  .merge(situacaoFinanceiraSchema)
  .merge(experienciaSchema)
  .merge(toleranciaRiscoSchema);
export type SuitabilityCompleto = z.infer<typeof suitabilityCompletoSchema>;

export const contaSchema = z
  .object({
    email: z.string().trim().email("Email inválido"),
    password: z.string().min(8, "Mínimo de 8 caracteres"),
    confirmarPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmarPassword, {
    message: "As senhas não coincidem",
    path: ["confirmarPassword"],
  });
export type ContaForm = z.infer<typeof contaSchema>;

/**
 * Trocar ou definir senha (aba Configurações > Segurança).
 * Serve tanto para quem já tem senha (troca) quanto para quem entrou via
 * Google e ainda não definiu uma (o Supabase aceita nos dois casos).
 */
export const trocarSenhaSchema = z
  .object({
    novaSenha: z.string().min(8, "Mínimo de 8 caracteres"),
    confirmarNovaSenha: z.string(),
  })
  .refine((data) => data.novaSenha === data.confirmarNovaSenha, {
    message: "As senhas não coincidem",
    path: ["confirmarNovaSenha"],
  });
export type TrocarSenhaForm = z.infer<typeof trocarSenhaSchema>;
