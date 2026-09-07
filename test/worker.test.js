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
  // These four tests dispatch through SELF.fetch, which — per the comment atop
  // this file — runs against the worker's own snapshot of `env`, i.e. whatever
  // is actually committed in wrangler.toml. That means they can only assert
  // invariants that hold for any valid deployed configuration, not behavior
  // derived from particular config values: they check that an unauthenticated
  // request is refused (403) and that no journal content leaks in the
  // response body. The distinct 403-vs-500 and configured-vs-unconfigured
  // paths are exercised in isolation by the callWorker() tests below, which
  // mutate `env` directly.
  const SHELL_MARKER = "Cigar Journal"; // from public/index.html's <title>; stable, distinctive to the app shell

  it("refuses the app shell", async () => {
    const res = await SELF.fetch("https://ember.austinsego.com/");
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).not.toContain(SHELL_MARKER);
  });

  it("refuses the API", async () => {
    const res = await SELF.fetch("https://ember.austinsego.com/api/entries");
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Type")).toMatch(/application\/json/);
    const body = await res.text();
    expect(body).not.toContain(SHELL_MARKER);
  });

  it("refuses a forged assertion too", async () => {
    const res = await SELF.fetch("https://ember.austinsego.com/api/entries", {
      headers: { "Cf-Access-Jwt-Assertion": "forged.token.value" },
    });
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).not.toContain(SHELL_MARKER);
  });

  it("serves the service worker without auth so it can boot offline", async () => {
    const res = await SELF.fetch("https://ember.austinsego.com/sw.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/javascript/);
  });

  it("serves the real service worker source at /sw.js, not a placeholder", async () => {
    // Status and content-type alone would still pass against an empty or
    // placeholder body. The esbuild/Text-rule resolution bug (fixed by
    // renaming public/sw.js to public/sw.js.txt) could silently ship an
    // empty string here while every other check stayed green.
    const res = await SELF.fetch("https://ember.austinsego.com/sw.js");
    const body = await res.text();
    expect(body).toContain("ember-shell-v1");
  });

  it("sets no-store on API responses", async () => {
    // A request with no Access assertion only ever measures the 403 from
    // forbidden() — that response would still carry no-store even if the
    // authenticated success path lost the header, so this test could never
    // fail. Point it at an authenticated request instead so it actually
    // covers the response that matters.
    const token = await mintJwt();
    const res = await callWorker(
      new Request("https://ember.austinsego.com/api/entries", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toMatch(/no-store/);
  });

  it("still sets no-store on an unauthenticated API request", async () => {
    const res = await SELF.fetch("https://ember.austinsego.com/api/entries");
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toMatch(/no-store/);
    const body = await res.text();
    expect(body).not.toContain(SHELL_MARKER);
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

  it("GET / with a valid assertion carries the X-Ember-Shell header the service worker relies on", async () => {
    const token = await mintJwt();
    const res = await callWorker(
      new Request("https://ember.austinsego.com/", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      })
    );
    expect(res.headers.get("X-Ember-Shell")).toBe("1");
  });

  it("GET /sw.js does not carry X-Ember-Shell (only the app shell HTML should)", async () => {
    const res = await SELF.fetch("https://ember.austinsego.com/sw.js");
    expect(res.headers.get("X-Ember-Shell")).toBeNull();
  });

  it("GET /api/entries with a valid assertion does not carry X-Ember-Shell", async () => {
    const token = await mintJwt({ email: "austin@example.com" });
    const res = await callWorker(
      new Request("https://ember.austinsego.com/api/entries", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      })
    );
    expect(res.headers.get("X-Ember-Shell")).toBeNull();
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

  it("returns 500, not 503, when Access is still set to the PENDING placeholder", async () => {
    // ACCESS_TEAM_DOMAIN/ACCESS_AUD ship as "PENDING" in wrangler.toml until the
    // Cloudflare Access application is created. Without a dedicated guard this
    // reaches getIdentity, tries to fetch https://PENDING/cdn-cgi/access/certs,
    // throws, and comes back as the same 503 a real Cloudflare outage would
    // produce — hiding a config mistake behind an infra-outage-shaped error.
    env.ACCESS_TEAM_DOMAIN = "PENDING";
    env.ACCESS_AUD = "PENDING";
    const token = await mintJwt();
    const res = await callWorker(
      new Request("https://ember.austinsego.com/api/entries", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      })
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);

    // The unconfigured path must not touch D1 or leak journal data either.
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM entries").first();
    expect(row.n).toBe(0);
  });

  it("returns 500 for a missing (not just PENDING) Access config", async () => {
    delete env.ACCESS_TEAM_DOMAIN;
    const token = await mintJwt();
    const res = await callWorker(
      new Request("https://ember.austinsego.com/api/entries", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      })
    );
    expect(res.status).toBe(500);
  });

  it("refuses /api/entries with no assertion at all — 403, not 500 and not 200", async () => {
    const res = await callWorker(new Request("https://ember.austinsego.com/api/entries"));
    expect(res.status).toBe(403);
  });

  it("refuses /api/entries with a forged/garbage assertion — 403", async () => {
    const res = await callWorker(
      new Request("https://ember.austinsego.com/api/entries", {
        headers: { "Cf-Access-Jwt-Assertion": "forged.token.value" },
      })
    );
    expect(res.status).toBe(403);
  });

  it("refuses the app shell with no assertion — 403, and never serves the shell HTML", async () => {
    const res = await callWorker(new Request("https://ember.austinsego.com/"));
    expect(res.status).toBe(403);
    // Prove journal content was not served, not merely that a status code came
    // back: neither the shell marker header nor a distinctive string from the
    // HTML itself should appear.
    expect(res.headers.get("X-Ember-Shell")).toBeNull();
    const body = await res.text();
    expect(body).not.toContain("Ember");
    expect(body).not.toContain("Cigar Journal");
  });

  it("refuses a validly-signed token whose aud does not match the configured AUD — 403", async () => {
    const token = await mintJwt({ aud: ["some-other-application-aud"] });
    const res = await callWorker(
      new Request("https://ember.austinsego.com/api/entries", {
        headers: { "Cf-Access-Jwt-Assertion": token },
      })
    );
    expect(res.status).toBe(403);
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
