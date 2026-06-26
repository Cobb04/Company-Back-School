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
  ReturnPlan,
  LeaveSuggestion,
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

// ============================================================
// S3: Two-Pass Scoring + Return Plans
// ============================================================

/** Two-pass scoring thresholds. Configurable constants, not magic numbers. */
export const TWO_PASS = {
  /** If Pass 1 best score is below this, trigger Pass 2. */
  PASS1_THRESHOLD: 70,
  /** Pass 2 best must beat Pass 1 best by at least this margin. */
  IMPROVEMENT_MARGIN: 15,
} as const;

/** Input for buildReturnPlans. */
export interface BuildReturnPlansInput {
  /** All scored trains, sorted by score descending. */
  scoredTrains: ScoredTrain[];
  /** Safe departure datetime (ISO 8601). */
  safeDepartureDatetime: string;
  /** Earliest exam datetime (ISO 8601). */
  firstExamAt: string;
  /** Intern's trade-off preference. */
  preference: Preference;
}

/** Output from buildReturnPlans. */
export interface BuildReturnPlansOutput {
  /** Generated return plans (primary first, then alternatives). */
  plans: ReturnPlan[];
  /** Overall leave recommendation from two-pass scoring. */
  leaveSuggestion: LeaveSuggestion;
  /** The selected (best) scored train, or null if no trains available. */
  selectedTrain: ScoredTrain | null;
  /**
   * All scored trains in the scoring context that matches the plans.
   * When leave is recommended, these are leave-adjusted (no early-departure
   * penalty, reasons cleaned). When no leave needed, these are the original
   * no-leave scores. Callers use this for groupedTrains to keep one coherent
   * view — the same train never appears with two different scores in one response.
   */
  allScoredTrains: ScoredTrain[];
}

/**
 * Build return plans using two-pass scoring.
 *
 * Pass 1 considers only trains departing at or after safe departure time
 * (the no-leave window). If the best Pass 1 score is below the threshold,
 * Pass 2 expands the window to all trains, including those that would
 * require leaving work early. If Pass 2 finds a meaningfully better train,
 * the system recommends taking leave.
 *
 * Deterministic — no LLM involved.
 */
