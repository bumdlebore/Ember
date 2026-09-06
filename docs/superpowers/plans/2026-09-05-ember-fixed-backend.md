# Ember Fixed Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Ember's per-device sync configuration with one fixed Cloudflare Workers + D1 backend behind Cloudflare Access with Google login, served at `ember.austinsego.com`, source public at `github.com/bumdlebore/ember`.

**Architecture:** A single Worker owns the origin. It verifies the `Cf-Access-Jwt-Assertion` header that Access injects, derives the row owner from the JWT's `email` claim, serves the app HTML and service worker as imported text modules, and exposes a two-endpoint delta-sync API backed by D1. The client keeps `localStorage` as its render source and syncs in the background.

**Tech Stack:** Cloudflare Workers (ES modules), D1 (SQLite), Cloudflare Access (Google IdP), Vitest with `@cloudflare/vitest-pool-workers`, vanilla JS single-file client.

**Spec:** `docs/superpowers/specs/2026-09-05-ember-fixed-backend-design.md`

## Global Constraints

- Account ID: `86157a94d182660d93ba076e084b3884`. D1 database name: `ember-journal`. Worker name: `ember`.
- `workers_dev = false` in `wrangler.toml`. Non-negotiable: without it the Worker is reachable at a `workers.dev` hostname that Access does not protect.
- The Worker verifies the Access JWT itself on **every** request including the HTML. Never serve app content on an unverified request.
- No secrets in the repo. `database_id`, `ACCESS_TEAM_DOMAIN`, and `ACCESS_AUD` are identifiers and may be committed. The Google client secret is entered in the Cloudflare dashboard only.
- Static files are served as imported **text modules**, not via `[assets]`. This keeps request routing entirely inside the Worker so the JWT check cannot be bypassed by asset-first routing.
- Delta cursor comparison is `u >= cursor`, never `u > cursor`.
- Entry JSON shape is unchanged from the existing app. Do not alter the journal, palate analysis, or prefill logic.
- Source file to port: `/usr/local/claude-artifacts/public/ember-cigar-journal.html` (954 lines). It stays in place untouched; work on a copy.

---

### Task 1: Repo scaffold, D1 database, schema, test harness

**Files:**
- Create: `/usr/local/ember/package.json`
- Create: `/usr/local/ember/wrangler.toml`
- Create: `/usr/local/ember/schema.sql`
- Create: `/usr/local/ember/vitest.config.js`
- Create: `/usr/local/ember/.gitignore`
- Create: `/usr/local/ember/src/index.js` (stub)

**Interfaces:**
- Consumes: nothing.
- Produces: the `DB` binding name, the `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` var names, and the `ember-journal` database that every later task queries.

- [ ] **Step 1: Initialize the repo**

```bash
cd /usr/local/ember
git init -b main
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "ember",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "schema": "wrangler d1 execute ember-journal --remote --file=./schema.sql"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.19",
    "vitest": "~3.0.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 3: Write `schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS entries (
  owner   TEXT    NOT NULL,
  id      TEXT    NOT NULL,
  data    TEXT    NOT NULL,
  u       INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, id)
);
CREATE INDEX IF NOT EXISTS idx_entries_owner_u ON entries(owner, u);
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
.wrangler/
.dev.vars
*.log
```

- [ ] **Step 5: Create the D1 database**

```bash
cd /usr/local/ember && npx wrangler d1 create ember-journal
```

Expected: prints a `database_id` UUID. Copy it into `wrangler.toml` in the next step. If it reports the database already exists, get the id with `npx wrangler d1 list`.

- [ ] **Step 6: Write `wrangler.toml`**

Substitute the real `database_id` from Step 5. Leave `ACCESS_AUD` as the literal string `PENDING` — Task 7 fills it in once the Access application exists.

```toml
name = "ember"
main = "src/index.js"
compatibility_date = "2026-09-05"
compatibility_flags = ["nodejs_compat"]
account_id = "86157a94d182660d93ba076e084b3884"
workers_dev = false

[[d1_databases]]
binding = "DB"
database_name = "ember-journal"
database_id = "PASTE_FROM_STEP_5"

[[rules]]
type = "Text"
globs = ["**/*.html", "**/*.webmanifest"]
fallthrough = true

[vars]
ACCESS_TEAM_DOMAIN = "PENDING"
ACCESS_AUD = "PENDING"
```

- [ ] **Step 7: Write `vitest.config.js`**

```js
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          d1Databases: ["DB"],
        },
      },
    },
  },
});
```

- [ ] **Step 8: Write the stub `src/index.js`**

```js
export default {
  async fetch() {
    return new Response("not implemented", { status: 501 });
  },
};
```

- [ ] **Step 9: Install and verify the harness runs**

```bash
cd /usr/local/ember && npm install && npx vitest run --reporter=verbose
```

Expected: vitest starts and reports "No test files found". That is success for this step — it proves the workers pool loads `wrangler.toml` without error. If it errors on `d1_databases`, the `database_id` is wrong.

- [ ] **Step 10: Apply the schema to the remote database**

```bash
cd /usr/local/ember && npm run schema
```

Expected: reports 2 commands executed.

- [ ] **Step 11: Verify the schema landed**

```bash
cd /usr/local/ember && npx wrangler d1 execute ember-journal --remote \
  --command "SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name"
