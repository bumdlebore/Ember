# Ember — fixed backend, Google login, ember.austinsego.com

Design doc. Written 2026-09-05. Approved in session before implementation.

## Problem

`ember-cigar-journal.html` is a single-file app whose journal lives in
`localStorage`. Cross-device sync exists but requires pasting a backend URL and
a token into a settings sheet **on every device**, and the sync layer carries
two mutually exclusive code paths (Cloudflare Worker and Supabase) selected by
regex-matching the URL. Nothing is configured today; the app runs local-only.

Goals:

1. One fixed backend. No per-device configuration.
2. Reachable at `ember.austinsego.com`.
3. Source in a public GitHub repo under `bumdlebore`.

Non-goals: multi-user features, sharing, changing the journal's data model or
its palate-analysis UI.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend | Cloudflare Workers + D1 | See "Why not the Pi" |
| Auth | Cloudflare Access, Google IdP | No secret in the client, no per-device config |
| Hosting of the HTML | The same Worker | Single origin means the Access cookie covers `/api/*` with no token handling |
| Sync shape | Delta on `u`, last-write-wins | Row-read budget; LWW already fits a single-user journal |
| Repo | Public, `bumdlebore/ember` | No secrets in the tree |

### Why not the Pi

The free tier is oversized for this by roughly three orders of magnitude:
Workers 100k requests/day, D1 5 GB storage with 5M row reads and 100k row
writes per day. A cigar journal writes a few rows a week.

A Pi container would add a Docker service to maintain, a backup obligation, and
another `cloudflared` ingress rule to the config file that has already caused
one outage. It buys nothing here. The data is a few hundred KB of JSON.

### Why Access rather than a baked-in token

A token compiled into a public HTML file is not a secret. Access puts identity
in front of the origin and hands the Worker a signed assertion, so the client
holds nothing worth stealing.

## Architecture

```
Google → Cloudflare Access → Worker "ember" → D1 "ember-journal"
                              ├─ GET  /                app shell
                              ├─ GET  /api/entries?since=<ms>
                              └─ POST /api/entries      upsert batch
```

### Auth flow

1. Request hits `ember.austinsego.com`. Access intercepts unauthenticated
   requests and redirects to Google.
2. On success Access sets its cookie and injects the
   `Cf-Access-Jwt-Assertion` header on every subsequent request to the origin.
3. The Worker verifies that JWT against
   `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, checking
   signature, `aud` against the app's AUD tag, and `exp`. It caches the JWKS.
4. `email` from the verified payload becomes the row owner.

The Worker verifying independently is deliberate. It mirrors the existing Caddy
private listener, which rejects any request lacking the Access header. If the
Access app is deleted or misconfigured, the Worker returns 403 rather than
serving the journal to the internet.

**`workers_dev = false` is required.** Without it the Worker stays reachable at
`ember.<subdomain>.workers.dev`, which Access does not protect. This is the one
configuration mistake that would leak the journal.

### Schema

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

`data` holds the entry as JSON. The app's entry shape stays untouched, so the
journal, palate analysis, and prefill logic need no changes.

`owner` scoping means granting Cara access later is an Access policy edit, not
a code change.

### Sync

The current implementation POSTs every entry and GETs every entry on each sync.
Replaced with:

- **Pull:** `GET /api/entries?since=<cursor>` returns rows with `u >= cursor`.
  Cursor is the server's max `u` from the previous response, stored locally.
  `>=` rather than `>` so a row written in the same millisecond as the cursor
  is not skipped; the overlap costs one re-sent row and `mergeServer` already
  dedupes by `id`.
- **Push:** only entries whose `u` exceeds the last pushed cursor.
- **Merge:** unchanged — `mergeServer` keeps the row with the higher `u`.
- **Deletes:** tombstones, already modeled by the `deleted` flag.

Cloudflare began enforcing D1 free-tier row limits on 2026-09-01. Delta sync
plus `idx_entries_owner_u` keeps a normal sync in the single-digit row reads.

`localStorage` remains the render source, so the UI paints immediately and
works offline. Sync runs in the background on load, after a save, and on
`visibilitychange`.

### Removed from the app

- The sync settings sheet and its markup (`#syncscrim`, `#syncsheet`, `#s-url`,
  `#s-token`, `#s-save`, `#s-test`).
- `ember.sync` localStorage key, `loadSync`, `saveSync`, `syncOn`, `apiBase`.
- `isSupabase()` and `syncSupabase()` — the entire Supabase path.

The sync pill stays, becomes status-only, and shows the signed-in account.

### Offline shell

A service worker caching the app shell, so the app opens without signal instead
of failing to load. Cache-first for the shell, network-only for `/api/*`.

## Repo layout

```
ember/
  README.md
  wrangler.toml
  schema.sql
  src/index.js
  public/index.html
  public/sw.js
```

`wrangler.toml` carries `database_id`, the Access team domain, and the app's
AUD tag. These are identifiers, not credentials — useless without account API
access — so the public repo stays clean. The Google client secret is entered in
the Cloudflare dashboard and never touches the tree.

## Error handling

| Condition | Behavior |
|---|---|
| Missing or invalid Access JWT | Worker 403, no body |
| JWKS fetch fails | 503, cached keys used if present |
| D1 write fails | 500; client keeps local state, pill shows Offline, retries next sync |
| Client offline | Writes land in localStorage, sync retries on reconnect |
| Malformed entry in POST | Skipped, remaining rows still applied |

## Verification

Per operating rule 7, prove it fires — no step is done until checked live:

1. `curl -I https://ember.austinsego.com` unauthenticated → 302 to Google.
2. `curl https://ember.austinsego.com/api/entries` with no Access cookie → 403.
3. `curl -I https://ember.<subdomain>.workers.dev` → does not resolve or serve.
4. Log an entry on the phone, load on the laptop, confirm it appears.
5. Edit the same entry on both while one is offline; confirm the later `u` wins.
6. Airplane mode, open the app, confirm the shell loads and the entry list
   renders from localStorage.
7. `wrangler d1 execute ember-journal --command "SELECT owner, count(*) ..."` →
   rows attributed to the right email.

## Open items

- Verify `austinsego.com` is a zone in Cloudflare account `86157a94...` before
  claiming the custom domain.
- Read the current IdP selection on `share.austinsego.com/admin` and
  `push.austinsego.com` and pin both explicitly **before** adding the Google
  IdP, so the new login method cannot appear on them unnoticed.
- `public/ember-cigar-journal.html` stays in place until the new app is
  verified. Removing it is a separate decision (operating rule 13).

## Follow-up, not in this scope

Switching `share.austinsego.com/admin` to Google while keeping one-time PIN as
a fallback method. Needs its own sign-off after the Google IdP is proven here.
`push.austinsego.com` is untouched — it authenticates with a service token, not
an IdP, and the `publish-artifact` skill depends on it.
