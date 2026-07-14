import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { obterAtivoDetalhe, obterChecklistAtivo, obterClassesSetores } from "@/lib/ativos/actions";
import { obterCorretoras } from "@/lib/carteira/actions";
import { obterRentabilidadeHistoricaAtivo } from "@/lib/ativos/preco-historico";
import AtivoDetalheView from "./AtivoDetalheView";

export default async function AtivoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [ativo, classesSetores, corretoras, checklist, rentabilidade] = await Promise.all([
    obterAtivoDetalhe(id),
    obterClassesSetores(),
    obterCorretoras(),
    obterChecklistAtivo(id),
    obterRentabilidadeHistoricaAtivo(id),
  ]);

  if (!ativo) notFound();

  return (
    <div className="px-6 py-10">
      <div className="max-w-4xl mx-auto">
        <AtivoDetalheView
          ativoInicial={ativo}
          classesSetores={classesSetores}
          corretoras={corretoras}
          checklistInicial={checklist}
          rentabilidadeInicial={rentabilidade}
        />
      </div>
    </div>
  );
}