```

Expected: rows including `entries` and `idx_entries_owner_u`.

- [ ] **Step 12: Commit**

```bash
cd /usr/local/ember
git add package.json package-lock.json wrangler.toml schema.sql vitest.config.js .gitignore src/index.js docs/
git commit -m "$(cat <<'EOF'
chore: scaffold ember worker, d1 schema, and test harness

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Access JWT verification

**Files:**
- Create: `/usr/local/ember/src/access.js`
- Create: `/usr/local/ember/test/access.test.js`

**Interfaces:**
- Consumes: `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` from `env`.
- Produces:
  - `verifyAccessJwt(token, { teamDomain, aud, now }) -> Promise<{ email: string }>` — resolves with the payload's identity on success, throws `Error` on any failure.
  - `getIdentity(request, env) -> Promise<{ email: string }>` — reads the `Cf-Access-Jwt-Assertion` header and delegates. Throws if the header is absent.
  - A module-level JWKS cache keyed by team domain, refreshed when a `kid` misses.

- [ ] **Step 1: Write the failing tests**

Create `/usr/local/ember/test/access.test.js`:

```js
import { describe, it, expect, beforeAll, vi } from "vitest";
import { verifyAccessJwt, __resetJwksCache } from "../src/access.js";

const TEAM = "example.cloudflareaccess.com";
const AUD = "aud-tag-123";

let keyPair, jwk, kid;

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

  vi.stubGlobal("fetch", async (url) => {
    if (String(url).includes("/cdn-cgi/access/certs")) {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error("unexpected fetch: " + url);
  });
});

describe("verifyAccessJwt", () => {
  it("returns the email for a valid token", async () => {
    __resetJwksCache();
    const token = await mintJwt();
    const identity = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD });
    expect(identity.email).toBe("austin@example.com");
  });

  it("rejects a token whose aud does not match", async () => {
    __resetJwksCache();
    const token = await mintJwt({ aud: ["someone-elses-app"] });
    await expect(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD })
    ).rejects.toThrow(/aud/i);
  });

  it("rejects an expired token", async () => {
    __resetJwksCache();
    const token = await mintJwt({ exp: Math.floor(Date.now() / 1000) - 10 });
    await expect(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD })
    ).rejects.toThrow(/expired/i);
  });

  it("rejects a token with a tampered payload", async () => {
    __resetJwksCache();
    const token = await mintJwt();
    const [h, , s] = token.split(".");
    const forged = b64urlJson({
      aud: [AUD],
      email: "attacker@example.com",
      iss: `https://${TEAM}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    await expect(
      verifyAccessJwt(`${h}.${forged}.${s}`, { teamDomain: TEAM, aud: AUD })
    ).rejects.toThrow(/signature/i);
  });

  it("rejects a token signed with an unknown kid", async () => {
    __resetJwksCache();
    const token = await mintJwt({}, { kid: "not-a-real-key" });
    await expect(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD })
    ).rejects.toThrow(/key/i);
  });

  it("rejects a malformed token", async () => {
    __resetJwksCache();
    await expect(
      verifyAccessJwt("not.a.jwt", { teamDomain: TEAM, aud: AUD })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /usr/local/ember && npx vitest run test/access.test.js
```

Expected: FAIL — cannot resolve `../src/access.js`.

- [ ] **Step 3: Write `src/access.js`**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /usr/local/ember && npx vitest run test/access.test.js
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd /usr/local/ember
git add src/access.js test/access.test.js
git commit -m "$(cat <<'EOF'
feat: verify Cloudflare Access JWT against team JWKS

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Entries API — delta pull, batch upsert, owner scoping

**Files:**
- Create: `/usr/local/ember/src/entries.js`
- Create: `/usr/local/ember/test/entries.test.js`

**Interfaces:**
- Consumes: `env.DB` (D1 binding), and `{ email }` from `getIdentity` in Task 2.
- Produces:
  - `listEntries(db, owner, since) -> Promise<{ entries: Array<{id,u,deleted,...}>, cursor: number }>` — rows with `u >= since`, `cursor` is the max `u` seen or `since` when empty.
  - `upsertEntries(db, owner, entries) -> Promise<{ written: number, skipped: number }>` — last-write-wins on `u`, malformed rows skipped.

- [ ] **Step 1: Write the failing tests**

Create `/usr/local/ember/test/entries.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { listEntries, upsertEntries } from "../src/entries.js";

beforeEach(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS entries");
  await env.DB.exec(
    "CREATE TABLE entries (owner TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, u INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner, id))"
  );
});

const A = "austin@example.com";
const B = "cara@example.com";

describe("upsertEntries", () => {
  it("writes new entries and reads them back", async () => {
    const r = await upsertEntries(env.DB, A, [
      { id: "e1", u: 100, deleted: 0, l: "Padron 1964" },
    ]);
    expect(r.written).toBe(1);

    const out = await listEntries(env.DB, A, 0);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].l).toBe("Padron 1964");
    expect(out.entries[0].id).toBe("e1");
  });

  it("keeps the higher u on conflict", async () => {
    await upsertEntries(env.DB, A, [{ id: "e1", u: 200, l: "newer" }]);
    await upsertEntries(env.DB, A, [{ id: "e1", u: 100, l: "older" }]);

    const out = await listEntries(env.DB, A, 0);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].l).toBe("newer");
    expect(out.entries[0].u).toBe(200);
  });

  it("applies an equal-u write idempotently", async () => {
    await upsertEntries(env.DB, A, [{ id: "e1", u: 100, l: "first" }]);
    await upsertEntries(env.DB, A, [{ id: "e1", u: 100, l: "second" }]);
    const out = await listEntries(env.DB, A, 0);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].u).toBe(100);
  });

  it("skips malformed rows but writes the rest", async () => {
    const r = await upsertEntries(env.DB, A, [
      { id: "good", u: 100, l: "ok" },
      { u: 100, l: "no id" },
      { id: "no-u", l: "missing u" },
      null,
    ]);
    expect(r.written).toBe(1);
    expect(r.skipped).toBe(3);
    const out = await listEntries(env.DB, A, 0);
    expect(out.entries.map((e) => e.id)).toEqual(["good"]);
  });

  it("round-trips tombstones", async () => {
    await upsertEntries(env.DB, A, [{ id: "e1", u: 100, l: "x" }]);
    await upsertEntries(env.DB, A, [{ id: "e1", u: 300, deleted: 1, l: "x" }]);
    const out = await listEntries(env.DB, A, 0);
    expect(out.entries[0].deleted).toBe(1);
  });

  it("returns written 0 for an empty batch", async () => {
    const r = await upsertEntries(env.DB, A, []);
    expect(r.written).toBe(0);
  });
});

