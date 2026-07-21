import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  obterRelatorioIR,
  obterDeclaracaoAtualIR,
  obterBensDireitosIR,
  obterTabelaGruposCodigosIR,
  obterDashboardIR,
} from "@/lib/ir/actions";
import ImpostoRendaView from "./ImpostoRendaView";

export default async function ImpostoRendaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const anoAtual = new Date().getFullYear();
  const [relatorio, declaracaoComPerfil] = await Promise.all([obterRelatorioIR(anoAtual), obterDeclaracaoAtualIR()]);

  const [bensInicial, tabelaGrupos, dashboardInicial] = await Promise.all([
    declaracaoComPerfil
      ? obterBensDireitosIR(declaracaoComPerfil.declaracao.id, declaracaoComPerfil.declaracao.anoCalendario)
      : Promise.resolve({ itens: [], ativosComPendencia: [] }),
    obterTabelaGruposCodigosIR(),
    obterDashboardIR(anoAtual),
  ]);

  return (
    <div className="px-6 py-10">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-medium text-ink mb-1">Imposto de Renda</h1>
        {declaracaoComPerfil && (
          <p className="text-xs text-faint mb-1">
            Exercício {declaracaoComPerfil.declaracao.exercicio} — ano-calendário{" "}
            {declaracaoComPerfil.declaracao.anoCalendario}
          </p>
        )}
        <p className="text-sm text-muted mb-2">
          Relatório auxiliar para a declaração — ações, FIIs, renda fixa, cripto e ativos
          internacionais, a partir da Carteira.
        </p>
        <div className="rounded-md bg-surface-2 border border-border px-3 py-2 mb-8 text-xs text-muted">
          ⚠️ Isto é um relatório <strong>auxiliar</strong>, não consultoria tributária — o app não
          substitui um contador nem transmite a declaração à Receita Federal. Day trade é detectado
          por aproximação (compra e venda do mesmo ativo no mesmo dia), não por casamento real de
          ordens. Confira os números antes de declarar.
        </div>
        <ImpostoRendaView
          relatorioInicial={relatorio}
          declaracaoComPerfilInicial={declaracaoComPerfil}
          bensInicial={bensInicial}
          tabelaGrupos={tabelaGrupos}
          dashboardInicial={dashboardInicial}
        />
      </div>
    </div>
  );
}
