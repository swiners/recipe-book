# Recipe book

Personal recipe log. Static site on GitHub Pages, data in Supabase, add-from-phone
via a sign-in link.

## What it does

- **Recipes**: ingredients, method, tags, rating, last-cooked, source link, a photo.
- **Allium-free**: a switch on every recipe and a filter on the list. Someone in the household is allergic to
  the onion family (garlic is fine), so this is asked of every recipe.
- **Scale servings** on any recipe. Ingredient amounts scale; amounts written inside the
  method text do not, and the page says so.
- **Plan + shopping list**: tap `+ Plan` on recipes, set servings, and the list builds
  itself, adding up like amounts across recipes (600 g + 1.2 kg becomes 1.8 kg). Tick items
  off, copy the rest.
- **Catch**: pick a species ("flathead", "squid") and see what to cook, split into recipes
  made for it and recipes where it works as a swap.
- **Import**: fill the new-recipe form from a link, or from pasted text or page source.
  Always lands in the form for checking; never saves by itself.
- **Photos**: from the camera or library, shrunk on the device, stored privately.

## How it is put together

| | |
|---|---|
| Frontend | Vite + React 19 + TypeScript, no UI framework |
| Styling | Plain CSS custom properties, two tiers (`src/styles/tokens.css`) |
| Routing | Hash-based, hand-rolled in `src/App.tsx` |
| Data | Supabase Postgres, one `recipes` table |
| Photos | Supabase Storage, one private bucket, one folder per user |
| Link import | One Supabase Edge Function (`supabase/functions/fetch-recipe-page`) |
| Auth | Supabase magic link, no passwords |
| Hosting | GitHub Pages, deployed by Actions on push to `main` |

Hash routing rather than a router: Pages has no server-side rewrite, so `/recipe/<id>`
would 404 on reload. The hash avoids that and gives working back/forward for free,
which is what you want when you are holding a phone.

## The security model

The built bundle is public, and the Supabase **publishable** key is inside it. That is
how Supabase is designed to work: the key names the project, it does not authorise
anything. **Row Level Security is the only thing protecting the data**, so the policies
in `supabase/schema.sql` are the security boundary, not a formality. The secret /
`service_role` key bypasses all of them and must never reach this repo, GitHub Actions,
or a browser.

The failure mode to know about: RLS enabled with no policy returns an empty list rather
than an error, so a missing policy looks exactly like having no recipes yet. Test both
directions after any schema change. `npm run verify:deploy` does the stranger's side of
that, plus the checks below.

Three more places where something untrusted comes in, and what holds each:

- **Photos.** The bucket is private and capped at 5 MB, JPEG only, by the bucket itself
  (not just the app). Every upload is re-drawn through a canvas on the device, which
  shrinks it and strips EXIF, including the GPS location phones embed. A recipe's
  `photo_path` must sit in its owner's folder (a table constraint).
- **Link import.** The Edge Function fetches a URL for you, which makes it a server
  making requests on someone's behalf. It refuses anyone who is not a signed-in user (the
  public key alone is not enough), refuses private, loopback and cloud-metadata addresses
  on every redirect hop, caps time, size and redirects, and returns only the recipe data,
  not the page. The one known gap, DNS rebinding, is written up at the top of
  `supabase/functions/fetch-recipe-page/guard.ts`; it is acceptable only because the
  function holds no secrets, so do not add any.
- **Imported and pasted text** is length-capped and never rendered as HTML. A source link
  is only ever shown as a link if it is `http(s)`; a `javascript:` URL is shown as plain
  text. An import never turns on **Allium-free** by itself.

## Going live

The app is built but needs a Supabase project, which has to be created by you. Until
then the deployed site just says "Not configured". In order:

1. **Create a Supabase project** (free tier). Note the project URL and the publishable key
   (Project Settings > API Keys).
2. **Run `supabase/schema.sql`** in the SQL editor. It is safe to re-run, and it upgrades
   an existing database (adds the photo column, tightens the bucket).
3. **Set the auth redirect.** Authentication > URL Configuration: set *Site URL* to the
   published site (`https://swiners.github.io/recipe-book/`) and add that plus
   `http://localhost:5173/**` to *Redirect URLs*. Otherwise the sign-in link opens
   `localhost` on your phone and fails.
4. **Set the two repository variables.** They are public by design, so these are
   variables, not secrets, and never the secret key:
   ```
   gh variable set VITE_SUPABASE_URL --repo swiners/recipe-book --body "https://<ref>.supabase.co"
   gh variable set VITE_SUPABASE_PUBLISHABLE_KEY --repo swiners/recipe-book --body "sb_publishable_..."
   ```
