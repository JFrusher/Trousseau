import { describe, expect, it } from "vitest";
import { emptyTrousseau } from "@jfrusher/trousseau";
import { coerceGuests, readCrew } from "./slices";

describe("coerceGuests keeps what it has no opinion about", () => {
  it("preserves fields owned by a tool rather than by the suite", () => {
    // Tableaux stores fullName, dietaryRaw and assignedSeatId on a guest; the
    // suite's model has never heard of them. Rebuilding a guest from the
    // suite's own field list dropped all three, and reconcileLoadedDocument
    // writes the result back on load — so seat positions inside a table were
    // silently destroyed by opening the app.
    const guests = coerceGuests({
      g1: {
        id: "g1",
        firstName: "Alexander",
        lastName: "Okonkwo",
        fullName: "Alexander Okonkwo",
        dietaryRaw: "no shellfish please",
        assignedTableId: "t1",
        assignedSeatId: "t1:3",
      },
    });

    expect(guests["g1"]).toMatchObject({
      fullName: "Alexander Okonkwo",
      dietaryRaw: "no shellfish please",
      assignedSeatId: "t1:3",
    });
  });

  it("still normalises the fields it does own", () => {
    const guests = coerceGuests({ g1: { id: "g1", rsvpStatus: "nonsense", tags: "not a list" } });
    expect(guests["g1"]).toMatchObject({ rsvpStatus: "pending", tags: [] });
  });

  it("carries a key belonging to a tool that does not exist yet", () => {
    const guests = coerceGuests({ g1: { id: "g1", favouriteColour: "sage" } });
    expect(guests["g1"]).toMatchObject({ favouriteColour: "sage" });
  });
});

describe("readCrew", () => {
  const docWith = (crew: unknown) => ({ ...emptyTrousseau(), crew } as never);

  it("reads a team's contract fields", () => {
    const crew = readCrew(
      docWith({
        teams: [
          {
            id: "t1",
            name: "Bloom & Co",
            cost: 1450,
            deposit: 300,
            depositPaidOn: "2026-11-02",
            balanceDueOn: "2027-05-01",
            email: "hello@bloom.example",
            confirmedOn: "2026-11-03",
          },
        ],
      }),
    );

    expect(crew.teams[0]).toMatchObject({
      cost: 1450,
      deposit: 300,
      depositPaidOn: "2026-11-02",
      balanceDueOn: "2027-05-01",
      email: "hello@bloom.example",
      confirmedOn: "2026-11-03",
    });
  });

  it("leaves a team with no contract details alone", () => {
    const crew = readCrew(docWith({ teams: [{ id: "t1", name: "Ushers" }] }));
    expect(crew.teams[0]).toMatchObject({
      cost: null,
      deposit: null,
      depositPaidOn: "",
      confirmedOn: "",
    });
  });

  it("keeps a field belonging to a tool it has never heard of", () => {
    // The same rule as the envelope, one level down. readCrew rebuilt every
    // team from a fixed list, which is how coerceGuests destroyed fullName.
    const crew = readCrew(docWith({ teams: [{ id: "t1", name: "Band", vanRegistration: "AB12 CDE" }] }));
    expect(crew.teams[0]).toMatchObject({ vanRegistration: "AB12 CDE" });
  });

  it("reads the budget, and treats a missing one as unset", () => {
    expect(readCrew(docWith({ budget: 18000 })).budget).toBe(18000);
    expect(readCrew(docWith({})).budget).toBeNull();
  });

  it("accepts a job that is not tied to a block", () => {
    const crew = readCrew(docWith({ jobs: [{ id: "j1", label: "Order confetti", blockId: null }] }));
    expect(crew.jobs[0]!.blockId).toBeNull();
  });

  it("still reads a job that is tied to one", () => {
    const crew = readCrew(docWith({ jobs: [{ id: "j1", label: "Buttonholes", blockId: "b1" }] }));
    expect(crew.jobs[0]!.blockId).toBe("b1");
  });
});