describe("listEntries", () => {
  it("never returns another owner's rows", async () => {
    await upsertEntries(env.DB, A, [{ id: "mine", u: 100, l: "mine" }]);
    await upsertEntries(env.DB, B, [{ id: "theirs", u: 100, l: "theirs" }]);

    const out = await listEntries(env.DB, A, 0);
    expect(out.entries.map((e) => e.id)).toEqual(["mine"]);
  });

  it("lets two owners hold the same entry id independently", async () => {
    await upsertEntries(env.DB, A, [{ id: "shared", u: 100, l: "a-version" }]);
    await upsertEntries(env.DB, B, [{ id: "shared", u: 100, l: "b-version" }]);

    expect((await listEntries(env.DB, A, 0)).entries[0].l).toBe("a-version");
    expect((await listEntries(env.DB, B, 0)).entries[0].l).toBe("b-version");
  });

  it("filters by cursor inclusively", async () => {
    await upsertEntries(env.DB, A, [
      { id: "old", u: 100, l: "old" },
      { id: "edge", u: 200, l: "edge" },
      { id: "new", u: 300, l: "new" },
    ]);

    const out = await listEntries(env.DB, A, 200);
    expect(out.entries.map((e) => e.id).sort()).toEqual(["edge", "new"]);
  });

  it("returns the max u as the cursor", async () => {
    await upsertEntries(env.DB, A, [
      { id: "a", u: 100, l: "a" },
      { id: "b", u: 450, l: "b" },
    ]);
    const out = await listEntries(env.DB, A, 0);
    expect(out.cursor).toBe(450);
  });

  it("echoes the cursor back when nothing matches", async () => {
    const out = await listEntries(env.DB, A, 999);
    expect(out.entries).toEqual([]);
    expect(out.cursor).toBe(999);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /usr/local/ember && npx vitest run test/entries.test.js
```

Expected: FAIL — cannot resolve `../src/entries.js`.

- [ ] **Step 3: Write `src/entries.js`**

```js
export async function listEntries(db, owner, since) {
  const cursor = Number.isFinite(since) ? since : 0;
  const { results } = await db
    .prepare("SELECT id, data, u, deleted FROM entries WHERE owner = ? AND u >= ? ORDER BY u ASC")
    .bind(owner, cursor)
    .all();

  const entries = [];
  let max = cursor;
  for (const row of results || []) {
    let parsed;
    try {
      parsed = JSON.parse(row.data);
    } catch {
      continue;
    }
    entries.push({ ...parsed, id: row.id, u: row.u, deleted: row.deleted });
    if (row.u > max) max = row.u;
  }
  return { entries, cursor: max };
}

export async function upsertEntries(db, owner, entries) {
  const list = Array.isArray(entries) ? entries : [];
  const statements = [];
  let skipped = 0;

  const sql = `INSERT INTO entries (owner, id, data, u, deleted)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(owner, id) DO UPDATE SET
                 data = excluded.data,
                 u = excluded.u,
                 deleted = excluded.deleted
               WHERE excluded.u > entries.u`;

  for (const entry of list) {
    if (!entry || typeof entry !== "object") { skipped++; continue; }
    const id = entry.id;
    const u = entry.u;
    if (typeof id !== "string" || !id || typeof u !== "number" || !Number.isFinite(u)) {
      skipped++;
      continue;
    }
    statements.push(
      db.prepare(sql).bind(owner, id, JSON.stringify(entry), u, entry.deleted ? 1 : 0)
    );
  }

  if (statements.length) await db.batch(statements);
  return { written: statements.length, skipped };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /usr/local/ember && npx vitest run test/entries.test.js
```

Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
cd /usr/local/ember
git add src/entries.js test/entries.test.js
git commit -m "$(cat <<'EOF'
feat: owner-scoped delta sync queries against D1

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Worker routing and static serving

**Files:**
- Modify: `/usr/local/ember/src/index.js` (replace the stub in full)
- Create: `/usr/local/ember/test/worker.test.js`
- Create: `/usr/local/ember/public/index.html` (placeholder; Task 5 replaces the contents)
- Create: `/usr/local/ember/public/sw.js` (placeholder; Task 6 replaces the contents)

**Interfaces:**
- Consumes: `getIdentity` (Task 2), `listEntries` / `upsertEntries` (Task 3).
- Produces: the HTTP contract the client in Task 5 codes against —
  - `GET /` → 200 `text/html`
  - `GET /sw.js` → 200 `text/javascript`
  - `GET /api/entries?since=<int>` → 200 `{ entries: [...], cursor: <int>, email: "<addr>" }`
  - `POST /api/entries` body `{ entries: [...] }` → 200 `{ written, skipped }`
  - any request without a valid Access assertion → 403 `{ error: "forbidden" }`
  - unknown path → 404

- [ ] **Step 1: Write the failing tests**

Create `/usr/local/ember/test/worker.test.js`. `SELF.fetch` sends no Access header, which is exactly the unauthenticated case; authenticated paths are covered by Tasks 2 and 3 plus the live checks in Task 7.

```js
import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

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
```

- [ ] **Step 2: Create the placeholder static files**

```bash
cd /usr/local/ember && mkdir -p public
printf '<!doctype html><title>Ember</title><p>placeholder</p>' > public/index.html
printf '/* placeholder */\n' > public/sw.js
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd /usr/local/ember && npx vitest run test/worker.test.js
```

Expected: FAIL — the stub returns 501 for every route.

- [ ] **Step 4: Replace `src/index.js` in full**

`sw.js` is served unauthenticated on purpose: a service worker must be fetchable to register, it contains no journal data, and every request it proxies still passes through Access.

```js
import { getIdentity, JwksUnavailable } from "./access.js";
import { listEntries, upsertEntries } from "./entries.js";
import HTML from "../public/index.html";
import SW from "../public/sw.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const forbidden = () => json({ error: "forbidden" }, 403);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/sw.js") {
      return new Response(SW, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    let identity;
    try {
      identity = await getIdentity(request, env);
    } catch (e) {
      // Distinguish "we cannot check right now" from "this request is not allowed",
      // so a Cloudflare-side outage does not read as a rejected identity.
      if (e instanceof JwksUnavailable) {
        return json({ error: "auth temporarily unavailable" }, 503);
      }
      return forbidden();
    }

    if (url.pathname === "/") {
      return new Response(HTML, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex",
        },
      });
    }

    if (url.pathname === "/api/entries") {
      if (request.method === "GET") {
        const since = Number.parseInt(url.searchParams.get("since") || "0", 10);
        const out = await listEntries(env.DB, identity.email, Number.isFinite(since) ? since : 0);
        return json({ ...out, email: identity.email });
      }
      if (request.method === "POST") {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: "bad json" }, 400);
        }
        const out = await upsertEntries(env.DB, identity.email, body && body.entries);
        return json(out);
      }
      return json({ error: "method not allowed" }, 405);
    }

    return json({ error: "not found" }, 404);
  },
};
```

- [ ] **Step 5: Add the JS text rule so `sw.js` imports as text**

In `wrangler.toml`, replace the existing `[[rules]]` block with:

```toml
[[rules]]
type = "Text"
globs = ["**/*.html", "**/*.webmanifest"]
fallthrough = true

