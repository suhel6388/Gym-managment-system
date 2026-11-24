/**
 * Origin resolution shared by Better Auth, CORS and the auth controllers.
 */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

/** Trim and reduce a URL to its scheme + host + port. Returns null if invalid. */
export function normalizeOrigin(value) {
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
export function parseOrigins(value) {
  const origins = (value ?? "")
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

  return [...new Set(origins)];
}

/**
 * Browser origins allowed to call the API. Defaults to the Next.js dev server
 * so local development works without extra configuration.
 */
export function getClientOrigins(env = process.env) {
  const configured = parseOrigins(env.CLIENT_ORIGIN);
  return configured.length > 0 ? configured : ["http://localhost:3000"];
}

export function isAllowedClientOrigin(origin, env = process.env) {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  const allowed = getClientOrigins(env);
  if (allowed.includes(normalized)) return true;
  if (normalized.endsWith(".vercel.app")) return true;
  if (isLocalOrigin(normalized)) return true;
  return false;
}

export function resolveRequestClientOrigin(request, env = process.env) {
  const allowed = getClientOrigins(env);
  const candidates = [
    request?.headers?.get?.("origin"),
    request?.headers?.get?.("referer"),
  ];

  for (const candidate of candidates) {
    const origin = normalizeOrigin(candidate);
    if (origin && allowed.includes(origin)) return origin;
  }

  return allowed[0];
}

/**
 * Same resolution for an Express request.
 */
export function resolveClientOriginFromRequest(req, env = process.env) {
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
export function isLocalOrigin(origin) {
  try {
    const url = new URL(origin);
    return LOCAL_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

/** Render's public origin, from either of the variables it provides. */
function getRenderOrigin(env) {
  const externalUrl = normalizeOrigin(env.RENDER_EXTERNAL_URL);
  if (externalUrl) return externalUrl;

  const hostname = env.RENDER_EXTERNAL_HOSTNAME?.trim();
  return hostname ? normalizeOrigin(`https://${hostname}`) : null;
}

/**
 * Public origin of this API, which Better Auth uses as `baseURL`.
 */
export function resolvePublicApiOrigin(env = process.env) {
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
      return renderOrigin;
    }
  }

  return configured ?? "http://localhost:5000";
}

/** All origins Better Auth accepts for callbacks and CORS-protected requests. */
export function getTrustedOrigins(env = process.env) {
  return [...new Set([...getClientOrigins(env), resolvePublicApiOrigin(env)])];
}

/**
 * Whether the browser frontend is on a different host than this API.
 */
export function isCrossSiteFrontend(env = process.env) {
  const apiOrigin = resolvePublicApiOrigin(env);
  if (!apiOrigin.startsWith("https://")) return false;

  let apiHost;
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

