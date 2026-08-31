import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyDoc, sampleDoc } from "../core/model/defaults";
import { getDoc, useStore } from "./store";

const dayJson = readFileSync("apps/brigade/fixtures/sample-day.day.json", "utf8");

const state = () => useStore.getState();
const doc = () => getDoc(useStore.getState());

describe("the store", () => {
  beforeEach(() => {
    state().loadDoc(sampleDoc());
  });

  it("puts a person on a job and takes them off again", () => {
    state().toggleAssignment("job-glasses", "per-joe");
    expect(doc().jobs.find((job) => job.id === "job-glasses")?.personIds).toEqual(["per-joe"]);

    state().toggleAssignment("job-glasses", "per-joe");
    expect(doc().jobs.find((job) => job.id === "job-glasses")?.personIds).toEqual([]);
  });

  it("undoes an assignment", () => {
    state().toggleAssignment("job-glasses", "per-joe");
    state().undo();
    expect(doc().jobs.find((job) => job.id === "job-glasses")?.personIds).toEqual([]);
  });

  it("keeps the work when a team goes, and lets its people go loose", () => {
    const caterer = doc().teams.find((team) => team.tag === "caterer");
    state().deleteTeam(caterer?.id ?? "");

    expect(doc().jobs.find((job) => job.id === "job-covers")).toBeDefined();
    expect(doc().jobs.find((job) => job.id === "job-covers")?.teamId).toBeNull();
    expect(doc().people.find((person) => person.id === "per-ana")?.teamId).toBeNull();
  });

  it("takes a deleted person off every job they held", () => {
    state().deletePerson("per-ana");
    expect(doc().jobs.some((job) => job.personIds.includes("per-ana"))).toBe(false);
    expect(doc().jobs.find((job) => job.id === "job-covers")?.personIds).toEqual(["per-sam"]);
  });

  it("imports a day onto an empty document and seeds its teams", () => {
    state().loadDoc(emptyDoc());
    state().importDay(dayJson);

    expect(doc().day?.blocks.length).toBeGreaterThan(20);
    expect(doc().teams.length).toBeGreaterThan(3);
    expect(state().notice).toContain("Day imported");
  });

  it("refuses a Cadence project file with an answer, not a crash", () => {
    state().importDay(JSON.stringify({ schemaVersion: 1, blocks: [] }));
    expect(state().notice).toContain("Export day");
    expect(doc().day).not.toBeNull();
  });
});
