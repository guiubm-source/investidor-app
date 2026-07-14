import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Mantém a sessão do usuário sempre atualizada (renova o token quando expira).
 * Chamado pelo middleware.ts em toda requisição.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANTE: não remover. Isso renova o token de sessão se necessário.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rotasProtegidas = [
    "/dashboard",
    "/configuracoes",
    "/alocacao",
    "/carteira",
    "/proventos",
    "/ativos",
    "/cadastro/perfil",
  ];
  const isRotaProtegida = rotasProtegidas.some((rota) =>
    request.nextUrl.pathname.startsWith(rota)
  );

  if (!user && isRotaProtegida) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
