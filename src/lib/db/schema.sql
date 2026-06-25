-- ─────────────────────────────────────────────────────────────────────────
-- DealerQA AI — Supabase schema (optional production persistence).
-- Apply in the Supabase SQL editor, then set NEXT_PUBLIC_SUPABASE_URL and
-- SUPABASE_SERVICE_ROLE_KEY in your environment to switch off the local store.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.audits (
  id          text primary key,
  url         text not null,
  title       text,
  status      text not null default 'complete',
  created_at  timestamptz not null default now(),
  reviewer    text,
  overall     numeric,
  fail        integer default 0,
  warning     integer default 0,
  approved    boolean default false,
  -- Full audit document (paragraphs, claims, links, etc.) as JSON.
  data        jsonb not null
);

create index if not exists audits_created_at_idx on public.audits (created_at desc);
create index if not exists audits_reviewer_idx on public.audits (reviewer);

-- Row Level Security: enable and add policies appropriate to your auth model.
-- The server uses the service-role key (bypasses RLS); browser clients should
-- never receive that key. Example policy for authenticated reads:
--
--   alter table public.audits enable row level security;
--   create policy "read for authenticated"
--     on public.audits for select to authenticated using (true);
