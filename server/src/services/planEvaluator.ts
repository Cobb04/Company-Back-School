// ============================================================
// Return School Planner — Plan Evaluator (Deep Module)
// ============================================================
// Orchestrates train search, safe departure time calculation,
// single-train scoring, two-pass scoring, plan generation,
// and leave suggestion. This is the single entry point that
// callers (route handlers, tests) depend on.
//
// Hidden implementation: city-station expansion, multi-station
// merging, safe departure computation, scoring, grouping, and
// response assembly.
// ============================================================

import type {
  TicketSource,
  PlanEvaluateRequest,
  PlanEvaluateResponse,
  ScoredTrain,
} from "@return-school/shared";
import { getStationsForCity } from "@return-school/shared";
import {
  calculateSafeDepartureDatetime,
  scoreTrainCandidate,
  buildReturnPlans,
} from "@return-school/planning-core";

// Re-export TicketSource so callers can import from one place.
export type { TicketSource } from "@return-school/shared";

/**
 * Evaluate the intern's return plan.
 *
 * Full pipeline:
 *   city-station expansion → ticket search →
 *   safe departure calculation → per-train scoring →
 *   two-pass scoring + plan assembly → response
 *
 * Accepts a TicketSource via dependency injection so tests can
 * substitute a fake source and Phase 1 can swap in 12306-mcp.
 *
 * Throws on invalid cities or date formats — callers should
 * validate before calling.
 */
export async function evaluateReturnPlan(
  request: PlanEvaluateRequest,
  dependencies: { ticketSource: TicketSource },
): Promise<PlanEvaluateResponse> {
  const { ticketSource } = dependencies;

  // 1. Expand cities to stations
  const fromStations = getStationsForCity(request.departureCity);
  if (fromStations.length === 0) {
    throw new Error(`Unknown departure city: "${request.departureCity}"`);
  }

  const toStations = getStationsForCity(request.destinationCity);
  if (toStations.length === 0) {
    throw new Error(`Unknown destination city: "${request.destinationCity}"`);
  }

  // 2. Calculate safe departure datetime
  const safeDepartureDatetime = calculateSafeDepartureDatetime({
    departDate: request.departDate,
    clockOutTime: request.clockOutTime,
    companyToStationMinutes: request.companyToStationMinutes,
    stationEntryBufferMinutes: request.stationEntryBufferMinutes,
    riskBufferMinutes: request.riskBufferMinutes,
  });

  // 3. Fetch train candidates from the injected ticket source
  const candidates = await ticketSource.searchTrainCandidates({
    fromStations,
    toStations,
    departDate: request.departDate,
  });

  // 4. Score every candidate (no filtering — two-pass decides what to keep)
  const scoredTrains: ScoredTrain[] = candidates.map((train) =>
    scoreTrainCandidate({
      train,
      safeDepartureDatetime,
      firstExamAt: request.firstExamAt,
      stationToSchoolMinutes: request.stationToSchoolMinutes,
      preference: request.preference,
    }),
  );

  // 5. Sort by score descending, then by departure time ascending for ties
  scoredTrains.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.departureTime.localeCompare(b.departureTime);
  });

  // 6. Two-pass scoring + plan generation
  const planResult = buildReturnPlans({
    scoredTrains,
    safeDepartureDatetime,
    firstExamAt: request.firstExamAt,
    preference: request.preference,
  });

  // 7. Group trains by decision category
  const groupedTrains = {
    recommend: scoredTrains.filter((t) => t.decision === "recommend"),
    optional: scoredTrains.filter((t) => t.decision === "optional"),
    notRecommended: scoredTrains.filter((t) => t.decision === "not_recommended"),
  };

  // 8. Extract safe departure time in HH:mm display format
  const safeDepartureHHMM = extractHHMM(safeDepartureDatetime);

  return {
    safeDepartureTime: safeDepartureHHMM,
    groupedTrains,
    plans: planResult.plans,
    leaveSuggestion: planResult.leaveSuggestion,
  };
}

/** Extract "HH:mm" from an ISO 8601 datetime string. */
function extractHHMM(iso: string): string {
  const match = iso.match(/T(\d{2}):(\d{2})/);
  if (match) {
    return `${match[1]}:${match[2]}`;
  }
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) throw new Error(`Invalid ISO datetime: "${iso}"`);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    throw new Error(`Invalid ISO datetime: "${iso}"`);
  }
}
