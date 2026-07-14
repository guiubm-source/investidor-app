import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { obterRelatorioIR } from "@/lib/ir/actions";
import ImpostoRendaView from "./ImpostoRendaView";

export default async function ImpostoRendaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const anoAtual = new Date().getFullYear();
  const relatorio = await obterRelatorioIR(anoAtual);

  return (
    <div className="px-6 py-10">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-medium text-ink mb-1">Imposto de Renda</h1>
        <p className="text-sm text-muted mb-2">
          Relatório auxiliar para a declaração — ações, FIIs, renda fixa, cripto e ativos
          internacionais, a partir da Carteira.
        </p>
        <div className="rounded-md bg-surface-2 border border-border px-3 py-2 mb-8 text-xs text-muted">
          ⚠️ Isto é um relatório <strong>auxiliar</strong>, não consultoria tributária — o app não
          substitui um contador. Day trade é detectado por aproximação (compra e venda do mesmo
          ativo no mesmo dia), não por casamento real de ordens. Confira os números antes de
          declarar.
        </div>
        <ImpostoRendaView relatorioInicial={relatorio} />
      </div>
    </div>
  );
}
