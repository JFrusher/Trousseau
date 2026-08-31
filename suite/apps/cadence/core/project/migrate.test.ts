import { describe, expect, it } from "vitest";
import { sampleDoc, SCHEMA_VERSION } from "../model/defaults";
import { parse, serialise } from "./file";
import { migrate } from "./migrate";

describe("migrate", () => {
  it("leaves a current document alone", () => {
    const raw = JSON.parse(serialise(sampleDoc()));
    const { raw: out, fromFuture } = migrate(raw);
    expect(fromFuture).toBe(false);
    expect(out).toEqual(raw);
  });

  it("stamps the current version onto an unversioned file", () => {
    const raw = JSON.parse(serialise(sampleDoc()));
    delete raw.schemaVersion;
    expect(migrate(raw).raw["schemaVersion"]).toBe(SCHEMA_VERSION);
  });

  it("preserves what a newer Cadence wrote", () => {
    const raw = { ...JSON.parse(serialise(sampleDoc())), schemaVersion: 999, weatherPlan: "marquee" };
    const result = parse(JSON.stringify(raw));
    expect(result.error).toBeUndefined();
    expect(result.fromFuture).toBe(true);

    const roundTripped = JSON.parse(serialise(result.doc!));
    expect(roundTripped.weatherPlan).toBe("marquee");
    expect(roundTripped.schemaVersion).toBe(999);
  });
});
