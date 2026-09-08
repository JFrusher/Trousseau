import { describe, expect, it } from "vitest";
import { coerceGuests } from "./slices";

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
