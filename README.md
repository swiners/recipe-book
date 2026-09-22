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

## Notes

`allium_free` is a column rather than a tag, deliberately. Someone in the household is allergic to the
whole onion family (garlic is fine), so it gets asked of every recipe and needs to be a
switch you can filter on, not free text you have to spell consistently.

A scheduled workflow pings Supabase three times a week, because free projects pause
after 7 days of inactivity and a paused project means the site is down.
