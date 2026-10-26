/**
 * Origin resolution shared by Better Auth, CORS and the auth controllers.
 *
 * The API and the browser frontend can be deployed to different sites (for
 * example Render + Vercel). In that setup `BETTER_AUTH_URL` must still be the
 * *API* origin: Better Auth builds the Google redirect URI from it, so pointing
 * it at the frontend sends Google to `/api/auth/callback/google` on a host that
 * has no API route. These helpers normalize the configured values and recover
 * the public API origin from Render's own URL when that mistake is detected.
 */

export type AuthEnv = Record<string, string | undefined>;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

/** Trim and reduce a URL to its scheme + host + port. Returns null if invalid. */
export function normalizeOrigin(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Parse a comma-separated origin list, dropping blanks, paths and duplicates. */
export function parseOrigins(value?: string | null): string[] {
  const origins = (value ?? "")
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));

  return [...new Set(origins)];
}

/**
 * Browser origins allowed to call the API. Defaults to the Next.js dev server
 * so local development works without extra configuration.
 */
export function getClientOrigins(env: AuthEnv = process.env): string[] {
  const configured = parseOrigins(env.CLIENT_ORIGIN);
  return configured.length > 0 ? configured : ["http://localhost:3000"];
}

/**
 * Frontend origin to embed in an emailed link.
 *
 * Prefers the `Origin`/`Referer` of the request that triggered the email when
 * it belongs to a configured client origin, so a user on any allowed
 * deployment receives a link back to that same deployment. Falls back to the
 * first configured client origin.
 */
export function resolveRequestClientOrigin(
  request?: Request | null,
  env: AuthEnv = process.env
): string {
  const allowed = getClientOrigins(env);
  const candidates = [
    request?.headers?.get("origin"),
    request?.headers?.get("referer"),
  ];

  for (const candidate of candidates) {
    const origin = normalizeOrigin(candidate);
    if (origin && allowed.includes(origin)) return origin;
  }

  return allowed[0];
}

/**
 * Same resolution for an Express request. Better Auth's server-side API calls
 * do not always preserve the incoming `Origin` header on the request passed to
 * `sendResetPassword`, so the controller resolves it here and forwards it as
 * `redirectTo` when starting a link reset.
 */
export function resolveClientOriginFromRequest(
  req:
    | { headers?: Record<string, string | string[] | undefined> }
    | null
    | undefined,
  env: AuthEnv = process.env
): string {
  const allowed = getClientOrigins(env);
  const rawCandidates = [req?.headers?.origin, req?.headers?.referer];

  for (const raw of rawCandidates) {
    const candidate = Array.isArray(raw) ? raw[0] : raw;
    const origin = normalizeOrigin(candidate);
    if (origin && allowed.includes(origin)) return origin;
  }

  return allowed[0];
}

/** True when the URL points at a loopback host (local development). */
export function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return LOCAL_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

/** Render's public origin, from either of the variables it provides. */
function getRenderOrigin(env: AuthEnv): string | null {
  const externalUrl = normalizeOrigin(env.RENDER_EXTERNAL_URL);
  if (externalUrl) return externalUrl;

  const hostname = env.RENDER_EXTERNAL_HOSTNAME?.trim();
  return hostname ? normalizeOrigin(`https://${hostname}`) : null;
}

/**
 * Public origin of this API, which Better Auth uses as `baseURL`.
 *
 * Precedence:
 * 1. `PUBLIC_API_URL` — explicit override for a custom API domain.
 * 2. Render's `RENDER_EXTERNAL_URL` when `BETTER_AUTH_URL` is missing, local,
 *    or points at one of the allowed frontend origins.
 * 3. `BETTER_AUTH_URL` — the correct production setting.
 * 4. `http://localhost:5000` for local development.
 */
export function resolvePublicApiOrigin(env: AuthEnv = process.env): string {
  const explicitApiOrigin = normalizeOrigin(env.PUBLIC_API_URL);
  if (explicitApiOrigin) return explicitApiOrigin;

  const configured = normalizeOrigin(env.BETTER_AUTH_URL);
  const renderOrigin = getRenderOrigin(env);

  if (renderOrigin) {
    if (!configured) return renderOrigin;
    if (isLocalOrigin(configured)) return renderOrigin;
    if (
      configured !== renderOrigin &&
      getClientOrigins(env).includes(configured)
    ) {
      // `BETTER_AUTH_URL` was set to the frontend by mistake. Prefer the API
      // host so Google callbacks land on `/api/auth/callback/google` here.
      return renderOrigin;
    }
  }

  return configured ?? "http://localhost:5000";
}

/** All origins Better Auth accepts for callbacks and CORS-protected requests. */
export function getTrustedOrigins(env: AuthEnv = process.env): string[] {
  return [...new Set([...getClientOrigins(env), resolvePublicApiOrigin(env)])];
}

/**
 * Whether the browser frontend is on a different host than this API. Those
 * requests are cross-site, so session cookies need `SameSite=None; Secure`.
 * Plain-HTTP local development keeps the safer `SameSite=Lax` default.
 */
export function isCrossSiteFrontend(env: AuthEnv = process.env): boolean {
  const apiOrigin = resolvePublicApiOrigin(env);
  if (!apiOrigin.startsWith("https://")) return false;

  let apiHost: string;
  try {
    apiHost = new URL(apiOrigin).hostname;
  } catch {
    return false;
  }

  return getClientOrigins(env).some((origin) => {
    try {
      return new URL(origin).hostname !== apiHost;
    } catch {
      return false;
    }
  });
}
