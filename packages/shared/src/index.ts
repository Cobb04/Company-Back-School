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
  /** Deterministic reason for the leave recommendation. */
  reason: string;
  /** How many minutes earlier the intern should leave work to catch the recommended train. */
  suggestedEarlyDepartureMinutes: number;
  /** Generated leave request text (S4 — Phase 3 expression layer). */
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
  /** Leave recommendation from two-pass scoring. */
  leaveSuggestion: LeaveSuggestion;
}

// --- City-Station Mapping ---

/**
 * Maps a city name to its known train stations.
 * Phase 0 covers Shanghai and Yantai only.
 */
export const CITY_STATION_MAP: Record<string, string[]> = {
  "上海": ["上海虹桥", "上海站", "上海南站"],
  "烟台": ["烟台站", "烟台南站"],
};

/**
 * Returns all known stations for a city, or an empty array if unknown.
 */
export function getStationsForCity(city: string): string[] {
  return CITY_STATION_MAP[city] ?? [];
}

// --- Train Search ---

/** Request body for the train search endpoint. */
export interface TrainSearchRequest {
  /** Departure city name, e.g. "上海". */
  departureCity: string;
  /** Destination city name, e.g. "烟台". */
  destinationCity: string;
  /** ISO 8601 date string, e.g. "2026-06-26". */
  departDate: string;
  /** The intern's trade-off priority. */
  preference: Preference;
  /** ISO 8601 datetime for clock-out time. */
  clockOutTime: string;
  /** Minutes from company to departure station. */
  companyToStationMinutes: number;
  /** ISO 8601 datetime for the earliest exam. */
  firstExamAt: string;
  /** Minutes from destination station to school (per station). */
  stationToSchoolMinutes: Record<string, number>;
  /** Minutes of station entry buffer (default 30). */
  stationEntryBufferMinutes?: number;
  /** Minutes of risk buffer (default 15). */
  riskBufferMinutes?: number;
}

/** Response body for the train search endpoint. */
export interface TrainSearchResponse {
  /** Scored trains sorted by score descending. */
  trains: ScoredTrain[];
  /** Computed safe departure time (ISO 8601 datetime). */
  safeDepartureTime: string;
  /** Total number of trains found. */
  total: number;
}

// --- Ticket Source (server-side boundary) ---

/**
 * Trusted source of train availability data.
 * Phase 0: mockTicketSource. Phase 1: mcp12306TicketSource.
 * Planning code never knows which adapter is in use.
 */
export interface TicketSource {
  searchTrainCandidates(params: {
    fromStations: string[];
    toStations: string[];
    departDate: string;
  }): Promise<TrainCandidate[]>;
}

// --- S1: Safe Departure Time ---

/** Input for the safe departure time calculator. */
export interface SafeDepartureInput {
  /** Clock-out time in "HH:mm" format (24-hour). */
  clockOutTime: string;
  /** Minutes from company to departure station. */
  companyToStationMinutes: number;
  /** Minutes of station entry buffer (default 30). */
  stationEntryBufferMinutes: number;
  /** Minutes of risk buffer (default 15). */
  riskBufferMinutes: number;
}

/** Output from the safe departure time calculator. */
export interface SafeDepartureOutput {
  /** Earliest safe train departure time in "HH:mm" format (24-hour). */
  safeDepartureTime: string;
}
