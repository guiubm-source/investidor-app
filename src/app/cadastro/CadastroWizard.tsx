"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";

import {
  contaSchema,
  dadosPessoaisSchema,
  type ContaForm,
  type DadosPessoais,
} from "@/lib/suitability/schema";
import {
  criarConta,
  criarContaComGoogle,
  salvarDadosPessoais,
  type StatusCadastro,
} from "./actions";
import SuitabilityWizard from "@/components/suitability/SuitabilityWizard";

type Step =
  | "conta"
  | "confirmarEmail"
  | "pessoais"
  | "perfil"
  | "resultado";

const ETAPAS_VISIVEIS: { step: Step; label: string }[] = [
  { step: "pessoais", label: "Dados pessoais" },
  { step: "perfil", label: "Perfil de investidor" },
];

function stepInicial(status: StatusCadastro): Step {
  if (!status.autenticado) return "conta";
  if (!status.emailConfirmado) return "confirmarEmail";
  if (!status.dadosPessoaisPreenchidos) return "pessoais";
  return "perfil";
}

export default function CadastroWizard({
  statusInicial,
}: {
  statusInicial: StatusCadastro;
}) {
  const [step, setStep] = useState<Step>(() => stepInicial(statusInicial));
  const [emailCadastro, setEmailCadastro] = useState(statusInicial.email ?? "");
  const [perfilResultado, setPerfilResultado] = useState<string | null>(null);

  const indiceEtapaAtual = ETAPAS_VISIVEIS.findIndex((e) => e.step === step);

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="w-full max-w-lg mx-auto">
        {indiceEtapaAtual >= 0 && <Progresso etapaAtual={indiceEtapaAtual} />}

        <div className="card p-8 mt-4">
          {step === "conta" && (
            <StepConta
              onSucesso={(email, sessaoCriada) => {
                setEmailCadastro(email);
                setStep(sessaoCriada ? "pessoais" : "confirmarEmail");
              }}
            />
          )}

          {step === "confirmarEmail" && (
            <StepConfirmarEmail email={emailCadastro} />
          )}

          {step === "pessoais" && (
            <StepDadosPessoais onSucesso={() => setStep("perfil")} />
          )}

          {step === "perfil" && (
            <SuitabilityWizard
              onConcluido={(perfil) => {
                setPerfilResultado(perfil);
                setStep("resultado");
              }}
            />
          )}

          {step === "resultado" && <StepResultado perfil={perfilResultado} />}
        </div>
      </div>
    </div>
  );
}

