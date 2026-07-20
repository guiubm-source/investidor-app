import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { obterLivroRazao } from "@/lib/carteira/actions";
import { obterPosicaoConsolidada } from "@/lib/carteira/posicao";
import { obterAtivosComPosicao } from "@/lib/ativos/actions";
import CarteiraView from "./CarteiraView";

export default async function CarteiraPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [posicao, livro, ativosComPosicao] = await Promise.all([
    obterPosicaoConsolidada(),
    obterLivroRazao(),
    obterAtivosComPosicao(),
  ]);
  const ativos = ativosComPosicao.map((a) => ({ id: a.id, ticker: a.ticker, tipo: a.tipo }));

  return (
    <div className="px-6 py-10">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-medium text-ink mb-1">Carteira</h1>
        <p className="text-sm text-muted mb-8">
          Posição consolidada por classe e livro-razão de compras e vendas. Proventos são
          exclusivos da aba Proventos. Preço médio e desvio de alocação de cada ativo ficam na
          página dele, na aba Ativos.
        </p>
        <CarteiraView posicaoInicial={posicao} livroInicial={livro} ativos={ativos} />
      </div>
    </div>
  );
}
