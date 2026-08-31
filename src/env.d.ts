/// <reference types="vite/client" />

/**
 * Vite's own ImportMetaEnv has an index signature, so an undeclared VITE_ key
 * type-checks as `any` and every use of it silently leaves the type system.
 * Declaring the one this app reads makes "the id is missing" a case the
 * compiler forces us to handle, which is exactly what happens on any machine
 * that has not been set up as a Discord Activity.
 */
interface ImportMetaEnv {
  /**
   * The Discord application's OAuth2 client id.
   *
   * Public by design — it ships inside the client bundle and is visible to
   * anyone who opens devtools. That is fine and expected; the *secret* is the
   * half that stays on the server. Absent on a plain Tailscale build.
   */
  readonly VITE_DISCORD_CLIENT_ID?: string;
}
