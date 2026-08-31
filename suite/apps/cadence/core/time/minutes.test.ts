import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, parseClock, MIN_PER_DAY } from "./minutes";

describe("parseClock", () => {
  it("accepts every documented form", () => {
    expect(parseClock("14:30")).toBe(870);
    expect(parseClock("2:30pm")).toBe(870);
    expect(parseClock("2.30pm")).toBe(870);
    expect(parseClock("1430")).toBe(870);
    expect(parseClock("9am")).toBe(540);
    expect(parseClock("0930")).toBe(570);
    expect(parseClock(" 14:30 ")).toBe(870);
  });

  it("handles the 12-hour edges", () => {
    expect(parseClock("12am")).toBe(0);
    expect(parseClock("12:01am")).toBe(1);
    expect(parseClock("12pm")).toBe(720);
    expect(parseClock("12:30pm")).toBe(750);
  });

  it("reads a day offset past midnight", () => {
    expect(parseClock("01:30 +1")).toBe(MIN_PER_DAY + 90);
    expect(parseClock("1:30am +1")).toBe(MIN_PER_DAY + 90);
  });

  it("rejects what is not a time", () => {
    expect(parseClock("25:00")).toBeNull();
    expect(parseClock("")).toBeNull();
    expect(parseClock("   ")).toBeNull();
    expect(parseClock("14:60")).toBeNull();
    expect(parseClock("13pm")).toBeNull();
    expect(parseClock("0pm")).toBeNull();
    expect(parseClock("half four")).toBeNull();
    expect(parseClock("2560")).toBeNull();
  });
});

describe("formatClock", () => {
  it("formats within the day", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(570)).toBe("09:30");
    expect(formatClock(870)).toBe("14:30");
    expect(formatClock(1439)).toBe("23:59");
  });

  it("marks the morning after", () => {
    expect(formatClock(1440)).toBe("00:00 +1");
    expect(formatClock(1530)).toBe("01:30 +1");
    expect(formatClock(1530, { dayOffset: false })).toBe("01:30");
  });
});

describe("round trip", () => {
  it("survives parse then format then parse", () => {
    for (const form of ["14:30", "2:30pm", "2.30pm", "1430", "9am", "01:30 +1"]) {
      const min = parseClock(form);
      expect(min).not.toBeNull();
      expect(parseClock(formatClock(min as number))).toBe(min);
    }
  });

  it("round trips every minute of two days", () => {
    for (let min = 0; min < 2 * MIN_PER_DAY; min += 1) {
      expect(parseClock(formatClock(min))).toBe(min);
    }
  });
});

describe("formatDuration", () => {
  it("reads as a planner would say it", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(85)).toBe("1h 25m");
    expect(formatDuration(-65)).toBe("-1h 5m");
  });
});
