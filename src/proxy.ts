import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// A partir do Next.js 16, "middleware" foi renomeado para "proxy" e passou a
// rodar em runtime Node.js por padrão (em vez de Edge). Isso é necessário
// aqui porque as dependências do Supabase (@supabase/supabase-js, usada por
// @supabase/ssr) referenciam módulos nativos do Node que não são suportados
// no Edge Runtime.
export async function proxy(request: NextRequest) {
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
