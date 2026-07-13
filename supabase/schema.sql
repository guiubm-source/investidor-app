-- ============================================================================
-- Schema: autenticação + cadastro do investidor + Ativos + Alocação + Carteira
-- Rode este script inteiro no Supabase Dashboard > SQL Editor > New query
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. PROFILES — dados pessoais do usuário (1 linha por usuário autenticado)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  full_name     text,
  cpf           text unique,
  birth_date    date,
  phone         text,
  cadastro_completo boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is 'Dados pessoais do investidor, 1 linha por usuário.';

-- ----------------------------------------------------------------------------
-- 2. INVESTOR_SUITABILITY — histórico do questionário de perfil (API/suitability)
--    Cada preenchimento gera uma NOVA linha (não sobrescreve), preservando o
--    histórico exigido para fins de compliance (CVM Resolução 30 / regras B3).
-- ----------------------------------------------------------------------------
create table if not exists public.investor_suitability (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles (id) on delete cascade,

  -- Objetivos e horizonte
  objetivo_investimento text not null
    check (objetivo_investimento in ('preservacao_capital','geracao_renda','crescimento_patrimonio','especulacao')),
  horizonte_investimento text not null
    check (horizonte_investimento in ('curto_prazo','medio_prazo','longo_prazo')),
  necessidade_liquidez text not null
    check (necessidade_liquidez in ('imediata','ate_1_ano','sem_necessidade')),

  -- Situação financeira
  renda_mensal numeric(14,2) not null check (renda_mensal >= 0),
  patrimonio_total numeric(14,2) not null check (patrimonio_total >= 0),
  percentual_patrimonio_a_investir numeric(5,2) check (percentual_patrimonio_a_investir between 0 and 100),

  -- Conhecimento e experiência
  conhecimento_mercado text not null
    check (conhecimento_mercado in ('nenhum','basico','intermediario','avancado')),
  experiencia_renda_fixa text not null
    check (experiencia_renda_fixa in ('nenhuma','pouca','moderada','ampla')),
  experiencia_fundos text not null
    check (experiencia_fundos in ('nenhuma','pouca','moderada','ampla')),
  experiencia_acoes text not null
    check (experiencia_acoes in ('nenhuma','pouca','moderada','ampla')),
  experiencia_derivativos text not null
    check (experiencia_derivativos in ('nenhuma','pouca','moderada','ampla')),

  -- Tolerância a risco
  tolerancia_perda text not null
    check (tolerancia_perda in ('baixa','media','alta')),
  percentual_perda_aceitavel numeric(5,2) check (percentual_perda_aceitavel between 0 and 100),
  reacao_a_perda text not null
    check (reacao_a_perda in ('venderia_tudo','venderia_parte','manteria','compraria_mais')),

  -- Resultado calculado (ver src/lib/suitability/score.ts)
  score integer not null check (score >= 0),
  perfil_resultado text not null
    check (perfil_resultado in ('conservador','moderado','arrojado')),

  created_at timestamptz not null default now()
);

comment on table public.investor_suitability is 'Histórico do questionário de suitability (análise de perfil do investidor). Nunca é atualizado, só recebe novas linhas.';

