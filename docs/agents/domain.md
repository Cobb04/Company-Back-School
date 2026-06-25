# Domain Docs

This repo uses a single-context domain documentation layout.

## Before exploring, read these

- `CONTEXT.md` at the repo root, if present
- `docs/adr/`, if present, especially ADRs touching the area being changed

If these files do not exist, proceed silently. The domain model can be created lazily when terms or decisions get resolved.

## Use the glossary vocabulary

When naming domain concepts in issues, tests, refactors, or implementation notes, use terms from `CONTEXT.md`.

If a needed concept is missing, note it for `/domain-modeling`.

## Flag ADR conflicts

If a proposed change contradicts an existing ADR, call that out explicitly instead of silently overriding it.
