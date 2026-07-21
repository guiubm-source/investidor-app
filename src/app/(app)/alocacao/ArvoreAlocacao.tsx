"use client";

import { useState } from "react";
import type { EstruturaAlocacao, MacroNode, ClasseNode, SetorNode } from "@/lib/alocacao/actions";
import type { Selecao } from "./arvore";
import { statusSomaFilhos } from "./arvore";

/**
 * Árvore operacional (fase 3, §8.50/§16.2.2) — coluna esquerda (~60% da
 * largura em telas largas, ver AlocacaoView.tsx). Cada linha é um nó
 * (Macro/Classe/Setor/Ativo); selecionar atualiza o painel contextual à
 * direita sem sair da página (§16.2.3). Não é um formulário sequencial: o
 * usuário pode clicar em qualquer nó, em qualquer ordem.
 */
export default function ArvoreAlocacao({
  estrutura,
  selecao,
  onSelecionar,
}: {
  estrutura: EstruturaAlocacao;
  selecao: Selecao;
  onSelecionar: (s: Selecao) => void;
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
          estrutura.macros.map((macro) => (
            <NoMacro key={macro.id} macro={macro} selecao={selecao} onSelecionar={onSelecionar} />
          ))
        )}
      </div>
    </div>
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
}) {
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
    </div>
  );
}

function NoMacro({
  macro,
  selecao,
  onSelecionar,
}: {
  macro: MacroNode;
  selecao: Selecao;
  onSelecionar: (s: Selecao) => void;
}) {
  const [expandido, setExpandido] = useState(false);
  const status = statusSomaFilhos(macro.classes);

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
      />
      {expandido &&
        macro.classes.map((classe) => (
          <NoClasse key={classe.id} classe={classe} selecao={selecao} onSelecionar={onSelecionar} />
        ))}
    </div>
  );
}

function NoClasse({
  classe,
  selecao,
  onSelecionar,
}: {
  classe: ClasseNode;
  selecao: Selecao;
  onSelecionar: (s: Selecao) => void;
}) {
  const [expandido, setExpandido] = useState(false);
  const status = statusSomaFilhos(classe.setores);

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
      />
      {expandido &&
        classe.setores.map((setor) => (
          <NoSetor key={setor.id} setor={setor} selecao={selecao} onSelecionar={onSelecionar} />
        ))}
    </div>
  );
}

function NoSetor({
  setor,
  selecao,
  onSelecionar,
}: {
  setor: SetorNode;
  selecao: Selecao;
  onSelecionar: (s: Selecao) => void;
}) {
  const [expandido, setExpandido] = useState(false);

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
