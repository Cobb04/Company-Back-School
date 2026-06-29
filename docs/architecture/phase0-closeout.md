# Phase 0 Closeout

Phase 0 is the first complete vertical slice of Return School Planner. It proves that an off-site intern can enter work, travel, and exam constraints on a phone and receive a deterministic return plan, train comparison, leave suggestion, leave message, and checklist.

## Completed Capabilities

The product now supports:

- entering departure city, destination city, preference, clock-out time, company-to-station minutes, station-to-school minutes, departure date, and earliest exam time;
- advanced station-entry and risk buffer settings;
- a non-recommended extreme speed mode that reduces risk buffer to 5 minutes and uses hardcoded station-entry data;
- safe departure time calculation with cross-midnight handling;
- mock train search across all known stations in a city;
- deterministic train scoring by price, duration, comfort, exam buffer, and safe-departure risk;
- grouped train comparison: recommend, optional, and not recommended;
- return-plan generation with primary and alternative plans;
- two-pass leave suggestion that compares normal departure against leave-adjusted options;
- deterministic leave-message generation from selected train facts;
- copy-to-clipboard behavior;
- checklist display and local checked state;
- mobile-first layout with train cards on narrow screens.

## Current Boundaries

Phase 0 intentionally does not include:

- live 12306 data;
- FlyAI or any other real travel inventory provider;
- live Xiaohongshu scraping;
- LLM-generated decisions or plans;
- LLM-generated leave copy;
- maps/geocoding for company-to-station or station-to-school travel times;
- authentication, persistence, saved plans, or user accounts;
- production deployment work.

These omissions are product boundaries, not missing implementation details.

## Mock Data

Phase 0 uses `server/src/adapters/mockTicketSource.ts`, backed by `examples/shanghai-yantai.json`.

The mock dataset contains 12 trains for `2026-06-26`:

- departure stations: 上海虹桥, 上海站, 上海南站;
- arrival stations: 烟台站, 烟台南站;
- train types: G, D, K;
- prices: 135-520 yuan;
- durations: 260-660 minutes;
- seat states: available, waitlist, sold_out.

The adapter filters by:

- departure station list expanded from the departure city;
- arrival station list expanded from the destination city;
- exact departure date derived from the candidate's `departureTime`.

Because the data is static, Phase 0 results are deterministic and should not be interpreted as live availability or live prices.

## Risk Assumptions

The risk model is deliberately simple:

- default station-entry buffer: 30 minutes;
- default risk buffer: 15 minutes;
- extreme speed risk buffer: 5 minutes;
- exam buffer at least 120 minutes: low risk before safe-departure adjustment;
- exam buffer 60-119 minutes: medium risk;
- exam buffer under 60 minutes: high risk;
- departure before safe departure time bumps risk one level;
- score penalty for departure before safe time: -20;
- score penalty for exam buffer under 60 minutes: -15;
- score penalty for exam buffer 60-119 minutes: -5.

Extreme speed mode is marked "不推荐" because it deliberately reduces buffers. Phase 0 uses the conservative maximum XHS-style station-entry time across the supported departure stations, not the fastest station's minimum time, so one station's faster entry time is not incorrectly applied to slower stations.

## Architecture Review

### What Is Working

- `evaluateReturnPlan` is the correct primary interface. It hides city expansion, ticket-source access, safe-departure calculation, scoring, grouping, and plan selection behind one server-side module.
- `TicketSource` is a real seam. Phase 0 has `mockTicketSource`; Phase 1 can add a real adapter without changing planning core.
- `planning-core` owns deterministic decisions. The web app displays results rather than recalculating scores or leave advice.
- The `PlanEvaluateResponse.extremeSpeedMode` contract is now always-present with `active: false` when disabled, which is cleaner than `object | null`.
- Phase 0 has regression tests for the two bug-prone areas found during review: timezone-safe date offsets and station-level XHS buffer aggregation.

### Cleanup Already Done

- Removed `| null` from `PlanEvaluateResponse.extremeSpeedMode`.
- Corrected `safeDepartureTime` documentation to "HH:mm" display format instead of ISO datetime where the API returns a display value.
- Updated domain wording to reflect Phase 0's deterministic leave-message template and mock ticket source.

### Deferred Cleanup

- Extract shared request validation helpers from `server/src/index.ts` before adding new endpoints.
- Split `apps/web/src/App.tsx` into smaller UI modules before adding Phase 1 UI work.
- Remove deprecated `/api/plan/safe-departure` and `/api/train/search` after their sunset if no caller depends on them.
- Decide whether Phase 1 real ticket data comes from FlyAI, 12306, manual import, or another adapter; do not couple planning core to that choice.

## Phase 1 Entry Criteria

Before starting Phase 1 feature work, keep these invariants:

- `bun test` passes.
- `apps/web` build passes.
- `PlanEvaluateResponse` remains the primary web response contract.
- No LLM or external data source is allowed to invent train facts, risk levels, or decisions.
- New data sources must normalize into `TrainCandidate` through a `TicketSource` adapter.
