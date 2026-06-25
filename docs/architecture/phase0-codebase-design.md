# Phase 0 Codebase Design

This document defines the Phase 0 module interfaces for Return School Planner. The goal is to keep calculation, scoring, and planning behaviour behind small interfaces that are easy for agents to test and extend.

## Design Goals

- Put most return-planning behaviour behind one deep module interface.
- Keep deterministic planning separate from the expression layer.
- Avoid duplicating time and scoring rules between web and server.
- Make Phase 0 mock data replaceable by 12306-mcp in Phase 1 without changing planning code.
- Test observable behaviour through public interfaces, not private helpers.

## Recommended Module Shape

### Shared Domain Module

**Location:** `packages/shared/src`

**Interface:**

```ts
export type SeatStatus = "available" | "waitlist" | "sold_out" | "unknown";
export type RiskLevel = "low" | "medium" | "high";
export type Decision = "recommend" | "optional" | "not_recommended";
export type Preference = "stable" | "less_leave" | "cheap" | "easy";

export interface TrainCandidate { /* domain fields only */ }
export interface ScoredTrain extends TrainCandidate { /* score, riskLevel, decision, reasons */ }
export interface LeaveSuggestion { /* needLeave, leaveText, estimatedLeaveDays */ }
export interface ReturnPlan { /* title, train, summary, risks, checklist */ }
export interface PlanEvaluateRequest { /* intern inputs and constraints */ }
export interface PlanEvaluateResponse { /* safeDepartureTime, grouped trains, plans */ }
```

**Why this is deep enough:** callers learn one stable vocabulary for web and server. It prevents the web app from depending on `server/src/types`, which would make the server directory a fake shared module.

### Planning Core Module

**Location:** `packages/planning-core/src`

**Interface:**

```ts
export function calculateSafeDepartureTime(input: {
  offWorkTime: string;
  commuteMinutes: number;
  stationEntryBufferMinutes: number;
  riskBufferMinutes: number;
}): string;

export function scoreTrainCandidate(input: {
  train: TrainCandidate;
  safeDepartureTime: string;
  firstExamAt: string;
  stationToSchoolMinutes: Record<string, number>;
  preference: Preference;
}): ScoredTrain;

export function buildReturnPlans(input: {
  scoredTrains: ScoredTrain[];
  safeDepartureTime: string;
  firstExamAt: string;
  preference: Preference;
}): ReturnPlan[];
```

**Hidden implementation:** time parsing, cross-day arithmetic, school arrival time, exam buffer, hard eliminations, score deductions, preference weighting, grouped reasons, leave suggestion triggers, and default checklist generation.

**Dependency category:** in-process. No adapter is needed here.

**Test surface:** pure tests on these exported functions are valid because these interfaces are used directly by the server and, for safe departure preview, by the web app.

### Plan Evaluator Module

**Location:** `server/src/services/planEvaluator.ts`

**Interface:**

```ts
export interface TicketSource {
  searchTrainCandidates(query: {
    fromStation: string;
    toStations: string[];
    departDate: string;
    trainTypes: string[];
  }): Promise<TrainCandidate[]>;
}

export async function evaluateReturnPlan(
  request: PlanEvaluateRequest,
  dependencies: {
    ticketSource: TicketSource;
  },
): Promise<PlanEvaluateResponse>;
```

**Hidden implementation:** querying train candidates, merging multi-station results, calculating safe departure time, scoring candidates, grouping scored trains, building return plans, and shaping the API response.

**Dependency category:** true external once Phase 1 introduces 12306-mcp. The `TicketSource` interface is justified because Phase 0 needs a mock adapter and Phase 1 needs a 12306-mcp adapter.

**Test surface:** most server tests should cross this interface with a fake `TicketSource`, not test route internals or private scorer helpers.

### Ticket Source Adapters

**Locations:**

- `server/src/adapters/mockTicketSource.ts`
- `server/src/adapters/mcp12306TicketSource.ts`

**Interface implemented:** `TicketSource`

**Rules:**

- Phase 0 uses `mockTicketSource` backed by `examples/shanghai-wuhan.json`.
- Phase 1 adds `mcp12306TicketSource`.
- Planning modules never know whether a Train Candidate came from mock data or 12306-mcp beyond the `source` field.

### API Route Modules

**Locations:**

- `server/src/routes/train.ts`
- `server/src/routes/plan.ts`

**Interface:** HTTP only.

**Rules:**

- `/api/plan/evaluate` calls `evaluateReturnPlan` directly.
- `/api/plan/evaluate` must not call `/api/train/search` over HTTP from inside the server.
- Routes should stay shallow: validate request, call the deep module, return response.

### Web Modules

**Locations:**

- `apps/web/src/pages/Home.tsx`
- `apps/web/src/pages/Result.tsx`
- `apps/web/src/components/*`
- `apps/web/src/api/client.ts`

**Rules:**

- The input page may call `calculateSafeDepartureTime` for local preview.
- Full evaluation comes from `/api/plan/evaluate`.
- UI modules should present Return Plans, Scored Trains, Leave Suggestions, and Checklists. They should not recompute decisions.

## Rejected Shallow Designs

### Server types as shared types

Rejected because it makes the web app depend on the server directory. Shared domain vocabulary belongs in `packages/shared`.

### Route-to-route server calls

Rejected because `/api/plan/evaluate` calling `/api/train/search` over HTTP would move orchestration into transport. The server should call the Plan Evaluator module directly.

### Separate public helpers for every calculation step

Rejected because it makes the caller assemble the domain workflow. Time helpers can exist internally, but callers should mostly cross `calculateSafeDepartureTime`, `scoreTrainCandidate`, `buildReturnPlans`, or `evaluateReturnPlan`.

### LLM as a planning dependency

Rejected for Phase 0-2. The expression layer is not part of deterministic planning. In Phase 3, any LLM interface should be injected behind a separate expression-layer interface and consume only already-computed results.

## Testing Strategy

Use these public interfaces as test surfaces:

- `calculateSafeDepartureTime` for the live preview rule.
- `scoreTrainCandidate` for G1/G2 scoring behaviour.
- `buildReturnPlans` for leave suggestion and plan generation.
- `evaluateReturnPlan` for the end-to-end server planning path using a fake `TicketSource`.
- `/api/plan/evaluate` for a thin HTTP integration test.

Avoid tests that assert private helper names, internal time parsing details, or route-to-route call order.
