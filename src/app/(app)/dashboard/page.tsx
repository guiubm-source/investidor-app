import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

  const { data: suitability } = await supabase
    .from("current_investor_suitability")
    .select("perfil_resultado, created_at")
    .eq("profile_id", user.id)
    .single();

  return (
    <div className="px-6 py-10">
      <div className="max-w-3xl mx-auto card p-8">
        <h1 className="text-2xl font-medium text-ink mb-1">
          Olá, {profile.full_name?.split(" ")[0] ?? "investidor"}
        </h1>
        <p className="text-sm text-muted mb-6">
          Este é o painel do seu app de investimentos. As próximas abas serão
          construídas aqui.
        </p>

        {suitability && (
          <div className="rounded-md bg-surface-2 border border-border px-4 py-3 text-sm text-muted">
            Seu perfil de investidor atual:{" "}
            <strong className="text-ink capitalize">{suitability.perfil_resultado}</strong>
          </div>
        )}
      </div>
    </div>
  );
}
