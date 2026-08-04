---
name: backend-contract-inspection
description: Inspect backend truth and frontend contract boundaries before proposing or implementing backend-related changes. Use when tasks mention Supabase, schema, auth, storage, RLS, policies, RPCs, backend-truth, or when UI behavior appears to conflict with backend contract.
---

# Backend Contract Inspection

## Purpose

Determine whether requested behavior already exists in backend truth, requires frontend wiring only, or requires a backend change in `rovno-db`.

## Use when

- The task mentions Supabase, schema, auth, storage, RLS, policies, RPCs, or `backend-truth`.
- A frontend change needs new fields or behaviors from the backend.
- UI and current schema appear to conflict.

## Instructions

1. Classify ownership first. Decide whether the requested change belongs to:
   - `rovno-db`
   - `backend-truth/` (read-only generated snapshot)
   - frontend adapters/mappers
   - frontend UI only
2. Inspect sources in this order:
   - migrations in `rovno-db` (if available) — the only complete picture
   - `backend-truth/generated/supabase-types.ts` (the only generated artifact;
     the schema/slices/contracts families were removed in rovno-db#106)
   - frontend adapters/mappers
   - UI usage points
3. Decide one outcome:
   - backend already supports this
   - frontend contract exists but wiring is missing
   - backend contract is missing and must be added in `rovno-db`
4. If backend contract is missing, stop and state it clearly.
5. Never propose direct edits to `backend-truth/` except through the sync/generation workflow.

## Output format

Use exactly these sections:

1. Requested capability
2. Existing backend evidence
3. Existing frontend seam
4. Gap analysis
5. Correct repo for the change
6. Minimal next implementation path

## Hard rules

- Schema wins over UI assumptions.
- No hand-edits to `backend-truth/`.