export function buildReturnPlans(input: BuildReturnPlansInput): BuildReturnPlansOutput {
  const { scoredTrains, safeDepartureDatetime, firstExamAt, preference } = input;

  // No trains at all
  if (scoredTrains.length === 0) {
    return {
      plans: [],
      leaveSuggestion: {
        needLeave: false,
        reason: "未找到可用车次，无法生成返校方案。",
        suggestedEarlyDepartureMinutes: 0,
        leaveText: "",
        estimatedLeaveDays: 0,
      },
      selectedTrain: null,
      allScoredTrains: [],
    };
  }

  const safeMs = isoToEpochMs(safeDepartureDatetime);

  // Build leave-adjusted versions for all trains.
  // In the leave scenario: early-departure penalty is removed, reasons are
  // cleaned, decision and riskLevel are recalculated without departBeforeSafe.
  const leaveAdjusted = scoredTrains.map(leaveAdjustedTrain);

  // --- Pass 1 (no-leave window): only trains at or after safe departure time, original scores ---
  const pass1Trains = scoredTrains.filter(
    (t) => isoToEpochMs(t.departureTime) >= safeMs,
  );
  const pass1Best = pass1Trains[0] ?? null;

  // --- Pass 1 ≥ threshold: no leave needed ---
  if (pass1Best && pass1Best.score >= TWO_PASS.PASS1_THRESHOLD) {
    const primaryPlan = buildPlan(pass1Best, "推荐方案", preference, firstExamAt);
    const alternatives = buildAlternativePlans(
      pass1Trains,
      primaryPlan,
      preference,
      firstExamAt,
      2,
    );
    return {
      plans: [primaryPlan, ...alternatives],
      leaveSuggestion: {
        needLeave: false,
        reason: `正常下班后出发，最佳车次 ${pass1Best.trainNumber} 评分 ${pass1Best.score} 分，无需请假。`,
        suggestedEarlyDepartureMinutes: 0,
        leaveText: "",
        estimatedLeaveDays: 0,
      },
      selectedTrain: pass1Best,
      // No leave → use original no-leave scores throughout
      allScoredTrains: scoredTrains,
    };
  }

  // --- Pass 2 (leave window): all trains, leave-adjusted scores ---
  // Sort leaveAdjusted by score desc for Pass 2 comparison
  const pass2Sorted = [...leaveAdjusted].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.departureTime.localeCompare(b.departureTime);
  });
  const pass2Best = pass2Sorted[0] ?? null;

  // Check if Pass 2 is meaningfully better
  if (
    pass2Best &&
    pass1Best &&
    pass2Best.score - pass1Best.score > TWO_PASS.IMPROVEMENT_MARGIN
  ) {
    const pass2DepartureMs = isoToEpochMs(pass2Best.departureTime);
    const earlyMinutes = Math.max(0, Math.round((safeMs - pass2DepartureMs) / 60000));

    const primaryPlan = buildPlan(pass2Best, "推荐方案（需请假）", preference, firstExamAt);
    const alternatives = buildAlternativePlans(
      pass2Sorted.filter((t) => t.id !== pass2Best.id),
      primaryPlan,
      preference,
      firstExamAt,
      2,
    );

    return {
      plans: [primaryPlan, ...alternatives],
      leaveSuggestion: {
        needLeave: true,
        reason: `正常下班后最佳车次 ${pass1Best.trainNumber} 仅 ${pass1Best.score} 分（低于 ${TWO_PASS.PASS1_THRESHOLD} 分阈值），提前出发可搭乘 ${pass2Best.trainNumber}，请假场景评分提升至 ${pass2Best.score} 分。`,
        suggestedEarlyDepartureMinutes: earlyMinutes,
        leaveText: "",
        estimatedLeaveDays: 0,
      },
      selectedTrain: pass2Best,
      // Leave recommended → use leave-adjusted scores throughout
      allScoredTrains: pass2Sorted,
    };
  }

  // --- Pass 2 not meaningfully better ---
  // If Pass 1 had no trains, all trains require early departure → must take leave
  if (!pass1Best) {
    const bestTrain = scoredTrains[0];
    if (!bestTrain) {
      return {
        plans: [],
        leaveSuggestion: {
          needLeave: false,
          reason: "未找到可用车次。",
          suggestedEarlyDepartureMinutes: 0,
          leaveText: "",
          estimatedLeaveDays: 0,
        },
        selectedTrain: null,
        allScoredTrains: [],
      };
    }

    // Use the leave-adjusted version of the best train for consistency
    const bestAdjusted = pass2Sorted[0]!;
    const bestDepartureMs = isoToEpochMs(bestAdjusted.departureTime);
    const earlyMinutes = Math.max(0, Math.round((safeMs - bestDepartureMs) / 60000));

    const primaryPlan = buildPlan(bestAdjusted, "推荐方案（需请假）", preference, firstExamAt);
    const alternatives = buildAlternativePlans(
      pass2Sorted.filter((t) => t.id !== bestAdjusted.id),
      primaryPlan,
      preference,
      firstExamAt,
      2,
    );

    return {
      plans: [primaryPlan, ...alternatives],
      leaveSuggestion: {
        needLeave: true,
        reason: `所有可用车次均早于安全出发时间，建议请假至少提前 ${earlyMinutes} 分钟出发。最佳车次 ${bestAdjusted.trainNumber} 评分 ${bestAdjusted.score} 分。`,
        suggestedEarlyDepartureMinutes: earlyMinutes,
        leaveText: "",
        estimatedLeaveDays: 0,
      },
      selectedTrain: bestAdjusted,
      // Leave recommended → use leave-adjusted scores throughout
      allScoredTrains: pass2Sorted,
    };
  }

  // Pass 1 has trains but they're below threshold AND Pass 2 not meaningfully better
  const primaryPlan = buildPlan(pass1Best, "推荐方案", preference, firstExamAt);
  const alternatives = buildAlternativePlans(
    scoredTrains.filter((t) => t.id !== pass1Best.id),
    primaryPlan,
    preference,
    firstExamAt,
    2,
  );

  return {
    plans: [primaryPlan, ...alternatives],
    leaveSuggestion: {
      needLeave: false,
      reason: `正常下班后最佳车次 ${pass1Best.trainNumber} 评分 ${pass1Best.score} 分，虽未达 ${TWO_PASS.PASS1_THRESHOLD} 分理想阈值，但提前出发无显著改善，建议正常出发。`,
      suggestedEarlyDepartureMinutes: 0,
      leaveText: "",
      estimatedLeaveDays: 0,
    },
    selectedTrain: pass1Best,
    // No leave → use original no-leave scores throughout
    allScoredTrains: scoredTrains,
  };
}

