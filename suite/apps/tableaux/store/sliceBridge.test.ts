import { beforeEach, expect, test, vi } from "vitest";

vi.mock("idb-keyval", () => ({
  get: async () => undefined,
  set: async () => undefined,
  del: async () => undefined,
}));

const { useTrousseauStore } = await import("@/lib/store/useTrousseauStore");
const { readDoc } = await import("./sliceBridge");
const { emptyTrousseau } = await import("@jfrusher/trousseau");

/**
 * Guests arriving from the shared wedding must be displayable in Seating.
 *
 * Tableaux renders and sorts by `fullName`, and derives it inside its own
 * addGuest/updateGuest. Nothing derived it for guests that came from anywhere
 * else — the suite's CSV import, a restored backup, the example wedding — so
 * the panel counted a hundred guests and showed a hundred blank rows, and
 * nobody could be seated at all.
 */

function withGuests(guests: Record<string, unknown>) {
  const doc = { ...emptyTrousseau(), guests };
  useTrousseauStore.setState({
    status: "ready",
    error: null,
    raw: doc as unknown as Record<string, unknown>,
    doc: doc as never,
    past: [],
    future: [],
  });
}

beforeEach(() => {
  useTrousseauStore.setState({ generation: 0 });
});

test("a guest with only first and last names still has a name to show", () => {
  withGuests({ g1: { id: "g1", firstName: "Alexander", lastName: "Okonkwo" } });

  const guest = readDoc().guests["g1"] as { fullName?: string };
  expect(guest.fullName).toBe("Alexander Okonkwo");
});

test("a first name on its own is enough", () => {
  withGuests({ g1: { id: "g1", firstName: "Priya", lastName: "" } });

  const guest = readDoc().guests["g1"] as { fullName?: string };
  expect(guest.fullName).toBe("Priya");
});

test("a fullName the guest already carries is left exactly as it is", () => {
  // Tableaux allows a name that is not simply first + last — a title, a
  // couple sharing a card. Deriving over the top would quietly rewrite it.
  withGuests({
    g1: { id: "g1", firstName: "Eleanor", lastName: "Abernathy", fullName: "Dr Eleanor Abernathy" },
  });

  const guest = readDoc().guests["g1"] as { fullName?: string };
  expect(guest.fullName).toBe("Dr Eleanor Abernathy");
});

test("a guest with no name at all is still listed rather than dropped", () => {
  withGuests({ g1: { id: "g1" } });

  const guest = readDoc().guests["g1"] as { fullName?: string };
  expect(guest.fullName).toBe("New guest");
});

test("every other field on the guest survives untouched", () => {
  withGuests({
    g1: { id: "g1", firstName: "Tobias", lastName: "Wright", dietary: "Vegetarian", tags: ["usher"] },
  });

  expect(readDoc().guests["g1"]).toMatchObject({
    id: "g1",
    dietary: "Vegetarian",
    tags: ["usher"],
  });
});
