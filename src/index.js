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