[[rules]]
type = "Text"
globs = ["public/sw.js"]
fallthrough = true
```

The `.js` extension collides with wrangler's default ESM handling, so this rule
is doing real work. If Step 6 fails with a module-parse or "cannot find module"
error on `../public/sw.js`, the rule did not take effect — rename the file to
`public/sw.js.txt`, update the import in `src/index.js` to match, and rerun. The
served path stays `/sw.js` either way because the Worker sets it explicitly.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd /usr/local/ember && npx vitest run
```

Expected: all tests from Tasks 2, 3, and 4 pass (22 total).

- [ ] **Step 7: Commit**

```bash
cd /usr/local/ember
git add src/index.js test/worker.test.js public/index.html public/sw.js wrangler.toml
git commit -m "$(cat <<'EOF'
feat: gate every route on a verified Access assertion

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Client rewrite — remove per-device config, delta sync

**Files:**
- Modify: `/usr/local/ember/public/index.html` (replaces the placeholder with the ported app)

**Interfaces:**
- Consumes: the HTTP contract from Task 4.
- Produces: nothing other tasks import. Task 6 registers the service worker from this file's boot sequence.

- [ ] **Step 1: Copy the source app into the repo**

```bash
cp /usr/local/claude-artifacts/public/ember-cigar-journal.html /usr/local/ember/public/index.html
wc -l /usr/local/ember/public/index.html
```

Expected: 954 lines. The original at `/usr/local/claude-artifacts/` is not modified by any step in this plan.

- [ ] **Step 2: Delete the sync settings sheet markup**

Remove lines 415–443 inclusive — the `<!-- sync settings sheet -->` comment through the blank line after the `</div>` that closes `#syncscrim`. Verify the boundaries first, because the line numbers must match exactly:

