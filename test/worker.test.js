import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { SELF, env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index.js";
import { __resetJwksCache } from "../src/access.js";

// Driving authenticated requests: mutating `env.ACCESS_TEAM_DOMAIN` /
// `env.ACCESS_AUD` does not reach the worker instance behind `SELF.fetch` —
// that dispatch goes through the service-binding boundary, which appears to
// use its own snapshot of the configured `env` rather than the live object
// this test file mutates (every authenticated SELF.fetch attempt below came
// back 403 even with a validly-signed, validly-scoped token). So per the
// brief's documented fallback, authenticated requests call the exported
// `worker.fetch(request, env, ctx)` directly, passing the same `env` object
// this file mutates. The 5 pre-existing unauthenticated tests are untouched
// and still use `SELF.fetch`.
async function callWorker(request) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const TEAM = "example.cloudflareaccess.com";
const AUD = "aud-tag-123";

let keyPair, jwk, kid;
let realFetch;

function b64url(bytes) {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJson(obj) {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function mintJwt(payloadOverrides = {}, headerOverrides = {}) {
  const header = { alg: "RS256", typ: "JWT", kid, ...headerOverrides };
  const payload = {
    aud: [AUD],
    email: "austin@example.com",
    iss: `https://${TEAM}`,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payloadOverrides,
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${b64url(sig)}`;
}

beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  kid = "test-key-1";
  jwk.kid = kid;
  jwk.alg = "RS256";
  jwk.use = "sig";

  realFetch = globalThis.fetch;
});

beforeEach(async () => {
  env.ACCESS_TEAM_DOMAIN = TEAM;
  env.ACCESS_AUD = AUD;
  __resetJwksCache();

  // Only intercept the JWKS certs fetch; everything else (including the
  // SELF.fetch dispatch to the worker under test) must pass through to the
  // real fetch implementation.
  vi.stubGlobal("fetch", async (url, init) => {
    if (String(url).includes("/cdn-cgi/access/certs")) {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return realFetch(url, init);
  });

  await env.DB.exec("DROP TABLE IF EXISTS entries");
  await env.DB.exec(
    "CREATE TABLE entries (owner TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, u INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner, id))"
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("worker routing", () => {
  it("refuses the app shell without an Access assertion", async () => {
    const res = await SELF.fetch("https://ember.austinsego.com/");
    expect(res.status).toBe(403);
  });

  it("refuses the API without an Access assertion", async () => {
    const res = await SELF.fetch("https://ember.austinsego.com/api/entries");
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Type")).toMatch(/application\/json/);
  });

  it("refuses a forged assertion", async () => {
    const res = await SELF.fetch("https://ember.austinsego.com/api/entries", {
      headers: { "Cf-Access-Jwt-Assertion": "forged.token.value" },
    });
    expect(res.status).toBe(403);
  });

  it("serves the service worker without auth so it can boot offline", async () => {
    const res = await SELF.fetch("https://ember.austinsego.com/sw.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/javascript/);
  });

  it("sets no-store on API responses", async () => {
    const res = await SELF.fetch("https://ember.austinsego.com/api/entries");
    expect(res.headers.get("Cache-Control")).toMatch(/no-store/);
  });
});

describe("worker routing — authenticated", () => {
  it("GET / with a valid assertion returns 200 html", async () => {
    const token = await mintJwt();
    const res = await callWorker(
      new Request("https://ember.austinsego.com/", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/text\/html/);
  });

  it("GET /api/entries with a valid assertion returns entries/cursor/email", async () => {
    const token = await mintJwt({ email: "austin@example.com" });
    const res = await callWorker(
      new Request("https://ember.austinsego.com/api/entries", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toHaveProperty("entries");
    expect(body).toHaveProperty("cursor");
    expect(body.email).toBe("austin@example.com");
  });

  it("POST /api/entries writes an entry and a following GET returns it", async () => {
    const token = await mintJwt({ email: "austin@example.com" });
    const postRes = await callWorker(
      new Request("https://ember.austinsego.com/api/entries", {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": token, "Content-Type": "application/json" },
        body: JSON.stringify({ entries: [{ id: "t1", u: 1000, l: "test" }] }),
      })
    );
    expect(postRes.status).toBe(200);
    const postBody = await postRes.json();
    expect(postBody).toEqual({ written: 1, skipped: 0 });

    const getRes = await callWorker(
      new Request("https://ember.austinsego.com/api/entries", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      })
    );
    const getBody = await getRes.json();
    expect(getBody.entries).toHaveLength(1);
    expect(getBody.entries[0].id).toBe("t1");
    expect(getBody.entries[0].l).toBe("test");
  });

  it("scopes entries per owner through the HTTP layer", async () => {
    const tokenA = await mintJwt({ email: "austin@example.com" });
    const tokenB = await mintJwt({ email: "cara@example.com" });

    const postRes = await callWorker(
      new Request("https://ember.austinsego.com/api/entries", {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": tokenA, "Content-Type": "application/json" },
        body: JSON.stringify({ entries: [{ id: "a-entry", u: 1000, l: "a's cigar" }] }),
      })
    );
    expect(postRes.status).toBe(200);

    const getResB = await callWorker(
      new Request("https://ember.austinsego.com/api/entries", {
        headers: { "Cf-Access-Jwt-Assertion": tokenB },
      })
    );
    const bodyB = await getResB.json();
    expect(bodyB.email).toBe("cara@example.com");
    expect(bodyB.entries.map((e) => e.id)).not.toContain("a-entry");
    expect(bodyB.entries).toHaveLength(0);

    const getResA = await callWorker(
      new Request("https://ember.austinsego.com/api/entries", {
        headers: { "Cf-Access-Jwt-Assertion": tokenA },
      })
    );
    const bodyA = await getResA.json();
    expect(bodyA.entries.map((e) => e.id)).toContain("a-entry");
  });

  it("returns 400 for a malformed JSON POST body", async () => {
    const token = await mintJwt();
    const res = await callWorker(
      new Request("https://ember.austinsego.com/api/entries", {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": token, "Content-Type": "application/json" },
        body: "{not json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 405 for an unhandled method on /api/entries", async () => {
    const token = await mintJwt();
    const res = await callWorker(
      new Request("https://ember.austinsego.com/api/entries", {
        method: "DELETE",
        headers: { "Cf-Access-Jwt-Assertion": token },
      })
    );
    expect(res.status).toBe(405);
  });

  it("returns 404 for an unknown path with a valid assertion", async () => {
    const token = await mintJwt();
    const res = await callWorker(
      new Request("https://ember.austinsego.com/nope", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      })
    );
    expect(res.status).toBe(404);
  });

  it("returns 503, not 403, when the JWKS fetch fails", async () => {
    vi.stubGlobal("fetch", async (url, init) => {
      if (String(url).includes("/cdn-cgi/access/certs")) {
        throw new Error("network down");
      }
      return realFetch(url, init);
    });
    const token = await mintJwt();
    const res = await callWorker(
      new Request("https://ember.austinsego.com/api/entries", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      })
    );
    expect(res.status).toBe(503);
  });

  it("clamps a negative since to 0", async () => {
    // Table is empty (beforeEach recreates it), so listEntries echoes the
    // cursor it was given straight back when nothing matches. That makes an
    // unclamped negative `since` observable: without the fix, ?since=-5
    // would come back with cursor -5 instead of 0, diverging from ?since=0.
    const token = await mintJwt({ email: "austin@example.com" });

    const resNeg = await callWorker(
      new Request("https://ember.austinsego.com/api/entries?since=-5", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      })
    );
    const resZero = await callWorker(
      new Request("https://ember.austinsego.com/api/entries?since=0", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      })
    );
    expect(resNeg.status).toBe(200);
    expect(resZero.status).toBe(200);
    const bodyNeg = await resNeg.json();
    const bodyZero = await resZero.json();
    expect(bodyNeg.entries).toEqual(bodyZero.entries);
    expect(bodyNeg.cursor).toBe(bodyZero.cursor);
    expect(bodyNeg.cursor).toBe(0);
  });
});
