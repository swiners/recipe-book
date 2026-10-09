-- Recipe book schema.
--
-- READ THIS FIRST. The app is a static site on GitHub Pages and its bundle is public.
-- The publishable key ships inside that bundle, by design — it identifies the project,
-- it does not authorise anything. Row Level Security is the ONLY thing standing between
-- a stranger and these rows.
--
-- The dangerous failure mode is silent: RLS enabled with no policy returns an empty set
-- rather than an error, so a missing policy looks like "no data yet", not "broken".
-- A policy that is too loose looks like everything working perfectly. Neither announces
-- itself. Test both directions after any change (see the bottom of this file).
--
-- The secret / service_role key must NEVER appear in this repo, in GitHub Actions, or in
-- the browser. It bypasses every policy below.

create extension if not exists "pgcrypto";

create table if not exists recipes (
  id            uuid primary key default gen_random_uuid(),

  -- Ownership is the whole security model. NOT NULL so a row can never exist unowned,
  -- and defaulted to the caller so the client cannot forget to set it. The insert policy
  -- below still checks it, because a default is a convenience and not a control.
  user_id       uuid not null references auth.users(id) on delete cascade default auth.uid(),

  title         text not null check (length(trim(title)) > 0),
  servings      integer check (servings is null or servings > 0),
  prep_minutes  integer check (prep_minutes is null or prep_minutes >= 0),
  cook_minutes  integer check (cook_minutes is null or cook_minutes >= 0),

  -- [{ "item": "fennel", "qty": "1", "unit": "bulb" }, ...]
  ingredients   jsonb not null default '[]'::jsonb,
  steps         text[] not null default '{}',
  tags          text[] not null default '{}',

  -- A first-class column, not a tag. Someone in the household is allergic to the whole allium family, so
  -- "can I cook this for them" is a question asked of every recipe, every time. A tag is
  -- free text that can be misspelled, half-applied, or filtered wrong; a boolean cannot.
  -- Garlic is fine, so this is specifically about onion/leek/shallot/chive, not garlic.
  allium_free   boolean not null default false,

  source_url    text,
  notes         text,
  rating        smallint check (rating is null or rating between 1 and 5),
  last_cooked   date,

  -- Object path in the private recipe-photos bucket: "<user id>/<uuid>.jpg". Not a URL:
  -- the bucket is private, so the app asks for a short-lived signed URL when it needs one.
  photo_path    text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Databases created before photos existed: `create table if not exists` leaves an existing
-- table alone, so the column has to be added separately. Harmless on a fresh database.
alter table recipes add column if not exists photo_path text;

-- A photo path has to live in its owner's folder. The storage policies below already stop
-- one user reading another's files, so this is defence in depth: a row can never point
-- at someone else's object even if a client sends a hand-written path.
alter table recipes drop constraint if exists recipes_photo_path_own_folder;
alter table recipes add constraint recipes_photo_path_own_folder
  check ( photo_path is null or photo_path like user_id::text || '/%' );

-- Every query the app makes is "my recipes, newest first" or a tag/allium filter.
create index if not exists recipes_user_created_idx on recipes (user_id, created_at desc);
create index if not exists recipes_tags_idx         on recipes using gin (tags);

-- updated_at maintained server-side: a client-supplied timestamp is a client-controlled
-- value, and this one is only ever used for display and ordering.
create or replace function set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists recipes_set_updated_at on recipes;
create trigger recipes_set_updated_at
  before update on recipes
  for each row execute function set_updated_at();

-- ── Row Level Security ──────────────────────────────────────────────────────────────
alter table recipes enable row level security;

-- One policy per operation rather than one FOR ALL policy: the four cases genuinely
-- differ (insert checks the row being written, the others check the row being read),
-- and separate policies fail closed one operation at a time instead of all at once.
--
-- `to authenticated` names the role explicitly, so the anon role is never in scope.
-- `(select auth.uid())` rather than bare auth.uid() so Postgres evaluates it once per
-- statement as an initPlan instead of once per row.

drop policy if exists recipes_select_own on recipes;
create policy recipes_select_own on recipes
  for select to authenticated
  using ( (select auth.uid()) = user_id );

-- WITH CHECK, not USING: on insert there is no existing row to test. This is what stops
-- a signed-in user writing a row owned by someone else.
drop policy if exists recipes_insert_own on recipes;
create policy recipes_insert_own on recipes
  for insert to authenticated
  with check ( (select auth.uid()) = user_id );

-- Both clauses: USING picks which rows may be updated, WITH CHECK validates the result.
-- Without WITH CHECK, a user could update their own row and reassign user_id away.
drop policy if exists recipes_update_own on recipes;
create policy recipes_update_own on recipes
  for update to authenticated
  using      ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists recipes_delete_own on recipes;
create policy recipes_delete_own on recipes
  for delete to authenticated
  using ( (select auth.uid()) = user_id );

-- ── Photo storage ───────────────────────────────────────────────────────────────────
-- Private bucket. A public bucket would make every photo readable by URL to anyone who
-- guessed or was given the path, which RLS on the table above would not prevent.
--
-- Limits live on the bucket so they hold whatever client is talking to it, including one
-- that skips the app's resize step. 5 MB and JPEG only: the app always re-encodes to
-- JPEG, which is also what strips location data from phone photos. `do update` rather
-- than `do nothing` so re-running this file brings an existing bucket in line.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-photos', 'recipe-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects are namespaced by owner: recipe-photos/<uid>/<filename>. The policies compare
-- the first path segment to the caller, so one user's folder is unreachable from another.
drop policy if exists recipe_photos_select_own on storage.objects;
create policy recipe_photos_select_own on storage.objects
  for select to authenticated
  using ( bucket_id = 'recipe-photos'
          and (storage.foldername(name))[1] = (select auth.uid())::text );

drop policy if exists recipe_photos_insert_own on storage.objects;
create policy recipe_photos_insert_own on storage.objects
  for insert to authenticated
  with check ( bucket_id = 'recipe-photos'
               and (storage.foldername(name))[1] = (select auth.uid())::text );

drop policy if exists recipe_photos_delete_own on storage.objects;
create policy recipe_photos_delete_own on storage.objects
  for delete to authenticated
  using ( bucket_id = 'recipe-photos'
          and (storage.foldername(name))[1] = (select auth.uid())::text );

-- ── Verify after running this ───────────────────────────────────────────────────────
-- Both checks matter. The first proves the lock is on; the second proves you are not
-- locked out of your own data, which is the failure the first check cannot see.
--
-- 1. Locked to strangers. From a terminal, signed out, using the PUBLISHABLE key:
--
--      curl "$SUPABASE_URL/rest/v1/recipes?select=*" \
--        -H "apikey: $PUBLISHABLE_KEY"
--
--    Must return []. Any row means the data is public — stop and fix before deploying.
--
-- 2. Reachable by you. Signed in in the app, add a recipe and reload. If the list is
--    empty, a policy is missing rather than the insert failing.
--
-- 3. Turn OFF new signups once your own account exists:
--    Dashboard -> Authentication -> Sign In / Providers -> disable "Allow new users to
--    sign up". The site is public, so without this anyone can create an account. They
--    still could not read your rows, but they would be in your project and count
--    against your quota.
