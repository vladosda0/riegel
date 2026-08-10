# AGENTS.md — `rovno` (application)

How AI agents (Claude Code, Codex, Cursor, Claude Cowork, etc.) work in this repository, **in addition to** Cursor project rules. These rules apply always. If a user request conflicts with them, **stop and confirm with the user before acting**.

---

## Instruction layering (read this first)

Apply guidance in this order when they conflict:

1. **`.cursor/rules/*.mdc`** — especially `alwaysApply: true` rules (source of truth, sensitive zones, preflight, subagent orchestration). These win.
2. **`.cursor/skills/**`** — invoke the matching `SKILL.md` when the task fits the skill description.
3. **`.cursor/agents/**`** — delegate via the **Task** tool when `subagent-orchestration` says to. Do not skip verification on non-trivial work.
4. **This `AGENTS.md`** — repo context, branch model, environments, file pointers, and habits the rules do not repeat.

**Semantic search** is for exploration; **exact search** prefers `rg` with narrow scope first (see `.cursor/rules/07-search-prefer-ripgrep.mdc`).

---

## 1. Repo purpose

Frontend / app workspace for Rovno:

- UI, routes, app state (including mock/demo paths where they still exist)
- Hooks, stores, domain screens
- Supabase client integration and **read-only** contract snapshot under `backend-truth/`

**Not authoritative:** database schema, SQL migrations, RLS, RPC definitions. Those live in **`rovno-db`**.

---

## 2. Branch model & deployment

| Branch | Purpose | Deploys to |
|---|---|---|
| `main` | **Production**. Protected from direct push. Only proven code. | `rovno.ai`, `стройагент.рф` (Timeweb Cloud Apps app `rovno`) |
| `dev` | **Staging / integration**. Feature branches converge here. | `*.twc1.net` staging URL (Timeweb app `rovno-staging`) |
| `feature/*`, `fix/*`, `chore/*`, `codex/*`, `claude/*`, `session-*/*` | Working branches. Created from `dev`, merged back via PR. | Not deployed (local build only). |

### Correct workflow

1. Branch from `dev`:
   ```bash
   git checkout dev && git pull --ff-only
   git checkout -b feature/short-name
   ```
2. Work, commit, push `feature/short-name` to origin.
3. Open PR **into `dev`** (never into `main`).
4. After staging URL passes review → human merges `dev → main` (via `npm run deploy` or PR through GitHub UI).
5. Push to `main` triggers prod deploy automatically.

### Hard prohibitions on git operations

- ❌ **Direct push to `main`.** Branch protection enforces this; do not attempt to circumvent.
- ❌ **Force-push** to any public branch (`main`, `dev`).
- ❌ **Delete or rename** `main`, `dev`.
- ❌ **Modify `supabase/config.toml`**, `supabase/migrations/`, or `supabase/functions/` without prior agreement (would break prod DB).

---

## 3. Environments

### Production — `https://rovno.ai`, `https://стройагент.рф`

- **Frontend**: Timeweb Cloud Apps app `rovno`, branch `main`, Node 20.
- **Database / Auth / Storage**: **self-hosted Supabase** on Timeweb VPS (URL in env). Real user data lives here.
- **Email**: Resend (`smtp.resend.com`), sender `noreply@rovno.ai`.
- **DNS**: GoDaddy for `rovno.ai`, Reg.ru for `стройагент.рф`.
- ⚠️ Any change here is visible to live users. Mistakes cost leads and trust.

### Staging — `*.twc1.net` (app `rovno-staging`)

- **Frontend**: Timeweb Cloud Apps app `rovno-staging`, branch `dev`, Node 20.
- **Database / Auth**: **Supabase Cloud** (project ref `aaycwobhdkrrgfxwcfxg`, eu-west-1). Separate DB with mocks/test data.
- **Email**: same Resend, low volume.
- ✅ Safe to break. Data may be wiped without notice.

### Local — `http://localhost:8080`

- `npm run dev` in `~/projects/rovno`.
- Default: Cloud Supabase (via `VITE_SUPABASE_URL` in `.env`).
- Optional: local Supabase Docker stack from `~/projects/rovno-db` (`supabase start`); update `.env` accordingly.

### How to know which environment you're in

1. **Env**: check `VITE_SUPABASE_URL`. `aaycwobhdkrrgfxwcfxg.supabase.co` = Cloud (staging/local). Timeweb VPS URL = self-hosted prod.
2. **UI**: staging shows yellow banner «STAGING — данные могут быть очищены». Prod has no banner.
3. **Browser console**: Supabase client logs `Connected to: <URL>` on init.

