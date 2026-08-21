import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A plain object schema strips unknown keys, which in this package means
 * silently deleting a slice belonging to an app nobody has written yet. There
 * is no legitimate use of it here. This test is a tripwire, not a style rule.
 */
describe("source hygiene", () => {
  /** Comments explain the ban and therefore name the thing being banned. */
  const withoutComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("never uses the stripping object schema", () => {
    const dir = new URL("./", import.meta.url);
    const offenders = readdirSync(dir, { recursive: true })
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .filter((name) =>
        /\bz\.object\s*\(/.test(withoutComments(readFileSync(new URL(name, dir), "utf8"))),
      );
    expect(offenders).toEqual([]);
  });

  it("catches a real offender", () => {
    expect(withoutComments("const a = z.object({});")).toMatch(/\bz\.object\s*\(/);
  });

  it("ignores one that is only mentioned in a comment", () => {
    expect(withoutComments("// never use z.object() here")).not.toMatch(/\bz\.object\s*\(/);
  });
});
