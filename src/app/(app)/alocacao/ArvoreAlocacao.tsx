"use client";

import { useState } from "react";
import type { EstruturaAlocacao, MacroNode, ClasseNode, SetorNode } from "@/lib/alocacao/actions";
import { moverMacroOrdem, moverClasseOrdem, moverSetorOrdem } from "@/lib/alocacao/actions";
import type { Selecao } from "./arvore";
import { statusSomaFilhos } from "./arvore";
import { useToast } from "@/components/ToastProvider";

/**
 * Árvore operacional (fase 3, §8.50/§16.2.2) — coluna esquerda (~60% da
 * largura em telas largas, ver AlocacaoView.tsx). Cada linha é um nó
 * (Macro/Classe/Setor/Ativo); selecionar atualiza o painel contextual à
 * direita sem sair da página (§16.2.3). Não é um formulário sequencial: o
 * usuário pode clicar em qualquer nó, em qualquer ordem.
 *
 * `onChange` (fase 5, §8.54/§16.2.8): os botões de subir/descer chamam
 * `moverMacroOrdem`/`moverClasseOrdem`/`moverSetorOrdem` e depois pedem pro
 * pai recarregar a estrutura — mesmo padrão de `onChange` já usado pelo
 * `PainelContextual`.
 */
export default function ArvoreAlocacao({
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
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => onSelecionar({ tipo: "raiz", id: null })}
        className={`w-full text-left px-3 py-2 text-xs font-medium uppercase tracking-wide border-b border-border transition-colors ${
          selecao.tipo === "raiz" ? "bg-accent/10 text-accent" : "text-faint hover:text-ink hover:bg-surface-2"
        }`}
      >
        Estrutura da carteira
      </button>
      <div className="py-1">
        {estrutura.macros.length === 0 ? (
          <p className="text-xs text-faint px-3 py-3">Nenhum Macro criado ainda.</p>
        ) : (
          estrutura.macros.map((macro, index) => (
            <NoMacro
              key={macro.id}
              macro={macro}
              selecao={selecao}
              onSelecionar={onSelecionar}
              podeSubir={index > 0}
              podeDescer={index < estrutura.macros.length - 1}
              onChange={onChange}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** Botões subir/descer (fase 5, §16.2.8) — botões reais, sempre visíveis (acessibilidade, §16.2.18), não drag-and-drop. */
function BotoesReordenar({
  podeSubir,
  podeDescer,
  onSubir,
  onDescer,
}: {
  podeSubir: boolean;
  podeDescer: boolean;
  onSubir: () => void;
  onDescer: () => void;
}) {
  return (
    <span className="flex flex-col shrink-0 -my-1">
      <button
        type="button"
        aria-label="Mover para cima"
        disabled={!podeSubir}
        onClick={(e) => {
          e.stopPropagation();
          onSubir();
        }}
        className="text-faint hover:text-ink disabled:opacity-20 disabled:hover:text-faint leading-none text-[10px]"
      >
        ▲
      </button>
      <button
        type="button"
        aria-label="Mover para baixo"
        disabled={!podeDescer}
        onClick={(e) => {
          e.stopPropagation();
          onDescer();
        }}
        className="text-faint hover:text-ink disabled:opacity-20 disabled:hover:text-faint leading-none text-[10px]"
      >
        ▼
      </button>
    </span>
  );
}

function Chevron({ expandido }: { expandido: boolean }) {
  return <span className={`text-faint text-[10px] inline-block transition-transform ${expandido ? "rotate-90" : ""}`}>▶</span>;
}

function Badge({ status }: { status: "completo" | "incompleto" | "excedido" | "vazio" }) {
  if (status === "vazio") return null;
  const texto = status === "completo" ? "Completo" : status === "incompleto" ? "Incompleto" : "Excedido";
  const cor =
    status === "completo" ? "text-success" : status === "incompleto" ? "text-faint" : "text-danger";
  return <span className={`text-[10px] ${cor}`}>{texto}</span>;
}

function LinhaNo({
  nivel,
  nome,
  pesoAlvo,
  pesoRealGlobal,
  temFilhos,
  expandido,
  onToggleExpand,
  ativo,
  onClick,
  statusFilhos,
  destaqueMacro,
  podeSubir,
  podeDescer,
  onSubir,
  onDescer,
}: {
  nivel: number;
  nome: string;
  pesoAlvo: number;
  pesoRealGlobal: number;
  temFilhos: boolean;
  expandido: boolean;
  onToggleExpand: () => void;
  ativo: boolean;
  onClick: () => void;
  statusFilhos?: "completo" | "incompleto" | "excedido" | "vazio";
  destaqueMacro?: boolean;
  /** Reordenar (§16.2.8) — omitido pra linhas de Ativo (não reordenáveis aqui). */
  podeSubir?: boolean;
  podeDescer?: boolean;
  onSubir?: () => void;
  onDescer?: () => void;
}) {
  const temReordenar = onSubir !== undefined && onDescer !== undefined;
  return (
    <div
      className={`flex items-center gap-2 pr-3 py-1.5 text-sm cursor-pointer border-l-2 transition-colors ${
        ativo ? "bg-accent/10 border-l-accent" : "border-l-transparent hover:bg-surface-2"
      }`}
      style={{ paddingLeft: `${12 + nivel * 16}px` }}
      onClick={onClick}
    >
      {temFilhos ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="text-faint hover:text-ink shrink-0"
        >
          <Chevron expandido={expandido} />
        </button>
      ) : (
        <span className="w-2.5 shrink-0" />
      )}
      <span className={`flex-1 truncate ${destaqueMacro ? "font-semibold text-ink" : "text-ink"}`}>{nome}</span>
      {statusFilhos && <Badge status={statusFilhos} />}
      <span className="text-faint text-xs w-14 text-right shrink-0">{pesoAlvo.toFixed(0)}%</span>
      <span className="text-faint text-[10px] w-16 text-right shrink-0" title="Peso na carteira (global)">
        {pesoRealGlobal.toFixed(1)}% cart.
      </span>
      {temReordenar && (
        <BotoesReordenar
          podeSubir={podeSubir ?? false}
          podeDescer={podeDescer ?? false}
          onSubir={onSubir!}
          onDescer={onDescer!}
        />
      )}
    </div>
  );
}

function NoMacro({
  macro,
  selecao,
  onSelecionar,
  podeSubir,
  podeDescer,
  onChange,
}: {
  macro: MacroNode;
  selecao: Selecao;
  onSelecionar: (s: Selecao) => void;
  podeSubir: boolean;
  podeDescer: boolean;
  onChange: () => void | Promise<void>;
}) {
  const [expandido, setExpandido] = useState(false);
  const status = statusSomaFilhos(macro.classes);
  const toast = useToast();

  return (
    <div>
      <LinhaNo
        nivel={0}
        nome={macro.nome}
        pesoAlvo={macro.pesoAlvo}
        pesoRealGlobal={macro.pesoRealGlobal}
        temFilhos={macro.classes.length > 0}
        expandido={expandido}
        onToggleExpand={() => setExpandido((v) => !v)}
        ativo={selecao.tipo === "macro" && selecao.id === macro.id}
        onClick={() => {
          onSelecionar({ tipo: "macro", id: macro.id });
          if (macro.classes.length > 0) setExpandido(true);
        }}
        statusFilhos={status.status}
        destaqueMacro
        podeSubir={podeSubir}
        podeDescer={podeDescer}
        onSubir={async () => {
          const resultado = await moverMacroOrdem(macro.id, "subir");
          if (resultado.error) toast.error(resultado.error);
          else await onChange();
        }}
        onDescer={async () => {
          const resultado = await moverMacroOrdem(macro.id, "descer");
          if (resultado.error) toast.error(resultado.error);
          else await onChange();
        }}
      />
      {expandido &&
        macro.classes.map((classe, index) => (
          <NoClasse
            key={classe.id}
            classe={classe}
            selecao={selecao}
            onSelecionar={onSelecionar}
            podeSubir={index > 0}
            podeDescer={index < macro.classes.length - 1}
            onChange={onChange}
          />
        ))}
    </div>
  );
}

function NoClasse({
  classe,
  selecao,
  onSelecionar,
  podeSubir,
  podeDescer,
  onChange,
}: {
  classe: ClasseNode;
  selecao: Selecao;
  onSelecionar: (s: Selecao) => void;
  podeSubir: boolean;
  podeDescer: boolean;
  onChange: () => void | Promise<void>;
}) {
  const [expandido, setExpandido] = useState(false);
  const status = statusSomaFilhos(classe.setores);
  const toast = useToast();

  return (
    <div>
      <LinhaNo
        nivel={1}
        nome={classe.nome}
        pesoAlvo={classe.pesoAlvo}
        pesoRealGlobal={classe.pesoRealGlobal}
        temFilhos={classe.setores.length > 0}
        expandido={expandido}
        onToggleExpand={() => setExpandido((v) => !v)}
        ativo={selecao.tipo === "classe" && selecao.id === classe.id}
        onClick={() => {
          onSelecionar({ tipo: "classe", id: classe.id });
          if (classe.setores.length > 0) setExpandido(true);
        }}
        statusFilhos={status.status}
        podeSubir={podeSubir}
        podeDescer={podeDescer}
        onSubir={async () => {
          const resultado = await moverClasseOrdem(classe.id, "subir");
          if (resultado.error) toast.error(resultado.error);
          else await onChange();
        }}
        onDescer={async () => {
          const resultado = await moverClasseOrdem(classe.id, "descer");
          if (resultado.error) toast.error(resultado.error);
          else await onChange();
        }}
      />
      {expandido &&
        classe.setores.map((setor, index) => (
          <NoSetor
            key={setor.id}
            setor={setor}
            selecao={selecao}
            onSelecionar={onSelecionar}
            podeSubir={index > 0}
            podeDescer={index < classe.setores.length - 1}
            onChange={onChange}
          />
        ))}
    </div>
  );
}

function NoSetor({
  setor,
  selecao,
  onSelecionar,
  podeSubir,
  podeDescer,
  onChange,
}: {
  setor: SetorNode;
  selecao: Selecao;
  onSelecionar: (s: Selecao) => void;
  podeSubir: boolean;
  podeDescer: boolean;
  onChange: () => void | Promise<void>;
}) {
  const [expandido, setExpandido] = useState(false);
  const toast = useToast();

  return (
    <div>
      <LinhaNo
        nivel={2}
        nome={setor.nome}
        pesoAlvo={setor.pesoAlvo}
        pesoRealGlobal={setor.pesoRealGlobal}
        temFilhos={setor.ativos.length > 0}
        expandido={expandido}
        onToggleExpand={() => setExpandido((v) => !v)}
        ativo={selecao.tipo === "setor" && selecao.id === setor.id}
        onClick={() => {
          onSelecionar({ tipo: "setor", id: setor.id });
          if (setor.ativos.length > 0) setExpandido(true);
        }}
        podeSubir={podeSubir}
        podeDescer={podeDescer}
        onSubir={async () => {
          const resultado = await moverSetorOrdem(setor.id, "subir");
          if (resultado.error) toast.error(resultado.error);
          else await onChange();
        }}
        onDescer={async () => {
          const resultado = await moverSetorOrdem(setor.id, "descer");
          if (resultado.error) toast.error(resultado.error);
          else await onChange();
        }}
      />
      {expandido &&
        setor.ativos.map((ativo) => (
          <div
            key={ativo.id}
            className={`flex items-center gap-2 pr-3 py-1.5 text-sm cursor-pointer border-l-2 transition-colors ${
              selecao.tipo === "ativo" && selecao.id === ativo.id
                ? "bg-accent/10 border-l-accent"
                : "border-l-transparent hover:bg-surface-2"
            }`}
            style={{ paddingLeft: `${12 + 3 * 16}px` }}
            onClick={() => onSelecionar({ tipo: "ativo", id: ativo.id })}
          >
            <span className="w-2.5 shrink-0" />
            <span className="flex-1 truncate text-ink">{ativo.ticker}</span>
            <span className="text-faint text-xs w-14 text-right shrink-0">{ativo.pesoAlvo.toFixed(0)}%</span>
            <span className="text-faint text-[10px] w-16 text-right shrink-0" title="Peso na carteira (global)">
              {ativo.pesoRealGlobal.toFixed(1)}% cart.
            </span>
          </div>
        ))}
    </div>
  );
}
