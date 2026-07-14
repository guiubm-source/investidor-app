# App do Investidor — guia de trabalho

Este arquivo é lido no início de qualquer sessão de trabalho neste projeto.
Ele define **como trabalhamos** (processo) e aponta onde está **o que o app
faz** (arquitetura). Mantenha os dois documentos atualizados — eles existem
para evitar bugs por falta de contexto, não para burocracia.

## 1. Processo de trabalho (obrigatório a partir de 2026-07-13)

1. **Nada de mudanças "assumidas".** Antes de implementar qualquer
   aprimoramento, melhoria ou nova funcionalidade (não se aplica a correção
   de bug óbvio/urgente), primeiro analiso o pedido e levanto o que está
   ambíguo ou tem mais de um caminho razoável.
2. **Pergunto uma pergunta por vez.** Uso a ferramenta de pergunta ao usuário
   com UMA pergunta objetiva, aguardo a resposta, e só then sigo para a
   próxima dúvida (se houver) ou para a execução. Nunca disparo uma lista de
   perguntas de uma vez nem começo a codar em paralelo "por via das dúvidas".
3. **Execução direta e precisa.** Depois de esclarecido o escopo, implemento
   sem rodeios: sem features extras não pedidas, sem refatorações
   colaterais não combinadas.
4. **Prioridade constante: evitar bugs.** Antes de qualquer entrega:
   - Verificar que a mudança não quebra o fluxo de dados descrito no mapa
     (`docs/MAPA-DE-DADOS.md`) — em especial a regra de que cada informação
     mora em UM lugar só (ver seção "Fonte única de verdade").
   - Rodar `tsc --noEmit` (o build completo com `next build` falha neste
     ambiente por falta de acesso de rede para baixar o binário do SWC — ver
     seção 3) e checar por erros de tipo antes de considerar algo pronto.
   - Verificar arquivos editados via `wc -l -c` / checagem de bytes nulos
     (ver seção 3 — bug de corrupção de arquivo neste ambiente).
5. **Redundância de informação proposital.** O app deve manter, sempre que
   fizer sentido, mais de uma forma de conferir a mesma informação (ex.:
   comentários no schema SQL explicando o "porquê", mais este mapa de dados,
   mais tipos TypeScript explícitos nas actions) — não para duplicar dados no
   banco, mas para que humano e IA consigam auditar o comportamento do app
   sem precisar reconstruir o raciocínio do zero a cada sessão.

## 2. Onde está o quê

- **`docs/MAPA-DE-DADOS.md`** — mapa completo: entidades do banco, relações,
  fluxo de dados entre as abas (Carteira → Ativos → Alocação), regras de
  negócio (custo médio ponderado, cálculo de desvio, suitability CVM/B3),
  fluxo de autenticação, estrutura de pastas e infraestrutura (Vercel,
  Supabase, Google Cloud). **Consultar antes de qualquer mudança em lógica
  de dados.**
- **`README.md`** — instruções de setup local e deploy (voltado para o
  Guilherme rodar comandos, não para arquitetura).
- **`supabase/schema.sql`** — fonte da verdade do banco; já comentado
  explicando o porquê de cada decisão (rode sempre o arquivo inteiro).

## 3. Particularidades deste ambiente (não do app em si)

- **Corrupção de arquivo ao editar via Edit/Write** no caminho montado do
  Windows já ocorreu várias vezes (trunca ou deixa bytes nulos no final).
  Depois de qualquer Edit/Write em arquivo existente, verificar com
  `wc -l -c arquivo` e `python3 -c "print(open('arquivo','rb').read().count(b'\x00'))"`.
  Se corrompido, reescrever o arquivo inteiro via bash (heredoc ou script
  Python), não tentar um novo Edit incremental.
- **Cache do mount do bash fica velho depois de `Edit` (não depois de
  `Write`)**: já aconteceu do bash mostrar um arquivo truncado (e até
  `tsc`/`grep` falharem em cima disso) enquanto o arquivo real, lido pela
  ferramenta `Read`, estava correto e completo — não é corrupção de verdade,
  é só o mount do bash desatualizado. **`Read` é a fonte da verdade**, não o
  `wc`/`grep` via bash. Se o bash parecer mostrar algo truncado logo depois
  de um `Edit`, confirme primeiro com `Read`; se o arquivo real estiver OK
  mas o bash insistir em mostrar a versão velha, force a sincronização
  reescrevendo o arquivo inteiro via `cat > arquivo << 'EOF' ... EOF` no
  bash (não um novo `Edit`).
- **`npm run build` falha neste sandbox** por falta de rede para baixar o
  binário `@next/swc-linux-x64-gnu`. Usar `./node_modules/.bin/tsc --noEmit`
  para checagem de tipos; o build real acontece na Vercel.
- **Nunca lido com credenciais do usuário** (tokens de GitHub, senhas, etc.)
  mesmo que eu mesmo as gere. Comandos `git` que exigem autenticação são
  passados para o Guilherme rodar no PowerShell dele.
- **Next.js 16**: middleware foi renomeado para `proxy.ts` e deve ficar em
  `src/proxy.ts` (mesmo nível de `src/app`), rodando em runtime Node.js por
  padrão — necessário porque `@supabase/ssr` depende de módulos Node.

## 4. Infraestrutura (referência rápida)

- **Repositório GitHub:** `guiubm-source/investidor-app` (branch `main`,
  deploy automático via integração Vercel).
- **Vercel:** projeto `app-do-investidor`, produção em
  `https://app-do-investidor.vercel.app`. Framework Preset deve ser
  **Next.js** (não "Other" — já causou bug de 404 geral).
- **Supabase:** projeto `investidor-app` (org `guiubm-source's Org`), ref
  `kkmqlcdoitjrttobhaud`. URL Configuration aponta Site URL/Redirect URLs
  para a URL de produção acima + `http://localhost:3000` para dev.
- **Google Cloud (OAuth):** projeto `App do Investidor`
  (`infinite-byte-502321-n4`), app OAuth em produção (não precisa de
  verificação — só escopos básicos openid/email/profile).