```bash
cd /usr/local/ember && sed -n '415,443p' public/index.html | head -3
sed -n '441,444p' public/index.html
```

Expected: the first command prints the comment and the opening `#syncscrim` div; the second prints two closing `</div>` tags, a blank line, then `<div class="toast" id="toast"></div>`.

Then delete:

```bash
cd /usr/local/ember && sed -i '' '415,443d' public/index.html
grep -c 'syncscrim\|s-url\|s-token\|s-save\|s-test\|s-msg\|s-disconnect' public/index.html
```

Expected: `0`. If it is not 0, the line range was wrong — restore with `git checkout public/index.html` and recheck.

- [ ] **Step 3: Replace the SYNC JavaScript section**

The section now runs from the `/* ============ SYNC` marker to the last line of the file. Find where it starts and cut everything from there:

```bash
cd /usr/local/ember
START=$(grep -n '/\* ============ SYNC' public/index.html | cut -d: -f1)
echo "SYNC starts at $START"
head -n $((START - 1)) public/index.html > /tmp/ember-head.html
tail -3 public/index.html
```

Expected: `tail` prints `</script>`, `</body>`, `</html>`.

Now append the replacement:

```bash
cd /usr/local/ember
cat /tmp/ember-head.html > public/index.html
cat >> public/index.html <<'ENDOFSYNC'
/* ============ SYNC (fixed backend — Cloudflare Worker + D1) ============ */
const CKEY="ember.cursor", PKEY="ember.pushed";
let cursor=+(localStorage.getItem(CKEY)||0);
let pushed=+(localStorage.getItem(PKEY)||0);
let account="";
let syncing=false;

function setPill(state,label){const b=$("#syncbtn");b.className="syncpill"+(state?" "+state:"");b.textContent=label;}
function updateSyncUI(){
  if(syncing){setPill("busy","↻ Syncing…");return;}
  if(!account){setPill("","○ Offline");return;}
  const t=cursor?new Date(cursor).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}):"";
  setPill("ok",t?"● Synced "+t:"● Connected");
}

class SessionExpired extends Error{}

async function apiFetch(path,opts){
  const res=await fetch(path,{credentials:"same-origin",...opts,
    headers:{"Content-Type":"application/json",...(opts&&opts.headers)}});
  // Access returns a redirect to the login page once the session lapses.
  if(res.redirected||res.status===302||res.status===403) throw new SessionExpired();
  const ct=res.headers.get("Content-Type")||"";
  if(!ct.includes("application/json")) throw new SessionExpired();
  if(!res.ok) throw new Error("HTTP "+res.status);
  return res.json();
}

function mergeServer(server){
  const map={};data.forEach(e=>map[e.id]=e);
  server.forEach(s=>{const cur=map[s.id];if(!cur||(s.u||0)>=(cur.u||0))map[s.id]=s;});
  data=Object.values(map);
}

async function syncNow(silent){
  if(syncing)return;
  syncing=true;updateSyncUI();
  try{
    const dirty=data.filter(e=>(e.u||0)>pushed);
    if(dirty.length) await apiFetch("/api/entries",{method:"POST",body:JSON.stringify({entries:dirty})});
    const maxDirty=dirty.reduce((m,e)=>Math.max(m,e.u||0),pushed);

    const out=await apiFetch("/api/entries?since="+cursor);
    mergeServer(out.entries||[]);
    cursor=out.cursor||cursor;
    pushed=maxDirty;
    account=out.email||"";
    localStorage.setItem(CKEY,String(cursor));
    localStorage.setItem(PKEY,String(pushed));

    save();fillDatalists();renderAll();
    syncing=false;updateSyncUI();
    if(!silent)toast("Synced");
  }catch(e){
    syncing=false;
    if(e instanceof SessionExpired){
      account="";setPill("err","⚠ Sign in");
      if(!silent)toast("Session expired — reload to sign in");
    }else{
      setPill("err","⚠ Offline");
      if(!silent)toast("Sync failed — you're offline");
    }
  }
}
function pushSync(){syncNow(true);}

$("#syncbtn").onclick=()=>{
  if(!account&&!navigator.onLine){toast("No connection");return;}
  if(!account){location.reload();return;}
  syncNow();
};
window.addEventListener("online",()=>syncNow(true));
document.addEventListener("visibilitychange",()=>{if(!document.hidden)syncNow(true);});

/* ============ BOOT ============ */
buildStars();fillDatalists();clearForm();renderAll();
updateSyncUI();syncNow(true);

if("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(()=>{});
</script>
</body>
</html>
ENDOFSYNC
```

