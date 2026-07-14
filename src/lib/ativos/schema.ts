import { z } from "zod";

export const TIPOS_ATIVO = [
  { valor: "acao", label: "Ação" },
  { valor: "fii", label: "Fundo imobiliário (FII)" },
  { valor: "etf", label: "ETF (Brasil)" },
  { valor: "renda_fixa", label: "Renda fixa" },
  { valor: "fundo", label: "Fundo de investimento" },
  { valor: "internacional", label: "Internacional (ação/ETF exterior)" },
  { valor: "cripto", label: "Criptomoeda" },
  { valor: "outro", label: "Outro" },
] as const;

/**
 * Só usados pelo relatório de Imposto de Renda (ver docs/MAPA-DE-DADOS.md
 * §8.5) — distinguem, dentro de `renda_fixa` e `cripto`, subtipos que mudam
 * a tributação (LCI/LCA/CRI/CRA isentos; cripto em exchange estrangeira sem
 * isenção de piso). Sem efeito em nenhum outro cálculo do app.
 */
export const SUBTIPOS_RENDA_FIXA = [
  { valor: "cdb", label: "CDB" },
  { valor: "tesouro", label: "Tesouro Direto" },
  { valor: "debenture", label: "Debênture" },
  { valor: "lci", label: "LCI (isento)" },
  { valor: "lca", label: "LCA (isento)" },
  { valor: "cri", label: "CRI (isento)" },
  { valor: "cra", label: "CRA (isento)" },
] as const;

export const EXCHANGES_CRIPTO = [
  { valor: "nacional", label: "Exchange nacional" },
  { valor: "estrangeira", label: "Exchange estrangeira" },
] as const;

export const ativoSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1, "Informe o ticker/código")
    .transform((v) => v.toUpperCase()),
  nome: z.string().trim().optional(),
  tipo: z.enum(["acao", "fii", "etf", "renda_fixa", "fundo", "internacional", "cripto", "outro"]),
  // Selects de formulário mandam "" quando "não informado" — union com
  // z.literal("") (em vez de z.preprocess) mantém o tipo de entrada
  // explícito, o que evita conflito de tipos entre zodResolver e o generic
  // do useForm (preprocess deixa o tipo de entrada como `unknown`).
  subtipo_renda_fixa: z
    .union([z.enum(["cdb", "tesouro", "debenture", "lci", "lca", "cri", "cra"]), z.literal("")])
    .transform((v) => (v ? v : null)),
  cripto_exchange: z
    .union([z.enum(["nacional", "estrangeira"]), z.literal("")])
    .transform((v) => (v ? v : null)),
});
export type AtivoForm = z.infer<typeof ativoSchema>;

export const classificacaoSchema = z.object({
  setor_id: z.string().uuid("Selecione um setor"),
  peso_alvo: z.number().min(0, "Deve ser entre 0 e 100").max(100, "Deve ser entre 0 e 100"),
});
export type ClassificacaoForm = z.infer<typeof classificacaoSchema>;

export const precoAtualSchema = z.object({
  preco_atual: z.number().min(0, "Informe um preço válido"),
});
export type PrecoAtualForm = z.infer<typeof precoAtualSchema>;

// Vazio ("") = usar o símbolo derivado automaticamente do tipo do ativo.
export const simboloTradingviewSchema = z.object({
  simbolo_tradingview: z.string().trim(),
});
export type SimboloTradingviewForm = z.infer<typeof simboloTradingviewSchema>;

// ---------------------------------------------------------------------------
// Checklist comparativo — ver docs/MAPA-DE-DADOS.md §8.10.
// ---------------------------------------------------------------------------

/** Único campo manual do checklist que não vem de resultado_trimestral (ver §8.10 decisão 7). */
export const saldoAcionistasSchema = z.object({
  saldo_acionistas: z.string().trim(),
});
export type SaldoAcionistasForm = z.infer<typeof saldoAcionistasSchema>;

/**
 * Lançamento de um trimestre de `ativo_resultado_trimestral` — schema único
 * cobrindo os dois grupos de campos (Ações/ETF/Internacional e FIIs); cada
 * formulário na UI só preenche o grupo que faz sentido pro tipo do ativo,
 * o resto fica null. Mesmo padrão de "tabela larga com campos opcionais" já
 * usado em `ipcaCompetenciaSchema` (lib/indicadores/schema.ts).
 */
const numeroOpcional = z.union([z.number(), z.nan()]).transform((v) => (Number.isNaN(v) ? null : v));

export const resultadoTrimestralSchema = z.object({
  ano_trimestre: z
    .string()
    .regex(/^\d{4}-Q[1-4]$/, "Formato esperado: AAAA-Q1 a AAAA-Q4"),
  // Ações / ETF / Internacional
  receita_liquida: numeroOpcional,
  lucro_bruto: numeroOpcional,
  lucro_liquido: numeroOpcional,
  ebit: numeroOpcional,
  ebitda: numeroOpcional,
  patrimonio_liquido: numeroOpcional,
  ativo_total: numeroOpcional,
  ativo_circulante: numeroOpcional,
  passivo_circulante: numeroOpcional,
  divida_liquida: numeroOpcional,
  divida_bruta: numeroOpcional,
  numero_acoes: numeroOpcional,
  // FIIs
  valor_patrimonial_cota: numeroOpcional,
  numero_negocios_mes: numeroOpcional,
  vacancia_financeira_pct: numeroOpcional,
  vacancia_fisica_pct: numeroOpcional,
  receita_imobiliaria: numeroOpcional,
  valor_avaliacao_imoveis: numeroOpcional,
  valor_m2_aluguel: numeroOpcional,
});
export type ResultadoTrimestralForm = z.infer<typeof resultadoTrimestralSchema>;
