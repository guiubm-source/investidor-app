"use client";

import { useEffect, useState } from "react";
import { obterRelatorioIR, obterDeclaracaoAtualIR, avisosEscopoIR, type RelatorioIR } from "@/lib/ir/actions";
import type { DeclaracaoComPerfil } from "@/lib/ir/consultas/declaracao";
import type { AvisoEscopoIR } from "@/lib/ir/tipos";
import QuestionarioIR from "./QuestionarioIR";

const formatarMoeda = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatarMes = (anoMes: string) => {
  const [ano, mes] = anoMes.split("-");
  return `${mes}/${ano}`;
};

function CardPerfilFiscal({
  declaracaoComPerfil,
  onRefazer,
}: {
  declaracaoComPerfil: DeclaracaoComPerfil;
  onRefazer: () => void;
}) {
  const [avisos, setAvisos] = useState<AvisoEscopoIR[]>([]);

  useEffect(() => {
    if (!declaracaoComPerfil.perfil) return;
    avisosEscopoIR(declaracaoComPerfil.perfil).then(setAvisos);
  }, [declaracaoComPerfil.perfil]);

  if (!declaracaoComPerfil.perfil) return null;

  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink">Perfil fiscal</p>
        <button onClick={onRefazer} className="text-xs text-accent hover:underline">
          Refazer questionário
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div>
          <p className="text-faint">Residência</p>
          <p className="text-ink">{declaracaoComPerfil.perfil.residenteBrasil ? "Brasil" : "Fora do Brasil"}</p>
        </div>
        <div>
          <p className="text-faint">Status EUA</p>
          <p className="text-ink">{declaracaoComPerfil.perfil.nonresidentAlien ? "Nonresident alien" : "Outro"}</p>
        </div>
        <div>
          <p className="text-faint">Versão de regras</p>
          <p className="text-ink">{declaracaoComPerfil.versaoRegraEncontrada ? "vigente" : "não cadastrada"}</p>
        </div>
        <div>
          <p className="text-faint">Status da declaração</p>
          <p className="text-ink">{declaracaoComPerfil.declaracao.status}</p>
        </div>
      </div>
      {avisos.length > 0 && (
        <div className="pt-1 space-y-1">
          {avisos.map((a) => (
            <p key={a.campo} className="text-xs text-danger bg-danger-soft rounded-md px-2 py-1.5">
              <strong>{a.titulo}:</strong> {a.descricao}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ImpostoRendaView({
  relatorioInicial,
  declaracaoComPerfilInicial,
}: {
  relatorioInicial: RelatorioIR;
  declaracaoComPerfilInicial: DeclaracaoComPerfil | null;
}) {
  const [relatorio, setRelatorio] = useState(relatorioInicial);
  const [carregando, setCarregando] = useState(false);
  const [declaracaoComPerfil, setDeclaracaoComPerfil] = useState(declaracaoComPerfilInicial);
  const [mostrarQuestionario, setMostrarQuestionario] = useState(
    !declaracaoComPerfilInicial?.perfil?.confirmadoEm
  );

  const trocarAno = async (ano: number) => {
    setCarregando(true);
    const novo = await obterRelatorioIR(ano);
    setRelatorio(novo);
    setCarregando(false);
  };

  const recarregarDeclaracao = async () => {
    const novo = await obterDeclaracaoAtualIR();
    setDeclaracaoComPerfil(novo);
    setMostrarQuestionario(false);
  };

  if (!declaracaoComPerfil) {
    return <p className="text-sm text-faint">Não foi possível carregar a declaração deste exercício.</p>;
  }

  if (mostrarQuestionario) {
    return (
      <QuestionarioIR
        declaracaoId={declaracaoComPerfil.declaracao.id}
        valoresIniciais={
          declaracaoComPerfil.perfil
            ? {
                residente_brasil: declaracaoComPerfil.perfil.residenteBrasil,
                residente_desde: declaracaoComPerfil.perfil.residenteDesde ?? "",
                saida_definitiva: declaracaoComPerfil.perfil.saidaDefinitiva,
                us_person: declaracaoComPerfil.perfil.usPerson,
                cidadania_eua: declaracaoComPerfil.perfil.cidadaniaEua,
                green_card: declaracaoComPerfil.perfil.greenCard,
                nonresident_alien: declaracaoComPerfil.perfil.nonresidentAlien,
                dias_presenca_eua: declaracaoComPerfil.perfil.diasPresencaEua ?? "",
                possui_dependentes: declaracaoComPerfil.perfil.possuiDependentes,
                declaracao_conjunta: declaracaoComPerfil.perfil.declaracaoConjunta,
                possui_trust: declaracaoComPerfil.perfil.possuiTrust,
                possui_controlada_exterior: declaracaoComPerfil.perfil.possuiControladaExterior,
              }
            : undefined
        }
        onSalvo={recarregarDeclaracao}
      />
    );
  }

  return (
    <div className="space-y-6">
      <CardPerfilFiscal declaracaoComPerfil={declaracaoComPerfil} onRefazer={() => setMostrarQuestionario(true)} />

      <div className="flex items-center gap-2">
        <label className="label mb-0">Ano</label>
        <select
          value={relatorio.ano}
          onChange={(e) => trocarAno(Number(e.target.value))}
          className="input w-32"
          disabled={carregando}
        >
          {relatorio.anosDisponiveis.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {carregando && <span className="text-xs text-faint">Recalculando...</span>}
      </div>

      <div>
        <p className="text-xs text-faint mb-2">Resumo anual por categoria</p>
        {relatorio.resumoAnual.length === 0 ? (
          <p className="text-sm text-faint">Nenhuma venda registrada em {relatorio.ano}.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {relatorio.resumoAnual.map((r) => (
              <div key={r.categoria} className="card p-3">
                <p className="text-xs text-faint mb-1">
                  {r.categoriaLabel}
                  {r.origemMotor === "novo_fase4" && (
                    <span
                      className="ml-2 inline-block rounded-full bg-accent/10 text-accent px-2 py-0.5 text-[10px] align-middle"
                      title="Calculado pelo motor novo (ledger fiscal + classificação de day trade reais) — ainda em validação, confira com um contador."
                    >
                      em validação
                    </span>
                  )}
                </p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-faint">Vendas</p>
                    <p className="text-ink">{formatarMoeda(r.vendaTotal)}</p>
                  </div>
                  <div>
                    <p className="text-faint">Lucro líquido</p>
                    <p className={r.lucroLiquido >= 0 ? "text-success" : "text-danger"}>
                      {formatarMoeda(r.lucroLiquido)}
                    </p>
                  </div>
                  <div>
                    <p className="text-faint">Imposto devido</p>
                    <p className="text-ink">{formatarMoeda(r.impostoDevido)}</p>
                  </div>
                </div>
                {r.apuracaoAnual && (
                  <p className="text-xs text-faint mt-2">Apuração anual (15% sobre o lucro líquido do ano)</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-2 border-b border-border">
          <p className="text-xs text-faint">Detalhe mês a mês</p>
        </div>
        <div className="grid grid-cols-[70px_1fr_90px_90px_90px_60px_90px_1fr] gap-2 px-4 py-2 text-xs text-faint border-b border-border">
          <span>Mês</span>
          <span>Categoria</span>
          <span className="text-right">Vendas</span>
          <span className="text-right">Lucro</span>
          <span className="text-right">Base</span>
          <span className="text-right">Alíq.</span>
          <span className="text-right">Imposto</span>
          <span>Observação</span>
        </div>
        {relatorio.mensal.length === 0 && <p className="text-sm text-faint px-4 py-4">Nenhum lançamento neste ano.</p>}
        {relatorio.mensal.map((l, i) => (
          <div
            key={`${l.anoMes}-${l.categoria}-${i}`}
            className={`grid grid-cols-[70px_1fr_90px_90px_90px_60px_90px_1fr] gap-2 items-center px-4 py-2 text-xs border-b border-border last:border-0 ${
              l.pendente ? "bg-danger-soft" : ""
            }`}
          >
            <span className="text-ink">{formatarMes(l.anoMes)}</span>
            <span className="text-muted truncate">
              {l.categoriaLabel}
              {l.origemMotor === "novo_fase4" && (
                <span
                  className="ml-1 inline-block rounded-full bg-accent/10 text-accent px-1.5 py-0.5 text-[9px] align-middle"
                  title="Calculado pelo motor novo — ainda em validação, confira com um contador."
                >
                  em validação
                </span>
              )}
            </span>
            {l.pendente ? (
              <>
                <span className="text-right text-faint">—</span>
                <span className="text-right text-faint">—</span>
                <span className="text-right text-faint">—</span>
                <span className="text-right text-faint">—</span>
                <span className="text-right text-faint">—</span>
                <span className="text-danger truncate" title={l.motivosPendencia.join(" ")}>
                  Pendente: day trade não classificado (dados insuficientes)
                </span>
              </>
            ) : (
              <>
                <span className="text-right text-ink">{formatarMoeda(l.vendaTotal)}</span>
                <span className={`text-right ${l.lucroBruto >= 0 ? "text-success" : "text-danger"}`}>
                  {formatarMoeda(l.lucroBruto)}
                </span>
                <span className="text-right text-ink">{formatarMoeda(l.baseCalculo)}</span>
                <span className="text-right text-muted">
                  {l.aliquota !== null ? `${(l.aliquota * 100).toFixed(1)}%` : "—"}
                </span>
                <span className="text-right text-ink">
                  {l.impostoDevido !== null ? formatarMoeda(l.impostoDevido) : "—"}
                </span>
                <span className="text-faint truncate">
                  {l.isento && l.motivoIsencao}
                  {l.apuracaoAnual && "Apuração anual — ver resumo"}
                  {l.categoria === "renda_fixa_tributavel" && "Retido na fonte, sem DARF"}
                  {l.categoria === "renda_fixa_isenta" && l.motivoIsencao}
                  {l.diasMediosRetencao !== null && ` (${Math.round(l.diasMediosRetencao)}d aplicado)`}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
