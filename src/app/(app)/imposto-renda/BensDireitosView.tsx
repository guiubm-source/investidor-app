"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  bemManualSchema,
  type BemManualForm,
  type BemManualFormInput,
} from "@/lib/ir/schema";
import {
  obterBensDireitosIR,
  criarBemManualIR,
  atualizarBemManualIR,
  excluirBemManualIR,
  type BensDireitosUI,
  type ItemBensDireitosUI,
} from "@/lib/ir/actions";
import type { GrupoCodigoBensDireitos } from "@/lib/ir/motores/bens-direitos";
import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/components/ToastProvider";

const formatarMoeda = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const VALORES_PADRAO: BemManualFormInput = {
  grupo: "",
  codigo: "",
  nome: "",
  localizacao: "",
  cpf_cnpj: "",
  discriminacao: "",
  situacao_anterior: 0,
  situacao_atual: 0,
  observacoes: "",
  status_revisao: "pendente",
};

function FormBemManual({
  tabelaGrupos,
  valoresIniciais,
  onSalvar,
  onCancelar,
}: {
  tabelaGrupos: GrupoCodigoBensDireitos[];
  valoresIniciais?: BemManualFormInput;
  onSalvar: (dados: BemManualForm) => Promise<void>;
  onCancelar: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<BemManualFormInput, unknown, BemManualForm>({
    resolver: zodResolver(bemManualSchema),
    defaultValues: valoresIniciais ?? VALORES_PADRAO,
  });

  const onSubmit = handleSubmit(async (dados) => {
    await onSalvar(dados);
  });

  return (
    <form onSubmit={onSubmit} className="card p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Grupo/código</label>
          <select {...register("grupo")} className="input">
            <option value="">Selecione...</option>
            {[...new Map(tabelaGrupos.map((g) => [g.grupo, g])).keys()].map((grupo) => (
              <option key={grupo} value={grupo}>
                Grupo {grupo}
              </option>
            ))}
          </select>
          {errors.grupo?.message && <p className="field-error">{errors.grupo.message}</p>}
        </div>
        <div>
          <label className="label">Código</label>
          <select {...register("codigo")} className="input">
            <option value="">Selecione...</option>
            {tabelaGrupos.map((g) => (
              <option key={`${g.grupo}-${g.codigo}`} value={g.codigo}>
                {g.grupo}-{g.codigo} — {g.label}
              </option>
            ))}
          </select>
          {errors.codigo?.message && <p className="field-error">{errors.codigo.message}</p>}
        </div>
      </div>

      <div>
        <label className="label">Nome/descrição</label>
        <input {...register("nome")} className="input" placeholder="Ex: Apartamento Rua X, Conta corrente Banco Y" />
        {errors.nome?.message && <p className="field-error">{errors.nome.message}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Localização (opcional)</label>
          <input {...register("localizacao")} className="input" placeholder="Cidade/UF ou país" />
        </div>
        <div>
          <label className="label">CPF/CNPJ (opcional)</label>
          <input {...register("cpf_cnpj")} className="input" />
        </div>
      </div>

      <div>
        <label className="label">Discriminação sugerida (opcional)</label>
        <textarea {...register("discriminacao")} className="input" rows={2} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Situação em 31/12 do ano anterior</label>
          <input
            type="number"
            step="0.01"
            {...register("situacao_anterior", { valueAsNumber: true })}
            className="input"
          />
        </div>
        <div>
          <label className="label">Situação em 31/12 do ano atual</label>
          <input type="number" step="0.01" {...register("situacao_atual", { valueAsNumber: true })} className="input" />
        </div>
      </div>

      <div>
        <label className="label">Observações (opcional)</label>
        <textarea {...register("observacoes")} className="input" rows={2} />
      </div>

      <div>
        <label className="label">Status de revisão</label>
        <select {...register("status_revisao")} className="input w-48">
          <option value="pendente">Pendente</option>
          <option value="revisado">Revisado</option>
        </select>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={isSubmitting} className="btn btn-primary">
          Salvar
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function LinhaItem({
  item,
  onEditar,
  onExcluir,
}: {
  item: ItemBensDireitosUI;
  onEditar: () => void;
  onExcluir: () => void;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr_100px_120px_120px_90px] gap-2 items-center px-4 py-2 text-xs border-b border-border last:border-0">
      <span className="text-muted">
        {item.grupo}-{item.codigo}
      </span>
      <span className="text-ink truncate" title={item.discriminacao ?? undefined}>
        {item.nome}
        {item.origem === "investimento" && (
          <span
            className="ml-2 inline-block rounded-full bg-accent/10 text-accent px-1.5 py-0.5 text-[9px] align-middle"
            title="Calculado automaticamente a partir da Carteira (custo de aquisição, não valor de mercado)."
          >
            auto
          </span>
        )}
      </span>
      <span className="text-muted truncate">{item.localizacao ?? "—"}</span>
      <span className="text-right text-ink">{formatarMoeda(item.situacaoAnterior)}</span>
      <span className="text-right text-ink">{formatarMoeda(item.situacaoAtual)}</span>
      {item.origem === "manual" ? (
        <span className="flex justify-end gap-2">
          <button onClick={onEditar} className="text-faint hover:text-ink">
            Editar
          </button>
          <button onClick={onExcluir} className="text-faint hover:text-danger">
            Excluir
          </button>
        </span>
      ) : (
        <span />
      )}
    </div>
  );
}

export default function BensDireitosView({
  bensInicial,
  tabelaGrupos,
  declaracaoId,
  anoCalendario,
}: {
  bensInicial: BensDireitosUI;
  tabelaGrupos: GrupoCodigoBensDireitos[] | null;
  declaracaoId: string;
  anoCalendario: number;
}) {
  const [bens, setBens] = useState(bensInicial);
  const [adicionando, setAdicionando] = useState(false);
  const [editando, setEditando] = useState<ItemBensDireitosUI | null>(null);
  const [excluindo, setExcluindo] = useState<ItemBensDireitosUI | null>(null);
  const [excluindoLoading, setExcluindoLoading] = useState(false);
  const toast = useToast();

  const recarregar = async () => {
    const novo = await obterBensDireitosIR(declaracaoId, anoCalendario);
    setBens(novo);
  };

  if (!tabelaGrupos) {
    return (
      <p className="text-sm text-faint">
        A tabela de grupos/códigos de Bens e Direitos ainda não está cadastrada pro exercício corrente — fale com
        quem administra a fundação de regras do app.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-surface-2 border border-border px-3 py-2 text-xs text-muted">
        Situação patrimonial pelo <strong>custo de aquisição acumulado</strong>, nunca valor de mercado — mesmo
        critério usado pela Receita Federal. Itens marcados <strong>auto</strong> vêm da Carteira e são
        recalculados sempre que a tela é aberta; os demais são mantidos manualmente aqui.
      </div>

      {bens.ativosComPendencia.length > 0 && (
        <div className="rounded-md bg-danger-soft border border-border px-3 py-2 text-xs text-danger">
          {bens.ativosComPendencia.length} ativo(s) internacional(is) excluído(s) por falta de câmbio cadastrado em
          alguma transação: {bens.ativosComPendencia.map((a) => a.ativoTicker).join(", ")}.
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <p className="text-xs text-faint">Itens</p>
          {!adicionando && !editando && (
            <button onClick={() => setAdicionando(true)} className="text-xs text-accent hover:underline">
              + Adicionar item manual
            </button>
          )}
        </div>

        <div className="grid grid-cols-[80px_1fr_100px_120px_120px_90px] gap-2 px-4 py-2 text-xs text-faint border-b border-border">
          <span>Grupo</span>
          <span>Nome</span>
          <span>Local</span>
          <span className="text-right">Ano anterior</span>
          <span className="text-right">Ano atual</span>
          <span />
        </div>

        {bens.itens.length === 0 && (
          <p className="text-sm text-faint px-4 py-4">Nenhum item cadastrado ainda.</p>
        )}

        {bens.itens.map((item, i) => (
          <LinhaItem
            key={item.manualId ?? item.ativoId ?? i}
            item={item}
            onEditar={() => setEditando(item)}
            onExcluir={() => setExcluindo(item)}
          />
        ))}
      </div>

      {adicionando && (
        <FormBemManual
          tabelaGrupos={tabelaGrupos}
          onCancelar={() => setAdicionando(false)}
          onSalvar={async (dados) => {
            try {
              const resultado = await criarBemManualIR(declaracaoId, dados);
              if (resultado.error) throw new Error(resultado.error);
              setAdicionando(false);
              await recarregar();
              toast.success("Item adicionado.");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
            }
          }}
        />
      )}

      {editando && (
        <FormBemManual
          tabelaGrupos={tabelaGrupos}
          valoresIniciais={{
            grupo: editando.grupo,
            codigo: editando.codigo,
            nome: editando.nome,
            localizacao: editando.localizacao ?? "",
            cpf_cnpj: editando.cpfCnpj ?? "",
            discriminacao: editando.discriminacao ?? "",
            situacao_anterior: editando.situacaoAnterior,
            situacao_atual: editando.situacaoAtual,
            observacoes: editando.observacoes ?? "",
            status_revisao: editando.statusRevisao ?? "pendente",
          }}
          onCancelar={() => setEditando(null)}
          onSalvar={async (dados) => {
            if (!editando.manualId) return;
            try {
              const resultado = await atualizarBemManualIR(editando.manualId, dados);
              if (resultado.error) throw new Error(resultado.error);
              setEditando(null);
              await recarregar();
              toast.success("Item atualizado.");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
            }
          }}
        />
      )}

      {excluindo && (
        <ConfirmModal
          title={`Excluir "${excluindo.nome}"?`}
          message="Essa ação não pode ser desfeita."
          loading={excluindoLoading}
          onCancel={() => setExcluindo(null)}
          onConfirm={async () => {
            if (!excluindo.manualId) return;
            setExcluindoLoading(true);
            await excluirBemManualIR(excluindo.manualId);
            setExcluindoLoading(false);
            setExcluindo(null);
            await recarregar();
            toast.success("Item excluído.");
          }}
        />
      )}
    </div>
  );
}
