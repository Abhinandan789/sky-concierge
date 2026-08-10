import type { ShowerInfo } from "@/types";

export interface MeteorShowerDef {
  name: string;
  month: number;
  day: number;
  /** Zenithal hourly rate — a rough intensity measure. */
  zhr: number;
}

export const MAJOR_SHOWERS: MeteorShowerDef[] = [
  { name: "Quadrantids", month: 1, day: 3, zhr: 110 },
  { name: "Lyrids", month: 4, day: 22, zhr: 18 },
  { name: "Eta Aquariids", month: 5, day: 6, zhr: 50 },
  { name: "Delta Aquariids", month: 7, day: 30, zhr: 25 },
  { name: "Perseids", month: 8, day: 12, zhr: 100 },
  { name: "Draconids", month: 10, day: 8, zhr: 10 },
  { name: "Orionids", month: 10, day: 21, zhr: 20 },
  { name: "Leonids", month: 11, day: 17, zhr: 15 },
  { name: "Geminids", month: 12, day: 14, zhr: 150 },
  { name: "Ursids", month: 12, day: 22, zhr: 10 },
];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Compute the status of every major shower relative to the given date.
 * Negative daysUntilPeak means the peak has already passed this year.
 */
export function computeShowerStatus(now: Date = new Date()): ShowerInfo[] {
  const year = now.getFullYear();
  const today = startOfLocalDay(now).getTime();

  return MAJOR_SHOWERS.map((shower) => {
    const peak = new Date(year, shower.month - 1, shower.day).getTime();
    const daysUntilPeak = Math.round((peak - today) / 86_400_000);

    return {
      name: shower.name,
      zhr: shower.zhr,
      peakDate: `${year}-${pad(shower.month)}-${pad(shower.day)}`,
      daysUntilPeak,
      isPeakTonight: daysUntilPeak === 0,
      isPeakingThisWeek: Math.abs(daysUntilPeak) <= 7,
    };
  });
}
