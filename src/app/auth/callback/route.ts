import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Rota de callback usada pelo login com Google (OAuth) e por magic links.
 * O Supabase redireciona para cá com um "code" que trocamos por uma sessão.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/cadastro";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?erro=auth`);
}
