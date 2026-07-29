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
    // Escala 1920x1080 (§8.60, 2026-07-23): container trocado de max-w-5xl
    // (1024px) pra max-w-[1600px) — em telas de 1920px, 1024px deixava quase
    // 40% da largura sem uso. 1600px foi escolhido (em vez de ocupar a tela
    // inteira) pra manter linhas de tabela com um comprimento confortável de
    // leitura; px-10 (vs px-6 antes) dá mais respiro nas bordas nessa largura
    // maior. Título/subtítulo subiram de escala junto (text-2xl→text-3xl).
    <div className="px-10 py-10">
      <div className="max-w-[1600px] mx-auto">
        <h1 className="text-3xl font-medium text-ink mb-1">Carteira</h1>
        <p className="text-base text-muted mb-8">
          Posição consolidada por classe e livro-razão de compras e vendas. Proventos são
          exclusivos da aba Proventos. Preço médio e desvio de alocação de cada ativo ficam na
          página dele, na aba Ativos.
        </p>
        <CarteiraView posicaoInicial={posicao} livroInicial={livro} ativos={ativos} />
      </div>
    </div>
  );
}
