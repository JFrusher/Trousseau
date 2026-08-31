/**
 * NOAA solar position, computed offline. No dependency, no network, and no
 * timezone database — the day's UTC offset is entered by the user, because a
 * wedding planner knows whether they are on BST and a tzdata blob is 300kB.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Refraction and the sun's radius put the disc's edge on the horizon here. */
const SUNSET_ZENITH_DEG = 90.833;
/** Golden hour opens when the sun is six degrees up. */
const GOLDEN_ZENITH_DEG = 84;

export interface SunTimes {
  /** All values are minutes-from-00:00 local wall clock, or null in polar day or night. */
  sunriseMin: number | null;
  sunsetMin: number | null;
  goldenHourStartMin: number | null;
  /** The light is gone at sunset. This is what the advisory measures against. */
  goldenHourEndMin: number | null;
  solarNoonMin: number;
}

/** Day of the year, 1-366, from an ISO `YYYY-MM-DD` string. */
export function dayOfYear(isoDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const start = Date.UTC(year, 0, 1);
  const target = Date.UTC(year, month - 1, day);
  return Math.round((target - start) / 86_400_000) + 1;
}

/**
 * @param isoDate  `YYYY-MM-DD`
 * @param latitude  degrees, north positive
 * @param longitude degrees, east positive
 * @param utcOffsetMin the day's offset from UTC in minutes (BST is 60)
 */
export function sunTimes(
  isoDate: string,
  latitude: number,
  longitude: number,
  utcOffsetMin: number,
): SunTimes | null {
  const doy = dayOfYear(isoDate);
  if (doy === null) return null;

  // Fractional year at local solar midday.
  const gamma = ((2 * Math.PI) / 365) * (doy - 1);

  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const solarNoonUtc = 720 + 4 * longitude - eqTime;
  const solarNoonMin = solarNoonUtc + utcOffsetMin;

  const hourAngle = (zenithDeg: number): number | null => {
    const cosH =
      Math.cos(zenithDeg * RAD) / (Math.cos(latitude * RAD) * Math.cos(decl)) -
      Math.tan(latitude * RAD) * Math.tan(decl);
    if (cosH > 1 || cosH < -1) return null; // Sun never reaches that height today.
    return Math.acos(cosH) * DEG;
  };

  const sunsetHa = hourAngle(SUNSET_ZENITH_DEG);
  const goldenHa = hourAngle(GOLDEN_ZENITH_DEG);

  const sunriseMin = sunsetHa === null ? null : Math.round(solarNoonMin - 4 * sunsetHa);
  const sunsetMin = sunsetHa === null ? null : Math.round(solarNoonMin + 4 * sunsetHa);
  const goldenHourStartMin = goldenHa === null ? null : Math.round(solarNoonMin + 4 * goldenHa);

  return {
    sunriseMin,
    sunsetMin,
    goldenHourStartMin,
    goldenHourEndMin: sunsetMin,
    solarNoonMin: Math.round(solarNoonMin),
  };
}

/** Convenience for the document's own day settings. */
export function sunForDay(day: {
  date: string;
  latitude: number;
  longitude: number;
  utcOffsetMin: number;
}): SunTimes | null {
  return sunTimes(day.date, day.latitude, day.longitude, day.utcOffsetMin);
}
