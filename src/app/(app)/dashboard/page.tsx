import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { obterEvolucaoCarteira } from "@/lib/ativos/preco-historico";
import EvolucaoCarteiraBlock from "./EvolucaoCarteiraBlock";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, cadastro_completo")
    .eq("id", user.id)
    .single();

  if (!profile?.cadastro_completo) redirect("/cadastro");

  const [{ data: suitability }, evolucaoCarteira] = await Promise.all([
    supabase
      .from("current_investor_suitability")
      .select("perfil_resultado, created_at")
      .eq("profile_id", user.id)
      .single(),
    obterEvolucaoCarteira(),
  ]);

  return (
    // Escala 1920x1080 (§8.62, 2026-07-29): container trocado de max-w-3xl
    // (768px) pra max-w-[1600px], mesmo valor já usado na Carteira (§8.60) e
    // no Ativo (§8.61) — mantém um único "container largo" padrão no app.
    <div className="px-10 py-10">
      <div className="max-w-[1600px] mx-auto space-y-5">
        <div className="card p-8">
          <h1 className="text-3xl font-medium text-ink mb-1">
            Olá, {profile.full_name?.split(" ")[0] ?? "investidor"}
          </h1>
          <p className="text-base text-muted mb-6">Este é o painel do seu app de investimentos.</p>

          {suitability && (
            <div className="rounded-md bg-surface-2 border border-border px-4 py-3 text-sm text-muted">
              Seu perfil de investidor atual:{" "}
              <strong className="text-ink capitalize">{suitability.perfil_resultado}</strong>
            </div>
          )}
        </div>

        <EvolucaoCarteiraBlock pontos={evolucaoCarteira} />
      </div>
    </div>
  );
}
