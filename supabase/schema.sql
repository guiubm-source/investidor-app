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

-- Campos usados só pelo relatório de Imposto de Renda (aba Indicadores/IR,
-- ver docs/MAPA-DE-DADOS.md §8.5). Nulos = ainda não informado; sem efeito
-- em nenhum outro cálculo do app (posição, alocação, etc.) além do IR.
alter table public.ativos add column if not exists subtipo_renda_fixa text
  check (subtipo_renda_fixa in ('cdb','tesouro','debenture','lci','lca','cri','cra'));
alter table public.ativos add column if not exists cripto_exchange text
  check (cripto_exchange in ('nacional','estrangeira'));

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

-- Câmbio do dia da operação — só relevante para ativos.tipo = 'internacional'
-- (apuração de ganho de capital em Lei 14.754/2023 usa câmbio da compra e da
-- venda). Nulo para todo o resto (ver docs/MAPA-DE-DADOS.md §8.5.4).
alter table public.transacoes add column if not exists cambio numeric(10,4) check (cambio > 0);

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

-- Guard igual ao da seção 18: em banco que já rodou a migração de lá, a
-- coluna "data" não existe mais (virou "data_pagamento") e este índice já
-- foi trocado por idx_proventos_ativo_id_data_pagamento — sem esse guard,
-- rodar o arquivo inteiro de novo falhava aqui com "column data does not
-- exist" (o índice já tinha sido dropado na seção 18 de uma execução
-- anterior, então "if not exists" tentava recriá-lo de verdade contra uma
-- coluna que não existe mais).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'proventos' and column_name = 'data'
  ) then
    create index if not exists idx_proventos_ativo_id_data on public.proventos (ativo_id, data);
  end if;
end $$;

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

-- ============================================================================
-- 10. INDICADORES — Selic, IPCA, Dólar e Fluxo estrangeiro (macro, aba
--     Indicadores). DIFERENTE de toda tabela anterior: são dados OFICIAIS,
--     iguais para qualquer usuário do app — por isso, DE PROPÓSITO, essas
--     tabelas NÃO têm `profile_id` e não seguem RLS por dono da linha (ver
--     docs/MAPA-DE-DADOS.md seção 8.3.8). Qualquer usuário autenticado lê e
--     escreve o mesmo registro compartilhado. Cadastro é sempre manual
--     (decisão consciente de não integrar a API gratuita do BACEN/SGS por
--     enquanto — ver seção 8.3.2 do mapa). Reavaliar RLS se o app deixar de
--     ser de uso pessoal.
-- ============================================================================

-- 10.1 Selic — log de reuniões do Copom (8x/ano, a cada ~45 dias, 2 dias
--      consecutivos). Datas de 2026 já públicas vêm pré-cadastradas (seed
--      abaixo); `taxa_definida` fica nula até a decisão sair.
create table if not exists public.indicador_selic_reunioes (
  id             uuid primary key default gen_random_uuid(),
  data_inicio    date not null,
  data_fim       date not null,
  taxa_definida  numeric(6,2) check (taxa_definida >= 0),
  decidido_em    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (data_inicio)
);

comment on table public.indicador_selic_reunioes is 'Log de reuniões do Copom (dado compartilhado, sem profile_id). taxa_definida nula = reunião ainda não aconteceu.';

drop trigger if exists trg_indicador_selic_reunioes_updated_at on public.indicador_selic_reunioes;
create trigger trg_indicador_selic_reunioes_updated_at
  before update on public.indicador_selic_reunioes
  for each row execute function public.set_updated_at();

-- Seed: calendário 2026 já público (fonte: Banco Central). Idempotente via
-- ON CONFLICT — pode rodar de novo sem duplicar nem sobrescrever taxa já
-- lançada manualmente.
insert into public.indicador_selic_reunioes (data_inicio, data_fim) values
  ('2026-03-17', '2026-03-18'),
  ('2026-04-28', '2026-04-29'),
  ('2026-06-16', '2026-06-17'),
  ('2026-08-04', '2026-08-05'),
  ('2026-09-15', '2026-09-16'),
  ('2026-11-03', '2026-11-04'),
  ('2026-12-08', '2026-12-09')
on conflict (data_inicio) do nothing;

