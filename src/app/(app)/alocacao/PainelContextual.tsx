"use client";

import { useState } from "react";
import Link from "next/link";
import type { ClasseForm, MacroForm, SetorForm } from "@/lib/alocacao/schema";
import {
  criarClasse,
  criarMacro,
  criarSetor,
  editarClasse,
  editarMacro,
  editarSetor,
  excluirClasse,
  excluirMacro,
  excluirSetor,
  type AcaoResultado,
  type EstruturaAlocacao,
} from "@/lib/alocacao/actions";
import { FormMacro } from "./FormMacro";
import { FormClasse } from "./FormClasse";
import { FormSetor } from "./FormSetor";
import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/components/ToastProvider";
import { RAIZ, resolverNo, statusSomaFilhos, type FilhoResolvido, type Selecao, type TipoNo } from "./arvore";

const formatarMoeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const ROTULO_TIPO: Record<Exclude<TipoNo, "raiz" | "ativo">, string> = {
  macro: "Macro",
  classe: "Classe",
  setor: "Setor",
};

const FORM_POR_TIPO = { macro: FormMacro, classe: FormClasse, setor: FormSetor } as const;

type DadosForm = MacroForm | ClasseForm | SetorForm;

async function criarFilho(paiTipo: TipoNo, paiId: string | null, filhoTipo: TipoNo, dados: DadosForm): Promise<AcaoResultado> {
  if (filhoTipo === "macro") return criarMacro(dados);
  if (filhoTipo === "classe") return criarClasse(paiId as string, dados);
  if (filhoTipo === "setor") return criarSetor(paiId as string, dados);
  return { error: "Tipo de filho inválido." };
}
async function editarNo(tipo: TipoNo, id: string, dados: DadosForm): Promise<AcaoResultado> {
  if (tipo === "macro") return editarMacro(id, dados);
  if (tipo === "classe") return editarClasse(id, dados);
  if (tipo === "setor") return editarSetor(id, dados);
  return { error: "Tipo inválido." };
}
async function excluirNo(tipo: TipoNo, id: string): Promise<AcaoResultado> {
  if (tipo === "macro") return excluirMacro(id);
  if (tipo === "classe") return excluirClasse(id);
  if (tipo === "setor") return excluirSetor(id);
  return { error: "Tipo inválido." };
}

/** Tipo do FILHO direto de cada tipo de nó pai — usado pro rótulo/formulário de "+ Adicionar". */
const FILHO_DE: Partial<Record<TipoNo, Exclude<TipoNo, "raiz" | "ativo">>> = {
  raiz: "macro",
  macro: "classe",
  classe: "setor",
};

/**
 * Editor contextual (fase 3, §8.50/§16.2.4) — coluna direita (~40%). Mostra
 * o breadcrumb, explica qual distribuição está em jogo (§16.2.4), lista os
 * filhos diretos do nó selecionado com peso local editável e peso global
 * calculado (§16.2.5/16.2.6), e oferece editar/excluir o próprio nó
 * selecionado. Ativo é sempre somente leitura aqui (§16.2.13) — a edição de
 * `setor_id`/`peso_alvo` do ativo continua exclusiva da aba Ativos.
 */
