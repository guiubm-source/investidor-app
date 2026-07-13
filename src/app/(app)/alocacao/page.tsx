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
    <div className="px-6 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-medium text-ink mb-1">Alocação</h1>
        <p className="text-sm text-muted mb-8">
          Defina o peso-alvo de cada classe, setor e ativo, e acompanhe o desvio em relação à
          meta.
        </p>
        <AlocacaoView estruturaInicial={estrutura} perfilSugestao={perfilSugestao} />
      </div>
    </div>
  );
}
