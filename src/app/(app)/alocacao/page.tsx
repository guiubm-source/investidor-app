import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { obterEstruturaAlocacao, obterPerfilParaSugestao } from "@/lib/alocacao/actions";
import AlocacaoView from "./AlocacaoView";

export default async function AlocacaoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [estrutura, perfilSugestao] = await Promise.all([
    obterEstruturaAlocacao(),
    obterPerfilParaSugestao(),
  ]);

  return (
    // Escala 1920x1080 (§8.63, 2026-07-29): mesmo padrão de Carteira/Ativo/Dashboard.
    <div className="px-10 py-10">
      <div className="max-w-[1600px] mx-auto">
        <h1 className="text-3xl font-medium text-ink mb-1">Alocação</h1>
        <p className="text-base text-muted mb-8">
          Defina o peso-alvo de cada classe, setor e ativo, e acompanhe o desvio em relação à
          meta.
        </p>
        <AlocacaoView estruturaInicial={estrutura} perfilSugestao={perfilSugestao} />
      </div>
    </div>
  );
}
