import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyDoc, sampleDoc } from "../model/defaults";
import type { BrigadeDoc, ImportedDay } from "../model/types";
import { parseDay, type DayTeam } from "./day";
import { reconcile } from "./reconcile";

const json = readFileSync("fixtures/sample-day.day.json", "utf8");

function read(text = json): { day: ImportedDay; teams: DayTeam[] } {
  const parsed = parseDay(text);
  if (parsed.error !== undefined) throw new Error(parsed.error);
  return { day: parsed.day, teams: parsed.teams };
}

/** The same day with one block edited, deleted or added. */
function changed(edit: (day: ImportedDay) => ImportedDay): ImportedDay {
  return edit(read().day);
}

describe("reconcile", () => {
  it("seeds a team for every tag the first time", () => {
    const { day, teams } = read();
    const { doc, report } = reconcile(emptyDoc(), day, teams);

    expect(doc.teams.map((team) => team.tag)).toEqual(teams.map((team) => team.tag));
    expect(doc.teams.find((team) => team.tag === "band")?.name).toBe("The Wrights");
    expect(report.addedTeamIds).toHaveLength(teams.length);
    expect(report.orphanedJobIds).toEqual([]);
  });

  it("adds nothing the second time the same day is imported", () => {
    const { day, teams } = read();
    const doc = sampleDoc();
    const { doc: after, report } = reconcile(doc, day, teams);

    expect(after.teams).toEqual(doc.teams);
    expect(after.jobs).toEqual(doc.jobs);
    expect(after.people).toEqual(doc.people);
    expect(report.addedTeamIds).toEqual([]);
    expect(report.newBlockIds).toEqual([]);
    expect(report.orphanedJobIds).toEqual([]);
  });

  it("carries jobs to their block's new time without touching the job", () => {
    const moved = changed((day) => ({
      ...day,
      blocks: day.blocks.map((block) =>
        block.id === "blk-turnaround"
          ? { ...block, startMin: block.startMin + 30, endMin: block.endMin + 30 }
          : block,
      ),
    }));

    const before = sampleDoc();
    const { doc, report } = reconcile(before, moved, []);
    const covers = doc.jobs.find((job) => job.id === "job-covers");

    expect(covers).toEqual(before.jobs.find((job) => job.id === "job-covers"));
    expect(doc.day?.blocks.find((block) => block.id === "blk-turnaround")?.startMin).toBe(
      (before.day as ImportedDay).blocks.find((block) => block.id === "blk-turnaround")!.startMin + 30,
    );
    expect(report.orphanedJobIds).toEqual([]);
  });

  it("keeps a job whose block has gone, and says so", () => {
    const without = changed((day) => ({
      ...day,
      blocks: day.blocks.filter((block) => block.id !== "blk-turnaround"),
    }));

    const { doc, report } = reconcile(sampleDoc(), without, []);
    expect(doc.jobs.map((job) => job.id)).toContain("job-covers");
    expect(report.orphanedJobIds).toEqual(["job-covers", "job-toptable", "job-candles"]);
  });

  it("reports a block that is new since the last import", () => {
    const extra = changed((day) => ({
      ...day,
      blocks: [
        ...day.blocks,
        {
          id: "blk-fireworks",
          label: "Fireworks",
          lane: "Main day",
          location: "Lawn",
          notes: "",
          tags: [],
          startMin: 1380,
          contentEndMin: 1390,
          endMin: 1390,
          anchored: true,
          moment: false,
        },
      ],
    }));

    expect(reconcile(sampleDoc(), extra, []).report.newBlockIds).toEqual(["blk-fireworks"]);
  });

  it("leaves a renamed team alone rather than seeding it again", () => {
    const { day, teams } = read();
    const doc: BrigadeDoc = {
      ...sampleDoc(),
      teams: sampleDoc().teams.map((team) =>
        team.tag === "caterer" ? { ...team, name: "The kitchen" } : team,
      ),
    };

    const { doc: after, report } = reconcile(doc, day, teams);
    expect(after.teams.find((team) => team.tag === "caterer")?.name).toBe("The kitchen");
    expect(report.addedTeamIds).toEqual([]);
  });

  it("does not bring back a team that was deleted on purpose", () => {
    const { day, teams } = read();
    const doc = sampleDoc();
    const trimmed: BrigadeDoc = {
      ...doc,
      teams: doc.teams.filter((team) => team.tag !== "band"),
    };

    // The tag is still on a block of the day, so it has been seen before: a
    // deletion is a decision, not a gap to fill.
    const { doc: after, report } = reconcile(trimmed, day, teams);
    expect(after.teams.some((team) => team.tag === "band")).toBe(false);
    expect(report.addedTeamIds).toEqual([]);
  });

  it("seeds a team for a supplier that is genuinely new", () => {
    const { day } = read();
    const withNew = [
      ...read().teams,
      { tag: "fireworks", displayName: "Pyro Bros", phone: "07700 900999", notes: "" },
    ];

    const { doc, report } = reconcile(sampleDoc(), day, withNew);
    expect(doc.teams.find((team) => team.tag === "fireworks")?.name).toBe("Pyro Bros");
    expect(report.addedTeamIds).toHaveLength(1);
  });
});
