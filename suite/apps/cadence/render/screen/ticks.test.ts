import { describe, expect, it } from "vitest";
import { MIN_LABEL_PX, MIN_LABEL_PITCH_PX, tickInterval, ticks } from "./ticks";

describe("tickInterval", () => {
  it("opens up as the zoom closes in", () => {
    expect(tickInterval(0.2)).toBeGreaterThan(tickInterval(2));
  });
});

describe("vertical pitch", () => {
  it("lands on half hours at the default vertical scale", () => {
    // 1.3 px/min: a 15 minute interval is 19.5px, under the 24px a line of
    // type needs. 30 minutes is 39px, which clears it.
    expect(tickInterval(1.3, MIN_LABEL_PITCH_PX)).toBe(30);
  });

  it("never lets two labels collide anywhere in the supported zoom range", () => {
    for (let pxPerMin = 0.4; pxPerMin <= 6; pxPerMin += 0.1) {
      const interval = tickInterval(pxPerMin, MIN_LABEL_PITCH_PX);
      expect(interval * pxPerMin).toBeGreaterThanOrEqual(MIN_LABEL_PITCH_PX);
    }
  });

  it("opens up as the day is zoomed out", () => {
    expect(tickInterval(0.4, MIN_LABEL_PITCH_PX)).toBeGreaterThan(
      tickInterval(2, MIN_LABEL_PITCH_PX),
    );
  });

  it("labels only the ticks the pitch allows", () => {
    const labelled = ticks(600, 780, 1.3, MIN_LABEL_PITCH_PX).filter((tick) => tick.label);
    expect(labelled.map((tick) => tick.min)).toEqual([600, 630, 660, 690, 720, 750, 780]);
  });
});

describe("ticks", () => {
  it("never lets two labels collide, at any zoom in the supported range", () => {
    for (let pxPerMin = 0.2; pxPerMin <= 8; pxPerMin += 0.1) {
      const labelled = ticks(420, 1500, pxPerMin).filter((tick) => tick.major);
      for (let i = 1; i < labelled.length; i += 1) {
        const gapPx = ((labelled[i]?.min ?? 0) - (labelled[i - 1]?.min ?? 0)) * pxPerMin;
        expect(gapPx).toBeGreaterThanOrEqual(MIN_LABEL_PX);
      }
    }
  });

  it("labels the majors and leaves the hairlines blank", () => {
    const all = ticks(480, 600, 2);
    expect(all.every((tick) => (tick.major ? tick.label !== "" : tick.label === ""))).toBe(true);
    expect(all.some((tick) => !tick.major)).toBe(true);
  });

  it("marks the morning after past midnight", () => {
    const late = ticks(1380, 1560, 2).find((tick) => tick.min === 1500);
    expect(late?.label).toBe("01:00 +1");
  });

  it("stays inside the span", () => {
    const all = ticks(500, 700, 1);
    expect(all[0]?.min).toBeGreaterThanOrEqual(500);
    expect(all[all.length - 1]?.min).toBeLessThanOrEqual(700);
  });

  it("returns nothing for a span that is not one", () => {
    expect(ticks(600, 600, 2)).toEqual([]);
    expect(ticks(700, 600, 2)).toEqual([]);
    expect(ticks(400, 600, 0)).toEqual([]);
  });
});

describe("spanOf", () => {
  it("wraps the day with air either side and always reaches the curfew", async () => {
    const { spanOf } = await import("./ticks");
    const span = spanOf([{ startMin: 480, endMin: 900 }], 1500);
    expect(span.fromMin).toBeLessThanOrEqual(450);
    expect(span.toMin).toBeGreaterThanOrEqual(1530);
  });

  it("has a sensible default for an empty day", async () => {
    const { spanOf } = await import("./ticks");
    expect(spanOf([], 1440).toMin).toBeGreaterThan(spanOf([], 1440).fromMin);
  });
});
