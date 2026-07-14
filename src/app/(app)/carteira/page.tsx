import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { obterLivroRazao } from "@/lib/carteira/actions";
import { obterAtivosComPosicao } from "@/lib/ativos/actions";
import CarteiraView from "./CarteiraView";

export default async function CarteiraPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [livro, ativosComPosicao] = await Promise.all([obterLivroRazao(), obterAtivosComPosicao()]);
  const ativos = ativosComPosicao.map((a) => ({ id: a.id, ticker: a.ticker }));

  return (
    <div className="px-6 py-10">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-medium text-ink mb-1">Carteira</h1>
        <p className="text-sm text-muted mb-8">
          Livro-razão de compras e vendas. Proventos aparecem aqui só como referência — cadastre-os
          na aba Proventos. Posição, preço médio e desvio de cada ativo ficam na página dele, na
          aba Ativos.
        </p>
        <CarteiraView livroInicial={livro} ativos={ativos} />
      </div>
    </div>
  );
}
