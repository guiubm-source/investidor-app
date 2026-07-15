"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  situacaoFinanceiraSchema,
  objetivosSchema,
  experienciaSchema,
  toleranciaRiscoSchema,
  type SituacaoFinanceira,
  type Objetivos,
  type Experiencia,
  type ToleranciaRisco,
  type SuitabilityCompleto,
} from "@/lib/suitability/schema";
import { salvarSuitability } from "@/lib/suitability/actions";
import { useToast } from "@/components/ToastProvider";

type Step = "financeiro" | "objetivos" | "experiencia" | "risco";

const ETAPAS: { step: Step; label: string }[] = [
  { step: "financeiro", label: "Situação financeira" },
  { step: "objetivos", label: "Objetivos" },
  { step: "experiencia", label: "Experiência" },
  { step: "risco", label: "Tolerância a risco" },
];

/**
 * Wizard das 4 etapas do questionário de suitability. Usado tanto no fluxo
 * de cadastro (depois dos dados pessoais) quanto em "Refazer avaliação de
 * perfil" na aba Configurações — sempre gera uma NOVA linha no histórico.
 */
export default function SuitabilityWizard({
  onConcluido,
  onCancelar,
}: {
  onConcluido: (perfil: string | null) => void;
  onCancelar?: () => void;
}) {
  const [step, setStep] = useState<Step>("financeiro");
  const [parcial, setParcial] = useState<Partial<SuitabilityCompleto>>({});

  const indiceAtual = ETAPAS.findIndex((e) => e.step === step);

  return (
    <div>
      <Progresso etapaAtual={indiceAtual} />

      <div className="mt-4">
        {step === "financeiro" && (
          <StepSituacaoFinanceira
            onCancelar={onCancelar}
            onSucesso={(dados) => {
              setParcial((prev) => ({ ...prev, ...dados }));
              setStep("objetivos");
            }}
          />
        )}

        {step === "objetivos" && (
          <StepObjetivos
            onVoltar={() => setStep("financeiro")}
            onSucesso={(dados) => {
              setParcial((prev) => ({ ...prev, ...dados }));
              setStep("experiencia");
            }}
          />
        )}

        {step === "experiencia" && (
          <StepExperiencia
            onVoltar={() => setStep("objetivos")}
            onSucesso={(dados) => {
              setParcial((prev) => ({ ...prev, ...dados }));
              setStep("risco");
            }}
          />
        )}

        {step === "risco" && (
          <StepToleranciaRisco
            onVoltar={() => setStep("experiencia")}
            onSucesso={async (dados) => {
              const completo = { ...parcial, ...dados } as SuitabilityCompleto;
              const resultado = await salvarSuitability(completo);
              if (resultado.error) {
                throw new Error(resultado.error);
              }
              onConcluido(resultado.perfilResultado ?? null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function Progresso({ etapaAtual }: { etapaAtual: number }) {
  return (
    <div>
      <div className="flex justify-between mb-2">
        {ETAPAS.map((e, i) => (
          <span
            key={e.step}
            className={`text-xs font-medium ${i <= etapaAtual ? "text-ink" : "text-faint"}`}
          >
            {e.label}
          </span>
        ))}
      </div>
      <div className="h-1.5 w-full bg-surface-2 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${((etapaAtual + 1) / ETAPAS.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

function StepSituacaoFinanceira({
  onSucesso,
  onCancelar,
}: {
  onSucesso: (dados: SituacaoFinanceira) => void;
  onCancelar?: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SituacaoFinanceira>({
    resolver: zodResolver(situacaoFinanceiraSchema),
  });

  const onSubmit = handleSubmit(async (data) => onSucesso(data));

  return (
    <div>
      <h2 className="text-xl font-medium text-ink mb-1">Situação financeira</h2>
      <p className="text-sm text-muted mb-6">
        Essas informações ajudam a definir um perfil de investidor adequado à
        sua realidade.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">Renda mensal (R$)</label>
          <input
            type="number"
            step="0.01"
            {...register("renda_mensal", { valueAsNumber: true })}
            className="input"
          />
          {errors.renda_mensal?.message && <p className="field-error">{errors.renda_mensal.message}</p>}
        </div>

        <div>
          <label className="label">Patrimônio total (R$)</label>
          <input
            type="number"
            step="0.01"
            {...register("patrimonio_total", { valueAsNumber: true })}
            className="input"
          />
          {errors.patrimonio_total?.message && (
            <p className="field-error">{errors.patrimonio_total.message}</p>
          )}
        </div>

        <div>
          <label className="label">% do patrimônio que pretende investir</label>
          <input
            type="number"
            step="1"
            min={0}
            max={100}
            {...register("percentual_patrimonio_a_investir", { valueAsNumber: true })}
            className="input"
          />
          {errors.percentual_patrimonio_a_investir?.message && (
            <p className="field-error">{errors.percentual_patrimonio_a_investir.message}</p>
          )}
        </div>

        <div>
          <label className="label">Necessidade de liquidez</label>
          <select {...register("necessidade_liquidez")} className="input">
            <option value="">Selecione</option>
            <option value="imediata">Posso precisar do dinheiro a qualquer momento</option>
            <option value="ate_1_ano">Só deve ser necessário em até 1 ano</option>
            <option value="sem_necessidade">Não deve ser necessário no curto prazo</option>
          </select>
          {errors.necessidade_liquidez?.message && (
            <p className="field-error">{errors.necessidade_liquidez.message}</p>
          )}
        </div>

        <div className="flex gap-3">
          {onCancelar && (
            <button type="button" onClick={onCancelar} className="btn btn-secondary flex-1">
              Cancelar
            </button>
          )}
          <button type="submit" disabled={isSubmitting} className="btn btn-primary flex-1">
            Continuar
          </button>
        </div>
      </form>
    </div>
  );
}

function StepObjetivos({
  onSucesso,
  onVoltar,
}: {
  onSucesso: (dados: Objetivos) => void;
  onVoltar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Objetivos>({ resolver: zodResolver(objetivosSchema) });

  const onSubmit = handleSubmit(async (data) => onSucesso(data));

  return (
    <div>
      <h2 className="text-xl font-medium text-ink mb-1">Objetivos de investimento</h2>
      <p className="text-sm text-muted mb-6">O que você busca ao investir?</p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">Objetivo principal</label>
          <select {...register("objetivo_investimento")} className="input">
            <option value="">Selecione</option>
            <option value="preservacao_capital">Preservar o capital, evitando perdas</option>
            <option value="geracao_renda">Gerar renda periódica</option>
            <option value="crescimento_patrimonio">Crescer o patrimônio no longo prazo</option>
            <option value="especulacao">Buscar ganhos rápidos, aceitando risco alto</option>
          </select>
          {errors.objetivo_investimento?.message && (
            <p className="field-error">{errors.objetivo_investimento.message}</p>
          )}
        </div>

        <div>
          <label className="label">Horizonte de investimento</label>
          <select {...register("horizonte_investimento")} className="input">
            <option value="">Selecione</option>
            <option value="curto_prazo">Curto prazo (até 1 ano)</option>
            <option value="medio_prazo">Médio prazo (1 a 3 anos)</option>
            <option value="longo_prazo">Longo prazo (mais de 3 anos)</option>
          </select>
          {errors.horizonte_investimento?.message && (
            <p className="field-error">{errors.horizonte_investimento.message}</p>
          )}
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={onVoltar} className="btn btn-secondary flex-1">
            Voltar
          </button>
          <button type="submit" disabled={isSubmitting} className="btn btn-primary flex-1">
            Continuar
          </button>
        </div>
      </form>
    </div>
  );
}

function StepExperiencia({
  onSucesso,
  onVoltar,
}: {
  onSucesso: (dados: Experiencia) => void;
  onVoltar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Experiencia>({ resolver: zodResolver(experienciaSchema) });

  const onSubmit = handleSubmit(async (data) => onSucesso(data));

  const opcoesExperiencia = (
    <>
      <option value="">Selecione</option>
      <option value="nenhuma">Nenhuma</option>
      <option value="pouca">Pouca</option>
      <option value="moderada">Moderada</option>
      <option value="ampla">Ampla</option>
    </>
  );

  return (
    <div>
      <h2 className="text-xl font-medium text-ink mb-1">Conhecimento e experiência</h2>
      <p className="text-sm text-muted mb-6">
        Conte sua experiência prévia com produtos financeiros.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">Conhecimento sobre mercado financeiro</label>
          <select {...register("conhecimento_mercado")} className="input">
            <option value="">Selecione</option>
            <option value="nenhum">Nenhum</option>
            <option value="basico">Básico</option>
            <option value="intermediario">Intermediário</option>
            <option value="avancado">Avançado</option>
          </select>
          {errors.conhecimento_mercado?.message && (
            <p className="field-error">{errors.conhecimento_mercado.message}</p>
          )}
        </div>

        <div>
          <label className="label">Experiência com Renda Fixa (CDB, Tesouro, etc.)</label>
          <select {...register("experiencia_renda_fixa")} className="input">{opcoesExperiencia}</select>
          {errors.experiencia_renda_fixa?.message && (
            <p className="field-error">{errors.experiencia_renda_fixa.message}</p>
          )}
        </div>

        <div>
          <label className="label">Experiência com Fundos de Investimento</label>
          <select {...register("experiencia_fundos")} className="input">{opcoesExperiencia}</select>
          {errors.experiencia_fundos?.message && (
            <p className="field-error">{errors.experiencia_fundos.message}</p>
          )}
        </div>

        <div>
          <label className="label">Experiência com Ações</label>
          <select {...register("experiencia_acoes")} className="input">{opcoesExperiencia}</select>
          {errors.experiencia_acoes?.message && (
            <p className="field-error">{errors.experiencia_acoes.message}</p>
          )}
        </div>

        <div>
          <label className="label">Experiência com Derivativos (opções, futuros)</label>
          <select {...register("experiencia_derivativos")} className="input">{opcoesExperiencia}</select>
          {errors.experiencia_derivativos?.message && (
            <p className="field-error">{errors.experiencia_derivativos.message}</p>
          )}
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={onVoltar} className="btn btn-secondary flex-1">
            Voltar
          </button>
          <button type="submit" disabled={isSubmitting} className="btn btn-primary flex-1">
            Continuar
          </button>
        </div>
      </form>
    </div>
  );
}

function StepToleranciaRisco({
  onSucesso,
  onVoltar,
}: {
  onSucesso: (dados: ToleranciaRisco) => Promise<void>;
  onVoltar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ToleranciaRisco>({ resolver: zodResolver(toleranciaRiscoSchema) });

  const toast = useToast();
  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSucesso(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    }
  });

  return (
    <div>
      <h2 className="text-xl font-medium text-ink mb-1">Tolerância a risco</h2>
      <p className="text-sm text-muted mb-6">
        Última etapa antes de calcularmos seu perfil de investidor.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">Tolerância a perdas</label>
          <select {...register("tolerancia_perda")} className="input">
            <option value="">Selecione</option>
            <option value="baixa">Baixa — não aceito perder valor investido</option>
            <option value="media">Média — aceito oscilações moderadas</option>
            <option value="alta">Alta — aceito perdas relevantes por mais retorno</option>
          </select>
          {errors.tolerancia_perda?.message && (
            <p className="field-error">{errors.tolerancia_perda.message}</p>
          )}
        </div>

        <div>
          <label className="label">Qual a maior perda (%) que você aceitaria em um ano?</label>
          <input
            type="number"
            step="1"
            min={0}
            max={100}
            {...register("percentual_perda_aceitavel", { valueAsNumber: true })}
            className="input"
          />
          {errors.percentual_perda_aceitavel?.message && (
            <p className="field-error">{errors.percentual_perda_aceitavel.message}</p>
          )}
        </div>

        <div>
          <label className="label">Se seus investimentos caíssem 20% em um mês, você:</label>
          <select {...register("reacao_a_perda")} className="input">
            <option value="">Selecione</option>
            <option value="venderia_tudo">Venderia tudo imediatamente</option>
            <option value="venderia_parte">Venderia parte da posição</option>
            <option value="manteria">Manteria o investimento</option>
            <option value="compraria_mais">Aproveitaria para comprar mais</option>
          </select>
          {errors.reacao_a_perda?.message && (
            <p className="field-error">{errors.reacao_a_perda.message}</p>
          )}
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={onVoltar} className="btn btn-secondary flex-1">
            Voltar
          </button>
          <button type="submit" disabled={isSubmitting} className="btn btn-primary flex-1">
            {isSubmitting ? "Calculando perfil..." : "Finalizar"}
          </button>
        </div>
      </form>
    </div>
  );
}
