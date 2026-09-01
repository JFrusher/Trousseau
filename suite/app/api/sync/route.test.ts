// @vitest-environment node
import { beforeAll, expect, test } from "vitest";

/**
 * The sync API, driven the way a browser drives it.
 *
 * Everything under `lib/sync` is tested against the in-memory store, and the
 * migrations against a real Postgres — but nothing exercised the route itself:
 * the parsing, the ordering of the rate limit against validation, the bearer
 * header, the path matching. A 500 reported from the running application came
 * from that gap, so it is now covered end to end.
 */

// Read at module load by `lib/env`, so it has to be set before the route is
// imported. `NODE_ENV` is "test" here, so the production guard does not fire.
process.env["SYNC_IN_MEMORY"] = "1";

const route = await import("./[...route]/route");

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

const BASE = "http://localhost/api/sync";

/** The route takes its path from `params`, exactly as Next hands it over. */
const params = (path: string) => ({ params: Promise.resolve({ route: path.split("/") }) });

let id: string;
let salt: string;
let token: string;
let authHash: string;
let auth: Record<string, string>;

async function hashOf(writeToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Buffer.from(writeToken, "base64"));
  return b64(new Uint8Array(digest));
}

const get = (path: string, headers: Record<string, string> = {}) =>
  route.GET(new Request(`${BASE}/${path}`, { headers }), params(path));

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  route.POST(
    new Request(`${BASE}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    params(path),
  );

const del = (path: string, headers: Record<string, string> = {}) =>
  route.DELETE(new Request(`${BASE}/${path}`, { method: "DELETE", headers }), params(path));

beforeAll(async () => {
  id = Buffer.from(random(16)).toString("base64url");
  salt = b64(random(16));
  token = b64(random(32));
  authHash = await hashOf(token);
  auth = { authorization: `Bearer ${token}` };
});

test("the whole passphrase flow works, from create to erasure", async () => {
  // Create. The one unauthenticated write.
  const created = await post("wedding", { id, salt, authHash });
  expect(created.status, await created.clone().text()).toBe(200);

  // Join from the other machine starts by fetching the salt.
  const gotSalt = await get(`wedding/${id}/salt`);
  expect(gotSalt.status).toBe(200);
  await expect(gotSalt.json()).resolves.toEqual({ salt });

  // First write of a slice expects version 0 and lands at 1.
  const pushed = await post(
    `wedding/${id}/slices`,
    { writes: [{ slice: "guests", sealed: { ciphertext: "AAAA", iv: "BBBB" }, expectedVersion: 0 }] },
    auth,
  );
  expect(pushed.status).toBe(200);
  await expect(pushed.json()).resolves.toMatchObject({
    accepted: [{ slice: "guests", version: 1 }],
  });

  const pulled = await get(`wedding/${id}/slices`, auth);
  expect(pulled.status).toBe(200);

  // An uploaded typeface, under an id shaped the way Plaque composes them.
  const uploaded = await post(
    `wedding/${id}/blob/font:crimson.ttf:1234`,
    { sealed: { ciphertext: "AAAA", iv: "BBBB" } },
    auth,
  );
  expect(uploaded.status).toBe(200);

  const published = await post(
    `wedding/${id}/share`,
    { token: "sharetoken1", sealed: { ciphertext: "AAAA", iv: "BBBB" } },
    auth,
  );
  expect(published.status).toBe(200);

  // A guest reads it with no passphrase at all.
  const guest = await get("share/sharetoken1");
  expect(guest.status).toBe(200);

  const erased = await del(`wedding/${id}`, auth);
  expect(erased.status).toBe(200);

  // Gone, and the guest link with it.
  expect((await get(`wedding/${id}/slices`, auth)).status).toBe(403);
  expect((await get("share/sharetoken1")).status).toBe(404);
});

test("a wedding id cannot be taken twice", async () => {
  const first = await post("wedding", { id: `${id}dup`, salt, authHash });
  expect(first.status).toBe(200);
  const second = await post("wedding", { id: `${id}dup`, salt, authHash });
  expect(second.status).toBe(400);
});

test("a wrong passphrase is refused, and says nothing about what exists", async () => {
  const mine = `${id}auth`;
  await post("wedding", { id: mine, salt, authHash });

  const wrong = { authorization: `Bearer ${b64(random(32))}` };
  const refused = await get(`wedding/${mine}/slices`, wrong);
  expect(refused.status).toBe(403);

  // A wedding that does not exist answers identically.
  const absent = await get(`wedding/${"z".repeat(22)}/slices`, wrong);
  expect(absent.status).toBe(403);
  expect(await refused.json()).toEqual(await absent.json());
});

test("no bearer header at all is refused rather than crashing", async () => {
  expect((await get(`wedding/${id}nohdr/slices`)).status).toBe(403);
});

/** The casts these replaced were the source of two 500s. */

test("a body that is not JSON is a 400", async () => {
  const response = await post("wedding", "{not json");
  expect(response.status).toBe(400);
});

test("a null body is a 400, not a TypeError", async () => {
  const response = await post("wedding", null);
  expect(response.status).toBe(400);
});

test("a non-integer expectedVersion never reaches the store", async () => {
  const mine = `${id}ver`;
  await post("wedding", { id: mine, salt, authHash });
  const response = await post(
    `wedding/${mine}/slices`,
    { writes: [{ slice: "g", sealed: { ciphertext: "AA", iv: "BB" }, expectedVersion: "banana" }] },
    auth,
  );
  expect(response.status).toBe(400);
});

test("an id that is not a wedding id is refused before any lookup", async () => {
  const response = await get("wedding/..%2F..%2Fetc/salt");
  expect(response.status).toBe(400);
});

test("an unknown path is a 404, not a crash", async () => {
  expect((await get("nonsense")).status).toBe(404);
});
