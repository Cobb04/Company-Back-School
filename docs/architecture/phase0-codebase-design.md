# Phase 0 Codebase Design

This document records the current Phase 0 module interfaces for Return School Planner after Issues #1-#7. The design goal is still the same: keep return-planning behavior behind small interfaces, keep deterministic decisions out of the UI, and make Phase 1 data-source work possible without rewriting planning rules.

## Current Module Shape

### Shared Domain Module

**Location:** `packages/shared/src/index.ts`

**Interface role:** shared vocabulary for server, planning core, and web.

Important exported types and constants:

```ts
export type RiskLevel = "low" | "medium" | "high";
export type Decision = "recommend" | "optional" | "not_recommended";
export type Preference = "price_sensitive" | "time_sensitive" | "balanced";

export interface TrainCandidate { /* ticket-source facts */ }
export interface ScoredTrain extends TrainCandidate { /* score, risk, reasons */ }
export interface ReturnPlan { /* selected train, summary, risks, checklist */ }
export interface LeaveSuggestion { /* whether to ask for leave and why */ }
export interface PlanEvaluateRequest { /* intern constraints */ }
export interface PlanEvaluateResponse { /* safe time, grouped trains, plans */ }

export const CITY_STATION_MAP: Record<string, string[]>;
export const XHS_STATION_ENTRY_TIMES: Record<string, number>;
export const EXTREME_SPEED_RISK_BUFFER = 5;
```

The shared module intentionally contains types and lookup constants only. It does not score trains, choose plans, call ticket sources, or generate UI text.

### Planning Core Module

**Location:** `packages/planning-core/src/index.ts`

**Interface role:** deterministic business rules.

Current public functions:

```ts
export function calculateSafeDepartureTime(input: SafeDepartureInput): SafeDepartureOutput;

export function calculateSafeDepartureDatetime(input: {
  departDate: string;
  clockOutTime: string;
  companyToStationMinutes: number;
  stationEntryBufferMinutes: number;
  riskBufferMinutes: number;
}): string;

export function scoreTrainCandidate(input: {
  train: TrainCandidate;
  safeDepartureDatetime: string;
  firstExamAt: string;
  stationToSchoolMinutes: Record<string, number>;
  preference: Preference;
}): ScoredTrain;

export function computeExtremeSpeedBuffers(departureStations: string[]): {
  riskBufferMinutes: number;
  stationEntryBufferMinutes: number;
  xhsStationsUsed: string[];
  xhsStationTimes: Record<string, number>;
};

export function buildReturnPlans(input: {
  scoredTrains: ScoredTrain[];
  safeDepartureDatetime: string;
  firstExamAt: string;
  preference: Preference;
}): {
  plans: ReturnPlan[];
  leaveSuggestion: LeaveSuggestion;
  selectedTrain: ScoredTrain | null;
  allScoredTrains: ScoredTrain[];
};

export function generateLeaveMessage(input: GenerateLeaveMessageInput): GenerateLeaveMessageOutput;
```

Hidden implementation includes time parsing, cross-midnight arithmetic, score weighting, risk derivation, two-pass leave evaluation, leave-adjusted train modeling, checklist generation, and deterministic leave-message templates.

Planning core has no HTTP, browser, real ticket-source, LLM, or filesystem dependency.

### Plan Evaluator Module

**Location:** `server/src/services/planEvaluator.ts`

**Interface role:** primary deep module for server-side planning.

```ts
export async function evaluateReturnPlan(
  request: PlanEvaluateRequest,
  dependencies: { ticketSource: TicketSource },
): Promise<PlanEvaluateResponse>;
```

Hidden implementation:

1. Expand departure and destination cities into stations.
2. Apply normal or extreme-speed buffers.
3. Calculate safe departure datetime.
4. Query the injected `TicketSource`.
5. Score every candidate.
6. Build return plans and leave suggestion.
7. Group trains using the coherent scored-train set returned by `buildReturnPlans`.

