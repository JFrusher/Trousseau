import sampleDayJson from "../../fixtures/sample-day.day.json";
import { parseDay } from "../import/day";
import { reconcile } from "../import/reconcile";
import type { BrigadeDoc } from "./types";

export const SCHEMA_VERSION = 1;
export const APP_VERSION = "0.1.0";

export function emptyDoc(): BrigadeDoc {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    day: null,
    teams: [],
    people: [],
    jobs: [],
  };
}

/**
 * A realistic crew on the sample day Cadence ships, used as the fixture every
 * test works against. Identifiers are fixed, not generated, so the fixture is
 * stable and a failure names the same job twice running.
 */
export function sampleDoc(): BrigadeDoc {
  const parsed = parseDay(JSON.stringify(sampleDayJson));
  if (parsed.error !== undefined) throw new Error(`The sample day will not parse: ${parsed.error}`);

  const { doc } = reconcile(emptyDoc(), parsed.day, parsed.teams);
  const teamId = (tag: string) => doc.teams.find((team) => team.tag === tag)?.id ?? null;

  const people = [
    { id: "per-ana", name: "Ana Willis", teamId: teamId("caterer"), phone: "07700 900701", notes: "", guestId: null },
    { id: "per-sam", name: "Sam Okafor", teamId: teamId("caterer"), phone: "07700 900702", notes: "", guestId: null },
    { id: "per-joe", name: "Joe Marsh", teamId: null, phone: "07700 900703", notes: "Venue duty manager.", guestId: null },
    { id: "per-nell", name: "Nell Hart", teamId: teamId("florist"), phone: "07700 900704", notes: "", guestId: null },
  ];

  const jobs = [
    job("job-flowers", "blk-florist", "Arch and pedestals in", ["per-nell"], teamId("florist")),
    job("job-chairs", "blk-florist", "Chairs out, 90 in rows", [], teamId("florist"), "Aisle 1.2m wide."),
    job("job-buttonholes", "blk-guests", "Buttonholes to the ushers", ["per-nell"], teamId("florist")),
    job("job-rings", "blk-rings", "Rings out of the safe", ["per-joe"], null),
    job("job-covers", "blk-turnaround", "Lay 90 covers", ["per-ana", "per-sam"], teamId("caterer")),
    job("job-toptable", "blk-turnaround", "Move the top table back", ["per-joe"], null),
    job("job-candles", "blk-turnaround", "Light the candles", ["per-ana"], teamId("caterer"), "Long matches in the pantry."),
    job("job-cake", "blk-cake", "Knife and plates to the cake", ["per-sam"], teamId("caterer")),
    job("job-glasses", "blk-evefood", "Clear glasses from the lawn", [], null),
    job("job-linens", "blk-carriages", "Hire linens bagged for collection", ["per-ana", "per-joe"], null),
  ];

  return { ...doc, people, jobs };
}

function job(
  id: string,
  blockId: string,
  label: string,
  personIds: string[],
  teamId: string | null,
  notes = "",
) {
  return { id, blockId, label, notes, teamId, personIds };
}
