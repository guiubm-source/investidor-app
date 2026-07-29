import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  obterDolar,
  obterFluxoEstrangeiro,
  obterIpca,
  obterSelic,
  obterVisaoGeral,
} from "@/lib/indicadores/actions";
import { obterDiretoriaBacen, obterPresidentesBrasil } from "@/lib/referencia/actions";
import IndicadoresView from "./IndicadoresView";

export default async function IndicadoresPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [visaoGeral, selic, ipca, dolar, fluxo, diretoriaBacen, presidentesBrasil] = await Promise.all([
    obterVisaoGeral(),
    obterSelic(),
    obterIpca(),
    obterDolar(),
    obterFluxoEstrangeiro(),
    obterDiretoriaBacen(),
    obterPresidentesBrasil(),
  ]);

  return (
    // Escala 1920x1080 (§8.63, 2026-07-29): mesmo padrão de Carteira/Ativo/Dashboard.
    <div className="px-10 py-10">
      <div className="max-w-[1600px] mx-auto">
        <h1 className="text-3xl font-medium text-ink mb-1">Indicadores</h1>
        <p className="text-base text-muted mb-8">
          Selic, IPCA, Dólar e Fluxo estrangeiro — dado compartilhado (igual para qualquer usuário do
          app), lançamento manual. A Visão Geral é só leitura.
        </p>
        <IndicadoresView
          visaoGeralInicial={visaoGeral}
          selicInicial={selic}
          ipcaInicial={ipca}
          dolarInicial={dolar}
          fluxoInicial={fluxo}
          diretoriaBacenInicial={diretoriaBacen}
          presidentesBrasilInicial={presidentesBrasil}
        />
      </div>
    </div>
  );
}
