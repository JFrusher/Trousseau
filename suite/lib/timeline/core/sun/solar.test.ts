import { describe, expect, it } from "vitest";
import { dayOfYear, sunTimes } from "./solar";

const LONDON = { lat: 51.5074, lon: -0.1278 };

function dayLength(iso: string, lat: number, lon: number, offset: number): number {
  const times = sunTimes(iso, lat, lon, offset);
  if (!times || times.sunriseMin === null || times.sunsetMin === null) {
    throw new Error("no sunrise or sunset");
  }
  return times.sunsetMin - times.sunriseMin;
}

describe("dayOfYear", () => {
  it("counts from 1", () => {
    expect(dayOfYear("2026-01-01")).toBe(1);
    expect(dayOfYear("2026-12-31")).toBe(365);
    expect(dayOfYear("2024-12-31")).toBe(366);
    expect(dayOfYear("not a date")).toBeNull();
  });
});

describe("sunTimes", () => {
  it("gives a twelve hour day at the equinox, at any latitude", () => {
    for (const lat of [0, 20, 40, 51.5, 60, -35]) {
      const length = dayLength("2026-03-20", lat, 0, 0);
      expect(Math.abs(length - 12 * 60)).toBeLessThan(15);
    }
  });

  it("puts the long day in June up north and in December down south", () => {
    expect(dayLength("2026-06-21", 51.5, 0, 0)).toBeGreaterThan(
      dayLength("2026-12-21", 51.5, 0, 0),
    );
    expect(dayLength("2026-12-21", -33.9, 151.2, 660)).toBeGreaterThan(
      dayLength("2026-06-21", -33.9, 151.2, 660),
    );
  });

  it("opens golden hour before the sun sets", () => {
    const times = sunTimes("2026-06-20", LONDON.lat, LONDON.lon, 60);
    expect(times?.goldenHourStartMin).toBeLessThan(times?.sunsetMin as number);
    expect(times?.goldenHourEndMin).toBe(times?.sunsetMin);
  });

  it("matches the almanac for London on the solstice", () => {
    // Published sunset for London, 21 June 2026: 21:21 BST. Tolerance two minutes.
    const times = sunTimes("2026-06-21", LONDON.lat, LONDON.lon, 60);
    expect(Math.abs((times?.sunsetMin as number) - (21 * 60 + 21))).toBeLessThanOrEqual(2);
    // Sunrise the same day: 04:43 BST.
    expect(Math.abs((times?.sunriseMin as number) - (4 * 60 + 43))).toBeLessThanOrEqual(2);
  });

  it("puts solar noon near the middle of the day", () => {
    const times = sunTimes("2026-06-20", LONDON.lat, LONDON.lon, 60);
    expect(times?.solarNoonMin).toBeGreaterThan(12 * 60);
    expect(times?.solarNoonMin).toBeLessThan(13 * 60 + 15);
  });

  it("reports no sunset inside the arctic circle in midsummer", () => {
    const times = sunTimes("2026-06-21", 78, 15, 120);
    expect(times?.sunsetMin).toBeNull();
    expect(times?.sunriseMin).toBeNull();
  });

  it("rejects a date it cannot read", () => {
    expect(sunTimes("20th June", LONDON.lat, LONDON.lon, 60)).toBeNull();
  });
});

describe("sunForDay", () => {
  it("reads the document's own day settings", async () => {
    const { sunForDay } = await import("./solar");
    const { sampleDoc } = await import("../model/defaults");
    expect(sunForDay(sampleDoc().day)?.sunsetMin).toBe(
      sunTimes("2026-06-20", 51.5074, -0.1278, 60)?.sunsetMin,
    );
  });
});
