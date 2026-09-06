const jwksCache = new Map(); // teamDomain -> { keys: Map<kid, CryptoKey>, at: number }
const JWKS_TTL_MS = 60 * 60 * 1000;

export function __resetJwksCache() {
  jwksCache.clear();
}

function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(segment) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(segment)));
}

export class JwksUnavailable extends Error {}

async function loadKeys(teamDomain) {
  let res;
  try {
    res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  } catch (e) {
    throw new JwksUnavailable(`JWKS fetch failed: ${e.message}`);
  }
  if (!res.ok) throw new JwksUnavailable(`JWKS fetch failed: ${res.status}`);
  const body = await res.json();
  const keys = new Map();
  for (const jwk of body.keys || []) {
    if (!jwk.kid) continue;
    const key = await crypto.subtle.importKey(
      "jwk",
      { ...jwk, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    keys.set(jwk.kid, key);
  }
  const entry = { keys, at: Date.now() };
  jwksCache.set(teamDomain, entry);
  return entry;
}

async function keyFor(teamDomain, kid) {
  let entry = jwksCache.get(teamDomain);
  const stale = !entry || Date.now() - entry.at > JWKS_TTL_MS;
  if (stale) entry = await loadKeys(teamDomain);
  if (!entry.keys.has(kid)) entry = await loadKeys(teamDomain); // rotation
  const key = entry.keys.get(kid);
  if (!key) throw new Error(`no signing key for kid ${kid}`);
  return key;
}

export async function verifyAccessJwt(token, { teamDomain, aud, now = Date.now() }) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = decodeJson(headerB64);
    payload = decodeJson(payloadB64);
  } catch {
    throw new Error("malformed token");
  }

  if (header.alg !== "RS256") throw new Error(`unsupported alg ${header.alg}`);
  if (!header.kid) throw new Error("missing key id");

  const key = await keyFor(teamDomain, header.kid);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );
  if (!ok) throw new Error("bad signature");

  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error("aud mismatch");

  if (payload.iss !== `https://${teamDomain}`) throw new Error("iss mismatch");
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) {
    throw new Error("token expired");
  }

  const email = payload.email;
  if (!email) throw new Error("no email claim");
  return { email: String(email).toLowerCase() };
}

export async function getIdentity(request, env) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new Error("missing Access assertion");
  return verifyAccessJwt(token, {
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    aud: env.ACCESS_AUD,
  });
}
