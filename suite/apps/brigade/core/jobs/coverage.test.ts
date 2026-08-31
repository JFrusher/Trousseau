import { describe, expect, it } from "vitest";
import { sampleDoc } from "../model/defaults";
import type { BrigadeDoc, Job } from "../model/types";
import { blocking, coverage } from "./coverage";

function withJobs(doc: BrigadeDoc, jobs: Job[]): BrigadeDoc {
  return { ...doc, jobs };
}

function job(id: string, blockId: string, personIds: string[], teamId: string | null = null): Job {
  return { id, blockId, label: id, notes: "", teamId, personIds };
}

describe("coverage", () => {
  it("holds nothing back on the sample crew", () => {
    expect(blocking(coverage(sampleDoc()))).toEqual([]);
  });

  it("flags one person on two jobs at the same time, and holds the print run", () => {
    const doc = sampleDoc();
    // Bridal preparations 08:00–11:00 and the florist install 07:00–09:00.
    const clashing = withJobs(doc, [
      job("job-a", "blk-prep", ["per-ana"]),
      job("job-b", "blk-florist", ["per-ana"]),
    ]);

    const found = coverage(clashing);
    const clash = found.find((warning) => warning.kind === "double-booked");
    expect(clash?.severity).toBe("conflict");
    expect(clash?.jobIds.sort()).toEqual(["job-a", "job-b"]);
    expect(clash?.message).toContain("Ana Willis");
    expect(blocking(found)).toHaveLength(1);
  });

  it("does not flag the same person on two jobs that only touch", () => {
    // Guests arrive 13:00–13:30, ceremony 13:30–14:15: back to back, not at once.
    const doc = withJobs(sampleDoc(), [
      job("job-a", "blk-guests", ["per-ana"]),
      job("job-b", "blk-ceremony", ["per-ana"]),
    ]);
    expect(coverage(doc).filter((warning) => warning.kind === "double-booked")).toEqual([]);
  });

  it("mentions a job on a moment inside other work, without holding the print run", () => {
    // The rings moment sits at 13:15, inside guests arriving 13:00–13:30.
    const doc = withJobs(sampleDoc(), [
      job("job-a", "blk-guests", ["per-joe"]),
      job("job-b", "blk-rings", ["per-joe"]),
    ]);

    const clash = coverage(doc).find((warning) => warning.kind === "double-booked");
    expect(clash?.severity).toBe("advisory");
    expect(blocking(coverage(doc))).toEqual([]);
  });

  it("says nothing about two jobs inside the same block", () => {
    // Lay the covers and light the candles, both during the turnaround.
    const doc = withJobs(sampleDoc(), [
      job("job-a", "blk-turnaround", ["per-ana"]),
      job("job-b", "blk-turnaround", ["per-ana"]),
    ]);
    expect(coverage(doc).filter((warning) => warning.kind === "double-booked")).toEqual([]);
  });

  it("mentions work with nobody on it, without holding the print run", () => {
    const doc = withJobs(sampleDoc(), [job("job-a", "blk-prep", [])]);
    const found = coverage(doc);

    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("nobody");
    expect(found[0]?.severity).toBe("advisory");
    expect(blocking(found)).toEqual([]);
  });

  it("tells a team-only job apart from one nobody owns at all", () => {
    const teamId = sampleDoc().teams[0]?.id ?? null;
    const doc = withJobs(sampleDoc(), [job("job-a", "blk-prep", [], teamId)]);
    expect(coverage(doc)[0]?.kind).toBe("team-only");
  });

  it("treats a job whose block has gone as a clash, not a note", () => {
    const doc = withJobs(sampleDoc(), [job("job-a", "blk-nonesuch", ["per-ana"])]);
    const found = coverage(doc);

    expect(found[0]?.kind).toBe("orphaned");
    expect(blocking(found)).toHaveLength(1);
  });
});
