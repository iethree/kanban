// Secrets aren't in wrangler.jsonc, so `wrangler types` doesn't generate them.
interface Env {
  /** TypeSafe key for guessing column icons; without it, icons come from the name rules only. */
  JEV_API_KEY?: string;
}