- [ ] **Step 4: Verify every trace of per-device config is gone**

```bash
cd /usr/local/ember
grep -n 'supabase\|Supabase\|ember\.sync\|sync\.url\|sync\.token\|syncOn\|apiBase\|isSupabase\|openSync\|closeSync' public/index.html
```

Expected: no output. Any hit is leftover dead code — remove it before continuing.

- [ ] **Step 5: Verify the file is still well-formed**

```bash
cd /usr/local/ember
tail -4 public/index.html
grep -c '<script>' public/index.html
node --input-type=module -e "
  const fs=await import('node:fs');
  const s=fs.readFileSync('public/index.html','utf8');
  const open=(s.match(/<script>/g)||[]).length, close=(s.match(/<\/script>/g)||[]).length;
  if(open!==close) throw new Error('script tags unbalanced: '+open+' vs '+close);
  console.log('script tags balanced:',open);
"
```

Expected: `</script>`, `</body>`, `</html>` at the tail, and "script tags balanced".

- [ ] **Step 6: Confirm the Worker still passes its tests with the real HTML**

```bash
cd /usr/local/ember && npx vitest run
```

Expected: all 22 tests pass. This also proves the 185 KB HTML imports as a text module without blowing the bundle.

- [ ] **Step 7: Commit**

```bash
cd /usr/local/ember
git add public/index.html
git commit -m "$(cat <<'EOF'
feat: drop per-device sync config for a fixed backend

Removes the sync settings sheet, the ember.sync store, and the Supabase
code path. Sync is now delta-based against the Worker on the same origin,
authenticated by the Access cookie.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Offline app shell

**Files:**
- Modify: `/usr/local/ember/public/sw.js` (replaces the placeholder)

**Interfaces:**
- Consumes: registered by the boot sequence written in Task 5, Step 3.
- Produces: nothing other tasks import.

- [ ] **Step 1: Write `public/sw.js`**

`/api/` is network-only so a stale journal is never served as authoritative, and the shell is served cache-first so the app opens with no signal. Never cache a redirect — that is how an Access login page would get baked in as the app.

```js
const CACHE = "ember-shell-v1";
const SHELL = "/";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // network only

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(event.request);
        // A redirect means the Access session lapsed; do not cache the login page.
        if (res.ok && !res.redirected && res.type === "basic") {
          cache.put(event.request, res.clone());
        }
        return res;
      } catch {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const shell = await cache.match(SHELL);
        if (shell) return shell;
        throw new Error("offline and nothing cached");
      }
    })()
  );
});
```

- [ ] **Step 2: Verify the Worker serves it unauthenticated**

```bash
cd /usr/local/ember && npx vitest run test/worker.test.js
```

Expected: 5 passed, including the `/sw.js` case.

- [ ] **Step 3: Commit**

```bash
cd /usr/local/ember
git add public/sw.js
git commit -m "$(cat <<'EOF'
feat: cache the app shell for offline use

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Cloudflare setup, deploy, and live verification

This task has manual steps Claude cannot perform: creating a Google OAuth client requires Austin's Google account, and the wrangler token carries no Zero Trust scope. Steps marked **[Austin]** are his; the rest are Claude's.

**Files:**
- Modify: `/usr/local/ember/wrangler.toml` (fill in `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`)

**Interfaces:**
- Consumes: the deployed Worker from Tasks 2–6.
- Produces: a live, authenticated `https://ember.austinsego.com`.

- [ ] **Step 1: [Austin] Record the current IdP selection on the existing Access apps**

In the Cloudflare dashboard → Zero Trust → Access → Applications, open both `share.austinsego.com/admin` and `push.austinsego.com`. For each, note which login methods are selected. If either is set to accept *all* identity providers, change it to explicitly select only the methods it uses today, and save.

This must happen **before** Step 3. Adding an account-level IdP while an app accepts all providers would silently add Google as a login option on that app.

- [ ] **Step 2: [Austin] Create the Google OAuth client**

1. Go to `https://console.cloud.google.com/`, create a project (any name, e.g. `ember-access`). A personal Gmail account is sufficient.
2. APIs & Services → OAuth consent screen → User type **External** → fill in app name and your email → Save.
3. Publish the app (Publishing status → **Publish app**). Because the only scopes are `openid`, `email`, and `profile`, no Google verification is required, users see no warning screen, and authorizations do not expire after 7 days.
4. APIs & Services → Credentials → Create Credentials → **OAuth client ID** → Application type **Web application**.
5. Under **Authorized redirect URIs** add exactly:
   `https://<your-team-name>.cloudflareaccess.com/cdn-cgi/access/callback`
   Find `<your-team-name>` in Zero Trust → Settings → Custom Pages, or the team domain shown at the top of the Zero Trust dashboard.
