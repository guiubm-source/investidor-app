"use client";

import { useState } from "react";
import {
  criarClasse,
  obterEstruturaAlocacao,
  type EstruturaAlocacao,
} from "@/lib/alocacao/actions";
import { SUGESTAO_ALOCACAO_POR_PERFIL, TOLERANCIA_REBALANCEAMENTO_PP } from "@/lib/alocacao/constants";
import ClasseRow, { FormClasse } from "./ClasseRow";
import DesvioBar from "@/components/DesvioBar";

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
  const [adicionandoClasse, setAdicionandoClasse] = useState(false);
  const [aplicandoSugestao, setAplicandoSugestao] = useState(false);

  const atualizar = async () => {
    const nova = await obterEstruturaAlocacao();
    setEstrutura(nova);
  };

  const sugestao = perfilSugestao ? SUGESTAO_ALOCACAO_POR_PERFIL[perfilSugestao] : undefined;

  const usarSugestao = async () => {
    if (!sugestao) return;
    setAplicandoSugestao(true);
    for (const item of sugestao) {
      await criarClasse({ nome: item.nome, peso_alvo: item.peso_alvo });
    }
    await atualizar();
    setAplicandoSugestao(false);
  };

  if (estrutura.classes.length === 0 && !adicionandoClasse) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-medium text-ink mb-1">Comece sua alocação-alvo</h2>
        <p className="text-sm text-muted mb-5">
          Defina classes de ativo (renda fixa, ações, fundos imobiliários...) e o peso que cada
          uma deve ter no seu patrimônio.
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

        <button onClick={() => setAdicionandoClasse(true)} className="btn btn-secondary">
          Começar do zero
        </button>
      </div>
    );
  }

  return (
    <div>
      {estrutura.classes.length > 0 && (
        <div className="card p-5 mb-6 space-y-3">
          <p className="text-xs text-faint mb-1">
            Resumo por classe — banda de tolerância de {TOLERANCIA_REBALANCEAMENTO_PP} pontos
            percentuais
          </p>
          {estrutura.classes.map((classe) => (
            <DesvioBar
              key={classe.id}
              label={classe.nome}
              pesoAlvo={classe.pesoAlvo}
              pesoReal={classe.pesoReal}
              desvio={classe.desvio}
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

      {estrutura.classes.map((classe) => (
        <ClasseRow key={classe.id} classe={classe} onChange={atualizar} />
      ))}

      {adicionandoClasse ? (
        <div className="card p-4">
          <FormClasse
            onCancelar={() => setAdicionandoClasse(false)}
            onSalvo={async (dados) => {
              const resultado = await criarClasse(dados);
              if (resultado.error) throw new Error(resultado.error);
              setAdicionandoClasse(false);
              await atualizar();
            }}
          />
        </div>
      ) : (
        <button onClick={() => setAdicionandoClasse(true)} className="btn btn-secondary mt-2">
          + Adicionar classe
        </button>
      )}
    </div>
  );
}
