// ============================================================
// Return School Planner — Shared Domain Types
// ============================================================
// These types form the shared vocabulary for all packages.
// They are pure type definitions — no business logic lives here.
// ============================================================

// --- Enums / Unions ---

export type SeatStatus = "available" | "waitlist" | "sold_out" | "unknown";

export type RiskLevel = "low" | "medium" | "high";

export type Decision = "recommend" | "optional" | "not_recommended";

export type Preference = "price_sensitive" | "time_sensitive" | "balanced";

export type ComfortLevel = "comfortable" | "uncomfortable" | "unknown";

export type TrainType = "G" | "D" | "K" | "other";

// --- Train ---

/** A train as returned from the ticket source, before scoring. */
export interface TrainCandidate {
  /** Unique identifier for this train (e.g. train number). */
  id: string;
  /** Train number, e.g. "G1234". */
  trainNumber: string;
  /** Train type (G/D/K/other). */
  trainType: TrainType;
  /** Departure station name. */
  departureStation: string;
  /** Arrival station name. */
  arrivalStation: string;
  /** Scheduled departure time (ISO 8601). */
  departureTime: string;
  /** Scheduled arrival time (ISO 8601). */
  arrivalTime: string;
  /** Travel duration in minutes. */
  durationMinutes: number;
  /** Ticket price in yuan. */
  price: number;
  /** Data source label (e.g. "mock", "12306"). */
  source: string;
  /** Seat availability across classes. */
  seats: Record<string, SeatStatus>;
}

/** A train after deterministic scoring has been applied. */
export interface ScoredTrain extends TrainCandidate {
  /** Computed score (higher = better). */
  score: number;
  /** Risk classification. */
  riskLevel: RiskLevel;
  /** Product decision category. */
  decision: Decision;
  /** Human-readable reasons for the decision. */
  reasons: string[];
  /** Estimated school arrival time (ISO 8601). */
  estimatedSchoolArrival: string;
  /** Minutes between school arrival and first exam. */
  examBufferMinutes: number;
  /** Comfort classification derived from train type. */
  comfortLevel: ComfortLevel;
}

// --- Plan ---

/** A complete return plan for the intern. */
export interface ReturnPlan {
  /** Display title for the plan. */
  title: string;
  /** The chosen scored train. */
  train: ScoredTrain;
  /** Human-readable schedule summary. */
  summary: string;
  /** Risk items the intern should be aware of. */
  risks: string[];
  /** Preparation checklist. */
  checklist: string[];
  /** Leave suggestion, if applicable. */
  leaveSuggestion: LeaveSuggestion | null;
}

/** Leave recommendation and generated message. */
export interface LeaveSuggestion {
  /** Whether the intern needs to take leave. */
  needLeave: boolean;
  /** Generated leave request text. */
  leaveText: string;
  /** Estimated days of leave needed. */
  estimatedLeaveDays: number;
}

// --- Request / Response ---

/** Input for the plan evaluator. */
export interface PlanEvaluateRequest {
  /** The city the intern is currently in. */
  departureCity: string;
  /** The city closest to the intern's school. */
  destinationCity: string;
  /** ISO 8601 date string for desired departure. */
  departDate: string;
  /** ISO 8601 datetime for clock-out time. */
  clockOutTime: string;
  /** Minutes from company to departure station. */
  companyToStationMinutes: number;
  /** Minutes of station entry buffer. */
  stationEntryBufferMinutes: number;
  /** Minutes of risk buffer. */
  riskBufferMinutes: number;
  /** ISO 8601 datetime for the earliest exam. */
  firstExamAt: string;
  /** Minutes from destination station to school (per station). */
  stationToSchoolMinutes: Record<string, number>;
  /** The intern's preference mode. */
  preference: Preference;
  /** Whether extreme speed mode is active. */
  extremeSpeedMode: boolean;
}

/** Response from the plan evaluator. */
export interface PlanEvaluateResponse {
  /** Computed safe departure time (ISO 8601). */
  safeDepartureTime: string;
  /** Scored trains grouped by decision category. */
  groupedTrains: {
    recommend: ScoredTrain[];
    optional: ScoredTrain[];
    notRecommended: ScoredTrain[];
  };
  /** Generated return plans. */
  plans: ReturnPlan[];
}