6. Save. Keep the **Client ID** and **Client secret** on screen for the next step. Do not paste the secret into chat or any file.

- [ ] **Step 3: [Austin] Add Google as an identity provider**

Zero Trust → Settings → Authentication → Login methods → **Add new** → **Google**. Paste the Client ID and Client secret. Save, then use **Test** to confirm the connection succeeds.

- [ ] **Step 4: [Austin] Create the Access application**

Zero Trust → Access → Applications → **Add an application** → **Self-hosted**.

- Application name: `Ember`
- Subdomain `ember`, domain `austinsego.com`, path empty
- Session duration: 1 month
- Identity providers: **Google only**
- Turn on **Apply instant authentication** so the Cloudflare login page is skipped and the browser goes straight to Google
- Policy: Action **Allow**, rule Include → **Emails** → `austinsego@gmail.com`, `austin@hopecc.com`

Save. Then open the application's **Overview** tab and copy the **Application Audience (AUD) Tag**.

- [ ] **Step 5: [Austin] Report two values**

Give Claude the **team domain** (`<team-name>.cloudflareaccess.com`) and the **AUD tag**. Neither is a secret — the AUD identifies the app and the team domain is a public hostname.

- [ ] **Step 6: Fill in the vars**

In `wrangler.toml` replace both `PENDING` values:

```toml
[vars]
ACCESS_TEAM_DOMAIN = "<team-name>.cloudflareaccess.com"
ACCESS_AUD = "<aud tag from step 4>"
```

- [ ] **Step 7: Deploy**

```bash
cd /usr/local/ember && npx wrangler deploy
```

Expected: uploads and prints the Worker version. It should report no `workers.dev` route. If it prints a `*.workers.dev` URL, `workers_dev = false` is missing — fix and redeploy before going further.

- [ ] **Step 8: Bind the custom domain**

```bash
cd /usr/local/ember && npx wrangler deploy --routes ember.austinsego.com/*
```

If the zone is not in this account the command fails here with an explicit error; that resolves the open question in the spec. Alternatively add the custom domain in the dashboard under Workers → `ember` → Settings → Domains & Routes.

- [ ] **Step 9: Verify the Worker is not exposed on workers.dev**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://ember.austinsego.workers.dev/ || echo "does not resolve — correct"
```

Expected: does not resolve, or a 404/1000-class error. Anything that returns the app is a leak — stop and fix `workers_dev`.

- [ ] **Step 10: Verify unauthenticated requests are refused**

```bash
curl -sS -i https://ember.austinsego.com/ | head -1
curl -sS -i https://ember.austinsego.com/api/entries | head -1
```

Expected: both are a 302 redirect toward `cloudflareaccess.com` (Access intercepting at the edge). If either returns 200 with journal content, stop — Access is not applied to the hostname.

- [ ] **Step 11: Verify the Worker's own check fails closed**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'Cf-Access-Jwt-Assertion: forged' https://ember.austinsego.com/api/entries
```

Expected: 302 from Access, or 403 from the Worker. Never 200.

- [ ] **Step 12: [Austin] Sign in and log an entry**

Open `https://ember.austinsego.com` on the laptop. Confirm it redirects straight to Google with no Cloudflare login page in between, then loads the journal. Log one test entry.

- [ ] **Step 13: Verify the row landed under the right owner**

```bash
cd /usr/local/ember && npx wrangler d1 execute ember-journal --remote \
  --command "SELECT owner, count(*) AS n, max(u) AS newest FROM entries GROUP BY owner"
```

Expected: one row, owner is the signed-in email, `n` ≥ 1.

- [ ] **Step 14: [Austin] Verify cross-device sync**

Open the app on the phone, sign in with the same Google account, confirm the test entry from Step 12 appears with no configuration prompt. Log a second entry on the phone, return to the laptop, confirm it arrives.

- [ ] **Step 15: [Austin] Verify offline behavior**

On the phone, load the app once, then turn on airplane mode and reopen it. Expected: the shell loads and the entry list renders from localStorage, with the pill showing `⚠ Offline`. Turn airplane mode off and confirm the pill returns to `● Synced`.

- [ ] **Step 16: Verify the delta cursor is actually reducing reads**

```bash
cd /usr/local/ember && npx wrangler d1 insights ember-journal --timePeriod 1d 2>/dev/null \
  || echo "insights unavailable — fall back to the dashboard D1 metrics"
```

Expected: rows read per query in the single digits, not a full table scan on every sync.

- [ ] **Step 17: Commit**

