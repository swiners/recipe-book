# Recipe book

Personal recipe log. Static site on GitHub Pages, data in Supabase, add-from-phone
via a sign-in link.

## How it is put together

| | |
|---|---|
| Frontend | Vite + React 19 + TypeScript, no UI framework |
| Styling | Plain CSS custom properties, two tiers (`src/styles/tokens.css`) |
| Routing | Hash-based, hand-rolled in `src/App.tsx` |
| Data | Supabase Postgres, one `recipes` table |
| Auth | Supabase magic link — no passwords |
| Hosting | GitHub Pages, deployed by Actions on push to `main` |

Hash routing rather than a router: Pages has no server-side rewrite, so `/recipe/<id>`
would 404 on reload. The hash avoids that and gives working back/forward for free,
which is what you want when you are holding a phone.

## The security model, in one paragraph

The built bundle is public, and the Supabase **publishable** key is inside it. That is
how Supabase is designed to work — the key names the project, it does not authorise
anything. **Row Level Security is the only thing protecting the data**, so the policies
in `supabase/schema.sql` are the security boundary, not a formality. The secret /
`service_role` key bypasses all of them and must never reach this repo, GitHub Actions,
or a browser.

The failure mode to know about: RLS enabled with no policy returns an empty list rather
than an error, so a missing policy looks exactly like having no recipes yet. Test both
directions after any schema change — the checks are at the bottom of `schema.sql`.

## Setup

1. Create a Supabase project (free tier).
2. Run `supabase/schema.sql` in the SQL editor.
3. **Turn off new signups** once your own account exists: Authentication → Sign In /
   Providers → disable "Allow new users to sign up". The site is public; without this
   anyone can create an account in your project.
4. Add two **repository variables** (Settings → Secrets and variables → Actions →
   Variables) — not secrets, see above:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
5. Push to `main`. Actions builds and deploys.

Locally: `cp .env.example .env.local`, fill it in, `npm run dev`.

## Starter recipes

`seed/recipes.json` holds the first batch of recipes, in the same shape as the `recipes`
table. It is deliberately **not** imported by the app: the bundle is public, and recipes
belong behind Row Level Security with everything else. Instead a script turns the JSON
into SQL you paste into Supabase.

```
node scripts/build-seed.mjs          # regenerate supabase/seed.sql
node scripts/build-seed.mjs --check  # exit 1 if seed.sql is stale
```

To load them: run `schema.sql`, sign in to the app once so your account exists, then open
`supabase/seed.sql`, set `owner_email` to the address you signed in with, and run it in
the SQL editor. Re-running is safe; a recipe with a title you already have is skipped.

The script refuses to build if any recipe marked `allium_free` mentions an onion, leek,
shallot or chive in its ingredients or method, and warns about packaged things that
commonly hide onion (stock, sausages, curry powder, taco seasoning, chilli crisp).
Titles and notes are exempt so they can say "onion-free" or "leave off the spring onion".
The warnings are a prompt to read the label, not a guarantee: the lint cannot see inside
a jar.

Everything in the starter set is tagged `to-try` with no rating: they are drafts, not
recipes that have been cooked. Remove the tag and add a rating after the first cook.

## Notes

`allium_free` is a column rather than a tag, deliberately. Someone in the household is allergic to the
whole onion family (garlic is fine), so it gets asked of every recipe and needs to be a
switch you can filter on, not free text you have to spell consistently.

A scheduled workflow pings Supabase three times a week, because free projects pause
after 7 days of inactivity and a paused project means the site is down.