5. **Publish on Pages.** Settings > Pages > Source: *GitHub Actions*. A **private** repo on
   a free GitHub plan cannot publish Pages, so it needs to be either public or on a paid
   plan. Nothing in the repo is secret by design, but a public repo also publishes
   `seed/` (the starter recipes). The keep-alive workflow below also assumes public, where
   Actions minutes are unlimited.
6. **Merge to `main`.** The deploy workflow runs the tests, then builds and publishes.
7. **Sign in** on the site (magic link), then **load the starter recipes**: open
   `supabase/seed.sql`, set `owner_email` to the address you signed in with, run it in the
   SQL editor.
8. **Turn off new sign-ups** once your own account exists: Authentication > Sign In /
   Providers > disable *Allow new users to sign up*. The site is public; until you do,
   anyone can create an account in your project.
9. **Deploy the import function** (optional; pasting text works without it):
   ```
   supabase login
   supabase link --project-ref <ref>
   supabase functions deploy fetch-recipe-page --no-verify-jwt
   ```
   `--no-verify-jwt` is deliberate: the function verifies the signed-in user itself
   (see `supabase/config.toml`). If the site is not at `https://swiners.github.io`, set
   `supabase secrets set ALLOWED_ORIGINS=https://your-site,http://localhost:5173`.
10. **Check it.** From a terminal, signed out:
    ```
    SUPABASE_URL=https://<ref>.supabase.co \
    SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
    SITE_URL=https://swiners.github.io/recipe-book/ \
    npm run verify:deploy
    ```
    It checks that a stranger cannot read recipes, sign-ups are off, the photo bucket is
    not public, the import function refuses signed-out callers, the site was built with
    the variables, and no secret key is in the bundle.

Locally: `cp .env.example .env.local`, fill it in, `npm run dev`.

## Commands

| | |
|---|---|
| `npm run dev` | local dev server |
| `npm test` | unit tests (Node's test runner, no extra dependencies) |
| `npm run lint` | oxlint |
| `npm run build` | type-check and build |
| `npm run seed:build` / `seed:check` | regenerate / verify `supabase/seed.sql` |
| `npm run verify:deploy` | probe a live project, signed out (see above) |

The tests load `.ts` files directly through Node's built-in type stripping, so they need
Node 22.18 or newer (CI uses 24) and the code under test sticks to erasable TypeScript:
no enums, no constructor parameter properties.

## Starter recipes

`seed/recipes.json` holds the first batch of recipes, in the same shape as the `recipes`
table. It is deliberately **not** imported by the app: the bundle is public, and recipes
belong behind Row Level Security with everything else. Instead a script turns the JSON
into SQL you paste into Supabase.

```
node scripts/build-seed.mjs          # regenerate supabase/seed.sql
node scripts/build-seed.mjs --check  # exit 1 if seed.sql is stale
```

Re-running the SQL is safe; a recipe with a title you already have is skipped, so adding
recipes to the JSON and re-running only inserts the new ones.

The script refuses to build if any recipe marked `allium_free` mentions an onion, leek,
shallot or chive in its ingredients or method, and warns about packaged things that
commonly hide onion (stock, sausages, curry powder, taco seasoning, chilli crisp).
Titles and notes are exempt so they can say "onion-free" or "leave off the spring onion".
The warnings are a prompt to read the label, not a guarantee: the lint cannot see inside
a jar.

Everything in the starter set is tagged `to-try` with no rating: they are drafts, not
recipes that have been cooked. Remove the tag and add a rating after the first cook. The
"for one" recipes are deliberately **not** flagged allium-free.

## Notes

`allium_free` is a column rather than a tag, deliberately. Someone in the household is allergic to the
whole onion family (garlic is fine), so it gets asked of every recipe and needs to be a
switch you can filter on, not free text you have to spell consistently.

The **plan and shopping list live in this device's browser storage**, not the database.
A plan is scratch space that changes weekly, and putting it in Supabase would mean a new
table, new policies and a migration for something disposable. The cost is that a plan made
on the laptop is not on the phone. Quantities are added up only where the units match
("2 tbsp" and "30 ml" stay as two lines), so skim the list before you shop.

A scheduled workflow pings Supabase three times a week, because free projects pause
after 7 days of inactivity and a paused project means the site is down.