create index if not exists idx_investor_suitability_profile_id_created_at
  on public.investor_suitability (profile_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 3. VIEW de conveniência: perfil de suitability mais recente de cada usuário
-- ----------------------------------------------------------------------------
create or replace view public.current_investor_suitability as
select distinct on (profile_id) *
from public.investor_suitability
order by profile_id, created_at desc;

-- ----------------------------------------------------------------------------
-- 4. updated_at automático
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Criação automática de profile ao cadastrar um novo usuário (auth.users)
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 6. RLS (Row Level Security) — cada usuário só acessa os próprios dados
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.investor_suitability enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Insert em profiles é feito pelo trigger (security definer); usuários comuns
-- não precisam de policy de insert direta, mas deixamos uma por segurança
-- caso algum fluxo futuro precise inserir manualmente.
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "suitability_select_own" on public.investor_suitability;
create policy "suitability_select_own" on public.investor_suitability
  for select using (auth.uid() = profile_id);

drop policy if exists "suitability_insert_own" on public.investor_suitability;
create policy "suitability_insert_own" on public.investor_suitability
  for insert with check (auth.uid() = profile_id);

-- Sem policy de update/delete em investor_suitability de propósito:
-- o histórico é imutável (compliance). Uma nova resposta = nova linha.

-- ============================================================================
-- 7. ALOCAÇÃO — estrutura-alvo em 2 camadas (classe > setor). Define o MODELO
--    de carteira desejado, independente de quais ativos você possui.
--    profile_id é repetido (denormalizado) de propósito: simplifica e acelera
--    as políticas de RLS, evitando joins/subqueries.
-- ============================================================================

-- 7.1 Classes de ativo (Renda Fixa, Ações, FIIs, etc.) — peso-alvo somando
--     100% do patrimônio total do usuário.
create table if not exists public.alocacao_classes (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  nome        text not null,
  peso_alvo   numeric(5,2) not null check (peso_alvo between 0 and 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id, nome)
);

comment on table public.alocacao_classes is 'Nível 1 da estrutura-alvo: classes de ativo (ex. Renda Fixa, Ações, FIIs).';

-- 7.2 Setores/segmentos dentro de uma classe (ex. dentro de Ações: Financeiro,
--     Tecnologia; dentro de FIIs: Lajes Corporativas, Logística) — peso-alvo
--     somando 100% daquela classe.
create table if not exists public.alocacao_setores (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  classe_id   uuid not null references public.alocacao_classes (id) on delete cascade,
  nome        text not null,
  peso_alvo   numeric(5,2) not null check (peso_alvo between 0 and 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (classe_id, nome)
);

comment on table public.alocacao_setores is 'Nível 2 da estrutura-alvo: setor ou segmento dentro de uma classe.';

create index if not exists idx_alocacao_setores_classe_id on public.alocacao_setores (classe_id);

-- updated_at automático
drop trigger if exists trg_alocacao_classes_updated_at on public.alocacao_classes;
create trigger trg_alocacao_classes_updated_at
  before update on public.alocacao_classes
  for each row execute function public.set_updated_at();

drop trigger if exists trg_alocacao_setores_updated_at on public.alocacao_setores;
create trigger trg_alocacao_setores_updated_at
  before update on public.alocacao_setores
  for each row execute function public.set_updated_at();

-- RLS
alter table public.alocacao_classes enable row level security;
alter table public.alocacao_setores enable row level security;

drop policy if exists "alocacao_classes_all_own" on public.alocacao_classes;
create policy "alocacao_classes_all_own" on public.alocacao_classes
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

drop policy if exists "alocacao_setores_all_own" on public.alocacao_setores;
create policy "alocacao_setores_all_own" on public.alocacao_setores
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- ============================================================================
-- 8. ATIVOS — registro mestre dos investimentos individuais. É o "motor
--    central" do app: identidade (ticker/tipo), classificação (setor, que já
--    carrega a classe) e peso-alvo dentro do setor moram AQUI, e em nenhum
--    outro lugar — Alocação e Carteira só leem esses dados, nunca duplicam.
--    `setor_id`/`peso_alvo` nulos = ativo ainda não classificado.
--    `preco_atual` é informado manualmente (sem API de cotação);
--    `preco_atualizado_em` guarda quando foi a última vez que isso foi feito.
--    `simbolo_tradingview` é o símbolo usado no gráfico embutido (ex.
--    BMFBOVESPA:ITSA3); se nulo, o app deriva um padrão a partir do tipo.
-- ============================================================================
create table if not exists public.ativos (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  ticker       text not null,
  nome         text,
  tipo         text not null
    check (tipo in ('acao','fii','renda_fixa','fundo','internacional','cripto','outro')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (profile_id, ticker)
);

comment on table public.ativos is 'Registro mestre de ativos: identidade, classificação (setor) e peso-alvo. Fonte única de verdade para Alocação e Carteira.';

-- `create table if not exists` acima não altera uma tabela `ativos` que já
-- existia de uma versão anterior do schema — por isso as colunas novas (e a
-- remoção da antiga `valor_atual`) precisam de ALTER TABLE explícito abaixo,
-- seguro de rodar de novo quantas vezes for preciso.
alter table public.ativos drop column if exists valor_atual;
alter table public.ativos add column if not exists setor_id uuid references public.alocacao_setores (id) on delete set null;
alter table public.ativos add column if not exists peso_alvo numeric(5,2) check (peso_alvo between 0 and 100);
alter table public.ativos add column if not exists preco_atual numeric(14,4) not null default 0 check (preco_atual >= 0);
alter table public.ativos add column if not exists preco_atualizado_em timestamptz;
alter table public.ativos add column if not exists simbolo_tradingview text;

create index if not exists idx_ativos_setor_id on public.ativos (setor_id);

drop trigger if exists trg_ativos_updated_at on public.ativos;
create trigger trg_ativos_updated_at
  before update on public.ativos
  for each row execute function public.set_updated_at();

alter table public.ativos enable row level security;

drop policy if exists "ativos_all_own" on public.ativos;
create policy "ativos_all_own" on public.ativos
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- Tabela antiga (nível 3 da alocação-alvo), substituída pelas colunas
-- setor_id/peso_alvo diretamente em `ativos` — elimina a duplicidade entre
-- "classificação do ativo" e "peso-alvo", que antes viviam em lugares
-- diferentes para a mesma informação.
drop table if exists public.alocacao_ativos;

-- ============================================================================
-- 9. CARTEIRA — livro-razão de lançamentos (compra/venda/proventos). A
--    quantidade e o preço médio de cada ativo são CALCULADOS a partir daqui
--    (método do custo médio ponderado, padrão no Brasil inclusive para
--    apuração de IR sobre renda variável) — nunca armazenados diretamente.
-- ============================================================================

-- 9.1 Corretoras — registro simples de onde cada posição está custodiada.
create table if not exists public.corretoras (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  nome        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id, nome)
);

comment on table public.corretoras is 'Corretoras/instituições onde o investidor mantém ativos custodiados.';

-- 9.2 Transações — cada compra/venda lançada pelo usuário.
create table if not exists public.transacoes (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  ativo_id       uuid not null references public.ativos (id) on delete cascade,
  corretora_id   uuid references public.corretoras (id) on delete set null,
  tipo           text not null check (tipo in ('compra','venda')),
  data           date not null,
  quantidade     numeric(18,8) not null check (quantidade > 0),
  preco_unitario numeric(14,4) not null check (preco_unitario >= 0),
  custos         numeric(14,2) not null default 0 check (custos >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.transacoes is 'Lançamentos de compra/venda por ativo. Base para cálculo de quantidade, preço médio (custo médio ponderado) e lucro realizado.';

create index if not exists idx_transacoes_ativo_id_data on public.transacoes (ativo_id, data);

-- 9.3 Proventos — dividendos, JCP e rendimentos recebidos por ativo.
create table if not exists public.proventos (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  ativo_id    uuid not null references public.ativos (id) on delete cascade,
  tipo        text not null check (tipo in ('dividendo','jcp','rendimento','outro')),
  data        date not null,
  valor_total numeric(14,2) not null check (valor_total >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.proventos is 'Proventos (dividendos, JCP, rendimentos) recebidos por ativo — usados no cálculo de retorno total.';

create index if not exists idx_proventos_ativo_id_data on public.proventos (ativo_id, data);

-- updated_at automático nas tabelas novas
drop trigger if exists trg_corretoras_updated_at on public.corretoras;
create trigger trg_corretoras_updated_at
  before update on public.corretoras
  for each row execute function public.set_updated_at();

drop trigger if exists trg_transacoes_updated_at on public.transacoes;
create trigger trg_transacoes_updated_at
  before update on public.transacoes
  for each row execute function public.set_updated_at();

drop trigger if exists trg_proventos_updated_at on public.proventos;
create trigger trg_proventos_updated_at
  before update on public.proventos
  for each row execute function public.set_updated_at();

-- RLS
alter table public.corretoras enable row level security;
alter table public.transacoes enable row level security;
alter table public.proventos enable row level security;

drop policy if exists "corretoras_all_own" on public.corretoras;
create policy "corretoras_all_own" on public.corretoras
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

drop policy if exists "transacoes_all_own" on public.transacoes;
create policy "transacoes_all_own" on public.transacoes
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

drop policy if exists "proventos_all_own" on public.proventos;
create policy "proventos_all_own" on public.proventos
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
