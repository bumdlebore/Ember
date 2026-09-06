import { describe, it, expect, beforeAll, vi } from "vitest";
import { verifyAccessJwt, __resetJwksCache, JwksUnavailable } from "../src/access.js";

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

  it("rejects with JwksUnavailable when the JWKS fetch throws (network error)", async () => {
    __resetJwksCache();
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    const token = await mintJwt();
    await expect(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD })
    ).rejects.toBeInstanceOf(JwksUnavailable);
  });

  it("rejects with JwksUnavailable when the JWKS endpoint returns a non-OK status", async () => {
    __resetJwksCache();
    vi.stubGlobal("fetch", async () =>
      new Response("server error", { status: 500 })
    );
    const token = await mintJwt();
    await expect(
      verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD })
    ).rejects.toBeInstanceOf(JwksUnavailable);
  });

  it("rejects an expired token with a plain error, not JwksUnavailable, when the JWKS endpoint is healthy", async () => {
    __resetJwksCache();
    vi.stubGlobal("fetch", async (url) => {
      if (String(url).includes("/cdn-cgi/access/certs")) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error("unexpected fetch: " + url);
    });
    const token = await mintJwt({ exp: Math.floor(Date.now() / 1000) - 10 });
    let caught;
    try {
      await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof JwksUnavailable).toBe(false);
  });
});
