import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/* Fail loudly at startup rather than at the first query. A missing key otherwise
   surfaces as an empty recipe list, which is indistinguishable from having no
   recipes yet — the same silent-empty problem that a missing RLS policy causes. */
export const configured = Boolean(url && key);

export const supabase = configured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
