import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { obterChecklistsPorGrupo } from "@/lib/ativos/actions";
import ComparativoView from "./ComparativoView";

export default async function CompararAtivosPage({
  searchParams,
}: {
  searchParams: Promise<{ grupo?: string }>;
}) {
  const { grupo } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [acoes, fiis] = await Promise.all([
    obterChecklistsPorGrupo("acoes"),
    obterChecklistsPorGrupo("fiis"),
  ]);

  const grupoInicial = grupo === "fiis" ? "fiis" : "acoes";

  return (
    // Escala 1920x1080 (§8.63, 2026-07-29): mesmo padrão de Carteira/Ativo/Dashboard.
    <div className="px-10 py-10">
      <div className="max-w-[1600px] mx-auto">
        <ComparativoView acoesInicial={acoes} fiisInicial={fiis} grupoInicial={grupoInicial} />
      </div>
    </div>
  );
}