```bash
cd /usr/local/ember
git add wrangler.toml
git commit -m "$(cat <<'EOF'
chore: point the worker at the live Access application

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Publish to GitHub

**Files:**
- Create: `/usr/local/ember/README.md`

**Interfaces:**
- Consumes: a verified working deployment from Task 7.
- Produces: `github.com/bumdlebore/ember`.

- [ ] **Step 1: Write `README.md`**

````markdown
# Ember

A cigar journal. Log what you smoked, rate it, and let it tell you what your
palate actually likes — which wrappers, binders, fillers, and origins your own
ratings favor.

Single-page app on Cloudflare Workers with a D1 backend, behind Cloudflare
Access with Google login. There is nothing to configure on a device: sign in
and your journal is there.

## Architecture

```
Google -> Cloudflare Access -> Worker "ember" -> D1 "ember-journal"
```

The Worker verifies the `Cf-Access-Jwt-Assertion` header on every request and
scopes rows by the JWT's `email` claim. The app HTML and service worker are
imported as text modules so all routing stays inside the Worker — nothing is
served ahead of the auth check.

`localStorage` is the render source, so the UI paints instantly and works
offline. Sync is delta-based on a millisecond `u` timestamp, last write wins.

## API

| Route | Method | Returns |
|---|---|---|
| `/` | GET | app HTML |
| `/sw.js` | GET | service worker (unauthenticated; contains no data) |
| `/api/entries?since=<ms>` | GET | `{ entries, cursor, email }`, rows with `u >= since` |
| `/api/entries` | POST | `{ written, skipped }` from `{ entries: [...] }` |

Anything without a valid Access assertion gets a 403.

## Develop

```bash
npm install
npm test          # vitest under @cloudflare/vitest-pool-workers
npm run dev       # local worker
```

## Deploy

```bash
npm run schema    # apply schema.sql to the remote D1 database
npm run deploy
```

## Configuration

`wrangler.toml` holds `database_id`, `ACCESS_TEAM_DOMAIN`, and `ACCESS_AUD`.
These are identifiers, not credentials — they are useless without account API
access, so they are committed deliberately. No secret belongs in this repo; the
Google OAuth client secret is entered in the Cloudflare dashboard only.

`workers_dev = false` is required. Without it the Worker stays reachable at a
`workers.dev` hostname that Cloudflare Access does not protect.

## Setting up your own

1. `wrangler d1 create ember-journal`, put the id in `wrangler.toml`
2. `npm run schema`
3. Create a Google OAuth client; add it to Zero Trust as an identity provider
4. Create a self-hosted Access application for your hostname, Google only,
   instant auth on; copy its AUD tag into `wrangler.toml`
5. `npm run deploy`

## License

MIT
````

- [ ] **Step 2: Add a license file**

```bash
cd /usr/local/ember
cat > LICENSE <<'EOF'
MIT License

Copyright (c) 2026 Austin Sego

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF
```

- [ ] **Step 3: Audit the tree for secrets before it goes public**

```bash
cd /usr/local/ember
git ls-files | xargs grep -n -I -iE 'client_secret|api[_-]?key|bearer [A-Za-z0-9]|password|BEGIN [A-Z ]*PRIVATE KEY' || echo "clean"
git ls-files | grep -E '\.env|\.dev\.vars' || echo "no env files tracked"
```

Expected: `clean` and `no env files tracked`. The strings `ACCESS_AUD` and `database_id` are expected and fine. Do not proceed if anything else appears.

- [ ] **Step 4: Commit**

```bash
cd /usr/local/ember
git add README.md LICENSE
git commit -m "$(cat <<'EOF'
docs: add README and MIT license

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Create the public repo and push**

```bash
cd /usr/local/ember
gh repo create bumdlebore/ember --public --source=. --remote=origin \
  --description "Cigar journal on Cloudflare Workers + D1, behind Access with Google login" \
  --push
```

- [ ] **Step 6: Verify what actually landed**

```bash
cd /usr/local/ember
gh repo view bumdlebore/ember --json url,visibility,description
git ls-remote --heads origin
```

Expected: visibility `PUBLIC`, a `main` branch on the remote.

- [ ] **Step 7: Link it from the Homelab project notes**

Append to `/Users/austinsego/Documents/Claude/Projects/Homelab/notes.md` under the reference section:

```markdown
- **Ember** (cigar journal) — https://ember.austinsego.com, Cloudflare Worker
  `ember` + D1 `ember-journal`, behind Access with Google login. Source:
  `/usr/local/ember`, published at github.com/bumdlebore/ember.
```

---

## Post-plan follow-ups

Not in scope; each needs its own sign-off.

1. **Retire `public/ember-cigar-journal.html`.** The old file stays live at
   `share.austinsego.com/ember-cigar-journal.html` until Austin confirms the new
   app works on every device he uses. Removing it is a separate decision under
   operating rule 13 — announce what and why, and offer to park rather than
   delete.
2. **Switch `share.austinsego.com/admin` to Google.** Keep one-time PIN enabled
   as a fallback login method; Google-only risks a lockout if the OAuth client
   breaks. `push.austinsego.com` stays untouched — it authenticates with a
   service token and the `publish-artifact` skill depends on it.
