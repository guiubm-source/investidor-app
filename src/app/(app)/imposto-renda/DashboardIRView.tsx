"use client";

import type { DeclaracaoComPerfil } from "@/lib/ir/consultas/declaracao";
import type { CardValorUI, DashboardUI, PrejuizoGrupoUI } from "@/lib/ir/actions";

const formatarMoeda = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const LABEL_STATUS_DECLARACAO: Record<string, string> = {
  nao_iniciada: "Não iniciada",
  em_configuracao: "Em configuração",
  em_preenchimento: "Em preenchimento",
  em_revisao: "Em revisão",
  pronta_relatorio: "Pronta para relatório",
  relatorio_gerado: "Relatório gerado",
};

function CardValor({ titulo, card }: { titulo: string; card: CardValorUI }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-faint mb-1">{titulo}</p>
      {card.status === "disponivel" ? (
        <p className="text-lg text-ink">{formatarMoeda(card.valor ?? 0)}</p>
      ) : (
        <p className="text-xs text-faint italic" title={card.motivo ?? undefined}>
          Não disponível ainda
        </p>
      )}
    </div>
  );
}

export default function DashboardIRView({
  dashboard,
  declaracaoComPerfil,
}: {
  dashboard: DashboardUI;
  declaracaoComPerfil: DeclaracaoComPerfil;
}) {
  const { declaracao, perfil } = declaracaoComPerfil;
  const perfilResumo = perfil
    ? [
        perfil.residenteBrasil ? "residente no Brasil" : "não residente no Brasil",
        perfil.nonresidentAlien ? "nonresident alien nos EUA" : null,
      ]
        .filter(Boolean)
        .join(" | ")
    : "perfil não confirmado";

  return (
    <div className="space-y-6">
      <div className="card p-4 space-y-1">
        <p className="text-xs text-faint">
          Exercício {declaracao.exercicio} — ano-calendário {declaracao.anoCalendario}
        </p>
        <p className="text-xs text-muted">Perfil: {perfilResumo}</p>
        <p className="text-xs text-muted">
          Versão fiscal: {dashboard.versaoFiscalNome ?? "não cadastrada pro exercício corrente"}
        </p>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-ink">Status: {LABEL_STATUS_DECLARACAO[declaracao.status] ?? declaracao.status}</span>
          {dashboard.quantidadePendencias > 0 && (
            <span className="text-xs text-danger bg-danger-soft rounded-md px-2 py-0.5">
              {dashboard.quantidadePendencias} pendência(s) localizada(s)
            </span>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs text-faint mb-2">Obrigação de declarar</p>
        <div className="card p-3">
          <p className="text-sm text-ink capitalize">
            {dashboard.cards.obrigacaoDeclarar.status === "nao_avaliada"
              ? "Não avaliada ainda"
              : dashboard.cards.obrigacaoDeclarar.status}
          </p>
          {dashboard.cards.obrigacaoDeclarar.motivos.map((m, i) => (
            <p key={i} className="text-xs text-faint mt-1">
              {m}
            </p>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-faint mb-2">Imposto</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <CardValor titulo="Imposto a pagar" card={dashboard.cards.impostoAPagar} />
          <CardValor titulo="Imposto pago" card={dashboard.cards.impostoPago} />
          <CardValor titulo="Imposto vencido" card={dashboard.cards.impostoVencido} />
        </div>
      </div>

      <div>
        <p className="text-xs text-faint mb-2">Prejuízo acumulado por grupo (renda variável Brasil)</p>
        {dashboard.cards.prejuizoPorGrupo.length === 0 ? (
          <p className="text-sm text-faint">Nenhum prejuízo acumulado até este ano.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {dashboard.cards.prejuizoPorGrupo.map((p: PrejuizoGrupoUI) => (
              <div key={p.grupo} className="card p-3">
                <p className="text-xs text-faint mb-1">{p.label}</p>
                <p className="text-lg text-danger">{formatarMoeda(p.saldo)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-xs text-faint mb-2">IRRF</p>
        <div className="grid grid-cols-1 md:grid-cols-1 gap-3">
          <CardValor titulo="IRRF disponível (crédito)" card={dashboard.cards.irrfDisponivel} />
        </div>
      </div>

      <div>
        <p className="text-xs text-faint mb-2">Exterior</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <CardValor titulo="Ganho de capital no exterior (imposto do ano)" card={dashboard.cards.ganhoCapitalExterior} />
          <CardValor titulo="Imposto pago no exterior" card={dashboard.cards.impostoPagoExterior} />
          <CardValor titulo="Crédito exterior admitido" card={dashboard.cards.creditoExteriorAdmitido} />
        </div>
      </div>

      <div>
        <p className="text-xs text-faint mb-2">Documentos</p>
        <div className="grid grid-cols-1 md:grid-cols-1 gap-3">
          <CardValor titulo="Documentos sem comprovante" card={dashboard.cards.documentosSemComprovante} />
        </div>
      </div>
    </div>
  );
}
