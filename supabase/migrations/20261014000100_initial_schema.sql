create extension if not exists pgcrypto with schema extensions;

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source_url text not null,
  platform text,
  author text,
  title text,
  caption text,
  image_url text,
  ingredients text[] not null default '{}',
  ingredient_sections jsonb,
  steps text[] not null default '{}',
  tags text[] not null default '{}',
  collections text[] not null default '{}',
  servings text,
  time_minutes integer,
  status text not null default 'needs_review'
    check (status in ('ok', 'needs_review', 'fetch_failed')),
  nutrition jsonb,
  notes text,
  rating integer check (rating is null or rating between 0 and 5),
  cooked boolean not null default false,
  favorite boolean not null default false,
  raw jsonb,
  lang text
);

create index if not exists recipes_created_id_idx
  on public.recipes (created_at desc, id desc);
create index if not exists recipes_status_created_idx
  on public.recipes (status, created_at desc);
create index if not exists recipes_source_url_idx on public.recipes (source_url);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  chat_id bigint,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'error')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_status_created_idx on public.jobs (status, created_at);
create index if not exists jobs_url_created_idx on public.jobs (url, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $
begin
  new.updated_at = now();
  return new;
end;
$;

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

create table if not exists public.worker_lock (
  id integer primary key check (id = 1),
  locked_until timestamptz
);
insert into public.worker_lock (id, locked_until)
values (1, null)
on conflict (id) do nothing;

create table if not exists public.app_kv (
  key text primary key,
  ts timestamptz not null default now()
);

alter table public.recipes enable row level security;
alter table public.jobs enable row level security;
alter table public.worker_lock enable row level security;
alter table public.app_kv enable row level security;

drop policy if exists recipes_public_read on public.recipes;
create policy recipes_public_read on public.recipes
  for select to anon using (true);

-- Keep notes private: grant public read only for explicitly listed columns.
revoke all on public.recipes from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select (
  id, created_at, source_url, platform, author, title, caption, image_url,
  ingredients, ingredient_sections, steps, tags, collections, servings,
  time_minutes, status, nutrition, rating, cooked, favorite, raw, lang
) on public.recipes to anon, authenticated;
grant select on public.recipes to service_role;
grant all privileges on public.recipes, public.jobs, public.worker_lock, public.app_kv
  to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-images', 'recipe-images', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read recipe images" on storage.objects;
create policy "Public can read recipe images"
  on storage.objects for select using (bucket_id = 'recipe-images');