export default function PainelContextual({
  estrutura,
  selecao,
  onSelecionar,
  onChange,
}: {
  estrutura: EstruturaAlocacao;
  selecao: Selecao;
  onSelecionar: (s: Selecao) => void;
  onChange: () => void | Promise<void>;
}) {
  const [editandoNo, setEditandoNo] = useState(false);
  const [excluindoNo, setExcluindoNo] = useState(false);
  const [excluindoNoLoading, setExcluindoNoLoading] = useState(false);
  const [adicionandoFilho, setAdicionandoFilho] = useState(false);
  const [editandoFilhoId, setEditandoFilhoId] = useState<string | null>(null);
  const [excluindoFilho, setExcluindoFilho] = useState<FilhoResolvido | null>(null);
  const [excluindoFilhoLoading, setExcluindoFilhoLoading] = useState(false);
  const toast = useToast();

  const no = resolverNo(estrutura, selecao);

  if (!no) {
    return (
      <div className="card p-5">
        <p className="text-sm text-muted mb-3">
          Este item não existe mais na estrutura (foi excluído em outra janela, por exemplo).
        </p>
        <button onClick={() => onSelecionar(RAIZ)} className="btn btn-secondary text-xs py-1 px-3">
          Voltar à estrutura
        </button>
      </div>
    );
  }

  const titulo =
    no.tipo === "raiz"
      ? "Estrutura da carteira"
      : no.tipo === "macro"
        ? `Distribuir Classes de ${no.nome}`
        : no.tipo === "classe"
          ? `Distribuir Setores de ${no.nome}`
          : no.tipo === "setor"
            ? `Ativos de ${no.nome}`
            : `Ativo ${no.nome}`;

  const status = statusSomaFilhos(no.filhos);
  const rotuloFilhoNovo = FILHO_DE[no.tipo];
  const FormFilho = rotuloFilhoNovo ? FORM_POR_TIPO[rotuloFilhoNovo] : null;
  const FormNo = no.tipo !== "raiz" && no.tipo !== "ativo" ? FORM_POR_TIPO[no.tipo] : null;

  return (
    <div className="card p-5">
      {/* Breadcrumb — localização, não etapas (§16.2.3). Mostrado sempre que
          algo além da raiz está selecionado, mesmo pra Macro (que não tem
          ancestral próprio, mas ainda se beneficia do link de volta). */}
      {no.tipo !== "raiz" && (
        <div className="flex flex-wrap items-center gap-1 text-xs text-faint mb-2">
          <button onClick={() => onSelecionar(RAIZ)} className="hover:text-ink hover:underline">
            Estrutura
          </button>
          {no.caminho.map((item) => (
            <span key={item.id} className="flex items-center gap-1">
              <span>›</span>
              <button
                onClick={() => onSelecionar({ tipo: item.tipo, id: item.id })}
                className="hover:text-ink hover:underline"
              >
                {item.nome}
              </button>
            </span>
          ))}
        </div>
      )}

      <h3 className="text-sm font-medium text-ink mb-1">{titulo}</h3>

      {/* Explicação contextual (§16.2.4) */}
      {no.tipo === "raiz" && (
        <p className="text-xs text-muted mb-4">
          Defina os Macros que compõem sua carteira (ex. Brasil, Exterior). Os Macros abaixo devem
          somar 100% do patrimônio total.
        </p>
      )}
      {no.tipo === "macro" && no.pesoReal !== null && no.pesoAlvo !== null && (
        <p className="text-xs text-muted mb-4">
          Você está definindo como os 100% internos de <strong>{no.nome}</strong> serão distribuídos
          entre suas Classes. {no.nome} representa {no.pesoReal.toFixed(1)}% da carteira hoje (meta:{" "}
          {no.pesoAlvo.toFixed(1)}%). As Classes abaixo devem somar 100%.
        </p>
      )}
      {no.tipo === "classe" && no.pesoRealGlobal !== null && no.pesoAlvoGlobal !== null && (
        <p className="text-xs text-muted mb-4">
          Você está definindo como os 100% internos de <strong>{no.nome}</strong> serão distribuídos
          entre seus Setores. {no.nome} representa {no.pesoRealGlobal.toFixed(1)}% da carteira hoje
          (meta: {no.pesoAlvoGlobal.toFixed(1)}%). Os Setores abaixo devem somar 100%.
        </p>
      )}
      {no.tipo === "setor" && (
        <p className="text-xs text-muted mb-4">
          Ativos classificados dentro de {no.nome} — somente leitura aqui. Pra reclassificar ou mudar
          o peso-alvo de um ativo, use a aba Ativos.
        </p>
      )}
      {no.tipo === "ativo" && (
        <p className="text-xs text-muted mb-4">
          Ativo somente leitura na Alocação (§16.2.13) — reclassificação e peso-alvo são geridos na
          aba Ativos.
        </p>
      )}

      {/* Editar/excluir o PRÓPRIO nó selecionado (não seus filhos) */}
      {FormNo && no.id && !editandoNo && (
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border">
          <button onClick={() => setEditandoNo(true)} className="text-xs text-faint hover:text-ink">
            Editar {ROTULO_TIPO[no.tipo as Exclude<TipoNo, "raiz" | "ativo">]}
          </button>
          <button onClick={() => setExcluindoNo(true)} className="text-xs text-faint hover:text-danger">
            Excluir {ROTULO_TIPO[no.tipo as Exclude<TipoNo, "raiz" | "ativo">]}
          </button>
        </div>
      )}
      {FormNo && no.id && editandoNo && (
        <div className="mb-4 pb-4 border-b border-border">
          <FormNo
            valoresIniciais={{ nome: no.nome, peso_alvo: no.pesoAlvo ?? 0 }}
            onCancelar={() => setEditandoNo(false)}
            onSalvo={async (dados) => {
              const resultado = await editarNo(no.tipo, no.id as string, dados);
              if (resultado.error) throw new Error(resultado.error);
              await onChange();
              setEditandoNo(false);
              toast.success(`${ROTULO_TIPO[no.tipo as Exclude<TipoNo, "raiz" | "ativo">]} atualizado.`);
            }}
          />
        </div>
      )}
      {no.id && excluindoNo && (
        <ConfirmModal
          title={`Excluir ${no.nome}?`}
          message="Tudo dentro dele some junto. Essa ação não pode ser desfeita."
          loading={excluindoNoLoading}
          onCancel={() => setExcluindoNo(false)}
          onConfirm={async () => {
            setExcluindoNoLoading(true);
            const resultado = await excluirNo(no.tipo, no.id as string);
            setExcluindoNoLoading(false);
            if (resultado.error) {
              toast.error(resultado.error);
              return;
            }
            setExcluindoNo(false);
            onSelecionar(no.caminho.length > 0 ? { tipo: no.caminho[no.caminho.length - 1].tipo, id: no.caminho[no.caminho.length - 1].id } : RAIZ);
            await onChange();
            toast.success(`${ROTULO_TIPO[no.tipo as Exclude<TipoNo, "raiz" | "ativo">]} excluído.`);
          }}
        />
      )}

      {/* Ativo: view somente leitura, sem lista de filhos */}
      {no.tipo === "ativo" && (
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-faint">Peso dentro do Setor</p>
              <p className="text-ink">{no.pesoAlvo?.toFixed(1)}% meta · {no.pesoReal?.toFixed(1)}% real</p>
            </div>
            <div>
              <p className="text-xs text-faint">Peso na carteira</p>
              <p className="text-ink">{no.pesoRealGlobal?.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-xs text-faint">Valor atual</p>
              <p className="text-ink">{formatarMoeda(no.valorAtual ?? 0)}</p>
            </div>
          </div>
          <Link href={`/ativos/${no.id}`} className="inline-block text-xs text-accent hover:underline mt-2">
            Abrir na aba Ativos →
          </Link>
        </div>
      )}

      {/* Lista de distribuição dos filhos diretos (§16.2.6) */}
      {no.tipo !== "ativo" && (
        <div>
          {no.filhos.length > 0 && (
            <p className={`text-xs mb-2 ${status.status === "excedido" ? "text-danger" : "text-faint"}`}>
              Soma dos pesos-alvo: {status.soma.toFixed(1)}%
              {status.status === "excedido"
                ? ` — excede 100% em ${(status.soma - 100).toFixed(1)}pp`
                : status.status === "incompleto"
                  ? ` — faltam ${(100 - status.soma).toFixed(1)}pp pra fechar 100%`
                  : " ✓"}
            </p>
          )}

          {no.filhos.length === 0 && (
            <p className="text-xs text-faint mb-2">
              {no.tipo === "setor"
                ? "Nenhum ativo classificado neste setor ainda. Classifique ativos na aba Ativos."
                : `Nenhum(a) ${no.rotuloFilhos.toLowerCase()} cadastrado(a) ainda.`}
            </p>
          )}

          <div className="space-y-1">
            {no.filhos.map((filho) =>
              no.filhosEditaveisAqui ? (
                <LinhaFilhoEditavel
                  key={filho.id}
                  filho={filho}
                  editando={editandoFilhoId === filho.id}
                  onSelecionar={() => onSelecionar({ tipo: filho.tipo, id: filho.id })}
                  onEditar={() => setEditandoFilhoId(filho.id)}
                  onCancelarEdicao={() => setEditandoFilhoId(null)}
                  onExcluir={() => setExcluindoFilho(filho)}
                  onSalvarEdicao={async (dados) => {
                    const resultado = await editarNo(filho.tipo, filho.id, dados);
                    if (resultado.error) throw new Error(resultado.error);
                    await onChange();
                    setEditandoFilhoId(null);
                    toast.success(`${ROTULO_TIPO[filho.tipo as Exclude<TipoNo, "raiz" | "ativo">]} atualizado.`);
                  }}
                />
              ) : (
                <LinhaFilhoAtivoSomenteLeitura key={filho.id} filho={filho} />
              )
            )}
          </div>

          {excluindoFilho && (
            <ConfirmModal
              title={`Excluir ${excluindoFilho.nome}?`}
              message="Tudo dentro dele some junto. Essa ação não pode ser desfeita."
              loading={excluindoFilhoLoading}
              onCancel={() => setExcluindoFilho(null)}
              onConfirm={async () => {
                setExcluindoFilhoLoading(true);
                const resultado = await excluirNo(excluindoFilho.tipo, excluindoFilho.id);
                setExcluindoFilhoLoading(false);
                if (resultado.error) {
                  toast.error(resultado.error);
                  return;
                }
                setExcluindoFilho(null);
                await onChange();
                toast.success(`${ROTULO_TIPO[excluindoFilho.tipo as Exclude<TipoNo, "raiz" | "ativo">]} excluído.`);
              }}
            />
          )}

          {no.filhosEditaveisAqui && FormFilho && rotuloFilhoNovo && (
            <div className="mt-3">
              {adicionandoFilho ? (
                <div className="bg-surface-2 rounded-md p-3">
                  <FormFilho
                    onCancelar={() => setAdicionandoFilho(false)}
                    onSalvo={async (dados) => {
                      const resultado = await criarFilho(no.tipo, no.id, rotuloFilhoNovo, dados);
                      if (resultado.error) throw new Error(resultado.error);
                      await onChange();
                      setAdicionandoFilho(false);
                      toast.success(`${ROTULO_TIPO[rotuloFilhoNovo]} criado(a).`);
                    }}
                  />
                </div>
              ) : (
                <button onClick={() => setAdicionandoFilho(true)} className="btn btn-secondary text-xs py-1 px-3">
                  + Adicionar {ROTULO_TIPO[rotuloFilhoNovo].toLowerCase()}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LinhaFilhoEditavel({
  filho,
  editando,
  onSelecionar,
  onEditar,
  onCancelarEdicao,
  onExcluir,
  onSalvarEdicao,
}: {
  filho: FilhoResolvido;
  editando: boolean;
  onSelecionar: () => void;
  onEditar: () => void;
  onCancelarEdicao: () => void;
  onExcluir: () => void;
  onSalvarEdicao: (dados: DadosForm) => Promise<void>;
}) {
  if (editando) {
    const Form = FORM_POR_TIPO[filho.tipo as Exclude<TipoNo, "raiz" | "ativo">];
    return (
      <div className="bg-surface-2 rounded-md p-3">
        <Form
          valoresIniciais={{ nome: filho.nome, peso_alvo: filho.pesoAlvo }}
          onCancelar={onCancelarEdicao}
          onSalvo={onSalvarEdicao}
        />
      </div>
    );
  }

  const fora = Math.abs(filho.desvio) > 5;

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-surface-2 text-sm">
      <button onClick={onSelecionar} className="flex-1 text-left text-ink hover:underline truncate">
        {filho.nome}
      </button>
      <span className="text-xs text-faint w-16 text-right" title="Peso-alvo local (meta)">
        {filho.pesoAlvo.toFixed(1)}% meta
      </span>
      <span className={`text-xs w-16 text-right ${fora ? "text-danger" : "text-success"}`} title="Peso real local">
        {filho.pesoReal.toFixed(1)}% real
      </span>
      <span className="text-[10px] text-faint w-16 text-right" title="Peso na carteira (global)">
        {filho.pesoRealGlobal.toFixed(1)}% cart.
      </span>
      <button onClick={onEditar} className="text-xs text-faint hover:text-ink">
        Editar
      </button>
      <button onClick={onExcluir} className="text-xs text-faint hover:text-danger">
        Excluir
      </button>
    </div>
  );
}

function LinhaFilhoAtivoSomenteLeitura({ filho }: { filho: FilhoResolvido }) {
  return (
    <Link
      href={`/ativos/${filho.id}`}
      className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-surface-2 text-sm"
    >
      <span className="flex-1 text-ink truncate">{filho.ticker ?? filho.nome}</span>
      <span className="text-xs text-faint w-16 text-right">{filho.pesoAlvo.toFixed(1)}% meta</span>
      <span className="text-xs text-faint w-16 text-right">{filho.pesoReal.toFixed(1)}% real</span>
      <span className="text-[10px] text-faint w-16 text-right">{filho.pesoRealGlobal.toFixed(1)}% cart.</span>
    </Link>
  );
}
