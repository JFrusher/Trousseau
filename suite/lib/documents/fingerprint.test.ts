import { expect, test } from "vitest";
import { fingerprint } from "./fingerprint";

test("same value, same fingerprint", () => {
  expect(fingerprint({ a: 1, b: [1, 2, 3] })).toBe(fingerprint({ a: 1, b: [1, 2, 3] }));
});

test("different value, different fingerprint", () => {
  expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
});

test("undefined and null both fingerprint, and agree with each other", () => {
  expect(fingerprint(undefined)).toBe(fingerprint(null));
});
