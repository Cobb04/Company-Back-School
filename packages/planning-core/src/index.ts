// ============================================================
// Return School Planner — Planning Core
// ============================================================
// Deterministic planning functions.
// All business rules live here — server and web consume these,
// never reimplementing time calculation themselves.
// ============================================================

import type {
  SafeDepartureInput,
  SafeDepartureOutput,
  TrainCandidate,
  ScoredTrain,
  Preference,
  ComfortLevel,
  RiskLevel,
  Decision,
} from "@return-school/shared";

// ============================================================
// S1: Safe Departure Time
// ============================================================

/**
 * Calculate the earliest safe train departure time in "HH:mm" format.
 *
 * Formula:
 *   safeDepartureTime = clockOutTime
 *     + companyToStationMinutes
 *     + stationEntryBufferMinutes
 *     + riskBufferMinutes
 *
 * Accepts clock-out time in "HH:mm" 24-hour format and returns
 * the safe departure time in the same format. Handles midnight
 * crossing by wrapping minutes past 23:59.
 */
export function calculateSafeDepartureTime(
  input: SafeDepartureInput,
): SafeDepartureOutput {
  const { clockOutTime, companyToStationMinutes, stationEntryBufferMinutes, riskBufferMinutes } =
    input;

  validateMinutes("companyToStationMinutes", companyToStationMinutes);
  validateMinutes("stationEntryBufferMinutes", stationEntryBufferMinutes);
  validateMinutes("riskBufferMinutes", riskBufferMinutes);

  const parsed = parseTime(clockOutTime);

  const totalMinutes =
    parsed.totalMinutes +
    companyToStationMinutes +
    stationEntryBufferMinutes +
    riskBufferMinutes;

  const wrappedMinutes = totalMinutes % 1440;

  const hours = Math.floor(wrappedMinutes / 60);
  const minutes = wrappedMinutes % 60;

  const safeDepartureTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  return { safeDepartureTime };
}

/** Input for the datetime-aware safe departure calculator. */
export interface SafeDepartureDatetimeInput {
  /** Departure date in "YYYY-MM-DD" format. */
  departDate: string;
  /** Clock-out time in "HH:mm" 24-hour format. */
  clockOutTime: string;
  /** Minutes from company to departure station. */
  companyToStationMinutes: number;
  /** Minutes of station entry buffer (default 30). */
  stationEntryBufferMinutes: number;
  /** Minutes of risk buffer (default 15). */
  riskBufferMinutes: number;
}

/**
 * Calculate the safe departure time as a full ISO 8601 datetime.
 *
 * This is the datetime-aware version needed for correct cross-midnight
 * comparison. When clockOutTime + buffers wraps past midnight,
 * the date portion advances accordingly.
 *
 * Returns ISO 8601 in +08:00 timezone (Phase 0 assumption).
 */
export function calculateSafeDepartureDatetime(
  input: SafeDepartureDatetimeInput,
): string {
  const { departDate, clockOutTime, companyToStationMinutes, stationEntryBufferMinutes, riskBufferMinutes } = input;

  validateDate(departDate);
  validateMinutes("companyToStationMinutes", companyToStationMinutes);
  validateMinutes("stationEntryBufferMinutes", stationEntryBufferMinutes);
  validateMinutes("riskBufferMinutes", riskBufferMinutes);

  // Build full ISO from departDate + clockOutTime
  const clockOutISO = `${departDate}T${clockOutTime}:00+08:00`;
  const totalBuffer = companyToStationMinutes + stationEntryBufferMinutes + riskBufferMinutes;

  return addMinutesToISO(clockOutISO, totalBuffer);
}

// ============================================================
// S2: Train Candidate Scoring
// ============================================================

/** Input for scoring a single train candidate. */
export interface ScoreTrainInput {
  train: TrainCandidate;
  /**
   * Safe departure time as a full ISO 8601 datetime.
   * Use calculateSafeDepartureDatetime() to compute this —
   * comparing only HH:mm strings fails across midnight boundaries.
   */
  safeDepartureDatetime: string;
  /** ISO 8601 datetime for the earliest exam. */
  firstExamAt: string;
  /** Minutes from each destination station to school. */
  stationToSchoolMinutes: Record<string, number>;
  /** The intern's trade-off preference. */
  preference: Preference;
}

/**
 * Score a single train candidate deterministically.
 *
 * Scoring model:
 *   1. Three weighted components (each 0-100):
 *      - Price: cheaper → higher score
 *      - Time:  faster → higher score
 *      - Comfort: G/D=100, K=0, other=50
 *   2. Weights per preference:
 *      - price_sensitive:  70% price / 20% time / 10% comfort
 *      - time_sensitive:   10% price / 70% time / 20% comfort
 *      - balanced:         40% price / 40% time / 20% comfort
 *   3. Penalties (deducted from weighted score):
 *      - Depart before safe departure datetime: -20
 *      - Exam buffer < 60 min: -15
 *      - Exam buffer 60-119 min: -5
 *   4. Risk level from exam buffer + departure safety.
 *   5. Decision from final score threshold (≥52 recommend, ≥35 optional).
 */
