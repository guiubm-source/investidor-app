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
import {
  bacenDiretorSchema,
  brasilPresidenteSchema,
  type BacenDiretorForm,
  type BrasilPresidenteForm,
} from "@/lib/referencia/schema";
import {
  criarDiretorBacen,
  criarPresidenteBrasil,
  editarDiretorBacen,
  editarPresidenteBrasil,
  excluirDiretorBacen,
  excluirPresidenteBrasil,
  obterDiretoriaBacen,
  obterPresidentesBrasil,
  type DiretorBacen,
  type PresidenteBrasil,
} from "@/lib/referencia/actions";

const NOMES_PERFIL: Record<string, string> = {
  conservador: "Conservador",
  moderado: "Moderado",
  arrojado: "Arrojado",
};

export default function ConfiguracoesForm({
  dadosIniciais,
  diretoriaBacenInicial,
  presidentesBrasilInicial,
}: {
  dadosIniciais: DadosConfiguracoes;
  diretoriaBacenInicial: DiretorBacen[];
  presidentesBrasilInicial: PresidenteBrasil[];
}) {
  const [dados, setDados] = useState(dadosIniciais);
  const [diretoriaBacen, setDiretoriaBacen] = useState(diretoriaBacenInicial);
  const [presidentesBrasil, setPresidentesBrasil] = useState(presidentesBrasilInicial);

  return (
    <div className="space-y-6">
      <SecaoDadosPessoais dados={dados} onSalvo={(novo) => setDados({ ...dados, perfil: novo })} />
      <SecaoPerfilInvestidor dados={dados} onAtualizado={(s) => setDados({ ...dados, suitability: s })} />
      <SecaoSeguranca dados={dados} onSenhaDefinida={() => setDados({ ...dados, temSenha: true })} />
      <SecaoDiretoriaBacen
        diretoria={diretoriaBacen}
        onAtualizar={async () => setDiretoriaBacen(await obterDiretoriaBacen())}
      />
      <SecaoPresidentesBrasil
        presidentes={presidentesBrasil}
        onAtualizar={async () => setPresidentesBrasil(await obterPresidentesBrasil())}
      />
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

// ---------------------------------------------------------------------------
// Diretoria do Bacen — cadastro de referência (presidente + diretores, todos
// os mandatos históricos). Dado compartilhado, sem profile_id (ver
// docs/MAPA-DE-DADOS.md §8.7). Alimenta os filtros de mandato da aba
// Indicadores (Selic hoje, IPCA depois).
// ---------------------------------------------------------------------------

const formatarDataBr = (iso: string | null) => {
  if (!iso) return "atual";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

function SecaoDiretoriaBacen({
  diretoria,
  onAtualizar,
}: {
  diretoria: DiretorBacen[];
  onAtualizar: () => Promise<void>;
}) {
  const [modo, setModo] = useState<"lista" | "novo" | string>("lista");

  const salvar = async (dadosForm: BacenDiretorForm, id?: string) => {
    const resultado = id ? await editarDiretorBacen(id, dadosForm) : await criarDiretorBacen(dadosForm);
    if (resultado.error) throw new Error(resultado.error);
    setModo("lista");
    await onAtualizar();
  };

  return (
    <section className="card p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-medium text-ink">Diretoria do Bacen</h2>
        {modo === "lista" && (
          <button onClick={() => setModo("novo")} className="text-xs text-accent hover:underline">
            + Cadastrar
          </button>
        )}
      </div>
      <p className="text-sm text-muted mb-5">
        Presidente e diretores do Banco Central, todos os mandatos. Usado nos filtros de mandato do
        gráfico da Selic.
      </p>

      {modo === "novo" && (
        <div className="mb-4">
          <FormDiretorBacen onSalvar={(d) => salvar(d)} onCancelar={() => setModo("lista")} />
        </div>
      )}

      {diretoria.length === 0 ? (
        <p className="text-sm text-faint">Nenhum diretor cadastrado ainda.</p>
      ) : (
        <div className="space-y-2">
          {diretoria.map((d) => (
            <div key={d.id}>
              {modo === d.id ? (
                <FormDiretorBacen
                  inicial={d}
                  onSalvar={(dadosForm) => salvar(dadosForm, d.id)}
                  onCancelar={() => setModo("lista")}
                />
              ) : (
                <div className="flex items-center justify-between rounded-md bg-surface-2 border border-border px-3 py-2 text-sm">
                  <div>
                    <p className="text-ink font-medium">
                      {d.nome} {d.presidente && <span className="text-xs text-accent">(presidente)</span>}
                    </p>
                    <p className="text-xs text-faint">
                      {d.cargo} — {formatarDataBr(d.mandatoInicio)} a {formatarDataBr(d.mandatoFim)}
                    </p>
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button onClick={() => setModo(d.id)} className="text-xs text-accent hover:underline">
                      Editar
                    </button>
                    <button
                      onClick={async () => {
                        await excluirDiretorBacen(d.id);
                        await onAtualizar();
                      }}
                      className="text-xs text-faint hover:text-danger"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FormDiretorBacen({
  inicial,
  onSalvar,
  onCancelar,
}: {
  inicial?: DiretorBacen;
  onSalvar: (dados: BacenDiretorForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm({
    resolver: zodResolver(bacenDiretorSchema),
    defaultValues: {
      nome: inicial?.nome ?? "",
      cargo: inicial?.cargo ?? "",
      presidente: inicial?.presidente ?? false,
      mandato_inicio: inicial?.mandatoInicio ?? "",
      mandato_fim: inicial?.mandatoFim ?? "",
      nomeado_por: inicial?.nomeadoPor ?? "",
      data_posse: inicial?.dataPosse ?? "",
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvar(data);
    } catch (e) {
      setError("root", { message: e instanceof Error ? e.message : "Erro ao salvar." });
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-2 md:grid-cols-3 gap-3 rounded-md bg-surface-2 border border-border p-3"
    >
      <div>
        <label className="label">Nome</label>
        <input {...register("nome")} className="input" />
        {errors.nome?.message && <p className="field-error">{errors.nome.message}</p>}
      </div>
      <div>
        <label className="label">Cargo</label>
        <input {...register("cargo")} placeholder="Presidente, Diretor de Política Monetária…" className="input" />
        {errors.cargo?.message && <p className="field-error">{errors.cargo.message}</p>}
      </div>
      <div className="flex items-end gap-2 pb-2">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" {...register("presidente")} />
          É presidência
        </label>
      </div>
      <div>
        <label className="label">Início do mandato</label>
        <input type="date" {...register("mandato_inicio")} className="input" />
        {errors.mandato_inicio?.message && <p className="field-error">{errors.mandato_inicio.message}</p>}
      </div>
      <div>
        <label className="label">Fim do mandato (vazio = atual)</label>
        <input type="date" {...register("mandato_fim")} className="input" />
        {errors.mandato_fim?.message && <p className="field-error">{errors.mandato_fim.message}</p>}
      </div>
      <div>
        <label className="label">Data de posse</label>
        <input type="date" {...register("data_posse")} className="input" />
      </div>
      <div className="col-span-2 md:col-span-3">
        <label className="label">Nomeado por (opcional)</label>
        <input {...register("nomeado_por")} className="input" />
      </div>

      {errors.root?.message && <p className="error-box col-span-2 md:col-span-3">{errors.root.message}</p>}

      <div className="col-span-2 md:col-span-3 flex gap-2">
        <button type="button" onClick={onCancelar} className="btn btn-secondary flex-1">
          Cancelar
        </button>
        <button type="submit" disabled={isSubmitting} className="btn btn-primary flex-1">
          {isSubmitting ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Presidentes do Brasil — cadastro de referência (mandato presidencial),
// mesmo padrão da diretoria do Bacen.
// ---------------------------------------------------------------------------

function SecaoPresidentesBrasil({
  presidentes,
  onAtualizar,
}: {
  presidentes: PresidenteBrasil[];
  onAtualizar: () => Promise<void>;
}) {
  const [modo, setModo] = useState<"lista" | "novo" | string>("lista");

  const salvar = async (dadosForm: BrasilPresidenteForm, id?: string) => {
    const resultado = id ? await editarPresidenteBrasil(id, dadosForm) : await criarPresidenteBrasil(dadosForm);
    if (resultado.error) throw new Error(resultado.error);
    setModo("lista");
    await onAtualizar();
  };

  return (
    <section className="card p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-medium text-ink">Presidentes do Brasil</h2>
        {modo === "lista" && (
          <button onClick={() => setModo("novo")} className="text-xs text-accent hover:underline">
            + Cadastrar
          </button>
        )}
      </div>
      <p className="text-sm text-muted mb-5">
        Usado no filtro de mandato presidencial do gráfico da Selic.
      </p>

      {modo === "novo" && (
        <div className="mb-4">
          <FormPresidenteBrasil onSalvar={(d) => salvar(d)} onCancelar={() => setModo("lista")} />
        </div>
      )}

      {presidentes.length === 0 ? (
        <p className="text-sm text-faint">Nenhum presidente cadastrado ainda.</p>
      ) : (
        <div className="space-y-2">
          {presidentes.map((p) => (
            <div key={p.id}>
              {modo === p.id ? (
                <FormPresidenteBrasil
                  inicial={p}
                  onSalvar={(dadosForm) => salvar(dadosForm, p.id)}
                  onCancelar={() => setModo("lista")}
                />
              ) : (
                <div className="flex items-center justify-between rounded-md bg-surface-2 border border-border px-3 py-2 text-sm">
                  <div>
                    <p className="text-ink font-medium">{p.nome}</p>
                    <p className="text-xs text-faint">
                      {formatarDataBr(p.mandatoInicio)} a {formatarDataBr(p.mandatoFim)}
                    </p>
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button onClick={() => setModo(p.id)} className="text-xs text-accent hover:underline">
                      Editar
                    </button>
                    <button
                      onClick={async () => {
                        await excluirPresidenteBrasil(p.id);
                        await onAtualizar();
                      }}
                      className="text-xs text-faint hover:text-danger"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FormPresidenteBrasil({
  inicial,
  onSalvar,
  onCancelar,
}: {
  inicial?: PresidenteBrasil;
  onSalvar: (dados: BrasilPresidenteForm) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm({
    resolver: zodResolver(brasilPresidenteSchema),
    defaultValues: {
      nome: inicial?.nome ?? "",
      mandato_inicio: inicial?.mandatoInicio ?? "",
      mandato_fim: inicial?.mandatoFim ?? "",
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      await onSalvar(data);
    } catch (e) {
      setError("root", { message: e instanceof Error ? e.message : "Erro ao salvar." });
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-2 md:grid-cols-3 gap-3 rounded-md bg-surface-2 border border-border p-3"
    >
      <div>
        <label className="label">Nome</label>
        <input {...register("nome")} className="input" />
        {errors.nome?.message && <p className="field-error">{errors.nome.message}</p>}
      </div>
      <div>
        <label className="label">Início do mandato</label>
        <input type="date" {...register("mandato_inicio")} className="input" />
        {errors.mandato_inicio?.message && <p className="field-error">{errors.mandato_inicio.message}</p>}
      </div>
      <div>
        <label className="label">Fim do mandato (vazio = atual)</label>
        <input type="date" {...register("mandato_fim")} className="input" />
        {errors.mandato_fim?.message && <p className="field-error">{errors.mandato_fim.message}</p>}
      </div>

      {errors.root?.message && <p className="error-box col-span-2 md:col-span-3">{errors.root.message}</p>}

      <div className="col-span-2 md:col-span-3 flex gap-2">
        <button type="button" onClick={onCancelar} className="btn btn-secondary flex-1">
          Cancelar
        </button>
        <button type="submit" disabled={isSubmitting} className="btn btn-primary flex-1">
          {isSubmitting ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </form>
  );
}