This is the main seam for Phase 1 real ticket-source work. A new adapter should satisfy `TicketSource`; it should not change planning core or web scoring logic.

### Ticket Source Adapter

**Location:** `server/src/adapters/mockTicketSource.ts`

Phase 0 adapter:

```ts
export const mockTicketSource: TicketSource;
```

The mock adapter loads `examples/shanghai-yantai.json`, filters by departure station, arrival station, and `departDate`, and returns `TrainCandidate[]`.

The adapter seam is justified because Phase 0 has a mock source and Phase 1 is expected to evaluate a real source such as FlyAI, 12306, or another provider.

### HTTP Routes

**Location:** `server/src/index.ts`

Current routes:

- `GET /health`
- `POST /api/plan/evaluate` — primary endpoint.
- `POST /api/plan/leave-message` — deterministic message endpoint.
- `POST /api/plan/safe-departure` — deprecated since S3.
- `POST /api/train/search` — deprecated since S3.

Route responsibilities:

- validate request shape and primitive fields;
- call the relevant planning module;
- translate errors into HTTP responses.

Routes should remain shallow. They should not call other routes over HTTP and should not duplicate scoring or plan-selection rules.

### Web App

**Location:** `apps/web/src/App.tsx`

The Phase 0 web app is intentionally compact and single-screen. It owns form state, API calls, mobile layout, and copy/checklist interactions. It does not recompute train scores, risk levels, return plans, or leave suggestions.

Current UI capabilities:

- intern constraint form;
- advanced buffer settings;
- non-recommended extreme speed mode toggle;
- plan summary;
- train comparison table on desktop;
- train cards on narrow screens;
- leave suggestion banner;
- collapsible action area;
- deterministic leave-message generation and copy button;
- checklist state.

## Deliberate Boundaries

- **No real ticket data in Phase 0.** Train facts come from `examples/shanghai-yantai.json`.
- **No LLM in Phase 0.** Leave messages are deterministic string templates.
- **No 12306/FlyAI/XHS live calls in planning core.** Future live data must enter through adapters and normalized shared types.
- **No UI-side decision logic.** The web app can validate form fields and display results, but decisions come from `planning-core` through `evaluateReturnPlan`.
- **No route-to-route orchestration.** `/api/plan/evaluate` calls the deep module directly.

## Review Notes After Phase 0

The overall module shape is healthy enough to continue into Phase 1. The strongest module is `evaluateReturnPlan`: one caller-facing interface hides multi-station expansion, ticket-source access, safe-departure calculation, scoring, two-pass planning, grouping, and response shaping.

Known cleanup opportunities:

- `server/src/index.ts` repeats request validation between deprecated `/api/train/search` and primary `/api/plan/evaluate`. This is acceptable while deprecated routes remain, but should be reduced before adding more endpoints.
- `apps/web/src/App.tsx` is now large because Phase 0 kept the UI in one file. Before adding Phase 1 UI features, extract form, result, train list, and action area modules.
- `PlanEvaluateResponse.extremeSpeedMode` is now always present; keep that contract stable and do not reintroduce `null`.
- Deprecated endpoints should be removed after their sunset date if no caller still depends on them.

## Testing Strategy

Use these public interfaces as test surfaces:

- `calculateSafeDepartureTime` and `calculateSafeDepartureDatetime` for time rules.
- `computeExtremeSpeedBuffers` for extreme-speed buffer rules.
- `scoreTrainCandidate` for scoring and risk behavior.
- `buildReturnPlans` for two-pass leave suggestion and plan generation.
- `generateLeaveMessage` for deterministic copy generation.
- `evaluateReturnPlan` for the end-to-end server planning path using a fake `TicketSource`.
- `/api/plan/evaluate` and `/api/plan/leave-message` for HTTP integration.

Avoid tests that assert private helper names, internal route order, or implementation-only formatting.
