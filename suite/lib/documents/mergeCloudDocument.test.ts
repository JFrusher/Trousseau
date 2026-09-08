import { expect, test } from "vitest";
import { SLICE_NAMES } from "@jfrusher/trousseau";
import { fingerprint } from "./fingerprint";
import { fingerprintAllSlices, mergeCloudDocument } from "./mergeCloudDocument";

function doc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  for (const slice of SLICE_NAMES) base[slice] = { owner: "base" };
  return { ...base, ...overrides };
}

test("a slice changed only on the server is taken", () => {
  const base = doc();
  const agreed = fingerprintAllSlices(base);
  const server = doc({ guests: { owner: "server" } });

  const result = mergeCloudDocument(base, server, agreed);

  expect(result.raw.guests).toEqual({ owner: "server" });
  expect(result.conflicts).toEqual([]);
  expect(result.agreed.guests).toBe(fingerprint({ owner: "server" }));
});

test("a slice changed only locally is kept, not overwritten", () => {
  const base = doc();
  const agreed = fingerprintAllSlices(base);
  const local = doc({ seating: { owner: "local" } });

  const result = mergeCloudDocument(local, base, agreed);

  expect(result.raw.seating).toEqual({ owner: "local" });
  expect(result.conflicts).toEqual([]);
});

test("a slice changed on both sides is a conflict, and neither value is applied", () => {
  const base = doc();
  const agreed = fingerprintAllSlices(base);
  const local = doc({ stationery: { owner: "local" } });
  const server = doc({ stationery: { owner: "server" } });

  const result = mergeCloudDocument(local, server, agreed);

  expect(result.conflicts).toEqual([{ slice: "stationery", theirs: { owner: "server" } }]);
  // Local's own value survives untouched in raw until the user resolves it.
  expect(result.raw.stationery).toEqual({ owner: "local" });
  // Not marked agreed - it's still unresolved.
  expect(result.agreed.stationery).toBe(agreed.stationery);
});

test("a slice unchanged on both sides is left alone and marked agreed", () => {
  const base = doc();
  const agreed = fingerprintAllSlices(base);

  const result = mergeCloudDocument(base, base, agreed);

  expect(result.conflicts).toEqual([]);
  expect(result.raw).toEqual(base);
  expect(result.agreed.event).toBe(fingerprint(base.event));
});

test("multiple independently-changed slices all merge without conflicting with each other", () => {
  const base = doc();
  const agreed = fingerprintAllSlices(base);
  const local = doc({ guests: { owner: "local" } });
  const server = doc({ seating: { owner: "server" } });

  const result = mergeCloudDocument(local, server, agreed);

  expect(result.conflicts).toEqual([]);
  expect(result.raw.guests).toEqual({ owner: "local" });
  expect(result.raw.seating).toEqual({ owner: "server" });
});

test("fingerprintAllSlices covers every slice in SLICE_NAMES", () => {
  const agreed = fingerprintAllSlices(doc());
  expect(Object.keys(agreed).sort()).toEqual([...SLICE_NAMES].sort());
});
