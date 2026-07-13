import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { obterAtivosComPosicao } from "@/lib/ativos/actions";
import AtivosView from "./AtivosView";

export default async function AtivosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const ativos = await obterAtivosComPosicao();

  return (
    <div className="px-6 py-10">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-medium text-ink mb-1">Ativos</h1>
        <p className="text-sm text-muted mb-8">
          Registro mestre dos seus investimentos: cadastre o ativo aqui, classifique-o (classe e
          setor) e abra a página dele para ver posição, desvio e histórico completo.
        </p>
        <AtivosView ativosIniciais={ativos} />
      </div>
    </div>
  );
}