If unsure — **stop and ask the user**.

---

## 4. Source-of-truth hierarchy

1. SQL migrations in **`rovno-db`**
2. Generated mirror: **`backend-truth/`** in this repo (read-only; do not hand-edit)
3. Adapters / mappers
4. Frontend types and UI models
5. Mock / demo store shapes

Never treat UI or mock types as DB truth. If the contract is missing a field or RPC, stop and fix **`rovno-db`** first, then consume the updated mirror via the **automated GitHub sync PR** after `rovno-db` is on `dev`.

---

## 5. Required reading before edits

**Backend-shaped or data work**

- `backend-truth/generated/supabase-types.ts` — the compile-time source of truth. Generated from the
  committed migrations and imported by 19 files in `src/`, so schema drift fails `npm run typecheck`
  rather than reaching a user.
- The migrations themselves, in `~/projects/rovno-db/supabase/migrations/`. **This is the only
  complete picture.** An object's real definition is the result of every migration touching its name,
  in timestamp order — so before concluding anything about a table, policy, trigger or function,
  search for LATER migrations touching that same name.

> **`backend-truth/` is `generated/supabase-types.ts` plus its README and MANIFEST, and nothing
> else.** The `schema/`, `slices/`, `contracts/` and `sql/` families, and `generated/
> db-public-schema.ts`, were removed in rovno-db#106 (2026-08-04): nothing imported or cited them,
> and they were silently partial in a way they never admitted — 67 of 205 migrations excluded, RLS
> among them, so `workspace_documents` had real RLS policies in `rovno-db` and appeared in
> `rls-summary.json` not at all. If you find a stale copy in an old checkout, do not read it.
>
> The partiality applies to what survives, too: `supabase-types.ts` is generated from the same
> curated allowlist, so an object living only in an excluded migration is typed nowhere. It is
> load-bearing for drift detection, not a map of the schema. The migrations remain the only
> complete picture.

**App architecture**

- `src/hooks/use-mock-data.ts`, `src/data/store.ts`, `src/lib/permissions.ts`
- Relevant `src/data/*`, hooks, pages, components
- `src/integrations/supabase/client.ts` and `types.ts` when touching real seams

---

## 6. Database & migrations

- Migrations live in **`~/projects/rovno-db/supabase/migrations/`** (separate repo).
- Each migration is a SQL file with timestamp; **append-only**, applied migrations cannot be edited.

### Migration workflow

1. New migration: `supabase migration new <name>`
2. Write SQL.
3. Apply on **Cloud (staging) first**: `supabase db push --linked` (linked to Cloud).
4. Verify schema works with frontend on staging URL.
5. If OK — apply on **prod self-hosted**: `psql $PROD_DATABASE_URL -f supabase/migrations/<file>.sql`.
6. Commit migration file in `rovno-db` repo.

### Categorically forbidden

- ❌ Edit schema via **Supabase Studio UI directly** (staging or prod). Migrations only.
- ❌ `pg_dump prod | psql staging` or vice versa — never copy data between environments.
- ❌ `DROP TABLE`, `TRUNCATE`, `DELETE FROM ... WHERE true` without explicit user approval each time. Even on staging.

---

## 7. Edge Functions

- Sources in **`~/projects/rovno-db/supabase/functions/`**.
- Active: `ai-inference`, `send-project-invite`.

### Deployment

Always specify **explicit `--project-ref`**:

```bash
# Staging (Cloud)
supabase functions deploy <name> --project-ref aaycwobhdkrrgfxwcfxg

# Prod (self-hosted) — via wrapper
./scripts/deploy-prod-function.sh <name>
```

- ❌ Never deploy without explicit `--project-ref` — the CLI may target the last linked project, which could be prod.
- Always staging first, prod second.

---

## 8. Email & Auth

- **Email templates**: Supabase Dashboard → Authentication → Email Templates. Edited manually in UI for both environments. Current Confirm signup uses `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup` (branded link).
- **SMTP**: Resend, API key in Supabase SMTP settings. Never log or commit the key.
- **Redirect URLs**: `Authentication → URL Configuration` whitelist. Adding a new domain → add `https://newdomain/**` to both Supabase instances.

---

## 9. Planning and execution

