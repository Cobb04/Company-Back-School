# Plan Evaluator as the primary planning interface

Phase 0 should concentrate return-planning behaviour behind a `evaluateReturnPlan` module interface rather than making route handlers manually orchestrate train search, safe departure time calculation, scoring, grouping, and plan generation. This gives tests and callers one high-leverage interface, keeps HTTP transport shallow, and lets Phase 1 swap mock data for a real ticket-source adapter through the `TicketSource` interface without changing deterministic planning code.
