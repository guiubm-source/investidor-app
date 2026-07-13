# App do Investidor

App web para gestão de investimentos, construído aba por aba.

Stack: Next.js (App Router + TypeScript + Tailwind), Supabase (Auth + Postgres com RLS), Vercel (deploy).

## Rodando localmente

1. `npm install`
2. Copie `.env.example` para `.env.local` e preencha com as chaves do seu projeto Supabase (Project Settings > API):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. `npm run dev`
4. Abra http://localhost:3000

## 1. Configurar o banco de dados (Supabase)

1. Abra seu projeto no Supabase Dashboard.
2. Vá em **SQL Editor > New query**.
3. Cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
   Isso cria as tabelas `profiles` e `investor_suitability`, a view `current_investor_suitability`, os triggers de `updated_at` e de criação automática de perfil no cadastro, e as políticas de RLS (cada usuário só acessa os próprios dados).
4. Confirme em **Table Editor** que as tabelas apareceram.

## 2. Configurar login com Google (OAuth)

1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials): crie um projeto (ou use um existente) > **APIs & Services > Credentials > Create Credentials > OAuth Client ID** (tipo "Web application").
2. No Supabase Dashboard, vá em **Authentication > Providers > Google** para ver a **Redirect URL** exata (algo como `https://SEU-PROJECT-REF.supabase.co/auth/v1/callback`) — copie e cole essa URL em "Authorized redirect URIs" no Google Cloud.
3. Copie o **Client ID** e **Client Secret** gerados pelo Google.
4. Volte ao Supabase > **Authentication > Providers > Google**, habilite o provider, cole Client ID/Secret e salve.
5. Em **Authentication > URL Configuration**, adicione `http://localhost:3000` e, depois do deploy, a URL da Vercel em "Redirect URLs".

## 3. Confirmação de email

Por padrão o Supabase exige confirmação de email antes do primeiro login — isso já é tratado no fluxo de cadastro (tela "Confirme seu email"). Para desativar durante desenvolvimento (não recomendado em produção): **Authentication > Providers > Email** > desmarque "Confirm email".

## 4. Deploy na Vercel

1. Repositório já importado: `guiubm-source/investidor-app`.
2. Em **Project Settings > Environment Variables**, adicione as mesmas variáveis do `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Deploy.
4. Depois do primeiro deploy, volte ao Supabase > **Authentication > URL Configuration** e adicione a URL da Vercel (`https://seu-projeto.vercel.app`) em "Site URL" e "Redirect URLs".

## 5. Subindo o código para o GitHub

Dentro desta pasta, no terminal:

```bash
git init
git add .
git commit -m "Login e cadastro do investidor"
git branch -M main
git remote add origin https://github.com/guiubm-source/investidor-app.git
git push -u origin main
```

Se a pasta já tiver `.git`, pule `git init` e `git remote add` e rode só `add/commit/push`.

**Importante:** apague a pasta `node_modules` antes de rodar `npm install` pela primeira vez nesta pasta — alguns arquivos temporários de uma tentativa de instalação ficaram presos aqui e podem ser ignorados/removidos com segurança (o `.gitignore` já impede que `node_modules` seja commitado).

## Abas construídas até agora

- `/` — landing simples com links para login e cadastro
- `/login` — entrar (email/senha + Google) + recuperação de senha (`/esqueci-senha`, `/redefinir-senha`)
- `/cadastro` — cadastro do investidor: conta → dados pessoais → situação financeira → objetivos → experiência → tolerância a risco → perfil calculado
- `/dashboard` — placeholder pós-cadastro (as próximas abas entram aqui)

## Banco de dados

- `profiles`: dados pessoais (1 linha por usuário, criada automaticamente no signup via trigger)
- `investor_suitability`: histórico do questionário de suitability — **nunca é sobrescrito**, cada novo preenchimento gera uma linha nova (importante para rastreabilidade/compliance)
- `current_investor_suitability`: view com o preenchimento mais recente de cada usuário

RLS garante que cada usuário só vê e edita os próprios dados.

## Aviso importante

O cálculo de perfil de investidor (`src/lib/suitability/score.ts`) usa uma metodologia de pontuação simplificada, adequada para este MVP. Antes de usar em produção para orientar decisões reais de investimento, revise a metodologia com um profissional de compliance — a regra de suitability da CVM exige metodologia tecnicamente defensável e documentada.

## Próximos passos

Uma aba por vez: me diga qual é a próxima (carteira de investimentos, lançamento de ativos, extrato, metas financeiras etc.) e seguimos com o mesmo processo.