- Plan first: files to touch, why, minimal surface (see `.cursor/rules/20-minimal-scope-change-and-reuse.mdc`).
- Non-trivial work: **inspect repo reality before edits**; separate product intent from implementation (`.cursor/rules/00-core-operating-boundary.mdc`).
- Use **slash commands** in `.cursor/commands/` when they match the moment (`/preflight`, `/ship-check`, `/rovno-contract-check`, etc.).
- Ambiguous requests: state assumptions explicitly; do not invent hidden behavior.
- **Stay in scope.** If asked to add a route, do not "also clean up" Landing.tsx.

---

## 10. Mock vs real

This repo mixes **real** integration and **mock/demo** paths. Classify before changing behavior (`.cursor/rules/40-mock-vs-real-boundary.mdc`, skill `mock-vs-real-boundary-check`). Do not silently turn mocks into production paths or remove fallbacks without an explicit request.

---

## 11. Verification before "done"

- Smallest relevant checks: `git diff` / `git diff --name-only`, `npm run build`, targeted `npm test` when appropriate.
- Use Cursor skill **`verification-and-regression-pass`** and/or **`rollback-aware-diff-review`** for non-trivial closeout.
- Optional Codex closeout: if available, `~/.codex/skills/finish-gate/SKILL.md` for structured handoff.

State what was verified and what was not.

---

## 12. Forbidden unless explicitly requested

- Dependency upgrades, broad refactors, mass renames
- Wiring Supabase through many pages at once
- **Manual edits to `backend-truth/`** or ad-hoc local regeneration of the mirror
- Inventing columns, tables, RPCs, or policies in app code
- Adding new npm dependencies (bundle bloat + security surface)
- Touching `.env` or env vars in Timeweb / Supabase / Resend dashboards

Mirror updates: **GitHub Actions sync PR** to `rovno` after `rovno-db` changes land on `dev`, not ad-hoc agent regeneration.

If `backend-truth/` was hand-edited as a rare unblock, **before closing** follow `.cursor/rules/11-backend-truth-emergency-closeout.mdc`: fix `rovno-db` (migrations, allowlist, verify + generator tests), **revert** all `backend-truth/` hand-edits here, then hand off noting the **sync PR** step.

---

## 13. Forbidden git/shell commands without explicit confirmation

- `git push --force` / `--force-with-lease` — except for own `feature/*`, `claude/*`, `codex/*` branches
- `git push origin <local>:main` — never
- `rm -rf` anywhere in repo
- `DROP DATABASE`, `DROP SCHEMA`, `TRUNCATE`, `DELETE FROM` without `WHERE` — never
- `supabase db reset` on a Cloud/prod-linked project — never
- Modifications to `package.json` `dependencies` / `devDependencies` without discussion

---

## 14. Git habits

- Human controls commits, merges, resets, reverts, branch deletes unless explicitly asked (see `.cursor/rules/00-core-operating-boundary.mdc`).
- Prefer small, single-intent commits; separate app logic from incidental noise per `.cursor/rules/06-generated-artifacts-and-local-noise.mdc`.

---

## 15. When to stop and escalate

Stop and summarize blockers if:

- Required contract pieces are missing from `backend-truth/`
- Demo vs real boundaries are unclear
- Multiple stores/models compete for ownership
- Change needs **`rovno-db`** work but that work is not done
- You broke prod or are unsure if you broke prod
- You see suspicious data (PII in logs, secrets in commits, strange SQL)

Use **subagents** rather than guessing (contract inspector, planner, sensitive-zone reviewer as appropriate).

If prod is broken / unsure → **immediately notify the user** describing what happened and which commands you ran. Do not attempt prod fix via `git revert`/force-push without confirmation. See `~/projects/rovno-demo-playbook.md` for rollback scenarios.

---

## 16. Quick reference

| Area        | Location |
|------------|----------|
| Contract   | `backend-truth/generated/supabase-types.ts` (+ `README.md`, `MANIFEST.json`); the full picture is `rovno-db/supabase/migrations/` |
| Permissions| `src/lib/permissions.ts` |
| Data entry | `src/data/store.ts`, `src/hooks/use-mock-data.ts` |
| Supabase   | `src/integrations/supabase/` |
| Cursor     | `.cursor/rules/`, `.cursor/skills/`, `.cursor/agents/`, `.cursor/commands/` |
| Deploy     | `scripts/deploy-to-prod.sh` (or `npm run deploy`) |
| Rollback   | `~/projects/rovno-demo-playbook.md` |

This repo **consumes** backend truth produced from `rovno-db/scripts/generate-backend-truth.mjs`.

---

**TL;DR**: feature-branch → PR into `dev` → check on staging → human merges `dev → main` → prod auto-deploys. When in doubt, ask.