function Progresso({ etapaAtual }: { etapaAtual: number }) {
  return (
    <div>
      <div className="flex justify-between mb-2">
        {ETAPAS_VISIVEIS.map((e, i) => (
          <span
            key={e.step}
            className={`text-xs font-medium ${
              i <= etapaAtual ? "text-ink" : "text-faint"
            }`}
          >
            {e.label}
          </span>
        ))}
      </div>
      <div className="h-1.5 w-full bg-surface-2 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent transition-all"
          style={{
            width: `${((etapaAtual + 1) / ETAPAS_VISIVEIS.length) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etapa: criação de conta
// ---------------------------------------------------------------------------
function StepConta({
  onSucesso,
}: {
  onSucesso: (email: string, sessaoCriada: boolean) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<ContaForm>({ resolver: zodResolver(contaSchema) });

  const onSubmit = handleSubmit(async (data) => {
    const resultado = await criarConta({
      email: data.email,
      password: data.password,
    });
    if (resultado.error) {
      setError("root", { message: resultado.error });
      return;
    }
    onSucesso(data.email, resultado.sessaoCriada);
  });

  return (
    <div>
      <h1 className="text-2xl font-medium text-ink mb-1">
        Criar conta de investidor
      </h1>
      <p className="text-sm text-muted mb-6">
        Vamos começar pelo acesso à sua conta.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">Email</label>
          <input type="email" autoComplete="email" {...register("email")} className="input" />
          {errors.email?.message && <p className="field-error">{errors.email.message}</p>}
        </div>

        <div>
          <label className="label">Senha</label>
          <input
            type="password"
            autoComplete="new-password"
            {...register("password")}
            className="input"
          />
          {errors.password?.message && <p className="field-error">{errors.password.message}</p>}
        </div>

        <div>
          <label className="label">Confirmar senha</label>
          <input
            type="password"
            autoComplete="new-password"
            {...register("confirmarPassword")}
            className="input"
          />
          {errors.confirmarPassword?.message && (
            <p className="field-error">{errors.confirmarPassword.message}</p>
          )}
        </div>

        {errors.root?.message && <p className="error-box">{errors.root.message}</p>}

        <button type="submit" disabled={isSubmitting} className="btn btn-primary w-full">
          {isSubmitting ? "Criando conta..." : "Criar conta e continuar"}
        </button>
      </form>

      <div className="flex items-center gap-3 my-5">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-faint">ou</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form action={criarContaComGoogle}>
        <button type="submit" className="btn btn-secondary w-full">
          Continuar com Google
        </button>
      </form>

      <p className="text-sm text-muted text-center mt-6">
        Já tem conta?{" "}
        <Link href="/login" className="text-ink font-medium hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}

function StepConfirmarEmail({ email }: { email: string }) {
  const router = useRouter();
  return (
    <div className="text-center py-6">
      <h1 className="text-2xl font-medium text-ink mb-2">
        Confirme seu email
      </h1>
      <p className="text-sm text-muted">
        Enviamos um link de confirmação para <strong className="text-ink">{email || "seu email"}</strong>.
        Depois de confirmar, volte a esta página para continuar o cadastro.
      </p>
      <button onClick={() => router.refresh()} className="btn btn-primary mt-6">
        Já confirmei, continuar
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etapa: dados pessoais
// ---------------------------------------------------------------------------
function StepDadosPessoais({ onSucesso }: { onSucesso: () => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<DadosPessoais>({ resolver: zodResolver(dadosPessoaisSchema) });

  const onSubmit = handleSubmit(async (data) => {
    const resultado = await salvarDadosPessoais(data);
    if (resultado.error) {
      setError("root", { message: resultado.error });
      return;
    }
    onSucesso();
  });

  return (
    <div>
      <h1 className="text-2xl font-medium text-ink mb-1">Dados pessoais</h1>
      <p className="text-sm text-muted mb-6">
        Precisamos confirmar sua identidade como investidor.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">Nome completo</label>
          <input {...register("full_name")} className="input" />
          {errors.full_name?.message && <p className="field-error">{errors.full_name.message}</p>}
        </div>

        <div>
          <label className="label">CPF (somente números)</label>
          <input
            {...register("cpf")}
            inputMode="numeric"
            maxLength={11}
            placeholder="00000000000"
            className="input"
          />
          {errors.cpf?.message && <p className="field-error">{errors.cpf.message}</p>}
          <p className="text-xs text-faint mt-1">
            O CPF não pode ser alterado depois de salvo.
          </p>
        </div>

        <div>
          <label className="label">Data de nascimento</label>
          <input type="date" {...register("birth_date")} className="input" />
          {errors.birth_date?.message && <p className="field-error">{errors.birth_date.message}</p>}
        </div>

        <div>
          <label className="label">Telefone (com DDD)</label>
          <input {...register("phone")} placeholder="(11) 90000-0000" className="input" />
          {errors.phone?.message && <p className="field-error">{errors.phone.message}</p>}
        </div>

        {errors.root?.message && <p className="error-box">{errors.root.message}</p>}

        <button type="submit" disabled={isSubmitting} className="btn btn-primary w-full">
          {isSubmitting ? "Salvando..." : "Continuar"}
        </button>
      </form>
    </div>
  );
}

function StepResultado({ perfil }: { perfil: string | null }) {
  const nomes: Record<string, string> = {
    conservador: "Conservador",
    moderado: "Moderado",
    arrojado: "Arrojado",
  };
  const descricoes: Record<string, string> = {
    conservador:
      "Você prioriza a segurança do capital investido e prefere investimentos de baixo risco e alta previsibilidade.",
    moderado:
      "Você aceita algum risco em busca de melhores retornos, equilibrando segurança e rentabilidade.",
    arrojado:
      "Você tem maior tolerância a oscilações e busca retornos mais altos no longo prazo, aceitando maior risco.",
  };

  return (
    <div className="text-center py-4">
      <h1 className="text-2xl font-medium text-ink mb-2">
        Cadastro concluído
      </h1>
      {perfil && (
        <>
          <p className="text-sm text-muted mb-4">Seu perfil de investidor é:</p>
          <div className="inline-block rounded-full bg-accent-soft text-success px-5 py-2 text-lg font-medium mb-4">
            {nomes[perfil] ?? perfil}
          </div>
          <p className="text-sm text-muted max-w-sm mx-auto">
            {descricoes[perfil]}
          </p>
        </>
      )}
      <Link href="/dashboard" className="btn btn-primary inline-block mt-8">
        Ir para o painel
      </Link>
    </div>
  );
}
