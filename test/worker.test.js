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
