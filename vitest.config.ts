import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Config do Vitest — fase 12 do §8.32.37 (ver docs/MAPA-DE-DADOS.md §8.47).
 * Escopo desta fase: só os motores PUROS de IR (sem banco/rede,
 * `lib/ir/motores/*.ts` e `lib/ir/ledger/*.ts`) — por isso não precisa de
 * nenhum mock de Supabase/Next. O alias `@/*` é configurado mesmo assim
 * (mesmo mapeamento do tsconfig.json) para qualquer teste futuro que
 * precise importar algo fora de `lib/ir`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
