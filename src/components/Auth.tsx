import { useState } from "react";
import { supabase } from "../lib/supabase";

/* Magic link rather than a password. There is no password to store, reset, leak or
   reuse, and on a phone it is fewer taps than typing one. The trade is that signing
   in needs access to the inbox, which for a personal recipe book is fine. */
export function Auth() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // Back to this exact page, including the /sam-recipes/ base, so the redirect
      // works the same locally and on Pages.
      options: { emailRedirectTo: window.location.href },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  if (sent) {
    return (
      <div className="rb-auth">
        <h1 className="rb-title">Check your email</h1>
        <p>
          A sign-in link is on its way to <strong>{email}</strong>. It opens this page
          back up, already signed in.
        </p>
        <button className="rb-btn rb-btn--quiet" onClick={() => setSent(false)}>
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <div className="rb-auth">
      <h1 className="rb-title">Recipe book</h1>
      <p>Everything you cook, in one place. Sign in with a link — no password.</p>
      {error && <div className="rb-banner rb-banner--error">{error}</div>}
      <form onSubmit={send}>
        <div className="rb-field">
          <label className="rb-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="rb-input"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <button className="rb-btn rb-btn--primary" type="submit" disabled={busy || !email}>
          {busy ? "Sending…" : "Send sign-in link"}
        </button>
      </form>
    </div>
  );
}
