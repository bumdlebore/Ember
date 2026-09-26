import { getIdentity, JwksUnavailable } from "./access.js";
import { listEntries, upsertEntries } from "./entries.js";
import HTML from "../public/index.html";
import SW from "../public/sw.js.txt";
import MANIFEST from "../public/manifest.webmanifest";
import ICON_180 from "../public/icon-180.png";
import ICON_192 from "../public/icon-192.png";
import ICON_512 from "../public/icon-512.png";

import FONT_500 from "../public/fonts/barlow-condensed-500.woff2";
import FONT_600 from "../public/fonts/barlow-condensed-600.woff2";
import FONT_700 from "../public/fonts/barlow-condensed-700.woff2";

const ICONS = { "/icon-180.png": ICON_180, "/icon-192.png": ICON_192, "/icon-512.png": ICON_512 };

const FONTS = {
  "/fonts/barlow-condensed-500.woff2": FONT_500,
  "/fonts/barlow-condensed-600.woff2": FONT_600,
  "/fonts/barlow-condensed-700.woff2": FONT_700,
};

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

    // "PENDING" is the placeholder committed in wrangler.toml before the Cloudflare
    // Access application exists. verifyAccessJwt's guard only rejects empty/non-string
    // values, so "PENDING" passes it, the Worker then tries to fetch
    // https://PENDING/cdn-cgi/access/certs, that throws, and every request gets mapped
    // to a 503 "auth temporarily unavailable" — indistinguishable from a real Cloudflare
    // outage. Fail loudly and specifically instead, before touching D1 or serving any
    // journal data.
    const accessNotConfigured = (v) => typeof v !== "string" || v.length === 0 || v === "PENDING";
    if (accessNotConfigured(env.ACCESS_TEAM_DOMAIN) || accessNotConfigured(env.ACCESS_AUD)) {
      return json(
        { error: "Access is not configured: ACCESS_TEAM_DOMAIN/ACCESS_AUD still set to PENDING in wrangler.toml" },
        500
      );
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
          "X-Ember-Shell": "1",
        },
      });
    }

    // Install files sit behind Access like the shell. X-Ember-Shell marks them
    // as coming from this Worker (not an Access interstitial), so the service
    // worker's existing rule caches them.
    if (url.pathname === "/manifest.webmanifest") {
      return new Response(MANIFEST, {
        headers: {
          "Content-Type": "application/manifest+json",
          "Cache-Control": "no-cache",
          "X-Ember-Shell": "1",
        },
      });
    }
    if (ICONS[url.pathname]) {
      return new Response(ICONS[url.pathname], {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
          "X-Ember-Shell": "1",
        },
      });
    }

    if (FONTS[url.pathname]) {
      return new Response(FONTS[url.pathname], {
        headers: {
          "Content-Type": "font/woff2",
          "Cache-Control": "public, max-age=604800",
          "X-Ember-Shell": "1",
        },
      });
    }

    if (url.pathname === "/api/entries") {
      if (request.method === "GET") {
        const since = Number.parseInt(url.searchParams.get("since") || "0", 10);
        const clampedSince = Number.isFinite(since) ? Math.max(since, 0) : 0;
        const out = await listEntries(env.DB, identity.email, clampedSince);
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
