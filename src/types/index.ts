export interface LatLon {
  lat: number;
  lon: number;
}

/** A single satellite pass above the horizon (rise -> maximum -> set). */
export interface IssPass {
  start: Date;
  max: Date;
  end: Date;
  /** Maximum elevation above the horizon in degrees (0-90). */
  maxElevationDeg: number;
  /** Compass azimuth (0-360, true north) at the moment of max elevation. */
  maxAzimuthDeg: number;
  durationMinutes: number;
}

export type AuroraLevel = "LOW" | "MODERATE" | "HIGH" | "STORM";

export interface AuroraInfo {
  /** Highest predicted Kp index during tonight's window (0-9). */
  maxKpTonight: number;
  level: AuroraLevel;
  /** Rough latitude band where aurora may be visible tonight. */
  viewingLatitudeHint: string;
}

export interface ShowerInfo {
  name: string;
  /** Zenithal hourly rate — a rough measure of intensity. */
  zhr: number;
  /** ISO date of the nominal peak. */
  peakDate: string;
  /** Negative = already past, 0 = peak is tonight. */
  daysUntilPeak: number;
  isPeakTonight: boolean;
  isPeakingThisWeek: boolean;
}

export interface SkyBriefError {
  section: "iss" | "aurora" | "showers";
  message: string;
}

export interface SkyBrief {
  location: LatLon;
  generatedAt: Date;
  issPasses: IssPass[];
  aurora: AuroraInfo | null;
  showers: ShowerInfo[];
  errors: SkyBriefError[];
}

export type AlertEventType = "iss" | "aurora" | "showers";

export const ALERT_EVENT_TYPES = ["iss", "aurora", "showers"] as const;
