// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { rowsFromRoom } from "./fromRoom";

/**
 * The point of this path is that a card cannot disagree with the seating plan,
 * so what is worth holding is the join: that a guest's table comes out as the
 * label printed on the plan rather than an id, and that nobody quietly loses
 * their card for not having a seat yet.
 */

const seat = (guests: Record<string, unknown>, tables: Record<string, unknown>) => {
  useTrousseauStore.getState().replaceDocument({ guests, seating: { tables } });
};

beforeEach(() => {
  useTrousseauStore.getState().replaceDocument({});
});

describe("printing from the room", () => {
  it("prints the table's label, not its id", () => {
    seat(
      { g1: { id: "g1", firstName: "Charis", lastName: "Smith", assignedTableId: "t7" } },
      { t7: { id: "t7", label: "Top Table" } },
    );

    expect(rowsFromRoom().rows[0]).toMatchObject({
      "First Name": "Charis",
      "Last Name": "Smith",
      Name: "Charis Smith",
      Table: "Top Table",
    });
  });

  it("still prints a card for someone with no table, and says so once", () => {
    seat(
      {
        g1: { id: "g1", firstName: "Charis", assignedTableId: "t1" },
        g2: { id: "g2", firstName: "Tobias" },
        g3: { id: "g3", firstName: "Eleanor" },
      },
      { t1: { id: "t1", label: "Table 1" } },
    );

    const { rows, issues } = rowsFromRoom();
    // Three cards, not one. An unseated guest is a job still to do; a card that
    // silently went missing is how somebody arrives to no place at all.
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row["Table"] === "")).toHaveLength(2);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/2 guests have no table/);
  });

  it("says nothing when everyone is seated", () => {
    seat(
      { g1: { id: "g1", firstName: "Charis", assignedTableId: "t1" } },
      { t1: { id: "t1", label: "Table 1" } },
    );
    expect(rowsFromRoom().issues).toEqual([]);
  });

  it("leaves the table blank when the plan no longer has it", () => {
    // The table was deleted in the room while the guest still pointed at it.
    // Better an empty line on the card than the word "t9" printed on the table.
    seat({ g1: { id: "g1", firstName: "Charis", assignedTableId: "t9" } }, {});
    expect(rowsFromRoom().rows[0]?.["Table"]).toBe("");
  });

  it("offers the columns a card is actually set from", () => {
    seat({}, {});
    expect(rowsFromRoom().headers).toEqual([
      "First Name",
      "Last Name",
      "Name",
      "Table",
      "Dietary",
      "Side",
    ]);
  });
});