/**
 * Create a leave-scenario version of a scored train.
 *
 * In the leave scenario the intern can depart whenever needed, so:
 * - the -20 early-departure penalty is removed
 * - the "早于安全出发时间" reason is replaced with a leave note
 * - decision is recalculated from the adjusted score
 * - riskLevel is recalculated with departBeforeSafe=false
 *
 * Trains that already depart after safe time are returned unchanged.
 */
function leaveAdjustedTrain(train: ScoredTrain): ScoredTrain {
  const hasDepartPenalty = train.reasons.some((r) =>
    r.includes("早于安全出发时间"),
  );
  if (!hasDepartPenalty) return train;

  const newScore = Math.min(100, train.score + 20);
  const newReasons = train.reasons.filter(
    (r) => !r.includes("早于安全出发时间"),
  );
  newReasons.push("需请假提前出发");

  return {
    ...train,
    score: newScore,
    decision: deriveDecision(newScore),
    riskLevel: deriveRiskLevel(train.examBufferMinutes, false),
    reasons: newReasons,
  };
}

/** Build a single ReturnPlan from a scored train. */
function buildPlan(
  train: ScoredTrain,
  label: string,
  _preference: Preference,
  _firstExamAt: string,
): ReturnPlan {
  const departHHMM = extractHHMM(train.departureTime);
  const arriveHHMM = extractHHMM(train.arrivalTime);
  const schoolHHMM = extractHHMM(train.estimatedSchoolArrival);
  const durationHours = Math.floor(train.durationMinutes / 60);
  const durationMins = train.durationMinutes % 60;

  const title = `${label}：${train.trainNumber} ${train.departureStation} → ${train.arrivalStation}`;

  const summary =
    `${train.trainNumber}（${train.trainType}字头）${train.departureStation} ${departHHMM} 出发` +
    ` → ${train.arrivalStation} ${arriveHHMM} 到达` +
    `（历时 ${durationHours}h${String(durationMins).padStart(2, "0")}m）` +
    `，票价 ¥${train.price}` +
    `，预计 ${schoolHHMM} 到校` +
    `，距考试 ${train.examBufferMinutes >= 0 ? `${train.examBufferMinutes} 分钟` : "已开始"}` +
    `，风险${train.riskLevel === "low" ? "低" : train.riskLevel === "medium" ? "中" : "高"}` +
    `，评分 ${train.score}/100`;

  const risks: string[] = [];
  if (train.riskLevel === "high") {
    risks.push(`高风险：${train.reasons.find((r) => r.includes("缓冲")) ?? "考试缓冲时间紧张"}`);
  } else if (train.riskLevel === "medium") {
    risks.push(`中等风险：请注意出发时间和考试缓冲`);
  }
  if (train.examBufferMinutes < 0) {
    risks.push("考试已开始：到校时间晚于考试时间，无法参加考试");
  } else if (train.examBufferMinutes < 60) {
    risks.push(`考试缓冲仅 ${train.examBufferMinutes} 分钟，非常紧张`);
  } else if (train.examBufferMinutes < 120) {
    risks.push(`考试缓冲 ${train.examBufferMinutes} 分钟，略有紧张`);
  }
  if (train.trainType === "K") {
    risks.push("K字头普快列车，耗时长、舒适度低");
  }

  // Checklist is empty for S3 — comes in S4/S6
  const checklist: string[] = [];

  // Leave suggestion is per-plan — if the plan requires early departure, note it
  let planLeave: LeaveSuggestion | null = null;
  // Check if this train requires leave by looking at scoring reasons
  const hasEarlyDeparture = train.reasons.some((r) => r.includes("早于安全出发时间"));
  if (hasEarlyDeparture) {
    planLeave = {
      needLeave: true,
      reason: `此车次需要提前离开公司才能赶上。`,
      suggestedEarlyDepartureMinutes: 0, // filled by caller if needed
      leaveText: "",
      estimatedLeaveDays: 0,
    };
  }

  return {
    title,
    train,
    summary,
    risks,
    checklist,
    leaveSuggestion: planLeave,
  };
}

/** Build a few alternative plans from remaining scored trains. */
function buildAlternativePlans(
  remaining: ScoredTrain[],
  primary: ReturnPlan,
  preference: Preference,
  firstExamAt: string,
  maxCount: number,
): ReturnPlan[] {
  // Take top-scoring alternatives that are at least "optional" and different from primary
  const alternatives = remaining
    .filter((t) => t.decision !== "not_recommended" && t.id !== primary.train.id)
    .slice(0, maxCount);

  return alternatives.map((t, i) =>
    buildPlan(t, `备选方案 ${i + 1}`, preference, firstExamAt),
  );
}
