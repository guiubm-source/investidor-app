import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { obterLivroProventos } from "@/lib/proventos/actions";
import { obterAtivosComPosicao } from "@/lib/ativos/actions";
import ProventosView from "./ProventosView";

export default async function ProventosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [livro, ativosComPosicao] = await Promise.all([
    obterLivroProventos(),
    obterAtivosComPosicao(),
  ]);
  const ativos = ativosComPosicao.map((a) => ({ id: a.id, ticker: a.ticker }));

  return (
    <div className="px-6 py-10">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-medium text-ink mb-1">Proventos</h1>
        <p className="text-sm text-muted mb-8">
          Cadastre aqui os dividendos, JCP e rendimentos recebidos. Essa é a única aba onde
          proventos são registrados — Carteira e a página de cada ativo só exibem essa
          informação.
        </p>
        <ProventosView livroInicial={livro} ativos={ativos} />
      </div>
    </div>
  );
}
