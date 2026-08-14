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
  /** Compass azimuth where the pass first clears the horizon. */
  riseAzimuthDeg?: number;
  durationMinutes: number;
  /** Peak apparent magnitude — how easy the pass is to spot (smaller = brighter). */
  magnitude?: number;
  /** True when the satellite is in Earth's shadow at its peak — invisible. */
  shadowed?: boolean;
  /** Satellite name from the TLE, e.g. "ISS (ZARYA)". Set by the brief builder. */
  satelliteName?: string;
  /** NORAD catalog id this pass belongs to. Set by the brief builder. */
  noradId?: string;
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

/** A contiguous period of dark, moon-free sky during the night. */
export interface ViewingWindow {
  start: Date;
  end: Date;
}

export interface MoonInfo {
  /** Fraction of the moon illuminated, 0 (new) to 1 (full). */
  illumination: number;
  phaseName: string;
  moonrise: Date | null;
  moonset: Date | null;
  /** Longest moon-free window tonight; null means the moon is up all night. */
  bestViewingWindow: ViewingWindow | null;
  /** True when the moon is below the horizon for essentially the whole night. */
  moonDownAllNight: boolean;
  /** Total hours the moon is below the horizon tonight. */
  darkHours: number;
}

export type CloudLevel = "CLEAR" | "PARTLY_CLOUDY" | "CLOUDY" | "UNKNOWN";

export interface CloudHour {
  /** Hour boundary. */
  time: Date;
  /** Cloud cover, 0-100%. */
  cloudCover: number;
}

export interface CloudSummary {
  level: CloudLevel;
  /** Average cloud cover over tonight's dark window, 0-100, or null. */
  average: number | null;
  /** Hourly cloud cover during tonight's window (for the timeline). */
  hours: CloudHour[];
}

export interface PlanetEvent {
  name: string;
  /** Visual magnitude at best viewing time (lower = brighter). */
  magnitude: number | null;
  /** Highest altitude above the horizon tonight, degrees. */
  maxAltitudeDeg: number;
  /** When it first appears above the horizon tonight (null = already up at dusk). */
  riseTime: Date | null;
  /** When it dips below the horizon (null = stays up past dawn). */
  setTime: Date | null;
  /** Best time to look — moment of maximum altitude. */
  bestTime: Date | null;
  /** Compass direction (e.g. "SW") at best viewing time. */
  direction: string;
  /** True when the planet is above the horizon at some point tonight. */
  visible: boolean;
}

export interface ConjunctionEvent {
  planet: string;
  /** Moment of closest approach tonight. */
  time: Date;
  /** Angular separation between the Moon and the planet, degrees. */
  separationDeg: number;
}

export interface SkyBriefError {
  section: "iss" | "aurora" | "showers" | "clouds" | "planets";
  message: string;
}

export interface SkyBrief {
  location: LatLon;
  generatedAt: Date;
  issPasses: IssPass[];
  aurora: AuroraInfo | null;
  showers: ShowerInfo[];
  moon: MoonInfo;
  clouds: CloudSummary;
  planets: PlanetEvent[];
  conjunctions: ConjunctionEvent[];
  errors: SkyBriefError[];
}

export type AlertEventType = "iss" | "aurora" | "showers";

export const ALERT_EVENT_TYPES = ["iss", "aurora", "showers"] as const;
