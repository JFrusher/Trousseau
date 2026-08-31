import { describe, expect, it } from "vitest";
import { sampleDoc } from "../../core/model/defaults";
import type { BrigadeDoc } from "../../core/model/types";
import {
  jobsForTeam,
  peopleWithJobs,
  renderAllPersonSheets,
  renderAllTeamSheets,
  renderJobList,
  renderPersonSheet,
} from "./jobSheets";
import { nodeFontSource } from "./nodeFontSource";
import { textOf } from "./readPdf";

const options = { fontSource: nodeFontSource, generatedOn: "Generated for the test" };

describe("renderJobList", () => {
  it("carries every job, once, in the order the day happens", async () => {
    const doc = sampleDoc();
    const { text } = await textOf(await renderJobList(doc, options));

    for (const job of doc.jobs) {
      const occurrences = text.split(job.label).length - 1;
      expect(occurrences, `${job.label} appears ${occurrences} times`).toBe(1);
    }
    expect(text.indexOf("Arch and pedestals in")).toBeLessThan(text.indexOf("Lay 90 covers"));
  });

  it("prints the block each job belongs to, and where it happens", async () => {
    const { text } = await textOf(await renderJobList(sampleDoc(), options));
    expect(text).toContain("Room turnaround");
    expect(text).toContain("Great hall");
    // Room turnaround runs 19:10–19:50 on the sample day.
    expect(text).toContain("19:10");
  });

  it("says so when nobody is on a job", async () => {
    const { text } = await textOf(await renderJobList(sampleDoc(), options));
    // Clearing the glasses has neither a person nor a team.
    expect(text).toContain("nobody yet");
  });

  it("still prints a job whose block has gone", async () => {
    const doc = sampleDoc();
    const orphaned: BrigadeDoc = {
      ...doc,
      jobs: doc.jobs.map((job) =>
        job.id === "job-covers" ? { ...job, blockId: "blk-nonesuch" } : job,
      ),
    };

    const { text } = await textOf(await renderJobList(orphaned, options));
    expect(text).toContain("Lay 90 covers");
    expect(text).toContain("block deleted");
  });

  it("renders a document with no day at all without falling over", async () => {
    const { pages } = await textOf(
      await renderJobList({ ...sampleDoc(), day: null, jobs: [] }, options),
    );
    expect(pages).toBe(1);
  });
});

describe("renderPersonSheet", () => {
  it("carries that person's jobs and nobody else's", async () => {
    const { text } = await textOf(await renderPersonSheet(sampleDoc(), "per-nell", options));

    expect(text).toContain("Nell Hart");
    expect(text).toContain("Arch and pedestals in");
    expect(text).toContain("Buttonholes to the ushers");
    expect(text).not.toContain("Lay 90 covers");
  });

  it("heads the sheet with the person's team", async () => {
    const { text } = await textOf(await renderPersonSheet(sampleDoc(), "per-ana", options));
    expect(text).toContain("Ana Willis");
    expect(text).toContain("Smith & Doyle Catering");
  });

  it("bundles everyone who has work, a page each", async () => {
    const doc = sampleDoc();
    const ids = peopleWithJobs(doc);
    expect(ids).toHaveLength(4);

    let separate = 0;
    for (const id of ids) {
      separate += (await textOf(await renderPersonSheet(doc, id, options))).pages;
    }
    const bundled = await textOf(await renderAllPersonSheets(doc, options));
    expect(bundled.pages).toBe(separate);
  });

  it("leaves out people with nothing to do", async () => {
    const doc: BrigadeDoc = {
      ...sampleDoc(),
      people: [
        ...sampleDoc().people,
        { id: "per-idle", name: "Idle Ivan", teamId: null, phone: "", notes: "", guestId: null },
      ],
    };
    const { text } = await textOf(await renderAllPersonSheets(doc, options));
    expect(text).not.toContain("Idle Ivan");
  });
});

describe("renderAllTeamSheets", () => {
  it("gives a team the jobs its members hold, not only the ones on the team", () => {
    const doc = sampleDoc();
    const caterer = doc.teams.find((team) => team.tag === "caterer");
    const jobs = jobsForTeam(doc, caterer?.id ?? "").map((job) => job.id);

    expect(jobs).toContain("job-covers");
    // Hire linens is on nobody's team, but Ana of the caterer is on it.
    expect(jobs).toContain("job-linens");
    expect(jobs).not.toContain("job-flowers");
  });

  it("prints a page for each team that has work", async () => {
    const { text, pages } = await textOf(await renderAllTeamSheets(sampleDoc(), options));
    expect(text).toContain("Smith & Doyle Catering");
    expect(text).toContain("Ivy & Vane");
    // The band and the registrar have no jobs, so they get no sheet.
    expect(text).not.toContain("The Wrights");
    expect(pages).toBeGreaterThanOrEqual(2);
  });
});