export function scoreTrainCandidate(input: ScoreTrainInput): ScoredTrain {
  const { train, safeDepartureDatetime, firstExamAt, stationToSchoolMinutes, preference } = input;

  // 1. Derive comfort level
  const comfortLevel = deriveComfortLevel(train.trainType);

  // 2. Calculate school arrival time
  const stationToSchoolMin = stationToSchoolMinutes[train.arrivalStation] ?? 0;
  const schoolArrival = addMinutesToISO(train.arrivalTime, stationToSchoolMin);

  // 3. Calculate exam buffer
  const examBufferMinutes = minutesBetween(schoolArrival, firstExamAt);

  // 4. Check safe departure — compare full ISO datetimes, not HH:mm strings
  const trainDepartureMs = isoToEpochMs(train.departureTime);
  const safeDepartureMs = isoToEpochMs(safeDepartureDatetime);
  const departBeforeSafe = trainDepartureMs < safeDepartureMs;

  // 5. Calculate score components
  const priceComponent = calcPriceComponent(train.price);
  const timeComponent = calcTimeComponent(train.durationMinutes);
  const comfortComponent = calcComfortComponent(comfortLevel);

  // 6. Apply preference weights
  const weights = PREFERENCE_WEIGHTS[preference];
  let score =
    priceComponent * weights.price +
    timeComponent * weights.time +
    comfortComponent * weights.comfort;

  // 7. Apply penalties
  const reasons: string[] = [];
  if (departBeforeSafe) {
    score -= 20;
    const safeDisplay = extractHHMM(safeDepartureDatetime);
    const trainDisplay = extractHHMM(train.departureTime);
    reasons.push(`出发时间 ${trainDisplay} 早于安全出发时间 ${safeDisplay}，扣20分`);
  }
  if (examBufferMinutes < 60) {
    score -= 15;
    reasons.push(`考试缓冲时间仅 ${examBufferMinutes} 分钟，非常紧张，扣15分`);
  } else if (examBufferMinutes < 120) {
    score -= 5;
    reasons.push(`考试缓冲时间 ${examBufferMinutes} 分钟，略有紧张，扣5分`);
  }

  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));

  // 8. Add comfort / price / time reasons
  addComponentReasons(reasons, train, comfortLevel, preference, examBufferMinutes);

  // 9. Derive risk level
  const riskLevel = deriveRiskLevel(examBufferMinutes, departBeforeSafe);

  // 10. Derive decision
  const decision = deriveDecision(score);

  return {
    ...train,
    score,
    riskLevel,
    decision,
    reasons,
    estimatedSchoolArrival: schoolArrival,
    examBufferMinutes,
    comfortLevel,
  };
}

// ============================================================
// Scoring helpers
// ============================================================

/** Reference values for price and time normalization. */
const REF_PRICE = 600; // max plausible price in yuan
const REF_DURATION = 720; // max plausible duration in minutes (12 hours)

/** Preference weight matrices. */
const PREFERENCE_WEIGHTS: Record<Preference, { price: number; time: number; comfort: number }> = {
  price_sensitive: { price: 0.7, time: 0.2, comfort: 0.1 },
  time_sensitive: { price: 0.1, time: 0.7, comfort: 0.2 },
  balanced: { price: 0.4, time: 0.4, comfort: 0.2 },
};

function deriveComfortLevel(trainType: string): ComfortLevel {
  switch (trainType) {
    case "G":
      return "comfortable";
    case "D":
      return "comfortable";
    case "K":
      return "uncomfortable";
    default:
      return "unknown";
  }
}

/** Price score 0-100: cheaper = higher. */
function calcPriceComponent(price: number): number {
  return Math.max(0, ((REF_PRICE - price) / REF_PRICE) * 100);
}

/** Time score 0-100: faster = higher. */
function calcTimeComponent(durationMinutes: number): number {
  return Math.max(0, ((REF_DURATION - durationMinutes) / REF_DURATION) * 100);
}

/** Comfort score 0-100. */
function calcComfortComponent(comfortLevel: ComfortLevel): number {
  switch (comfortLevel) {
    case "comfortable":
      return 100;
    case "uncomfortable":
      return 0;
    default:
      return 50;
  }
}

function deriveRiskLevel(examBufferMinutes: number, departBeforeSafe: boolean): RiskLevel {
  let level: RiskLevel;
  if (examBufferMinutes >= 120) {
    level = "low";
  } else if (examBufferMinutes >= 60) {
    level = "medium";
  } else {
    level = "high";
  }
  // Bump up one level if departing before safe time
  if (departBeforeSafe) {
    if (level === "low") return "medium";
    if (level === "medium") return "high";
    return "high";
  }
  return level;
}

