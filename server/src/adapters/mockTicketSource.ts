// ============================================================
// Return School Planner — Mock Ticket Source Adapter
// ============================================================
// Phase 0 mock adapter. Implements TicketSource using static
// JSON data from examples/shanghai-yantai.json.
// Phase 1 will replace this with mcp12306TicketSource.
// ============================================================

import type { TicketSource, TrainCandidate } from "@return-school/shared";
import mockData from "../../../examples/shanghai-yantai.json" with { type: "json" };

/** All trains loaded from the mock data file. */
const MOCK_TRAINS: TrainCandidate[] = mockData as unknown as TrainCandidate[];

/**
 * Mock implementation of TicketSource.
 *
 * Searches the static JSON file for trains matching the given stations.
 * Phase 0 only — replace with 12306-mcp adapter in Phase 1.
 */
export const mockTicketSource: TicketSource = {
  async searchTrainCandidates(params) {
    const { fromStations, toStations, departDate } = params;

    return MOCK_TRAINS.filter(
      (t) =>
        fromStations.includes(t.departureStation) &&
        toStations.includes(t.arrivalStation) &&
        t.departureTime.startsWith(departDate),
    );
  },
};
