import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * One project per tool, plus the suite's own.
 *
 * Each tool arrived with a test setup of its own, and those settings were not
 * decoration: Plaque and Cadence run in Node because their cores are pure and
 * their PDF renderers are headless, and jsdom is not simply a superset — its
 * `Blob` has no `arrayBuffer`, which is exactly what Cadence's blob store is
 * built on. Forcing one environment on everything broke working tests and told
 * us nothing true about the code.
 *
 * Cadence additionally runs its files one at a time, and last. Two of its tests
 * are wall-clock performance guards — a 200-block run sheet must export inside
 * three seconds — and workers competing for the machine make them lie. Running
 * them alone is the whole point of the guard: a number measured against a busy
 * machine says nothing about how long the export takes for a user.
 *
 * Two settings are needed for that, and the obvious one does not work:
 * `fileParallelism` is read only from the root config and ignored inside a
 * project, which fails quietly — the guard simply measures a busy machine and
 * reports three and a half seconds. `singleFork` is the per-project equivalent
 * and does serialise Cadence's files; `groupOrder` then runs the project after
 * the other two have finished, so nothing else is competing either.
 */
export default defineConfig({
  resolve: {
    // The same `@/*` alias tsconfig and Next use.
    alias: { "@": root },
  },
  test: {
    projects: [
      {
        resolve: { alias: { "@": root } },
        test: {
          name: "suite",
          /*
           * Generous, because this project renders real PDFs too now
           * (`lib/ensemble/render/pdf`). Alone each takes about a second;
           * sharing a machine with the rest of the suite they can pass five,
           * and the default timeout then reports a failure about nothing — the
           * assertions here are page counts and text, never speed.
           */
          testTimeout: 20_000,
          sequence: { groupOrder: 0 },
          include: ["*.test.{ts,tsx}", "lib/**/*.test.{ts,tsx}", "components/**/*.test.{ts,tsx}", "app/**/*.test.{ts,tsx}", "apps/*.test.ts"],
          // The store's persistence path is a no-op without `window`, and that
          // is exactly the path worth testing.
          environment: "jsdom",
        },
      },
      {
        resolve: { alias: { "@": root } },
        test: {
          name: "plaque",
          /*
           * Generous, because these render real PDFs. Alone each takes about a
           * second; sharing a machine with the rest of the suite they can pass
           * five, and the default timeout then reports a failure about nothing
           * — the assertions here are page counts and paper sizes, never speed.
           * The one place elapsed time is the assertion is Cadence's perf
           * guard, which measures it itself and is unaffected by this.
           */
          testTimeout: 20_000,
          sequence: { groupOrder: 0 },
          include: ["apps/plaque/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        resolve: { alias: { "@": root } },
        test: {
          name: "brigade",
          /*
           * Generous, because these render real PDFs. Alone each takes about a
           * second; sharing a machine with the rest of the suite they can pass
           * five, and the default timeout then reports a failure about nothing
           * — the assertions here are page counts and paper sizes, never speed.
           * The one place elapsed time is the assertion is Cadence's perf
           * guard, which measures it itself and is unaffected by this.
           */
          testTimeout: 20_000,
          sequence: { groupOrder: 0 },
          include: ["apps/brigade/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        // Tableaux is the one tool written in JSX rather than TSX. Next compiles
        // it with the automatic runtime, and its files do not import React;
        // without this the test transform falls back to the classic runtime and
        // every rendered component throws "React is not defined". It has to sit
        // in the project rather than at the root, which does not inherit.
        esbuild: { jsx: "automatic" },
        resolve: { alias: { "@": root } },
        test: {
          name: "tableaux",
          /*
           * Generous, because these render real PDFs. Alone each takes about a
           * second; sharing a machine with the rest of the suite they can pass
           * five, and the default timeout then reports a failure about nothing
           * — the assertions here are page counts and paper sizes, never speed.
           * The one place elapsed time is the assertion is Cadence's perf
           * guard, which measures it itself and is unaffected by this.
           */
          testTimeout: 20_000,
          sequence: { groupOrder: 0 },
          include: ["apps/tableaux/**/*.test.{js,jsx,ts,tsx}"],
          // Its component tests render, and its store tests touch localStorage.
          environment: "jsdom",
          // Testing Library unmounts between tests only when it can see a
          // global `afterEach`. Without this each render is left in the
          // document and the next query finds several copies of the panel.
          globals: true,
          setupFiles: ["apps/tableaux/test/setup.js"],
        },
      },
      {
        resolve: { alias: { "@": root } },
        test: {
          name: "cadence",
          /*
           * Generous, because these render real PDFs. Alone each takes about a
           * second; sharing a machine with the rest of the suite they can pass
           * five, and the default timeout then reports a failure about nothing
           * — the assertions here are page counts and paper sizes, never speed.
           * The one place elapsed time is the assertion is Cadence's perf
           * guard, which measures it itself and is unaffected by this.
           */
          testTimeout: 20_000,
          sequence: { groupOrder: 1 },
          // Not `fileParallelism: false` — that is a root-only option and is
          // silently ignored here. This is the setting that actually serialises.
          poolOptions: { forks: { singleFork: true } },
          include: ["apps/cadence/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
    ],
  },
});
