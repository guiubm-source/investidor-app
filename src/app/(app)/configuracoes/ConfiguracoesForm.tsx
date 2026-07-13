"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  dadosPessoaisEditavelSchema,
  trocarSenhaSchema,
  type DadosPessoaisEditavel,
  type TrocarSenhaForm,
} from "@/lib/suitability/schema";
import SuitabilityWizard from "@/components/suitability/SuitabilityWizard";
import {
  salvarDadosPessoaisConfig,
  trocarSenha,
  type DadosConfiguracoes,
} from "./actions";

const NOMES_PERFIL: Record<string, string> = {
  conservador: "Conservador",
  moderado: "Moderado",
  arrojado: "Arrojado",
};

export default function ConfiguracoesForm({
  dadosIniciais,
}: {
  dadosIniciais: DadosConfiguracoes;
}) {
  const [dados, setDados] = useState(dadosIniciais);

  return (
    <div className="space-y-6">
      <SecaoDadosPessoais dados={dados} onSalvo={(novo) => setDados({ ...dados, perfil: novo })} />
      <SecaoPerfilInvestidor dados={dados} onAtualizado={(s) => setDados({ ...dados, suitability: s })} />
      <SecaoSeguranca dados={dados} onSenhaDefinida={() => setDados({ ...dados, temSenha: true })} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dados pessoais
// ---------------------------------------------------------------------------
function SecaoDadosPessoais({
  dados,
  onSalvo,
}: {
  dados: DadosConfiguracoes;
  onSalvo: (novo: DadosConfiguracoes["perfil"]) => void;
}) {
  const [sucesso, setSucesso] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<DadosPessoaisEditavel>({
    resolver: zodResolver(dadosPessoaisEditavelSchema),
    defaultValues: {
      full_name: dados.perfil.full_name ?? "",
      birth_date: dados.perfil.birth_date ?? "",
      phone: dados.perfil.phone ?? "",
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    setSucesso(false);
    const resultado = await salvarDadosPessoaisConfig(data);
    if (resultado.error) {
      setError("root", { message: resultado.error });
      return;
    }
    onSalvo({ ...dados.perfil, ...data });
    setSucesso(true);
  });

  return (
    <section className="card p-6">
      <h2 className="text-lg font-medium text-ink mb-1">Dados pessoais</h2>
      <p className="text-sm text-muted mb-5">
        Nome, data de nascimento e telefone podem ser atualizados a qualquer momento.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">Email</label>
          <input value={dados.email} disabled className="input opacity-60 cursor-not-allowed" />
          <p className="text-xs text-faint mt-1">O email de login não pode ser alterado.</p>
        </div>

        <div>
          <label className="label">CPF</label>
          <input value={dados.perfil.cpf ?? ""} disabled className="input opacity-60 cursor-not-allowed" />
          <p className="text-xs text-faint mt-1">O CPF não pode ser alterado depois do cadastro.</p>
        </div>

        <div>
          <label className="label">Nome completo</label>
          <input {...register("full_name")} className="input" />
          {errors.full_name?.message && <p className="field-error">{errors.full_name.message}</p>}
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
        {sucesso && <p className="success-box">Dados atualizados.</p>}

        <button type="submit" disabled={isSubmitting} className="btn btn-primary">
          {isSubmitting ? "Salvando..." : "Salvar alterações"}
        </button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Perfil de investidor (suitability)
// ---------------------------------------------------------------------------
function SecaoPerfilInvestidor({
  dados,
  onAtualizado,
}: {
  dados: DadosConfiguracoes;
  onAtualizado: (s: DadosConfiguracoes["suitability"]) => void;
}) {
  const [refazendo, setRefazendo] = useState(false);

  if (refazendo) {
    return (
      <section className="card p-6">
        <SuitabilityWizard
          onCancelar={() => setRefazendo(false)}
          onConcluido={(perfil) => {
            onAtualizado(
              perfil
                ? { perfil_resultado: perfil, score: 0, created_at: new Date().toISOString() }
                : dados.suitability
            );
            setRefazendo(false);
          }}
        />
      </section>
    );
  }

  const dataFormatada = dados.suitability
    ? new Date(dados.suitability.created_at).toLocaleDateString("pt-BR")
    : null;

  return (
    <section className="card p-6">
      <h2 className="text-lg font-medium text-ink mb-1">Perfil de investidor</h2>
      <p className="text-sm text-muted mb-5">
        Resultado do seu questionário de suitability (perfil de risco).
      </p>

      {dados.suitability ? (
        <div className="flex items-center justify-between rounded-md bg-surface-2 border border-border px-4 py-3 mb-5">
          <div>
            <p className="text-xs text-faint mb-0.5">Perfil atual</p>
            <p className="text-ink font-medium capitalize">
              {NOMES_PERFIL[dados.suitability.perfil_resultado] ?? dados.suitability.perfil_resultado}
            </p>
          </div>
          {dataFormatada && (
            <p className="text-xs text-faint">Avaliado em {dataFormatada}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted mb-5">Você ainda não tem uma avaliação de perfil.</p>
      )}

      <button onClick={() => setRefazendo(true)} className="btn btn-secondary">
        Refazer avaliação de perfil
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Segurança
// ---------------------------------------------------------------------------
function SecaoSeguranca({
  dados,
  onSenhaDefinida,
}: {
  dados: DadosConfiguracoes;
  onSenhaDefinida: () => void;
}) {
  const [sucesso, setSucesso] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
    reset,
  } = useForm<TrocarSenhaForm>({ resolver: zodResolver(trocarSenhaSchema) });

  const onSubmit = handleSubmit(async (data) => {
    setSucesso(false);
    const resultado = await trocarSenha(data);
    if (resultado.error) {
      setError("root", { message: resultado.error });
      return;
    }
    onSenhaDefinida();
    setSucesso(true);
    reset();
  });

  return (
    <section className="card p-6">
      <h2 className="text-lg font-medium text-ink mb-1">Segurança</h2>
      <p className="text-sm text-muted mb-5">
        {dados.conectadoGoogle
          ? "Sua conta está conectada ao Google."
          : "Sua conta usa email e senha."}
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">{dados.temSenha ? "Nova senha" : "Definir senha"}</label>
          <input
            type="password"
            autoComplete="new-password"
            {...register("novaSenha")}
            className="input"
          />
          {errors.novaSenha?.message && <p className="field-error">{errors.novaSenha.message}</p>}
        </div>

        <div>
          <label className="label">Confirmar senha</label>
          <input
            type="password"
            autoComplete="new-password"
            {...register("confirmarNovaSenha")}
            className="input"
          />
          {errors.confirmarNovaSenha?.message && (
            <p className="field-error">{errors.confirmarNovaSenha.message}</p>
          )}
        </div>

        {!dados.temSenha && (
          <p className="text-xs text-faint">
            Depois de definida, você também poderá entrar com email e senha, além do Google.
          </p>
        )}

        {errors.root?.message && <p className="error-box">{errors.root.message}</p>}
        {sucesso && <p className="success-box">Senha atualizada.</p>}

        <button type="submit" disabled={isSubmitting} className="btn btn-primary">
          {isSubmitting ? "Salvando..." : dados.temSenha ? "Trocar senha" : "Definir senha"}
        </button>
      </form>
    </section>
  );
}