function deriveDecision(score: number): Decision {
  if (score >= 52) return "recommend";
  if (score >= 35) return "optional";
  return "not_recommended";
}

function addComponentReasons(
  reasons: string[],
  train: TrainCandidate,
  _comfortLevel: ComfortLevel,
  preference: Preference,
  examBufferMinutes: number,
): void {
  // Comfort reason
  if (train.trainType === "G") {
    reasons.push("G字头高铁，速度快、舒适度高");
  } else if (train.trainType === "D") {
    reasons.push("D字头动车，性价比较好");
  } else if (train.trainType === "K") {
    reasons.push("K字头普快，耗时较长、舒适度低");
  }

  // Price reason
  if (train.price <= 200) {
    reasons.push(`票价 ¥${train.price}，价格较低`);
  } else if (train.price >= 450) {
    reasons.push(`票价 ¥${train.price}，价格较高`);
  }

  // Time reason
  if (train.durationMinutes <= 300) {
    reasons.push(`历时 ${train.durationMinutes} 分钟，速度较快`);
  } else if (train.durationMinutes >= 500) {
    reasons.push(`历时 ${train.durationMinutes} 分钟，耗时较长`);
  }

  // Preference-specific
  if (preference === "price_sensitive" && train.price <= 300) {
    reasons.push("适合价格敏感型偏好");
  } else if (preference === "time_sensitive" && train.durationMinutes <= 350) {
    reasons.push("适合时间敏感型偏好");
  }

  // Exam buffer positive
  if (examBufferMinutes >= 180) {
    reasons.push(`考试缓冲时间充足（${examBufferMinutes}分钟）`);
  }
}

// ============================================================
// Internal time helpers (not exported)
// ============================================================

interface ParsedTime {
  hours: number;
  minutes: number;
  totalMinutes: number;
}

function validateMinutes(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `${field} must be a non-negative integer, got ${JSON.stringify(value)}`,
    );
  }
}

function validateDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(
      `Invalid date format: "${date}". Expected "YYYY-MM-DD".`,
    );
  }
}

function parseTime(time: string): ParsedTime {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new Error(
      `Invalid time format: "${time}". Expected "HH:mm" in 24-hour format.`,
    );
  }

  const [hoursStr, minutesStr] = time.split(":") as [string, string];
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(
      `Invalid time value: "${time}". Hours must be 0–23, minutes 0–59.`,
    );
  }

  return { hours, minutes, totalMinutes: hours * 60 + minutes };
}

/**
 * Convert an ISO 8601 string to epoch milliseconds.
 * Throws a clear error on invalid input so callers get 400, not 500.
 */
function isoToEpochMs(iso: string): number {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid ISO datetime: "${iso}"`);
  }
  return d.getTime();
}

/**
 * Add minutes to an ISO 8601 datetime string, returning ISO 8601
 * in the same +08:00 timezone (Phase 0 assumption).
 */
function addMinutesToISO(iso: string, addMinutes: number): string {
  // Parse the local datetime components from the ISO string
  // Format: "2026-06-26T23:50:00+08:00"
  const match = iso.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:\d{2})$/,
  );
  if (!match) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) throw new Error(`Invalid ISO datetime: "${iso}"`);
    d.setMinutes(d.getMinutes() + addMinutes);
    return d.toISOString();
  }

  const [, year, month, day, hour, min, sec, tz] = match as [
    string, string, string, string, string, string, string, string,
  ];

  // Create a date in local time (no timezone conversion)
  const localStr = `${year}-${month}-${day}T${hour}:${min}:${sec}`;
  const d = new Date(localStr + "Z"); // Treat as UTC to avoid offset
  if (isNaN(d.getTime())) throw new Error(`Invalid ISO datetime: "${iso}"`);

  d.setUTCMinutes(d.getUTCMinutes() + addMinutes);

  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");

  return `${y}-${mo}-${da}T${h}:${mi}:${s}${tz}`;
}

/**
 * Extract "HH:mm" from an ISO 8601 string in +08:00 timezone.
 */
function extractHHMM(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid ISO datetime: "${iso}"`);
  }
  // For mock data in +08:00, extract time portion from the ISO string directly
  // Format: "2026-06-26T19:30:00+08:00"
  const match = iso.match(/T(\d{2}):(\d{2})/);
  if (match) {
    return `${match[1]}:${match[2]}`;
  }
  // Fallback: format from Date object (may be affected by local timezone)
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Calculate minutes between two ISO 8601 datetimes (b - a).
 * Returns negative if b is before a.
 * Throws on invalid input — callers should validate before calling.
 */
function minutesBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  if (isNaN(da.getTime())) throw new Error(`Invalid ISO datetime: "${a}"`);
  if (isNaN(db.getTime())) throw new Error(`Invalid ISO datetime: "${b}"`);
  return Math.round((db.getTime() - da.getTime()) / 60000);
}