-- 10.2 IPCA — consolidado mensal + acumulado 12 meses (meta contínua desde
--      2025, não mais por ano-calendário).
create table if not exists public.indicador_ipca_mensal (
  id                 uuid primary key default gen_random_uuid(),
  ano_mes            text not null unique check (ano_mes ~ '^\d{4}-\d{2}$'),
  variacao_pct       numeric(6,3) not null,
  acumulado_12m_pct  numeric(6,3),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.indicador_ipca_mensal is 'IPCA consolidado por mês (ano_mes formato YYYY-MM) e acumulado em 12 meses, para conferir enquadramento na meta contínua.';

drop trigger if exists trg_indicador_ipca_mensal_updated_at on public.indicador_ipca_mensal;
create trigger trg_indicador_ipca_mensal_updated_at
  before update on public.indicador_ipca_mensal
  for each row execute function public.set_updated_at();

-- 10.3 IPCA por categoria — os 9 grupos oficiais do IBGE, um lançamento por
--      mês/categoria. Ligação com indicador_ipca_mensal é só por convenção
--      de ano_mes (não FK de banco) — um mês pode ter só o consolidado
--      lançado ainda sem detalhamento por categoria.
create table if not exists public.indicador_ipca_categoria (
  id            uuid primary key default gen_random_uuid(),
  ano_mes       text not null check (ano_mes ~ '^\d{4}-\d{2}$'),
  categoria     text not null check (categoria in (
    'alimentacao_bebidas', 'habitacao', 'artigos_residencia', 'vestuario',
    'transportes', 'saude_cuidados_pessoais', 'despesas_pessoais',
    'educacao', 'comunicacao'
  )),
  variacao_pct  numeric(6,3) not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (ano_mes, categoria)
);

comment on table public.indicador_ipca_categoria is 'IPCA por grupo IBGE (9 categorias oficiais), um valor por mês/categoria.';

drop trigger if exists trg_indicador_ipca_categoria_updated_at on public.indicador_ipca_categoria;
create trigger trg_indicador_ipca_categoria_updated_at
  before update on public.indicador_ipca_categoria
  for each row execute function public.set_updated_at();

-- 10.4 Dólar — cotação mensal (fechamento/média do mês, decidido na UI).
create table if not exists public.indicador_dolar_mensal (
  id          uuid primary key default gen_random_uuid(),
  ano_mes     text not null unique check (ano_mes ~ '^\d{4}-\d{2}$'),
  cotacao     numeric(10,4) not null check (cotacao > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.indicador_dolar_mensal is 'Cotação do dólar (PTAX ou equivalente), um valor por mês.';

drop trigger if exists trg_indicador_dolar_mensal_updated_at on public.indicador_dolar_mensal;
create trigger trg_indicador_dolar_mensal_updated_at
  before update on public.indicador_dolar_mensal
  for each row execute function public.set_updated_at();

-- 10.5 Fluxo estrangeiro — saldo líquido mensal (B3), pode ser negativo.
create table if not exists public.indicador_fluxo_estrangeiro_mensal (
  id             uuid primary key default gen_random_uuid(),
  ano_mes        text not null unique check (ano_mes ~ '^\d{4}-\d{2}$'),
  saldo_liquido  numeric(16,2) not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.indicador_fluxo_estrangeiro_mensal is 'Saldo líquido mensal de fluxo de capital estrangeiro na B3 (R$, pode ser negativo = saída).';

drop trigger if exists trg_indicador_fluxo_estrangeiro_mensal_updated_at on public.indicador_fluxo_estrangeiro_mensal;
create trigger trg_indicador_fluxo_estrangeiro_mensal_updated_at
  before update on public.indicador_fluxo_estrangeiro_mensal
  for each row execute function public.set_updated_at();

-- RLS: qualquer usuário autenticado lê e escreve (dado compartilhado, sem
-- profile_id — ver comentário no topo da seção 10).
alter table public.indicador_selic_reunioes enable row level security;
alter table public.indicador_ipca_mensal enable row level security;
alter table public.indicador_ipca_categoria enable row level security;
alter table public.indicador_dolar_mensal enable row level security;
alter table public.indicador_fluxo_estrangeiro_mensal enable row level security;

drop policy if exists "indicador_selic_reunioes_authenticated" on public.indicador_selic_reunioes;
create policy "indicador_selic_reunioes_authenticated" on public.indicador_selic_reunioes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "indicador_ipca_mensal_authenticated" on public.indicador_ipca_mensal;
create policy "indicador_ipca_mensal_authenticated" on public.indicador_ipca_mensal
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "indicador_ipca_categoria_authenticated" on public.indicador_ipca_categoria;
create policy "indicador_ipca_categoria_authenticated" on public.indicador_ipca_categoria
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "indicador_dolar_mensal_authenticated" on public.indicador_dolar_mensal;
create policy "indicador_dolar_mensal_authenticated" on public.indicador_dolar_mensal
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "indicador_fluxo_estrangeiro_mensal_authenticated" on public.indicador_fluxo_estrangeiro_mensal;
create policy "indicador_fluxo_estrangeiro_mensal_authenticated" on public.indicador_fluxo_estrangeiro_mensal
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================================
-- 11. Selic avançada (numeração oficial da reunião) + cadastros de
--     referência (diretoria do Bacen, presidentes do Brasil) — decisões em
--     docs/MAPA-DE-DADOS.md §8.7 (2026-07-14). bacen_diretoria e
--     brasil_presidentes seguem o mesmo padrão de dado compartilhado da
--     seção 10 (sem profile_id, RLS auth.role() = 'authenticated') — são
--     cadastrados em Configurações, mas lidos pela aba Indicadores (Selic
--     hoje, IPCA depois) para os filtros de mandato do gráfico.
-- ============================================================================

-- 11.1 Numeração oficial da reunião do Copom ("277ª reunião"). Não dá pra
--      derivar contando linhas (numeração oficial começa em 1996 e o app
--      pode não ter o histórico completo carregado) — por isso é campo
--      próprio, preenchido via importação ou lançamento manual.
alter table public.indicador_selic_reunioes add column if not exists numero_reuniao integer;

create unique index if not exists indicador_selic_reunioes_numero_reuniao_key
  on public.indicador_selic_reunioes (numero_reuniao)
  where numero_reuniao is not null;

-- 11.2 Diretoria do Banco Central — histórico completo (presidente +
--      diretores), todos os mandatos. `presidente` é uma flag separada do
--      texto livre de `cargo` (que muda de nome ao longo das décadas) pra
--      identificar com certeza qual linha é presidência, sem parsear texto.
create table if not exists public.bacen_diretoria (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  cargo           text not null,
  presidente      boolean not null default false,
  mandato_inicio  date not null,
  mandato_fim     date,
  nomeado_por     text,
  data_posse      date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (mandato_fim is null or mandato_fim >= mandato_inicio)
);

comment on table public.bacen_diretoria is 'Diretoria completa do Bacen (presidente + diretores), todos os mandatos históricos. Dado compartilhado, sem profile_id — cadastrado em Configurações, lido pelos filtros de mandato da aba Indicadores.';

drop trigger if exists trg_bacen_diretoria_updated_at on public.bacen_diretoria;
create trigger trg_bacen_diretoria_updated_at
  before update on public.bacen_diretoria
  for each row execute function public.set_updated_at();

-- 11.3 Presidentes do Brasil — usado no filtro "mandato presidencial" do
--      gráfico de evolução da Selic (e futuramente do IPCA).
create table if not exists public.brasil_presidentes (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  mandato_inicio  date not null,
  mandato_fim     date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (mandato_fim is null or mandato_fim >= mandato_inicio)
);

comment on table public.brasil_presidentes is 'Presidentes do Brasil e período de mandato. Dado compartilhado, sem profile_id — cadastrado em Configurações, lido pelos filtros de mandato da aba Indicadores.';

drop trigger if exists trg_brasil_presidentes_updated_at on public.brasil_presidentes;
create trigger trg_brasil_presidentes_updated_at
  before update on public.brasil_presidentes
  for each row execute function public.set_updated_at();

alter table public.bacen_diretoria enable row level security;
alter table public.brasil_presidentes enable row level security;

drop policy if exists "bacen_diretoria_authenticated" on public.bacen_diretoria;
create policy "bacen_diretoria_authenticated" on public.bacen_diretoria
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "brasil_presidentes_authenticated" on public.brasil_presidentes;
create policy "brasil_presidentes_authenticated" on public.brasil_presidentes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================================
-- 12. IPCA avançado — tabela única (geral + 9 grupos), Pesos do IPCA e Metas
--     de Inflação. Decisões em docs/MAPA-DE-DADOS.md §8.8 (2026-07-14):
--     impacto por grupo é sempre calculado (peso vigente × variação), nunca
--     armazenado; acumulado ano/12m é sempre calculado por juros compostos a
--     partir das variações mensais, nunca coluna própria. peso_ipca_grupo e
--     meta_inflacao seguem o mesmo padrão de dado compartilhado da seção 10
--     (sem profile_id, RLS auth.role() = 'authenticated').
-- ============================================================================

-- 12.1 Redesenho de indicador_ipca_mensal: variacao_pct vira geral (mesmo
--      dado, nome alinhado à tabela larga) e ganha as 9 colunas de grupo +
--      metadados de importação. geral perde o not null só pelo cenário de
--      migração abaixo (mês com categoria lançada mas geral ainda não) —
--      todo fluxo novo (formulário/importação) sempre lança o geral.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'indicador_ipca_mensal' and column_name = 'variacao_pct'
  ) then
    alter table public.indicador_ipca_mensal rename column variacao_pct to geral;
  end if;
end $$;

alter table public.indicador_ipca_mensal alter column geral type numeric(8,4);
alter table public.indicador_ipca_mensal alter column geral drop not null;
alter table public.indicador_ipca_mensal drop column if exists acumulado_12m_pct;

alter table public.indicador_ipca_mensal add column if not exists alimentacao_bebidas numeric(8,4);
alter table public.indicador_ipca_mensal add column if not exists habitacao numeric(8,4);
alter table public.indicador_ipca_mensal add column if not exists artigos_residencia numeric(8,4);
alter table public.indicador_ipca_mensal add column if not exists vestuario numeric(8,4);
alter table public.indicador_ipca_mensal add column if not exists transportes numeric(8,4);
alter table public.indicador_ipca_mensal add column if not exists saude_cuidados_pessoais numeric(8,4);
alter table public.indicador_ipca_mensal add column if not exists despesas_pessoais numeric(8,4);
alter table public.indicador_ipca_mensal add column if not exists educacao numeric(8,4);
alter table public.indicador_ipca_mensal add column if not exists comunicacao numeric(8,4);
alter table public.indicador_ipca_mensal add column if not exists data_divulgacao date;
alter table public.indicador_ipca_mensal add column if not exists fonte text not null default 'IBGE';
alter table public.indicador_ipca_mensal add column if not exists observacoes text;

comment on table public.indicador_ipca_mensal is 'IPCA por competência: índice geral (geral) + variação dos 9 grupos oficiais do IBGE. Acumulado ano/12m e impacto por grupo são sempre calculados em lib/indicadores (nunca armazenados) — ver docs/MAPA-DE-DADOS.md §8.8.';
comment on column public.indicador_ipca_mensal.geral is 'Variação % do índice geral do IPCA no mês (numeric 8,4, 2 casas exibidas). Nullable só pelo cenário de migração de indicador_ipca_categoria; todo fluxo novo sempre lança o geral.';

-- 12.2 Migração de dado existente: indicador_ipca_categoria -> colunas em
--      indicador_ipca_mensal, por ano_mes. Cria a linha em indicador_ipca_mensal
--      se só existir a categoria e não o geral ainda (idempotente via
--      on conflict + updates repetíveis).
insert into public.indicador_ipca_mensal (ano_mes)
select distinct ano_mes from public.indicador_ipca_categoria
on conflict (ano_mes) do nothing;

update public.indicador_ipca_mensal m set alimentacao_bebidas = c.variacao_pct
  from public.indicador_ipca_categoria c where c.ano_mes = m.ano_mes and c.categoria = 'alimentacao_bebidas';
update public.indicador_ipca_mensal m set habitacao = c.variacao_pct
  from public.indicador_ipca_categoria c where c.ano_mes = m.ano_mes and c.categoria = 'habitacao';
update public.indicador_ipca_mensal m set artigos_residencia = c.variacao_pct
  from public.indicador_ipca_categoria c where c.ano_mes = m.ano_mes and c.categoria = 'artigos_residencia';
update public.indicador_ipca_mensal m set vestuario = c.variacao_pct
  from public.indicador_ipca_categoria c where c.ano_mes = m.ano_mes and c.categoria = 'vestuario';
update public.indicador_ipca_mensal m set transportes = c.variacao_pct
  from public.indicador_ipca_categoria c where c.ano_mes = m.ano_mes and c.categoria = 'transportes';
update public.indicador_ipca_mensal m set saude_cuidados_pessoais = c.variacao_pct
  from public.indicador_ipca_categoria c where c.ano_mes = m.ano_mes and c.categoria = 'saude_cuidados_pessoais';
update public.indicador_ipca_mensal m set despesas_pessoais = c.variacao_pct
  from public.indicador_ipca_categoria c where c.ano_mes = m.ano_mes and c.categoria = 'despesas_pessoais';
update public.indicador_ipca_mensal m set educacao = c.variacao_pct
  from public.indicador_ipca_categoria c where c.ano_mes = m.ano_mes and c.categoria = 'educacao';
update public.indicador_ipca_mensal m set comunicacao = c.variacao_pct
  from public.indicador_ipca_categoria c where c.ano_mes = m.ano_mes and c.categoria = 'comunicacao';

drop trigger if exists trg_indicador_ipca_categoria_updated_at on public.indicador_ipca_categoria;
drop table if exists public.indicador_ipca_categoria;

-- 12.3 Pesos do IPCA (Configurações → Pesos do IPCA) — cadastro por grupo com
--      vigência; usado para calcular impacto = peso vigente na competência ×
--      variação do grupo. Sem seed: pesos oficiais (metodologia POF) não são
--      inventados, ficam para o Guilherme cadastrar/confirmar.
create table if not exists public.peso_ipca_grupo (
  id              uuid primary key default gen_random_uuid(),
  grupo           text not null check (grupo in (
    'alimentacao_bebidas', 'habitacao', 'artigos_residencia', 'vestuario',
    'transportes', 'saude_cuidados_pessoais', 'despesas_pessoais',
    'educacao', 'comunicacao'
  )),
  peso_pct        numeric(6,4) not null check (peso_pct >= 0),
  vigencia_inicio date not null,
  vigencia_fim    date,
  metodologia     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);

comment on table public.peso_ipca_grupo is 'Peso (%) de cada grupo do IPCA por período de vigência (metodologia POF do IBGE muda de tempos em tempos). Usado para calcular impacto = peso vigente × variação do grupo. Dado compartilhado, sem profile_id.';

drop trigger if exists trg_peso_ipca_grupo_updated_at on public.peso_ipca_grupo;
create trigger trg_peso_ipca_grupo_updated_at
  before update on public.peso_ipca_grupo
  for each row execute function public.set_updated_at();

-- 12.4 Metas de Inflação (Configurações → Metas de Inflação) — cadastro com
--      vigência, substitui as constantes hardcoded META_IPCA_CENTRO/
--      META_IPCA_TOLERANCIA. Banda informada explicitamente (não assume
--      simetria em torno do centro, mesmo o Brasil historicamente usando
--      banda simétrica).
create table if not exists public.meta_inflacao (
  id              uuid primary key default gen_random_uuid(),
  meta_central    numeric(5,2) not null,
  banda_inferior  numeric(5,2) not null,
  banda_superior  numeric(5,2) not null,
  vigencia_inicio date not null,
  vigencia_fim    date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  check (banda_inferior <= meta_central and meta_central <= banda_superior)
);

comment on table public.meta_inflacao is 'Meta contínua de inflação (CMN) por período de vigência: centro + banda inferior/superior explícitos. Dado compartilhado, sem profile_id.';

drop trigger if exists trg_meta_inflacao_updated_at on public.meta_inflacao;
create trigger trg_meta_inflacao_updated_at
  before update on public.meta_inflacao
  for each row execute function public.set_updated_at();

-- Seed: meta contínua vigente desde 2025 (centro 3%, banda 1,5%-4,5%) — já
-- documentada em docs/MAPA-DE-DADOS.md §8.2, mesmo valor que estava hardcoded
-- em META_IPCA_CENTRO/META_IPCA_TOLERANCIA. Só insere se não houver nenhuma
-- meta cadastrada ainda (idempotente, não sobrescreve edição manual).
insert into public.meta_inflacao (meta_central, banda_inferior, banda_superior, vigencia_inicio)
select 3.00, 1.50, 4.50, '2025-01-01'
where not exists (select 1 from public.meta_inflacao);

alter table public.peso_ipca_grupo enable row level security;
alter table public.meta_inflacao enable row level security;

drop policy if exists "peso_ipca_grupo_authenticated" on public.peso_ipca_grupo;
create policy "peso_ipca_grupo_authenticated" on public.peso_ipca_grupo
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "meta_inflacao_authenticated" on public.meta_inflacao;
create policy "meta_inflacao_authenticated" on public.meta_inflacao
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================================
-- 13. Dólar avançado (granularidade diária + automação) — decisões em
--     docs/MAPA-DE-DADOS.md §8.9 (2026-07-14). indicador_dolar_mensal é
--     substituída por indicador_dolar_diario: a automação via API do Bacen
--     (PTAX, SGS série 1) faz o lançamento mensal manual ficar obsoleto —
--     backfill diário desde 1999 é estritamente superior a qualquer
--     aproximação mensal digitada à mão, então não há migração de dado, só
--     `drop table`. Continua sem profile_id (mesmo padrão de dado
--     compartilhado da seção 10), mas com uma diferença importante: a aba é
--     somente-leitura pro usuário, então a policy de "authenticated" cobre
--     só SELECT — não existe policy de insert/update/delete pra esse papel.
--     A escrita é feita só pelo cron (src/app/api/cron/dolar/route.ts) via
--     service role key, que bypassa RLS por padrão no Supabase.
-- ============================================================================

drop table if exists public.indicador_dolar_mensal;

create table if not exists public.indicador_dolar_diario (
  id          uuid primary key default gen_random_uuid(),
  data        date not null unique,
  cotacao     numeric(10,4) not null check (cotacao > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.indicador_dolar_diario is 'Cotação de fechamento diária do dólar (PTAX, Bacen SGS série 1), preenchida automaticamente por cron. Somente leitura para usuários — sem cadastro/edição manual pela UI.';

drop trigger if exists trg_indicador_dolar_diario_updated_at on public.indicador_dolar_diario;
create trigger trg_indicador_dolar_diario_updated_at
  before update on public.indicador_dolar_diario
  for each row execute function public.set_updated_at();

alter table public.indicador_dolar_diario enable row level security;

drop policy if exists "indicador_dolar_diario_select_authenticated" on public.indicador_dolar_diario;
create policy "indicador_dolar_diario_select_authenticated" on public.indicador_dolar_diario
  for select using (auth.role() = 'authenticated');

-- ============================================================================
-- 14. Ativo avançado — cotação automática (Yahoo Finance), checklist
--     comparativo (Ações/ETF/Internacional vs FIIs) e resultados
--     trimestrais. Decisões em docs/MAPA-DE-DADOS.md §8.10.
-- ============================================================================

-- 14.1 Novo tipo de ativo `etf` (B3) — não existia categoria própria antes,
--      só `internacional` ("ação/ETF exterior"). O check constraint da
--      coluna `tipo` precisa ser recriado (não dá pra só adicionar um valor
--      a um CHECK já existente).
alter table public.ativos drop constraint if exists ativos_tipo_check;
alter table public.ativos add constraint ativos_tipo_check
  check (tipo in ('acao','fii','etf','renda_fixa','fundo','internacional','cripto','outro'));

-- 14.2 Cotação automática: liga/desliga por ativo (`cotacao_automatica`) e
--      procedência do último preço salvo (`preco_fonte`) — pra UI distinguir
--      "veio do Yahoo Finance" de "informado manualmente". Tipos cotáveis
--      (acao/fii/etf/internacional/cripto) começam ligados; os demais
--      (renda_fixa/fundo/outro) começam desligados, mesmo default de antes
--      (preço 100% manual).
alter table public.ativos add column if not exists cotacao_automatica boolean not null default false;
alter table public.ativos add column if not exists preco_fonte text
  check (preco_fonte in ('yahoo_finance','manual'));

-- Backfill único: liga cotação automática pros ativos já cadastrados dos
-- tipos cotáveis. Se rodar de novo depois de o usuário desligar manualmente
-- pra algum ativo específico, volta a ligar — aceitável nesse app pessoal,
-- documentado em §8.10.
update public.ativos set cotacao_automatica = true
  where tipo in ('acao','fii','etf','internacional','cripto');

-- 14.3 Checklist comparativo — campos manuais que não vêm de
--      ativo_resultado_trimestral (hoje só a nota de governança de
--      Ações/ETF; o resto do checklist é sempre calculado, nunca
--      armazenado, ver §8.10 decisão 6).
create table if not exists public.ativo_checklist (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  ativo_id     uuid not null references public.ativos (id) on delete cascade,
  saldo_acionistas text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (ativo_id)
);

comment on table public.ativo_checklist is 'Campos manuais do checklist comparativo que não vêm dos resultados trimestrais (ex. nota de governança/estrutura de controle). O resto dos indicadores do checklist (P/L, ROE, P/VP, Dividend Yield etc.) é sempre recalculado a partir de ativo_resultado_trimestral + preco_atual + proventos, nunca armazenado aqui.';

drop trigger if exists trg_ativo_checklist_updated_at on public.ativo_checklist;
create trigger trg_ativo_checklist_updated_at
  before update on public.ativo_checklist
  for each row execute function public.set_updated_at();

alter table public.ativo_checklist enable row level security;

drop policy if exists "ativo_checklist_all_own" on public.ativo_checklist;
create policy "ativo_checklist_all_own" on public.ativo_checklist
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- 14.4 Resultados trimestrais — dados BRUTOS lançados manualmente por
--      trimestre. Ações/ETF/Internacional usam as colunas de demonstração
--      financeira; FIIs usam as colunas específicas de fundo imobiliário.
--      Todas nullable — cada ativo só preenche o grupo de colunas que faz
--      sentido pro seu tipo, e pode ficar incompleto (o motor de cálculo
--      mostra "—" pro que faltar).
create table if not exists public.ativo_resultado_trimestral (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid not null references public.profiles (id) on delete cascade,
  ativo_id              uuid not null references public.ativos (id) on delete cascade,
  ano_trimestre         text not null check (ano_trimestre ~ '^\d{4}-Q[1-4]$'),

  -- Ações / ETF / Internacional (demonstração financeira)
  receita_liquida       numeric(18,2),
  lucro_bruto           numeric(18,2),
  lucro_liquido         numeric(18,2),
  ebit                  numeric(18,2),
  ebitda                numeric(18,2),
  patrimonio_liquido    numeric(18,2),
  ativo_total           numeric(18,2),
  ativo_circulante      numeric(18,2),
  passivo_circulante    numeric(18,2),
  divida_liquida        numeric(18,2),
  divida_bruta          numeric(18,2),
  numero_acoes          bigint,

  -- FIIs
  valor_patrimonial_cota  numeric(14,4),
  numero_negocios_mes     integer,
  vacancia_financeira_pct numeric(6,2),
  vacancia_fisica_pct     numeric(6,2),
  receita_imobiliaria     numeric(18,2),
  valor_avaliacao_imoveis numeric(18,2),
  valor_m2_aluguel        numeric(10,2),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (ativo_id, ano_trimestre)
);

comment on table public.ativo_resultado_trimestral is 'Dados brutos trimestrais lançados manualmente (DRE/balanço para Ações/ETF/Internacional; métricas de fundo imobiliário para FIIs). Os índices do checklist (P/L, ROE, ROIC, margens, DL/EBIT, CAGR...) são sempre recalculados a partir daqui — nunca armazenados prontos, ver docs/MAPA-DE-DADOS.md §8.10 decisão 6.';

create index if not exists idx_ativo_resultado_trimestral_ativo_id on public.ativo_resultado_trimestral (ativo_id);

drop trigger if exists trg_ativo_resultado_trimestral_updated_at on public.ativo_resultado_trimestral;
create trigger trg_ativo_resultado_trimestral_updated_at
  before update on public.ativo_resultado_trimestral
  for each row execute function public.set_updated_at();

alter table public.ativo_resultado_trimestral enable row level security;

drop policy if exists "ativo_resultado_trimestral_all_own" on public.ativo_resultado_trimestral;
create policy "ativo_resultado_trimestral_all_own" on public.ativo_resultado_trimestral
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- ============================================================================
-- 15. Histórico de preço diário por ativo — decisões em
--     docs/MAPA-DE-DADOS.md §8.12 (2026-07-14). Duas tabelas com semânticas
--     diferentes:
--     (a) ativo_preco_diario_mercado: preço de FECHAMENTO de mercado real
--         (Yahoo Finance), COMPARTILHADO por (tipo, ticker) — não por
--         ativo_id/profile_id. O preço de PETR4 é o mesmo pra todo mundo que
--         tem PETR4, então uma única série serve todos os usuários (mesmo
--         padrão de indicador_dolar_diario, seção 13). Só cobre os tipos
--         cotáveis via Yahoo (TIPOS_COTACAO_AUTOMATICA em
--         lib/ativos/yahoo-finance.ts): acao, fii, etf, internacional,
--         cripto. Escrita só via cron (service role, bypassa RLS); somente
--         leitura pra usuários autenticados.
--     (b) ativo_preco_diario_manual: snapshot do preço informado manualmente
--         (renda_fixa, fundo, outro), por profile_id + ativo_id — aqui o
--         "ticker" é só um rótulo que o usuário escolheu, não um símbolo de
--         mercado público, então NÃO dá pra compartilhar entre usuários (dois
--         "CDB-ITAU" de pessoas diferentes são instrumentos diferentes com
--         preços diferentes). Um ponto por dia: se o usuário atualizar o
--         preço manual duas vezes no mesmo dia, a segunda sobrescreve
--         (upsert por ativo_id+data), não acumula intraday.
-- ============================================================================

create table if not exists public.ativo_preco_diario_mercado (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null check (tipo in ('acao','fii','etf','internacional','cripto')),
  ticker      text not null,
  data        date not null,
  preco       numeric(14,4) not null check (preco > 0),
  created_at  timestamptz not null default now(),
  unique (tipo, ticker, data)
);

comment on table public.ativo_preco_diario_mercado is 'Série diária de preço de fechamento por (tipo, ticker), via Yahoo Finance. Compartilhada entre todos os usuários que têm o mesmo ativo — preço de mercado é dado objetivo, não pessoal (ver docs/MAPA-DE-DADOS.md §8.12). Escrita só pelo cron (service role); somente leitura pra usuários autenticados.';

alter table public.ativo_preco_diario_mercado enable row level security;

drop policy if exists "ativo_preco_diario_mercado_select_authenticated" on public.ativo_preco_diario_mercado;
create policy "ativo_preco_diario_mercado_select_authenticated" on public.ativo_preco_diario_mercado
  for select using (auth.role() = 'authenticated');

create index if not exists idx_ativo_preco_diario_mercado_lookup
  on public.ativo_preco_diario_mercado (tipo, ticker, data);

create table if not exists public.ativo_preco_diario_manual (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  ativo_id    uuid not null references public.ativos(id) on delete cascade,
  data        date not null,
  preco       numeric(14,4) not null check (preco >= 0),
  created_at  timestamptz not null default now(),
  unique (ativo_id, data)
);

comment on table public.ativo_preco_diario_manual is 'Snapshot do preço manual (renda_fixa/fundo/outro) na data em que foi salvo via atualizarPrecoAtual — um ponto por ativo por dia (upsert). Ver docs/MAPA-DE-DADOS.md §8.12.';

alter table public.ativo_preco_diario_manual enable row level security;

drop policy if exists "ativo_preco_diario_manual_own" on public.ativo_preco_diario_manual;
create policy "ativo_preco_diario_manual_own" on public.ativo_preco_diario_manual
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

create index if not exists idx_ativo_preco_diario_manual_ativo
  on public.ativo_preco_diario_manual (ativo_id, data);

-- ============================================================================
-- 16. Sub-aba Posição (Carteira) — decisões em docs/MAPA-DE-DADOS.md §8.16
--     (2026-07-16). `internacional` sempre foi um tipo único ("ação/ETF
--     exterior", ver seção 14.1) e a nova visão de Posição agrupa por classe
--     mostrando "Stocks" e "ETF Exterior" como grupos separados — sem esse
--     campo não dá pra saber se um ativo internacional é uma ação individual
--     (AAPL) ou um ETF (VOO). Mesmo espírito de subtipo_renda_fixa/
--     cripto_exchange (seção 8): nulo = ainda não informado, sem efeito em
--     nenhuma regra de cotação/IR, só na visualização/agrupamento da Posição.
-- ============================================================================

alter table public.ativos add column if not exists subtipo_internacional text
  check (subtipo_internacional in ('acao','etf'));

-- ============================================================================
-- 17. Eventos societários (bonificação/desdobramento/grupamento) — decisões em
--     docs/MAPA-DE-DADOS.md §8.22 (2026-07-20). Modelados como um TIPO
--     ESPECIAL dentro de `transacoes` (não uma tabela separada), pra manter
--     fonte única de verdade e reaproveitar o motor de custo médio ponderado
--     já existente (calcularPosicao/aplicarTransacaoNaPosicao). Cada tipo usa
--     um subconjunto diferente de colunas:
--     - compra/venda: `quantidade` + `preco_unitario` (como sempre).
--     - desdobramento/grupamento: só `fator_proporcao` (ex. 2 = desdobra 1:2,
--       0.1 = agrupa 10:1) — sem preço nem quantidade digitados, o motor
--       multiplica a quantidade em carteira pelo fator.
--     - bonificação: `quantidade` (ações recebidas) + `valor_capitalizado`
--       (total atribuído pela empresa à capitalização, 0 se não houver) — o
--       motor soma esse valor ao custoTotal e a quantidade recebida à
--       quantidade em carteira, redistribuindo o custo médio (nunca "custo
--       zero" isolado pras ações bonificadas).
--     `quantidade`/`preco_unitario` deixam de ser NOT NULL (viram opcionais
--     conforme o tipo); a validação de qual campo é obrigatório por tipo
--     migra do CHECK simples de coluna pra um CHECK combinado por linha.
-- ============================================================================

alter table public.transacoes drop constraint if exists transacoes_tipo_check;
alter table public.transacoes add constraint transacoes_tipo_check
  check (tipo in ('compra','venda','desdobramento','grupamento','bonificacao'));

alter table public.transacoes alter column quantidade drop not null;
alter table public.transacoes alter column preco_unitario drop not null;
alter table public.transacoes drop constraint if exists transacoes_quantidade_check;
alter table public.transacoes drop constraint if exists transacoes_preco_unitario_check;

alter table public.transacoes add column if not exists fator_proporcao numeric(12,6) check (fator_proporcao > 0);
alter table public.transacoes add column if not exists valor_capitalizado numeric(14,2) check (valor_capitalizado >= 0);

comment on column public.transacoes.fator_proporcao is 'Só para desdobramento/grupamento: fator multiplicador da quantidade em carteira (2 = desdobra 1:2, 0.1 = agrupa 10:1). Nulo para os demais tipos.';
comment on column public.transacoes.valor_capitalizado is 'Só para bonificação: valor total (R$) que a empresa atribuiu à capitalização de reservas/lucro — 0 se não houver valor atribuído (bonificação se comporta como split puro). Nulo para os demais tipos.';

alter table public.transacoes drop constraint if exists transacoes_campos_por_tipo;
alter table public.transacoes add constraint transacoes_campos_por_tipo check (
  (tipo in ('compra','venda')
    and quantidade > 0 and preco_unitario >= 0
    and fator_proporcao is null and valor_capitalizado is null)
  or
  (tipo in ('desdobramento','grupamento')
    and fator_proporcao is not null and fator_proporcao > 0
    and quantidade is null and preco_unitario is null and valor_capitalizado is null)
  or
  (tipo = 'bonificacao'
    and quantidade > 0 and valor_capitalizado is not null and valor_capitalizado >= 0
    and preco_unitario is null and fator_proporcao is null)
);

-- ============================================================================
-- 18. Proventos avançado + categoria REIT — decisões em
--     docs/MAPA-DE-DADOS.md §8.23 (2026-07-20).
--     - `data` (única data que existia) vira `data_pagamento` — status
--       provisionado/recebido NUNCA é armazenado, é sempre calculado em
--       runtime comparando com a data de hoje (data_pagamento no futuro =
--       provisionado; passado/hoje = recebido). Migração: registros antigos
--       simplesmente passam a ter só `data_pagamento` preenchida (é a mesma
--       coluna renomeada, nenhum dado é perdido ou duplicado).
--     - `data_com` é NOVA e opcional (registros antigos não têm essa
--       informação; o usuário pode completar depois editando).
--     - `quantidade` + `valor_por_cota` são NOVOS e opcionais — quando os
--       dois estão preenchidos, `valor_total` é recalculado pela aplicação
--       como quantidade × valor_por_cota (fonte única = os dois campos, o
--       valor_total vira derivado); registros antigos continuam só com
--       valor_total informado direto, sem quebrar nada.
--     - REIT: novo subtipo dentro de `internacional` (junto de "acao" e
--       "etf", ver seção 16) — mesmo espírito, sem efeito em cotação/IR, só
--       agrupamento/exibição (Posição e Proventos passam a ter uma
--       categoria "REITs" separada de "Stocks"/"ETF Exterior").
-- ============================================================================

-- Rename não é idempotente por natureza (não existe "rename column if
-- exists" no Postgres) — guard manual via information_schema pra permitir
-- rodar o arquivo inteiro de novo em bancos que já tiveram essa migração
-- aplicada (nesses, a coluna "data" já não existe mais, só "data_pagamento").
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'proventos' and column_name = 'data'
  ) then
    alter table public.proventos rename column data to data_pagamento;
  end if;
end $$;

alter table public.proventos add column if not exists data_com date;
alter table public.proventos add column if not exists quantidade numeric(18,8);
alter table public.proventos add column if not exists valor_por_cota numeric(14,6);

alter table public.proventos drop constraint if exists proventos_quantidade_check;
alter table public.proventos add constraint proventos_quantidade_check
  check (quantidade is null or quantidade >= 0);
alter table public.proventos drop constraint if exists proventos_valor_por_cota_check;
alter table public.proventos add constraint proventos_valor_por_cota_check
  check (valor_por_cota is null or valor_por_cota >= 0);

comment on column public.proventos.data_pagamento is 'Data em que o provento foi (ou será) creditado na conta — coluna renomeada de "data" (2026-07-20). Status provisionado/recebido é sempre calculado em runtime (futuro = provisionado, passado/hoje = recebido), nunca armazenado.';
comment on column public.proventos.data_com is 'Data-com/data-base: último dia em que era preciso ter o ativo em carteira para ter direito ao provento. Opcional — pode ficar em branco (registros antigos, ou lançamento rápido).';
comment on column public.proventos.quantidade is 'Quantidade de cotas/ações que geraram o provento. Opcional — junto com valor_por_cota, permite a aplicação recalcular valor_total e o Dividend Yield por cota; registros antigos (sem isso) só têm valor_total informado direto.';
comment on column public.proventos.valor_por_cota is 'Valor pago por cota/ação. Opcional — quando preenchido junto com quantidade, valor_total = quantidade × valor_por_cota (calculado pela aplicação, não por trigger).';

drop index if exists idx_proventos_ativo_id_data;
create index if not exists idx_proventos_ativo_id_data_pagamento on public.proventos (ativo_id, data_pagamento);

alter table public.ativos drop constraint if exists ativos_subtipo_internacional_check;
alter table public.ativos add constraint ativos_subtipo_internacional_check
  check (subtipo_internacional is null or subtipo_internacional in ('acao','etf','reit'));

-- ============================================================================
-- 19. Proventos — tipo "Aluguel de ações" + preço médio ajustado (decisões em
--     docs/MAPA-DE-DADOS.md §8.26, 2026-07-20).
--     - Antes, aluguel de ações recebido só podia ser lançado como "outro"
--       (sem distinção). Agora vira tipo próprio — registros antigos que
--       porventura já eram aluguel e ficaram em "outro" continuam lá (não são
--       migrados automaticamente, ninguém tem como saber quais eram aluguel
--       sem o usuário reclassificar manualmente editando cada um).
--     - Nenhum novo campo pro cálculo de "preço médio ajustado" (Posição): ele
--       é 100% derivado em runtime (totalInvestidoBruto − soma de proventos
--       por ativo, já lida em obterPosicaoConsolidada), nunca armazenado.
--     - O check abaixo já inclui 'reembolso' (só criado de fato na seção 20,
--       logo depois) — na ORDEM histórica em que essas duas seções foram
--       escritas, "aluguel" veio antes de "reembolso" sozinho. Mas como o
--       script inteiro é re-executado do zero em qualquer atualização (não
--       roda só a parte nova), recriar aqui a constraint antiga (sem
--       'reembolso') falha na hora com ERROR 23514 assim que já existir
--       qualquer provento tipo 'reembolso' na base — a seção 20 alargaria de
--       volta um instante depois, mas o `alter table ... add constraint`
--       desta seção já teria sido rejeitado antes de chegar lá. Por isso a
--       lista aqui é idêntica à da seção 20 desde 2026-07-21.
-- ============================================================================

alter table public.proventos drop constraint if exists proventos_tipo_check;
alter table public.proventos add constraint proventos_tipo_check
  check (tipo in ('dividendo','jcp','rendimento','aluguel','reembolso','outro'));

-- ============================================================================
-- 20. Proventos — importação por copiar/colar + tipo "Reembolso" (decisões em
--     docs/MAPA-DE-DADOS.md §8.30, 2026-07-20).
--     - Reembolso é outro tipo que o Guilherme recebe hoje só como "outro"
--       (sem distinção) — mesma decisão de "Aluguel de ações" na seção 19:
--       vira tipo próprio, registros antigos em "outro" não são migrados
--       automaticamente.
--     - Nenhuma coluna nova pra importação em si: reaproveita
--       ativo_id/tipo/data_com/data_pagamento/quantidade/valor_por_cota já
--       existentes, mesmo padrão da importação de transações (seção
--       "Livro-razão", §8.24) — só client-side (parsing) e a mesma
--       `criarProvento` de sempre gravam.
--     - Desde 2026-07-21 a seção 19 já recria a constraint com esta MESMA
--       lista (ver comentário lá) — o drop+add abaixo virou uma
--       reafirmação idempotente, não um alargamento de fato. Mantido por
--       redundância/auditoria (CLAUDE.md §1.5), não por necessidade.
-- ============================================================================

alter table public.proventos drop constraint if exists proventos_tipo_check;
alter table public.proventos add constraint proventos_tipo_check
  check (tipo in ('dividendo','jcp','rendimento','aluguel','reembolso','outro'));

-- ============================================================================
-- 21. Imposto de Renda — fundação fiscal (fase 1 de 12 da reformulação
--     completa, decisões em docs/MAPA-DE-DADOS.md §8.32/§8.33, 2026-07-21).
--     Só a fundação entra aqui: regras versionadas, declaração, perfil
--     fiscal e pendências/confirmações. O motor de cálculo por regime
--     (renda variável, exterior, DARF etc.) e o dashboard completo são
--     fases futuras (§8.32.37) — hoje o app continua usando
--     `lib/ir/actions.ts#obterRelatorioIR` como está, sem nenhuma mudança
--     de comportamento nesta seção.
--
--     Princípio central (§8.32.4): nenhuma dessas tabelas duplica dado que
--     já mora em `ativos`/`transacoes`/`proventos` — só guarda fato
--     exclusivamente fiscal (regra legal, resposta do questionário,
--     pendência, confirmação). Resultado calculado (imposto devido, base
--     tributável etc.) nunca é persistido aqui; fica pra quando o motor de
--     cálculo (fases 4+) existir.
-- ============================================================================

-- 21.1 Regras fiscais versionadas — nenhum limite/alíquota/código vira
--      constante "eterna" no código (§8.32.4 item 3). Sem profile_id: são
--      compartilhadas entre todos os usuários, cadastradas via este script
--      (ou processo administrativo futuro), nunca pela UI do usuário comum
--      (§8.32.27.2 — "usuário autenticado apenas lê").
create table if not exists public.ir_versoes_regra (
  id              uuid primary key default gen_random_uuid(),
  jurisdicao      text not null check (jurisdicao in ('brasil','estados_unidos')),
  exercicio       integer null,
  ano_calendario  integer null,
  nome            text not null,
  versao          text not null,
  vigencia_inicio date not null,
  vigencia_fim    date null,
  publicada_em    timestamptz null,
  fonte_oficial   text null,
  hash_fonte      text null,
  -- 'rascunho' = seed inicial, ainda sem passar pela checagem completa de
  -- fontes oficiais (§8.32.40) — nunca usada pra fechar relatório final
  -- (invariante #12, §8.32.31), só pra dar aos motores futuros um lugar de
  -- onde ler parâmetro em vez de constante hardcoded.
  status          text not null default 'rascunho' check (status in ('rascunho','validada','substituida')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.ir_versoes_regra is
  'Versão de regras fiscais por jurisdição/exercício (§8.32.4 item 3). Compartilhada entre usuários, somente leitura para authenticated.';

-- 21.2 Parâmetros de cada versão (limite, alíquota, código etc.) — chave
--      livre em vez de uma coluna por parâmetro, porque o conjunto de
--      parâmetros muda de exercício pra exercício (§8.32.40).
create table if not exists public.ir_parametros_regra (
  id              uuid primary key default gen_random_uuid(),
  versao_regra_id uuid not null references public.ir_versoes_regra (id) on delete cascade,
  chave           text not null,
  valor_numero    numeric(20,8) null,
  valor_texto     text null,
  valor_json      jsonb null,
  unidade         text null,
  observacao      text null,
  unique (versao_regra_id, chave)
);
comment on table public.ir_parametros_regra is
  'Parâmetros nomeados de uma ir_versoes_regra (limite de isenção, alíquota, código de receita etc.) — nunca hardcoded no motor.';

-- 21.3 Declaração anual do titular — 1 linha por (perfil, exercício).
--      Ver ciclo de vida em §8.32.11 (nao_iniciada → ... → relatorio_gerado).
create table if not exists public.ir_declaracoes (
  id                     uuid primary key default gen_random_uuid(),
  profile_id             uuid not null references public.profiles (id) on delete cascade,
  exercicio              integer not null,
  ano_calendario         integer not null,
  versao_regra_brasil_id uuid null references public.ir_versoes_regra (id),
  status                 text not null default 'nao_iniciada'
    check (status in ('nao_iniciada','em_configuracao','em_preenchimento','em_revisao','pronta_relatorio','relatorio_gerado')),
  iniciada_em            timestamptz not null default now(),
  relatorio_gerado_em    timestamptz null,
  observacoes            text null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (profile_id, exercicio)
);
comment on table public.ir_declaracoes is
  'Declaração anual do titular (§8.32.11). exercicio ≠ ano_calendario — ver §8.32.3 item 1 (operação de 2026 cai, em regra, no exercício 2027).';

-- 21.4 Perfil fiscal — snapshot ANUAL das respostas do questionário
--      (§8.32.12/§8.32.20.1), 1 linha por declaração (não em `profiles`,
--      porque residência/US person podem mudar de ano pra ano).
create table if not exists public.ir_perfis_fiscais (
  id                          uuid primary key default gen_random_uuid(),
  profile_id                  uuid not null references public.profiles (id) on delete cascade,
  declaracao_id               uuid not null references public.ir_declaracoes (id) on delete cascade,
  residente_brasil            boolean not null default true,
  residente_desde             date null,
  saida_definitiva            boolean not null default false,
  us_person                   boolean not null default false,
  cidadania_eua               boolean not null default false,
  green_card                  boolean not null default false,
  nonresident_alien           boolean not null default true,
  dias_presenca_eua           integer null,
  possui_dependentes          boolean not null default false,
  declaracao_conjunta         boolean not null default false,
  possui_trust                boolean not null default false,
  possui_controlada_exterior  boolean not null default false,
  confirmado_em               timestamptz null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (declaracao_id)
);
comment on table public.ir_perfis_fiscais is
  'Snapshot anual do questionário inicial (§8.32.12). possui_dependentes/declaracao_conjunta/possui_trust/possui_controlada_exterior=true dispara aviso de escopo não suportado (§8.32.39) — primeira versão é só titular individual.';

-- 21.5 Pendências — dado fiscal ausente/conflitante bloqueia SÓ o que
--      depende dele (§8.32.9), nunca a declaração inteira. Fase 1 só cria a
--      tabela; a geração automática de pendência a partir de conciliação
--      real chega junto do ledger fiscal (fase 2/3, §8.32.37).
create table if not exists public.ir_pendencias (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid not null references public.profiles (id) on delete cascade,
  declaracao_id         uuid null references public.ir_declaracoes (id) on delete cascade,
  tipo                  text not null,
  severidade_tecnica    text not null check (severidade_tecnica in ('bloqueia','nao_bloqueia')),
  entidade_tipo         text not null,
  entidade_id           uuid null,
  ativo_id              uuid null references public.ativos (id) on delete set null,
  competencia_inicio    date null,
  competencia_fim       date null,
  titulo                text not null,
  descricao             text not null,
  dados_conflitantes    jsonb null,
  impacto               jsonb null,
  status                text not null default 'aberta' check (status in ('aberta','resolvida','descartada')),
  criada_em             timestamptz not null default now(),
  resolvida_em          timestamptz null
);
comment on table public.ir_pendencias is
  'Pendência fiscal localizada (§8.32.9) — bloqueia só ativo/período/ficha afetados, nunca a declaração inteira.';

-- 21.6 Confirmações — decisão explícita do titular ao resolver uma
--      pendência ou escolher entre fontes divergentes (§8.32.8/§8.32.9).
create table if not exists public.ir_confirmacoes (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references public.profiles (id) on delete cascade,
  pendencia_id        uuid null references public.ir_pendencias (id) on delete set null,
  entidade_tipo       text not null,
  entidade_id         uuid not null,
  campo               text not null,
  valor_confirmado    jsonb not null,
  fonte_escolhida     text not null,
  justificativa       text null,
  documento_id        uuid null,
  confirmado_em       timestamptz not null default now()
);
comment on table public.ir_confirmacoes is
  'Confirmação explícita do titular sobre um fato fiscal (nunca sobrescrita silenciosa entre fontes, §8.32.8).';

-- updated_at automático (reaproveita o trigger genérico da seção 4)
drop trigger if exists set_updated_at on public.ir_versoes_regra;
create trigger set_updated_at before update on public.ir_versoes_regra
  for each row execute function public.set_updated_at();

-- Sem trigger em ir_parametros_regra de propósito: essa tabela NÃO tem
-- coluna updated_at (não estava na especificação §8.32.27.2 e não faz
-- falta — parâmetro raramente é editado in-place, o normal é criar nova
-- versão). Um trigger genérico aqui quebrava com "record new has no field
-- updated_at" assim que o próprio seed da seção 21.7 tentava fazer um
-- UPDATE nesta tabela.

drop trigger if exists set_updated_at on public.ir_declaracoes;
create trigger set_updated_at before update on public.ir_declaracoes
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.ir_perfis_fiscais;
create trigger set_updated_at before update on public.ir_perfis_fiscais
  for each row execute function public.set_updated_at();

-- RLS
alter table public.ir_versoes_regra enable row level security;
alter table public.ir_parametros_regra enable row level security;
alter table public.ir_declaracoes enable row level security;
alter table public.ir_perfis_fiscais enable row level security;
alter table public.ir_pendencias enable row level security;
alter table public.ir_confirmacoes enable row level security;

-- Regras versionadas: SEM profile_id, compartilhadas — usuário comum só lê
-- (§8.32.27.2). Sem policy de insert/update/delete pra role authenticated:
-- escrita só acontece rodando este script (role dono do banco) ou, no
-- futuro, por um processo administrativo com service role.
drop policy if exists "ir_versoes_regra_select_authenticated" on public.ir_versoes_regra;
create policy "ir_versoes_regra_select_authenticated" on public.ir_versoes_regra
  for select using (auth.role() = 'authenticated');

drop policy if exists "ir_parametros_regra_select_authenticated" on public.ir_parametros_regra;
create policy "ir_parametros_regra_select_authenticated" on public.ir_parametros_regra
  for select using (auth.role() = 'authenticated');

drop policy if exists "ir_declaracoes_all_own" on public.ir_declaracoes;
create policy "ir_declaracoes_all_own" on public.ir_declaracoes
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

drop policy if exists "ir_perfis_fiscais_all_own" on public.ir_perfis_fiscais;
create policy "ir_perfis_fiscais_all_own" on public.ir_perfis_fiscais
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

drop policy if exists "ir_pendencias_all_own" on public.ir_pendencias;
create policy "ir_pendencias_all_own" on public.ir_pendencias
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

drop policy if exists "ir_confirmacoes_all_own" on public.ir_confirmacoes;
create policy "ir_confirmacoes_all_own" on public.ir_confirmacoes
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- 21.7 Seed inicial da versão 2026 (rascunho) — reaproveita os MESMOS
--      parâmetros que já estavam hardcoded em `lib/ir/actions.ts` (isenções,
--      alíquotas de day trade/swing/FII/cripto, tabela regressiva de renda
--      fixa), só movidos pra cá como primeiro passo — NENHUM valor novo foi
--      pesquisado agora. Status 'rascunho' de propósito: antes de virar
--      'validada', alguém precisa rodar a checagem de fontes oficiais do
--      §8.32.40 (Instrução Normativa do exercício, Perguntas e Respostas
--      IRPF, Manual ReVar) — isso é dívida técnica explícita, não uma
--      omissão silenciosa.
do $$
declare
  v_versao_id uuid;
begin
  -- Exercício 2027 (ano-calendário 2026) — é o que `obterDeclaracaoAtual()`
  -- usa como padrão (ano corrente em curso + 1, ver lib/ir/consultas/
  -- declaracao.ts), já que hoje (21/07/2026) o prazo do exercício 2026
  -- (ano-calendário 2025) já passou. Se um dia o app precisar reabrir um
  -- exercício anterior, basta rodar este mesmo bloco com outro par
  -- exercicio/ano_calendario — nada aqui é exclusivo de 2027.
  if not exists (
    select 1 from public.ir_versoes_regra where jurisdicao = 'brasil' and exercicio = 2027
  ) then
    insert into public.ir_versoes_regra
      (jurisdicao, exercicio, ano_calendario, nome, versao, vigencia_inicio, status, fonte_oficial)
    values
      ('brasil', 2027, 2026, 'IRPF 2027 (ano-calendário 2026) — seed inicial', 'v1-rascunho',
       '2026-01-01', 'rascunho',
       'Valores herdados de lib/ir/actions.ts pré-existente — AINDA NÃO validados contra IN/RFB do exercício 2027, ver §8.32.40.')
    returning id into v_versao_id;

    insert into public.ir_parametros_regra (versao_regra_id, chave, valor_numero, unidade, observacao) values
      (v_versao_id, 'renda_variavel.isencao_acao_swing_limite_mensal', 20000, 'BRL', 'Isenção mensal de vendas em ações — swing trade (soma do mês).'),
      (v_versao_id, 'renda_variavel.isencao_cripto_nacional_limite_mensal', 35000, 'BRL', 'Isenção mensal de vendas de cripto em exchange nacional.'),
      (v_versao_id, 'renda_variavel.aliquota_acao_swing', 0.15, 'fracao', 'Alíquota sobre ganho líquido — ações/fundos, swing trade.'),
      (v_versao_id, 'renda_variavel.aliquota_acao_day_trade', 0.20, 'fracao', 'Alíquota sobre ganho líquido — ações/fundos, day trade.'),
      (v_versao_id, 'renda_variavel.aliquota_fii', 0.20, 'fracao', 'Alíquota sobre ganho líquido — venda de cotas de FII.'),
      (v_versao_id, 'cripto.aliquota_faixa_1', 0.15, 'fracao', 'Ganho até R$5.000.000 no mês.'),
      (v_versao_id, 'cripto.aliquota_faixa_2', 0.175, 'fracao', 'Ganho de R$5.000.000,01 até R$10.000.000.'),
      (v_versao_id, 'cripto.aliquota_faixa_3', 0.20, 'fracao', 'Ganho de R$10.000.000,01 até R$30.000.000.'),
      (v_versao_id, 'cripto.aliquota_faixa_4', 0.225, 'fracao', 'Ganho acima de R$30.000.000.'),
      (v_versao_id, 'renda_fixa.regressiva_ate_180_dias', 0.225, 'fracao', 'Tabela regressiva — até 180 dias corridos.'),
      (v_versao_id, 'renda_fixa.regressiva_ate_360_dias', 0.20, 'fracao', 'Tabela regressiva — 181 a 360 dias corridos.'),
      (v_versao_id, 'renda_fixa.regressiva_ate_720_dias', 0.175, 'fracao', 'Tabela regressiva — 361 a 720 dias corridos.'),
      (v_versao_id, 'renda_fixa.regressiva_acima_720_dias', 0.15, 'fracao', 'Tabela regressiva — acima de 720 dias corridos.'),
      (v_versao_id, 'exterior_lei_14754.aliquota_padrao', 0.15, 'fracao', 'Alíquota anual padrão sobre rendimentos/ganhos de aplicações financeiras no exterior (§8.32.18.1) — AINDA NÃO valida faixas/exceções da lei.'),
      (v_versao_id, 'darf.codigo_receita_renda_variavel_comum', null, 'texto', null),
      (v_versao_id, 'darf.valor_minimo_recolhimento', 10, 'BRL', 'Abaixo disso, acumula pro próximo período compatível (§8.32.24.3).');

    update public.ir_parametros_regra
      set valor_texto = '6015'
      where versao_regra_id = v_versao_id and chave = 'darf.codigo_receita_renda_variavel_comum';
  end if;
end $$;

-- =====================================================================
-- 22. IR fase 2 (§8.32.37) — colunas fiscais em transacoes/proventos
-- =====================================================================
-- Ver docs/MAPA-DE-DADOS.md §8.35. Enriquecimento de detalhe fiscal por
-- lançamento, escopo decidido com o Guilherme: SÓ colunas (documentos/
-- upload de arquivo fica pra fase separada) e SEM os campos "de sistema"
-- (origem_tipo/origem_id/status_confirmacao/editado_manual/
-- classificacao_day_trade_status/modalidade_fiscal_confirmada) — nenhum
-- motor ainda consome esses campos de bookkeeping, isso é fase 3 (ledger
-- fiscal/conciliação). Todas as colunas abaixo são opcionais/têm default:
-- lançamentos antigos continuam válidos sem preencher nada disso.

-- 22.1 transacoes — moeda, identificação do lançamento (nota/ordem/mercado/
--      horário) e custos discriminados (corretagem/emolumentos/taxa de
--      liquidação/outras taxas). `custos` continua sendo o total que todo
--      cálculo já existente usa — ver lib/carteira/schema.ts, que soma os 4
--      campos discriminados em `custos` quando preenchidos.
alter table public.transacoes
  add column if not exists moeda text not null default 'BRL' check (moeda in ('BRL', 'USD')),
  add column if not exists horario_negociacao text,
  add column if not exists numero_nota text,
  add column if not exists numero_ordem text,
  add column if not exists mercado text,
  add column if not exists corretagem numeric(14, 2),
  add column if not exists emolumentos numeric(14, 2),
  add column if not exists taxa_liquidacao numeric(14, 2),
  add column if not exists outras_taxas numeric(14, 2);

comment on column public.transacoes.moeda is 'Moeda do lançamento — BRL sempre pra ativos nacionais, BRL ou USD pra internacional (câmbio já existe em transacoes.cambio). Default BRL preserva lançamentos antigos.';
comment on column public.transacoes.corretagem is 'Custo discriminado (§8.32.27.1) — junto com emolumentos/taxa_liquidacao/outras_taxas, soma pra `custos` quando preenchido (ver lib/carteira/schema.ts). Ainda sem motor consumidor individual (fase 3+).';

-- 22.2 proventos — valor bruto (espelha valor_total — nenhuma matemática
--      nova, mesma semântica de sempre), imposto retido na fonte, moeda,
--      câmbio (só relevante pra proventos de ativo internacional), país da
--      fonte pagadora (default 'Brasil') e identificador da fonte pagadora
--      (CNPJ do fundo/empresa, ticker no exterior, etc — texto livre).
alter table public.proventos
  add column if not exists valor_bruto numeric(14, 2),
  add column if not exists imposto_retido numeric(14, 2) not null default 0,
  add column if not exists moeda text not null default 'BRL' check (moeda in ('BRL', 'USD')),
  add column if not exists cambio numeric(10, 4) check (cambio is null or cambio > 0),
  add column if not exists pais_fonte text not null default 'Brasil',
  add column if not exists fonte_pagadora_identificador text;

comment on column public.proventos.valor_bruto is 'Espelha valor_total (quantidade × valor_por_cota) — mesmo valor, campo separado só pra alinhar nome com o vocabulário fiscal do §8.32.27.1 (bruto vs. líquido após imposto_retido). Nenhum cálculo novo aqui.';
comment on column public.proventos.imposto_retido is 'Imposto retido na fonte (ex.: withholding tax no exterior — Lei 14.754, §8.32.18.1). Default 0 preserva lançamentos antigos. Ainda sem motor de crédito de imposto (fase 7).';
comment on column public.proventos.pais_fonte is 'País da fonte pagadora do provento. Default Brasil preserva lançamentos antigos (todos nacionais até aqui).';

-- =====================================================================
-- 23. IR fase 3, segunda metade (§8.32.37) — tabela ir_retencoes
-- =====================================================================
-- Ver docs/MAPA-DE-DADOS.md §8.37. Retenções (IRRF comum/day trade, JCP,
-- renda fixa, exterior) como FATOS PRÓPRIOS (§8.32.16) — não dá pra
-- distribuir com segurança uma retenção agregada por uma única transação
-- ou provento, então isso vive em tabela separada, referenciando (sem
-- exigir) a origem quando conhecida. Só fundação nesta fase: schema +
-- RLS, sem UI e sem nada ainda populando esta tabela automaticamente —
-- isso é trabalho dos motores de regime (fase 4+), que vão decidir o que
-- é retenção "de fato" a partir dos dados de transacoes/proventos.
create table if not exists public.ir_retencoes (
  id                      uuid primary key default gen_random_uuid(),
  profile_id              uuid not null references public.profiles (id) on delete cascade,
  jurisdicao              text not null check (jurisdicao in ('brasil', 'estados_unidos', 'outro')),
  tipo                    text not null check (
                            tipo in ('irrf_comum', 'irrf_day_trade', 'jcp', 'renda_fixa', 'exterior_dividendo', 'exterior_outro')
                          ),
  competencia             date not null,
  data_retencao           date not null,
  valor_moeda_original    numeric(14, 2) not null,
  moeda                   text not null default 'BRL' check (moeda in ('BRL', 'USD')),
  cambio_utilizado        numeric(10, 4) check (cambio_utilizado is null or cambio_utilizado > 0),
  valor_reais             numeric(14, 2) not null,
  ativo_id                uuid null references public.ativos (id) on delete set null,
  transacao_id            uuid null references public.transacoes (id) on delete set null,
  provento_id             uuid null references public.proventos (id) on delete set null,
  documento_id            uuid null,
  compensavel             boolean not null default true,
  status_confirmacao      text not null default 'nao_confirmado' check (
                            status_confirmacao in ('nao_confirmado', 'confirmado_usuario', 'divergente')
                          ),
  criado_em               timestamptz not null default now()
);
comment on table public.ir_retencoes is
  'Retenção fiscal (IRRF/JCP/renda fixa/exterior) como fato próprio (§8.32.16) — o motor mantém créditos separados por tipo (ex.: IRRF de day trade NÃO é crédito perpétuo idêntico ao IRRF comum). Fundação de schema (fase 3): nenhum motor ainda escreve aqui.';
comment on column public.ir_retencoes.documento_id is 'Referência solta (sem FK ainda) para um futuro ir_documentos — documentos/upload ficou explicitamente fora do escopo desta fase (§8.35).';
comment on column public.ir_retencoes.compensavel is 'Se este valor pode ser usado como crédito/antecipação no cálculo do imposto devido — nem toda retenção é compensável (ex.: imposto exterior não comprovado, §8.32.31 item 16).';

alter table public.ir_retencoes enable row level security;

drop policy if exists "ir_retencoes_all_own" on public.ir_retencoes;
create policy "ir_retencoes_all_own" on public.ir_retencoes
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

create index if not exists ir_retencoes_profile_competencia_idx on public.ir_retencoes (profile_id, competencia);
create index if not exists ir_retencoes_profile_ativo_idx on public.ir_retencoes (profile_id, ativo_id);

-- Sem trigger set_updated_at: tabela não tem coluna updated_at (registro de
-- retenção é um fato pontual, não algo editado in-place — mesma razão de
-- ir_parametros_regra na seção 21).

-- =====================================================================
-- 24. IR fase 9 (§8.32.37) — Bens e Direitos: itens manuais + tabela de
--     grupos/códigos versionada
-- =====================================================================
-- Ver docs/MAPA-DE-DADOS.md §8.43. Escopo decidido com o Guilherme: só
-- imóveis, veículos, contas (corrente/poupança) e participações societárias
-- como itens MANUAIS — posições de investimento (ações/FIIs/renda
-- fixa/exterior) NUNCA são gravadas aqui, são recalculadas a partir do
-- ledger fiscal (fase 3) toda vez que a tela é aberta (fonte única de
-- verdade, mesmo princípio de todo o app — ver docs/MAPA-DE-DADOS.md §3).
-- Esta tabela existe só pro que o app genuinamente NÃO consegue derivar
-- sozinho.
create table if not exists public.ir_bens_direitos_manuais (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  declaracao_id     uuid not null references public.ir_declaracoes (id) on delete cascade,
  -- Grupo/código do padrão oficial da Receita (Tabela de Bens e Direitos) —
  -- texto livre em vez de enum/FK: o CONJUNTO válido de combinações muda de
  -- exercício pra exercício (§8.32.20, "sem copiar códigos fixos para todos
  -- os anos"), então a validação/sugestão na UI vem do parâmetro
  -- `bens_direitos.tabela_grupos_codigos` (versionado, ver seção de seed
  -- abaixo), nunca de uma constraint fixa no banco.
  grupo             text not null,
  codigo            text not null,
  nome              text not null,
  localizacao       text null,
  cpf_cnpj          text null,
  discriminacao     text null,
  situacao_anterior numeric(16,2) not null default 0 check (situacao_anterior >= 0),
  situacao_atual    numeric(16,2) not null default 0 check (situacao_atual >= 0),
  observacoes       text null,
  status_revisao    text not null default 'pendente' check (status_revisao in ('pendente','revisado')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.ir_bens_direitos_manuais is
  'Itens de Bens e Direitos que o app não deriva de nenhum dado já existente (imóveis, veículos, contas, participações societárias não listadas). Investimentos (ações/FIIs/renda fixa/exterior) nunca entram aqui — são montados em tempo de leitura a partir do ledger fiscal, ver lib/ir/consultas/bens-direitos.ts.';
comment on column public.ir_bens_direitos_manuais.situacao_anterior is 'Situação em 31/12 do ano-calendário ANTERIOR — custo/valor declarado, nunca valor de mercado (mesmo princípio de §8.32.18.3 pro exterior, aqui aplicado a bens em geral).';
comment on column public.ir_bens_direitos_manuais.situacao_atual is 'Situação em 31/12 do ano-calendário da declaração. Pode ser 0 com situacao_anterior > 0 quando o bem foi baixado/vendido no ano (§8.32.20.7: "ativo vendido e zerado no ano pode continuar aparecendo com situação atual zero").';

alter table public.ir_bens_direitos_manuais enable row level security;

drop policy if exists "ir_bens_direitos_manuais_all_own" on public.ir_bens_direitos_manuais;
create policy "ir_bens_direitos_manuais_all_own" on public.ir_bens_direitos_manuais
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

create index if not exists ir_bens_direitos_manuais_declaracao_idx
  on public.ir_bens_direitos_manuais (profile_id, declaracao_id);

drop trigger if exists set_updated_at on public.ir_bens_direitos_manuais;
create trigger set_updated_at before update on public.ir_bens_direitos_manuais
  for each row execute function public.set_updated_at();

-- 24.1 Seed do parâmetro `bens_direitos.tabela_grupos_codigos` — só o
--      subconjunto da tabela oficial (Receita Federal, Bens e Direitos)
--      relevante pro escopo desta fase (imóveis, veículos, contas,
--      participações societárias). Fundos/criptoativos/créditos/outros bens
--      ficam de fora por ora (nenhum motor de auto-preenchimento os cobre
--      ainda). Pesquisado em fonte pública (tabela vigente pra declaração
--      2026/ano-calendário 2025) em 2026-07-21 — AINDA NÃO confirmado se a
--      Receita alterou algo pro exercício 2027 (mesma dívida técnica de
--      §8.32.40 dos demais parâmetros seedados como 'rascunho'). Usa
--      `insert ... on conflict do update` (não o bloco `do $$ if not
--      exists $$` da seção 21.7) porque a versão de regra 2027 já pode
--      existir de uma rodada anterior deste script — precisa ser possível
--      adicionar/atualizar UM parâmetro novo sem depender da versão inteira
--      ainda não existir.
do $$
declare
  v_versao_id uuid;
begin
  select id into v_versao_id from public.ir_versoes_regra where jurisdicao = 'brasil' and exercicio = 2027;

  if v_versao_id is not null then
    insert into public.ir_parametros_regra (versao_regra_id, chave, valor_json, observacao)
    values (
      v_versao_id,
      'bens_direitos.tabela_grupos_codigos',
      '[
        {"grupo": "01", "codigo": "11", "label": "Apartamento"},
        {"grupo": "01", "codigo": "12", "label": "Casa"},
        {"grupo": "01", "codigo": "13", "label": "Terreno"},
        {"grupo": "01", "codigo": "01", "label": "Prédio residencial"},
        {"grupo": "01", "codigo": "02", "label": "Prédio comercial"},
        {"grupo": "01", "codigo": "99", "label": "Outros bens imóveis"},
        {"grupo": "02", "codigo": "01", "label": "Veículo automotor terrestre (carro, moto, caminhão)"},
        {"grupo": "02", "codigo": "99", "label": "Outros bens móveis"},
        {"grupo": "03", "codigo": "01", "label": "Ações (inclusive listadas em bolsa)"},
        {"grupo": "03", "codigo": "02", "label": "Quotas ou quinhões de capital"},
        {"grupo": "03", "codigo": "99", "label": "Outras participações societárias"},
        {"grupo": "04", "codigo": "01", "label": "Depósito em conta poupança"},
        {"grupo": "06", "codigo": "01", "label": "Depósito em conta-corrente ou conta pagamento"},
        {"grupo": "06", "codigo": "99", "label": "Outros depósitos à vista"}
      ]'::jsonb,
      'Subconjunto da Tabela de Bens e Direitos da Receita Federal (imóveis, veículos, contas, participações) — AINDA NÃO validado contra a Instrução Normativa do exercício 2027, ver §8.32.40.'
    )
    on conflict (versao_regra_id, chave) do update
      set valor_json = excluded.valor_json, observacao = excluded.observacao;
  end if;
end $$;

-- ============================================================================
-- 25. Alocação — nível Macro acima de Classe (fase 1 de 6 da reformulação
--     "Metas e estrutura", spec em docs/MAPA-DE-DADOS.md §8.50, decisões de
--     fase em §8.51). Hierarquia passa de Classe > Setor > Ativo para
--     Macro > Classe > Setor > Ativo. Classe deixa de somar 100% do
--     patrimônio total direto e passa a somar 100% DENTRO do seu Macro —
--     mesmo modelo que Setor já usa dentro de Classe (peso local vs. peso
--     global calculado, nunca persistido — ver §5.2 do mapa de dados).
-- ============================================================================

-- 25.1 Macros — novo nível 1 da estrutura-alvo (ex. Brasil, Exterior). Peso-
--      alvo soma 100% do patrimônio total do usuário, igual Classe fazia
--      antes desta migração.
create table if not exists public.alocacao_macros (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  nome        text not null,
  peso_alvo   numeric(5,2) not null check (peso_alvo between 0 and 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id, nome)
);

comment on table public.alocacao_macros is 'Nível 1 da estrutura-alvo (fase 1 da reformulação "Metas e estrutura", §8.50/§8.51): agrupamento acima de Classe (ex. Brasil, Exterior). Peso-alvo soma 100% do patrimônio total do usuário.';

drop trigger if exists trg_alocacao_macros_updated_at on public.alocacao_macros;
create trigger trg_alocacao_macros_updated_at
  before update on public.alocacao_macros
  for each row execute function public.set_updated_at();

alter table public.alocacao_macros enable row level security;

drop policy if exists "alocacao_macros_all_own" on public.alocacao_macros;
create policy "alocacao_macros_all_own" on public.alocacao_macros
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- 25.2 alocacao_classes ganha macro_id — nullable por enquanto, só pra
--      permitir o backfill (25.3) rodar antes do NOT NULL (25.4) entrar em
--      vigor num banco que já tinha classes cadastradas.
alter table public.alocacao_classes add column if not exists macro_id uuid references public.alocacao_macros (id) on delete cascade;

create index if not exists idx_alocacao_classes_macro_id on public.alocacao_classes (macro_id);

-- 25.3 Backfill: toda classe existente sem macro_id ganha um Macro "Geral"
--      (100%, criado 1x por usuário que já tinha classe) — não perde nenhum
--      dado nem muda peso global de nada (Geral = 100%, então peso_alvo da
--      classe continua significando exatamente o mesmo valor de antes).
--      Guilherme pode renomear "Geral" ou dividir em mais Macros depois,
--      pela UI nova (fase 3).
do $$
declare
  r record;
  v_macro_id uuid;
begin
  for r in select distinct profile_id from public.alocacao_classes where macro_id is null loop
    select id into v_macro_id from public.alocacao_macros where profile_id = r.profile_id and nome = 'Geral';
    if v_macro_id is null then
      insert into public.alocacao_macros (profile_id, nome, peso_alvo)
      values (r.profile_id, 'Geral', 100)
      returning id into v_macro_id;
    end if;
    update public.alocacao_classes set macro_id = v_macro_id where profile_id = r.profile_id and macro_id is null;
  end loop;
end $$;

-- 25.4 Depois do backfill, macro_id é obrigatório (toda classe pertence a
--      um Macro) — seguro de rodar de novo (SET NOT NULL numa coluna já
--      NOT NULL não dá erro no Postgres).
alter table public.alocacao_classes alter column macro_id set not null;

-- 25.5 unique(profile_id, nome) fazia sentido quando Classe era o nível 1;
--      agora o nome só precisa ser único DENTRO do Macro (mesmo padrão que
--      alocacao_setores já usa com classe_id) — permite, por exemplo,
--      "Renda fixa" existir tanto em Brasil quanto em Exterior.
alter table public.alocacao_classes drop constraint if exists alocacao_classes_profile_id_nome_key;
alter table public.alocacao_classes drop constraint if exists alocacao_classes_macro_id_nome_key;
alter table public.alocacao_classes add constraint alocacao_classes_macro_id_nome_key unique (macro_id, nome);

comment on table public.alocacao_classes is 'Nível 2 da estrutura-alvo (antes do §8.50/8.51 era o nível 1): classes de ativo (ex. Renda Fixa, Ações, FIIs) dentro de um Macro. Peso-alvo soma 100% DENTRO do Macro pai (macro_id), não mais do patrimônio total direto.';

-- =====================================================================
-- 26. Alocação — ordem persistida dos nós (fase 5 da reformulação "Metas
--     e estrutura", §8.50/§8.54). A ação "reordenar" (§16.2.8) exige uma
--     ordem explícita por irmão — antes disso a ordem era só a da
--     consulta (por nome). Adiciona `ordem` a cada nível editável
--     (Macro/Classe/Setor) e faz backfill idempotente, numerando os
--     irmãos existentes em sequência estável (a própria `ordem`, ainda
--     0 em todo mundo na 1ª rodada, com `created_at` como desempate) —
--     seguro rodar de novo: uma vez numerada, a sequência já ordenada
--     produz o mesmo resultado.
-- =====================================================================
alter table public.alocacao_macros add column if not exists ordem integer not null default 0;
alter table public.alocacao_classes add column if not exists ordem integer not null default 0;
alter table public.alocacao_setores add column if not exists ordem integer not null default 0;

update public.alocacao_macros m
set ordem = sub.rn
from (
  select id, row_number() over (partition by profile_id order by ordem, created_at) - 1 as rn
  from public.alocacao_macros
) sub
where m.id = sub.id;

update public.alocacao_classes c
set ordem = sub.rn
from (
  select id, row_number() over (partition by macro_id order by ordem, created_at) - 1 as rn
  from public.alocacao_classes
) sub
where c.id = sub.id;

update public.alocacao_setores s
set ordem = sub.rn
from (
  select id, row_number() over (partition by classe_id order by ordem, created_at) - 1 as rn
  from public.alocacao_setores
) sub
where s.id = sub.id;

-- =====================================================================
-- 27. Empresas — cadastro do "cartão de visita" (CNPJ/nome/logo/segmento
--     oficial) por trás de Ações/FIIs/ETF Brasil e ações/ETF/REIT
--     internacionais (ver docs/MAPA-DE-DADOS.md §8.56). Tabela SEPARADA de
--     `ativos` (em vez de colunas soltas nela) porque dois ativos podem ser
--     da MESMA empresa/fundo (ex. PETR3 e PETR4 são a mesma Petrobras) — uma
--     tabela `empresas` com `ativos.empresa_id` apontando pra ela garante
--     que esse dado cadastral more em UM lugar só, nunca duplicado entre as
--     duas linhas de `ativos` (mesmo princípio de fonte única do §3).
--
--     `chave_externa` é o identificador natural usado tanto pra dedupe
--     (dois ativos com a mesma chave reaproveitam o mesmo registro) quanto
--     pra evitar rebuscar a mesma empresa via API toda hora: CNPJ pra
--     empresas nacionais (sempre disponível via brapi.dev pra Ações/FIIs/
--     ETF B3); pra internacionais (sem CNPJ) usa o próprio ticker limpo
--     (maiúsculo, sem sufixo de bolsa) como fallback — pior que CNPJ (duas
--     ações do mesmo emissor em bolsas diferentes NÃO dedupam), mas simples
--     e correto pro caso comum (1 ticker = 1 empresa estrangeira).
--
--     Todos os campos de dado cadastral são nullable e livremente
--     editáveis à mão — a API (brapi.dev/Yahoo) só popula um ponto de
--     partida; ver `origem_dados` pra saber se o valor atual veio de busca
--     automática ou foi sobrescrito manualmente (mesmo espírito de
--     `ativos.preco_fonte`).
-- =====================================================================
create table if not exists public.empresas (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  chave_externa     text not null,
  cnpj              text,
  razao_social      text,
  nome_fantasia     text,
  logo_url          text,
  segmento          text,
  descricao         text,
  origem_dados      text not null default 'manual'
    check (origem_dados in ('manual', 'brapi', 'yahoo')),
  atualizado_em     timestamptz,
  created_at        timestamptz not null default now(),
  unique (profile_id, chave_externa)
);

comment on table public.empresas is 'Cadastro do "cartão de visita" de empresas/fundos por trás de um ticker (CNPJ, nome, logo, segmento) — fase 4 do card de empresa (§8.56). Separada de `ativos` pra permitir que ON/PN do mesmo emissor (ou dois FIIs da mesma gestora) compartilhem o mesmo registro, sem duplicar dado cadastral.';
comment on column public.empresas.chave_externa is 'CNPJ (nacional) ou ticker limpo em maiúsculo (internacional, sem CNPJ) — usado tanto pra dedupe entre ativos quanto como chave de busca da API.';
comment on column public.empresas.origem_dados is 'De onde veio o valor atual dos campos cadastrais: brapi (B3, automático), yahoo (internacional, automático) ou manual (usuário editou/preencheu à mão).';

create index if not exists idx_empresas_profile_id on public.empresas (profile_id);

alter table public.empresas enable row level security;

drop policy if exists "empresas_all_own" on public.empresas;
create policy "empresas_all_own" on public.empresas
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

alter table public.ativos add column if not exists empresa_id uuid references public.empresas (id) on delete set null;
create index if not exists idx_ativos_empresa_id on public.ativos (empresa_id);
