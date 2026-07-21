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
  excluirClasseComOpcao,
  excluirMacro,
  excluirMacroComOpcao,
  excluirSetor,
  moverClasseParaMacro,
  moverSetorParaClasse,
  type AcaoResultado,
  type EstruturaAlocacao,
} from "@/lib/alocacao/actions";
import { FormMacro } from "./FormMacro";
import { FormClasse } from "./FormClasse";
import { FormSetor } from "./FormSetor";
import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/components/ToastProvider";
import {
  RAIZ,
  calcularDistribuicaoIgual,
  resolverNo,
  statusSomaFilhos,
  type FilhoResolvido,
  type Selecao,
  type TipoNo,
} from "./arvore";

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
/**
 * Exclusão com opções (fase 5, §8.54/§16.2.12) — só existe pra Macro/Classe,
 * cujos filhos (Classes/Setores) são geridos pela própria Alocação e por
 * isso podem ser "movidos" pra outro pai antes de apagar o nó. Setor não
 * tem essa variante: seus filhos são Ativos, e mudar `ativos.setor_id` é
 * exclusivo da aba Ativos (§16.2.13) — `excluirNo` simples já basta lá.
 */
async function excluirNoComOpcao(
  tipo: TipoNo,
  id: string,
  opcao: "subarvore" | "mover",
  destinoId?: string
): Promise<AcaoResultado> {
  if (tipo === "macro") return excluirMacroComOpcao(id, opcao, destinoId);
  if (tipo === "classe") return excluirClasseComOpcao(id, opcao, destinoId);
  return { error: "Tipo inválido para exclusão com opções." };
}
/** Mover pra outro pai (fase 5, §8.54/§16.2.11) — só Classe (outro Macro) e Setor (outra Classe). */
async function moverNoParaOutroPai(tipo: TipoNo, id: string, novoPaiId: string): Promise<AcaoResultado> {
  if (tipo === "classe") return moverClasseParaMacro(id, novoPaiId);
  if (tipo === "setor") return moverSetorParaClasse(id, novoPaiId);
  return { error: "Tipo inválido para mover." };
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
  // Fase 5 (§8.54/§16.2.9-11): mover o próprio nó pra outro pai (Classe→Macro, Setor→Classe).
  const [movendoNo, setMovendoNo] = useState(false);
  const [destinoMoverNo, setDestinoMoverNo] = useState("");
  const [movendoNoLoading, setMovendoNoLoading] = useState(false);
  // Fase 5 (§16.2.12): exclusão com opções (mover filhos ou excluir subárvore) — Macro/Classe só.
  const [exclusaoNoOpcao, setExclusaoNoOpcao] = useState<"subarvore" | "mover" | null>(null);
  const [destinoExclusaoNo, setDestinoExclusaoNo] = useState("");
  const [exclusaoFilhoOpcao, setExclusaoFilhoOpcao] = useState<"subarvore" | "mover" | null>(null);
  const [destinoExclusaoFilho, setDestinoExclusaoFilho] = useState("");
  // Fase 5 (§16.2.8): usar saldo restante / distribuir restante igualmente.
  const [acaoRestante, setAcaoRestante] = useState<{ tipo: "usar"; filhoId: string } | { tipo: "distribuir" } | null>(
    null
  );
  const [aplicandoRestante, setAplicandoRestante] = useState(false);
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

  /** Outros Macros (exclui `excluirId`) — destino de "mover Classe" ou "mover filhos ao excluir Macro". */
  const destinosMacro = (excluirId: string) =>
    estrutura.macros
      .filter((m) => m.id !== excluirId)
      .map((m) => ({ id: m.id, nome: m.nome, pesoAlvoGlobal: m.pesoAlvoGlobal }));
  /** Outras Classes em qualquer Macro (exclui `excluirId`) — destino de "mover Setor" ou "mover filhos ao excluir Classe". */
  const destinosClasse = (excluirId: string) =>
    estrutura.macros.flatMap((m) =>
      m.classes
        .filter((c) => c.id !== excluirId)
        .map((c) => ({ id: c.id, nome: `${m.nome} › ${c.nome}`, pesoAlvoGlobal: c.pesoAlvoGlobal }))
    );

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

      {/* Editar/mover/excluir o PRÓPRIO nó selecionado (não seus filhos) */}
      {FormNo && no.id && !editandoNo && !movendoNo && (
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-border flex-wrap">
          <button onClick={() => setEditandoNo(true)} className="text-xs text-faint hover:text-ink">
            Editar {ROTULO_TIPO[no.tipo as Exclude<TipoNo, "raiz" | "ativo">]}
          </button>
          {(no.tipo === "classe" || no.tipo === "setor") && (
            <button onClick={() => setMovendoNo(true)} className="text-xs text-faint hover:text-ink">
              Mover para {no.tipo === "classe" ? "outro Macro" : "outra Classe"}
            </button>
          )}
          <button onClick={() => setExcluindoNo(true)} className="text-xs text-faint hover:text-danger">
            Excluir {ROTULO_TIPO[no.tipo as Exclude<TipoNo, "raiz" | "ativo">]}
          </button>
        </div>
      )}
      {FormNo && no.id && editandoNo && (
        <div className="mb-4 pb-4 border-b border-border">
          <FormNo
            valoresIniciais={{ nome: no.nome, peso_alvo: no.pesoAlvo ?? 0 }}
            somaOutros={no.somaIrmaos ?? 0}
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
      {/* Ações avançadas — mover pra outro pai (§16.2.9/§16.2.11), fora do fluxo principal de edição */}
      {no.id && movendoNo && (no.tipo === "classe" || no.tipo === "setor") && (
        <MoverParaOutroPai
          nomeAtual={no.nome}
          pesoAlvo={no.pesoAlvo ?? 0}
          pesoAlvoGlobalAtual={no.pesoAlvoGlobal ?? 0}
          rotuloDestino={no.tipo === "classe" ? "Macro" : "Classe"}
          destinos={
            no.tipo === "classe"
              ? destinosMacro(no.caminho[0]?.id ?? "")
              : destinosClasse(no.caminho[1]?.id ?? "")
          }
          destinoEscolhido={destinoMoverNo}
          onEscolherDestino={setDestinoMoverNo}
          loading={movendoNoLoading}
          onCancelar={() => {
            setMovendoNo(false);
            setDestinoMoverNo("");
          }}
          onConfirmar={async () => {
            if (!destinoMoverNo) return;
            setMovendoNoLoading(true);
            const resultado = await moverNoParaOutroPai(no.tipo, no.id as string, destinoMoverNo);
            setMovendoNoLoading(false);
            if (resultado.error) {
              toast.error(resultado.error);
              return;
            }
            setMovendoNo(false);
            setDestinoMoverNo("");
            await onChange();
            toast.success(`${ROTULO_TIPO[no.tipo as Exclude<TipoNo, "raiz" | "ativo">]} movido(a).`);
          }}
        />
      )}
      {no.id && excluindoNo && (no.tipo === "macro" || no.tipo === "classe") && no.filhos.length > 0 ? (
        <ExclusaoComOpcoes
          nomeNo={no.nome}
          rotuloFilho={no.rotuloFilhos}
          qtdFilhos={no.filhos.length}
          rotuloDestino={no.tipo === "macro" ? "Macro" : "Classe"}
          destinos={no.tipo === "macro" ? destinosMacro(no.id) : destinosClasse(no.id)}
          opcaoEscolhida={exclusaoNoOpcao}
          onEscolherOpcao={setExclusaoNoOpcao}
          destinoEscolhido={destinoExclusaoNo}
          onEscolherDestino={setDestinoExclusaoNo}
          loading={excluindoNoLoading}
          onCancelar={() => {
            setExcluindoNo(false);
            setExclusaoNoOpcao(null);
            setDestinoExclusaoNo("");
          }}
          onConfirmar={async () => {
            if (!exclusaoNoOpcao) return;
            if (exclusaoNoOpcao === "mover" && !destinoExclusaoNo) return;
            setExcluindoNoLoading(true);
            const resultado = await excluirNoComOpcao(
              no.tipo,
              no.id as string,
              exclusaoNoOpcao,
              exclusaoNoOpcao === "mover" ? destinoExclusaoNo : undefined
            );
            setExcluindoNoLoading(false);
            if (resultado.error) {
              toast.error(resultado.error);
              return;
            }
            setExcluindoNo(false);
            setExclusaoNoOpcao(null);
            setDestinoExclusaoNo("");
            onSelecionar(
              no.caminho.length > 0
                ? { tipo: no.caminho[no.caminho.length - 1].tipo, id: no.caminho[no.caminho.length - 1].id }
                : RAIZ
            );
            await onChange();
            toast.success(`${ROTULO_TIPO[no.tipo as Exclude<TipoNo, "raiz" | "ativo">]} excluído(a).`);
          }}
        />
      ) : (
        no.id &&
        excluindoNo && (
          <ConfirmModal
            title={`Excluir ${no.nome}?`}
            message={
              no.tipo === "setor" && no.filhos.length > 0
                ? `${no.filhos.length} Ativo(s) classificado(s) aqui ficarão "não classificados" (a classificação deles pode ser refeita na aba Ativos). Essa ação não pode ser desfeita.`
                : "Essa ação não pode ser desfeita."
            }
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
              onSelecionar(
                no.caminho.length > 0
                  ? { tipo: no.caminho[no.caminho.length - 1].tipo, id: no.caminho[no.caminho.length - 1].id }
                  : RAIZ
              );
              await onChange();
              toast.success(`${ROTULO_TIPO[no.tipo as Exclude<TipoNo, "raiz" | "ativo">]} excluído.`);
            }}
          />
        )
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
            <p className={`text-xs mb-1 ${status.status === "excedido" ? "text-danger" : "text-faint"}`}>
              Soma dos pesos-alvo: {status.soma.toFixed(1)}%
              {status.status === "excedido"
                ? ` — excede 100% em ${(status.soma - 100).toFixed(1)}pp`
                : status.status === "incompleto"
                  ? ` — faltam ${(100 - status.soma).toFixed(1)}pp pra fechar 100%`
                  : " ✓"}
            </p>
          )}

          {/* Ação principal "distribuir restante igualmente" (§16.2.8) — só faz sentido incompleto */}
          {status.status === "incompleto" && no.filhosEditaveisAqui && acaoRestante === null && (
            <button
              onClick={() => setAcaoRestante({ tipo: "distribuir" })}
              className="text-xs text-accent hover:underline mb-2"
            >
              Distribuir restante ({(100 - status.soma).toFixed(1)}%) igualmente entre todos
            </button>
          )}

          {/* Prévia + confirmação (nunca altera peso silenciosamente, §16.2.8) */}
          {acaoRestante !== null && no.filhosEditaveisAqui && (
            <PreviaRestante
              itens={
                acaoRestante.tipo === "distribuir"
                  ? calcularDistribuicaoIgual(no.filhos.map((f) => ({ id: f.id, nome: f.nome, pesoAlvo: f.pesoAlvo })))
                  : (() => {
                      const filho = no.filhos.find((f) => f.id === acaoRestante.filhoId);
                      if (!filho) return [];
                      const restante = 100 - status.soma;
                      return [
                        {
                          id: filho.id,
                          nome: filho.nome,
                          pesoAtual: filho.pesoAlvo,
                          pesoNovo: Math.round((filho.pesoAlvo + restante) * 100) / 100,
                        },
                      ];
                    })()
              }
              loading={aplicandoRestante}
              onCancelar={() => setAcaoRestante(null)}
              onConfirmar={async () => {
                const itens =
                  acaoRestante.tipo === "distribuir"
                    ? calcularDistribuicaoIgual(no.filhos.map((f) => ({ id: f.id, nome: f.nome, pesoAlvo: f.pesoAlvo })))
                    : (() => {
                        const filho = no.filhos.find((f) => f.id === acaoRestante.filhoId);
                        if (!filho) return [];
                        const restante = 100 - status.soma;
                        return [
                          {
                            id: filho.id,
                            nome: filho.nome,
                            pesoAtual: filho.pesoAlvo,
                            pesoNovo: Math.round((filho.pesoAlvo + restante) * 100) / 100,
                          },
                        ];
                      })();
                setAplicandoRestante(true);
                for (const item of itens) {
                  const filho = no.filhos.find((f) => f.id === item.id)!;
                  const resultado = await editarNo(filho.tipo, filho.id, { nome: filho.nome, peso_alvo: item.pesoNovo });
                  if (resultado.error) {
                    setAplicandoRestante(false);
                    toast.error(resultado.error);
                    return;
                  }
                }
                setAplicandoRestante(false);
                setAcaoRestante(null);
                await onChange();
                toast.success("Pesos-alvo atualizados.");
              }}
            />
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
                  somaOutros={status.soma - filho.pesoAlvo}
                  mostrarUsarRestante={status.status === "incompleto" && acaoRestante === null}
                  editando={editandoFilhoId === filho.id}
                  onSelecionar={() => onSelecionar({ tipo: filho.tipo, id: filho.id })}
                  onEditar={() => setEditandoFilhoId(filho.id)}
                  onCancelarEdicao={() => setEditandoFilhoId(null)}
                  onExcluir={() => setExcluindoFilho(filho)}
                  onUsarRestante={() => setAcaoRestante({ tipo: "usar", filhoId: filho.id })}
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

          {excluindoFilho &&
          (excluindoFilho.tipo === "macro" || excluindoFilho.tipo === "classe") &&
          excluindoFilho.qtdFilhosDiretos > 0 ? (
            <ExclusaoComOpcoes
              nomeNo={excluindoFilho.nome}
              rotuloFilho={excluindoFilho.tipo === "macro" ? "Classes" : "Setores"}
              qtdFilhos={excluindoFilho.qtdFilhosDiretos}
              rotuloDestino={excluindoFilho.tipo === "macro" ? "Macro" : "Classe"}
              destinos={
                excluindoFilho.tipo === "macro" ? destinosMacro(excluindoFilho.id) : destinosClasse(excluindoFilho.id)
              }
              opcaoEscolhida={exclusaoFilhoOpcao}
              onEscolherOpcao={setExclusaoFilhoOpcao}
              destinoEscolhido={destinoExclusaoFilho}
              onEscolherDestino={setDestinoExclusaoFilho}
              loading={excluindoFilhoLoading}
              onCancelar={() => {
                setExcluindoFilho(null);
                setExclusaoFilhoOpcao(null);
                setDestinoExclusaoFilho("");
              }}
              onConfirmar={async () => {
                if (!exclusaoFilhoOpcao) return;
                if (exclusaoFilhoOpcao === "mover" && !destinoExclusaoFilho) return;
                setExcluindoFilhoLoading(true);
                const resultado = await excluirNoComOpcao(
                  excluindoFilho.tipo,
                  excluindoFilho.id,
                  exclusaoFilhoOpcao,
                  exclusaoFilhoOpcao === "mover" ? destinoExclusaoFilho : undefined
                );
                setExcluindoFilhoLoading(false);
                if (resultado.error) {
                  toast.error(resultado.error);
                  return;
                }
                setExcluindoFilho(null);
                setExclusaoFilhoOpcao(null);
                setDestinoExclusaoFilho("");
                await onChange();
                toast.success(`${ROTULO_TIPO[excluindoFilho.tipo as Exclude<TipoNo, "raiz" | "ativo">]} excluído(a).`);
              }}
            />
          ) : (
            excluindoFilho && (
              <ConfirmModal
                title={`Excluir ${excluindoFilho.nome}?`}
                message={
                  excluindoFilho.tipo === "setor" && excluindoFilho.qtdFilhosDiretos > 0
                    ? `${excluindoFilho.qtdFilhosDiretos} Ativo(s) classificado(s) aqui ficarão "não classificados" (a classificação deles pode ser refeita na aba Ativos). Essa ação não pode ser desfeita.`
                    : "Essa ação não pode ser desfeita."
                }
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
            )
          )}

          {no.filhosEditaveisAqui && FormFilho && rotuloFilhoNovo && (
            <div className="mt-3">
              {adicionandoFilho ? (
                <div className="bg-surface-2 rounded-md p-3">
                  <FormFilho
                    somaOutros={status.soma}
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
  somaOutros,
  mostrarUsarRestante,
  editando,
  onSelecionar,
  onEditar,
  onCancelarEdicao,
  onExcluir,
  onUsarRestante,
  onSalvarEdicao,
}: {
  filho: FilhoResolvido;
  somaOutros: number;
  /** Mostra o botão "Usar restante aqui" (ação principal, §16.2.8) — só quando a soma está incompleta. */
  mostrarUsarRestante: boolean;
  editando: boolean;
  onSelecionar: () => void;
  onEditar: () => void;
  onCancelarEdicao: () => void;
  onExcluir: () => void;
  onUsarRestante: () => void;
  onSalvarEdicao: (dados: DadosForm) => Promise<void>;
}) {
  if (editando) {
    const Form = FORM_POR_TIPO[filho.tipo as Exclude<TipoNo, "raiz" | "ativo">];
    return (
      <div className="bg-surface-2 rounded-md p-3">
        <Form
          valoresIniciais={{ nome: filho.nome, peso_alvo: filho.pesoAlvo }}
          somaOutros={somaOutros}
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
      {mostrarUsarRestante && (
        <button onClick={onUsarRestante} className="text-xs text-accent hover:underline whitespace-nowrap">
          Usar restante aqui
        </button>
      )}
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

/**
 * Prévia + confirmação de "usar saldo restante" / "distribuir restante
 * igualmente" (ações principais, fase 5, §8.54/§16.2.8) — nunca altera peso
 * silenciosamente: mostra o resultado esperado de cada item antes de aplicar.
 */
function PreviaRestante({
  itens,
  loading,
  onCancelar,
  onConfirmar,
}: {
  itens: { id: string; nome: string; pesoAtual: number; pesoNovo: number }[];
  loading: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  if (itens.length === 0) return null;
  return (
    <div className="bg-surface-2 rounded-md p-3 mb-2 text-xs">
      <p className="text-faint mb-2">Resultado esperado:</p>
      <ul className="space-y-0.5 mb-3">
        {itens.map((item) => (
          <li key={item.id} className="text-ink">
            {item.nome}: {item.pesoAtual.toFixed(1)}% → <strong>{item.pesoNovo.toFixed(1)}%</strong>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button onClick={onCancelar} disabled={loading} className="btn btn-secondary text-xs py-1 px-3">
          Cancelar
        </button>
        <button onClick={onConfirmar} disabled={loading} className="btn btn-primary text-xs py-1 px-3">
          {loading ? "Aplicando..." : "Confirmar"}
        </button>
      </div>
    </div>
  );
}

/**
 * Mover o nó selecionado pra outro pai (Classe → outro Macro, Setor → outra
 * Classe) — ação avançada, fora do fluxo principal (fase 5, §8.54/§16.2.9/
 * §16.2.11). Preserva o peso local; mostra o peso global antes/depois antes
 * de confirmar (nunca move silenciosamente).
 */
function MoverParaOutroPai({
  nomeAtual,
  pesoAlvo,
  pesoAlvoGlobalAtual,
  rotuloDestino,
  destinos,
  destinoEscolhido,
  onEscolherDestino,
  loading,
  onCancelar,
  onConfirmar,
}: {
  nomeAtual: string;
  pesoAlvo: number;
  pesoAlvoGlobalAtual: number;
  rotuloDestino: string;
  destinos: { id: string; nome: string; pesoAlvoGlobal: number }[];
  destinoEscolhido: string;
  onEscolherDestino: (id: string) => void;
  loading: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const destino = destinos.find((d) => d.id === destinoEscolhido);
  const novoGlobal = destino ? (destino.pesoAlvoGlobal / 100) * pesoAlvo : null;

  return (
    <div className="mb-4 pb-4 border-b border-border bg-surface-2 rounded-md p-3 text-xs">
      {destinos.length === 0 ? (
        <p className="text-faint mb-2">
          Não há outro {rotuloDestino.toLowerCase()} cadastrado pra mover {nomeAtual}.
        </p>
      ) : (
        <>
          <label className="label">
            Mover {nomeAtual} para qual {rotuloDestino.toLowerCase()}?
          </label>
          <select value={destinoEscolhido} onChange={(e) => onEscolherDestino(e.target.value)} className="input mb-2">
            <option value="">Selecione...</option>
            {destinos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nome}
              </option>
            ))}
          </select>
          {destino && novoGlobal !== null && (
            <p className="text-faint mb-2">
              Peso local preservado ({pesoAlvo.toFixed(1)}%). Peso na carteira: {pesoAlvoGlobalAtual.toFixed(1)}% →{" "}
              <strong>{novoGlobal.toFixed(1)}%</strong>.
            </p>
          )}
        </>
      )}
      <div className="flex gap-2">
        <button onClick={onCancelar} disabled={loading} className="btn btn-secondary text-xs py-1 px-3">
          Cancelar
        </button>
        {destinos.length > 0 && (
          <button
            onClick={onConfirmar}
            disabled={loading || !destinoEscolhido}
            className="btn btn-primary text-xs py-1 px-3"
          >
            {loading ? "Movendo..." : "Confirmar"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Excluir um Macro/Classe com filhos — nunca silencioso: escolhe mover os
 * filhos pra outro pai já existente, ou excluir a subárvore inteira (fase 5,
 * §8.54/§16.2.12). Não existe pra Setor (filhos são Ativos, ver
 * `excluirNoComOpcao` em lib/alocacao/actions.ts).
 */
function ExclusaoComOpcoes({
  nomeNo,
  rotuloFilho,
  qtdFilhos,
  rotuloDestino,
  destinos,
  opcaoEscolhida,
  onEscolherOpcao,
  destinoEscolhido,
  onEscolherDestino,
  loading,
  onCancelar,
  onConfirmar,
}: {
  nomeNo: string;
  rotuloFilho: string;
  qtdFilhos: number;
  rotuloDestino: string;
  destinos: { id: string; nome: string }[];
  opcaoEscolhida: "subarvore" | "mover" | null;
  onEscolherOpcao: (o: "subarvore" | "mover" | null) => void;
  destinoEscolhido: string;
  onEscolherDestino: (id: string) => void;
  loading: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <div className="mb-4 pb-4 border-b border-border bg-surface-2 rounded-md p-3 text-xs space-y-2">
      <p className="text-ink">
        <strong>{nomeNo}</strong> tem {qtdFilhos} {rotuloFilho.toLowerCase()}. O que fazer com elas antes de excluir?
      </p>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name={`exclusao-opcao-${nomeNo}`}
          checked={opcaoEscolhida === "mover"}
          onChange={() => onEscolherOpcao("mover")}
        />
        Mover {rotuloFilho.toLowerCase()} pra outro {rotuloDestino}
      </label>
      {opcaoEscolhida === "mover" && (
        <div className="pl-6">
          {destinos.length === 0 ? (
            <p className="text-faint">
              Não há outro {rotuloDestino.toLowerCase()} cadastrado — só é possível excluir a subárvore inteira.
            </p>
          ) : (
            <select value={destinoEscolhido} onChange={(e) => onEscolherDestino(e.target.value)} className="input">
              <option value="">Selecione o destino...</option>
              {destinos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name={`exclusao-opcao-${nomeNo}`}
          checked={opcaoEscolhida === "subarvore"}
          onChange={() => onEscolherOpcao("subarvore")}
        />
        Excluir {nomeNo} e {qtdFilhos} {rotuloFilho.toLowerCase()} junto (não pode ser desfeito)
      </label>
      <div className="flex gap-2 pt-1">
        <button onClick={onCancelar} disabled={loading} className="btn btn-secondary text-xs py-1 px-3">
          Cancelar
        </button>
        <button
          onClick={onConfirmar}
          disabled={loading || !opcaoEscolhida || (opcaoEscolhida === "mover" && !destinoEscolhido)}
          className="btn btn-danger text-xs py-1 px-3"
        >
          {loading ? "Excluindo..." : "Confirmar"}
        </button>
      </div>
    </div>
  );
}
