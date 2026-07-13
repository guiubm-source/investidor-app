import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Roda em runtime Node.js (em vez de Edge) porque as dependências do
// Supabase (@supabase/supabase-js, usada por @supabase/ssr) referenciam
// módulos nativos do Node (ex.: para o realtime via websockets) que não são
// suportados no Edge Runtime.
export const runtime = "nodejs";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Roda em todas as rotas, exceto arquivos estáticos e de imagem.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
