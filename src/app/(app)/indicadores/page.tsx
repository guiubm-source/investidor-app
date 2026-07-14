import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  obterDolar,
  obterFluxoEstrangeiro,
  obterIpca,
  obterSelic,
  obterVisaoGeral,
} from "@/lib/indicadores/actions";
import IndicadoresView from "./IndicadoresView";

export default async function IndicadoresPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [visaoGeral, selic, ipca, dolar, fluxo] = await Promise.all([
    obterVisaoGeral(),
    obterSelic(),
    obterIpca(),
    obterDolar(),
    obterFluxoEstrangeiro(),
  ]);

  return (
    <div className="px-6 py-10">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-medium text-ink mb-1">Indicadores</h1>
        <p className="text-sm text-muted mb-8">
          Selic, IPCA, Dólar e Fluxo estrangeiro — dado compartilhado (igual para qualquer usuário do
          app), lançamento manual. A Visão Geral é só leitura.
        </p>
        <IndicadoresView
          visaoGeralInicial={visaoGeral}
          selicInicial={selic}
          ipcaInicial={ipca}
          dolarInicial={dolar}
          fluxoInicial={fluxo}
        />
      </div>
    </div>
  );
}
