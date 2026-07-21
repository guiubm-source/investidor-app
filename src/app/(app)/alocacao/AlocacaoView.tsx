"use client";

import { useState } from "react";
import {
  criarClasse,
  criarMacro,
  obterEstruturaAlocacao,
  type EstruturaAlocacao,
} from "@/lib/alocacao/actions";
import { SUGESTAO_ALOCACAO_POR_PERFIL, TOLERANCIA_REBALANCEAMENTO_PP } from "@/lib/alocacao/constants";
import { FormMacro } from "./FormMacro";
import ArvoreAlocacao from "./ArvoreAlocacao";
import PainelContextual from "./PainelContextual";
import { RAIZ, type Selecao } from "./arvore";
import DesvioBar from "@/components/DesvioBar";
import { useToast } from "@/components/ToastProvider";

const NOMES_PERFIL: Record<string, string> = {
  conservador: "conservador",
  moderado: "moderado",
  arrojado: "arrojado",
};

export default function AlocacaoView({
  estruturaInicial,
  perfilSugestao,
}: {
  estruturaInicial: EstruturaAlocacao;
  perfilSugestao: string | null;
}) {
  const [estrutura, setEstrutura] = useState(estruturaInicial);
  const [adicionandoMacro, setAdicionandoMacro] = useState(false);
  const [aplicandoSugestao, setAplicandoSugestao] = useState(false);
  const [selecao, setSelecao] = useState<Selecao>(RAIZ);
  const toast = useToast();

  const atualizar = async () => {
    const nova = await obterEstruturaAlocacao();
    setEstrutura(nova);
  };

  const sugestao = perfilSugestao ? SUGESTAO_ALOCACAO_POR_PERFIL[perfilSugestao] : undefined;
  const somaPesoMacros = estrutura.macros.reduce((s, m) => s + m.pesoAlvo, 0);

  /**
   * Sugestão de template aplica tudo dentro de um único Macro "Geral" (100%)
   * criado na hora — mesmo Macro-guarda-chuva usado pela migração de dado
   * existente (§8.51). O usuário pode depois dividir em mais Macros pela UI.
   */
  const usarSugestao = async () => {
    if (!sugestao) return;
    setAplicandoSugestao(true);
    const resultadoMacro = await criarMacro({ nome: "Geral", peso_alvo: 100 });
    if (resultadoMacro.error || !resultadoMacro.id) {
      toast.error(resultadoMacro.error ?? "Não foi possível criar o Macro inicial.");
      setAplicandoSugestao(false);
      return;
    }
    for (const item of sugestao) {
      await criarClasse(resultadoMacro.id, { nome: item.nome, peso_alvo: item.peso_alvo });
    }
    await atualizar();
    setAplicandoSugestao(false);
    toast.success("Sugestão de alocação aplicada.");
  };

  if (estrutura.macros.length === 0 && !adicionandoMacro) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-medium text-ink mb-1">Comece sua alocação-alvo</h2>
        <p className="text-sm text-muted mb-5">
          Defina Macros (ex. Brasil, Exterior), as classes de ativo dentro de cada um (renda fixa,
          ações, fundos imobiliários...) e o peso que cada nível deve ter.
        </p>

        {sugestao && (
          <div className="rounded-md bg-surface-2 border border-border px-4 py-3 mb-4">
            <p className="text-sm text-ink mb-2">
              Baseado no seu perfil <strong>{NOMES_PERFIL[perfilSugestao ?? ""]}</strong>, sugerimos
              começar com:
            </p>
            <ul className="text-sm text-muted mb-3">
              {sugestao.map((s) => (
                <li key={s.nome}>
                  {s.nome} — {s.peso_alvo}%
                </li>
              ))}
            </ul>
            <button onClick={usarSugestao} disabled={aplicandoSugestao} className="btn btn-primary">
              {aplicandoSugestao ? "Aplicando..." : "Usar esta sugestão"}
            </button>
          </div>
        )}

        <button onClick={() => setAdicionandoMacro(true)} className="btn btn-secondary">
          Começar do zero
        </button>

        {adicionandoMacro && (
          <div className="card p-4 mt-4">
            <FormMacro
              onCancelar={() => setAdicionandoMacro(false)}
              onSalvo={async (dados) => {
                const resultado = await criarMacro(dados);
                if (resultado.error) throw new Error(resultado.error);
                await atualizar();
                setAdicionandoMacro(false);
                toast.success("Macro criado.");
              }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {estrutura.macros.length > 0 && (
        <div className="card p-5 mb-6 space-y-3">
          <p className="text-xs text-faint mb-1">
            Resumo por Macro — banda de tolerância de {TOLERANCIA_REBALANCEAMENTO_PP} pontos
            percentuais
          </p>
          {estrutura.macros.map((macro) => (
            <DesvioBar
              key={macro.id}
              label={macro.nome}
              pesoAlvo={macro.pesoAlvo}
              pesoReal={macro.pesoReal}
              desvio={macro.desvio}
              tolerancia={TOLERANCIA_REBALANCEAMENTO_PP}
            />
          ))}
          <p className="text-xs text-faint pt-2 border-t border-border">
            Patrimônio investido informado: R${" "}
            {estrutura.patrimonioTotalInvestido.toLocaleString("pt-BR", {
              minimumFractionDigits: 2,
            })}
          </p>
        </div>
      )}

      {estrutura.macros.length > 0 && (
        <p className={`text-xs mb-2 ${somaPesoMacros > 100.01 ? "text-danger" : "text-faint"}`}>
          Soma dos pesos-alvo dos Macros: {somaPesoMacros.toFixed(1)}%
          {somaPesoMacros > 100.01
            ? ` — excede 100% em ${(somaPesoMacros - 100).toFixed(1)}pp`
            : somaPesoMacros < 99.99
              ? ` — faltam ${(100 - somaPesoMacros).toFixed(1)}pp pra fechar 100%`
              : " ✓"}
        </p>
      )}

      {/*
        Árvore (esquerda, ~60%) + editor contextual (direita, ~40%) — §8.50
        §16.2.1. Empilha em telas pequenas (responsividade completa é fase
        6); o painel é remontado (via `key`) a cada troca de seleção pra não
        vazar estado de edição de um nó pro outro.
      */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="w-full lg:w-[60%]">
          <ArvoreAlocacao estrutura={estrutura} selecao={selecao} onSelecionar={setSelecao} />
        </div>
        <div className="w-full lg:w-[40%]">
          <PainelContextual
            key={`${selecao.tipo}:${selecao.id}`}
            estrutura={estrutura}
            selecao={selecao}
            onSelecionar={setSelecao}
            onChange={atualizar}
          />
        </div>
      </div>
    </div>
  );
}
