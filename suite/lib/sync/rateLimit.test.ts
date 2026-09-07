// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { allow, type Limit } from "./rateLimit";

/**
 * The limiter had no tests at all until subsystem G made it load-bearing on
 * the authenticated document write path, not just on the public /seat/[token]
 * endpoints.
 *
 * `windows` is module state shared by this whole file, so every test uses its
 * own key. Reusing one across tests makes them order-dependent.
 */

const LIMIT: Limit = { max: 3, windowMs: 1000 };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("calls under the limit are all allowed", () => {
  expect(allow("under", LIMIT)).toBe(true);
  expect(allow("under", LIMIT)).toBe(true);
  expect(allow("under", LIMIT)).toBe(true);
});

test("the call past the limit is refused", () => {
  for (let i = 0; i < LIMIT.max; i += 1) expect(allow("past", LIMIT)).toBe(true);
  expect(allow("past", LIMIT)).toBe(false);
  // Still refused — a rejected call does not reset the window.
  expect(allow("past", LIMIT)).toBe(false);
});

test("two keys have separate budgets", () => {
  for (let i = 0; i < LIMIT.max; i += 1) allow("separate-a", LIMIT);
  expect(allow("separate-a", LIMIT)).toBe(false);
  expect(allow("separate-b", LIMIT)).toBe(true);
});

test("the window reopens once it has expired", () => {
  for (let i = 0; i < LIMIT.max; i += 1) allow("reopen", LIMIT);
  expect(allow("reopen", LIMIT)).toBe(false);

  vi.advanceTimersByTime(LIMIT.windowMs);
  expect(allow("reopen", LIMIT)).toBe(true);
});

test("the window does not reopen early", () => {
  for (let i = 0; i < LIMIT.max; i += 1) allow("early", LIMIT);

  vi.advanceTimersByTime(LIMIT.windowMs - 1);
  expect(allow("early", LIMIT)).toBe(false);
});

test("the sweep drops expired windows without touching live ones", () => {
  // A live key, counted up to one below its limit.
  allow("sweep-live", LIMIT);
  allow("sweep-live", LIMIT);

  // Enough short-lived keys to push the map past the sweep threshold of 5000.
  const brief: Limit = { max: 1, windowMs: 10 };
  for (let i = 0; i < 5200; i += 1) allow(`sweep-filler-${i}`, brief);

  // Past the filler's window but well inside the live key's.
  vi.advanceTimersByTime(20);

  // The sweep runs on the next call. The live key kept its count, so it has
  // exactly one allowed call left before it is refused.
  expect(allow("sweep-live", LIMIT)).toBe(true);
  expect(allow("sweep-live", LIMIT)).toBe(false);
});
