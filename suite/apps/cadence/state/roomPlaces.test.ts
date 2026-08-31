import { describe, expect, it } from "vitest";
import { roomPlaces } from "./roomPlaces";

/**
 * The trap this guards is that Tableaux keeps two things that both sound like
 * "named areas": a `zones` map the suite's typed reader knows about and Tableaux
 * never fills in, and the `room.spaces` you actually draw. Reading the first
 * gives an empty list that looks like a working feature with nothing to suggest.
 */
describe("places offered from the room", () => {
  it("reads the spaces you draw, not the zones map nobody fills in", () => {
    expect(
      roomPlaces({
        zones: { z1: { id: "z1", label: "Never used" } },
        room: { spaces: [{ id: "s1", label: "Orangery" }] },
      }),
    ).toEqual(["Orangery"]);
  });

  it("sorts, and offers each name once however many spaces share it", () => {
    expect(
      roomPlaces({
        room: {
          spaces: [
            { id: "s1", label: "Terrace" },
            { id: "s2", label: "Orangery" },
            { id: "s3", label: "Terrace" },
          ],
        },
      }),
    ).toEqual(["Orangery", "Terrace"]);
  });

  it("offers nothing rather than throwing when there is no room yet", () => {
    for (const empty of [undefined, null, {}, { room: {} }, { room: { spaces: "no" } }]) {
      expect(roomPlaces(empty)).toEqual([]);
    }
  });

  it("skips a space nobody has named", () => {
    expect(roomPlaces({ room: { spaces: [{ id: "s1" }, { id: "s2", label: "Barn" }] } })).toEqual([
      "Barn",
    ]);
  });
});
