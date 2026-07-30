# Stop report — portable snippet for `~/.claude/CLAUDE.md`

Repo-agnostic version of `.cursor/rules/55-stop-report-and-next-step.mdc`. Copy the block below into `~/.claude/CLAUDE.md` (user memory) so the format applies in every project, not just `rovno`. `.claude/` is gitignored here, so it cannot be committed — this file is the source to copy from.

Keep the two in sync when either changes. The repo rule is canonical for `rovno`-specific detail (branch model, `backend-truth/` blockers); this snippet stays generic.

---

```markdown
## Stop reports

Every turn that hands control back to me ends with a report. Two formats — never blended:

- **Full session report** — epics, multi-task coding sessions, long or autonomous runs (unattended
  code-writing routines, batch work). Long form, as before.
- **Compact stop report** — the default for everything else: small follow-ups, a pause while a
  subagent or adversarial audit finishes, audit results, research steps, one targeted fix, a
  question answered. When unsure which format applies, use this one.

### Compact skeleton

Bold inline labels, no headings, no tables. This order. **Omit any section that would be empty** —
an omitted section is information, a padded one is noise. Write it in the language I'm writing in.

**Работаем над:** goal + where it lives (branch / repo / PR). Only when I may have lost the thread:
first stop after a plan or task switch, after a wait (subagent, audit, CI) or a long turn, branch or
environment changed, or more than a couple of exchanges since the goal was named. Skip it in a tight
back-and-forth where my own last message named the subject.
**Сделано:** what actually changed, as facts, with `path/to/file.ts:42` where it helps.
**Состояние:** shippable / needs work / broken, plus what was verified and what was not. Only when
there is state I cannot see: uncommitted or unpushed work, an open PR, checks that failed or were
never run, background work still running, deploy state changed. Skip on read-only work that left the
tree clean.
**Ждём:** what is in flight and what happens when it returns. Pause stops only — 2–4 lines total,
and say plainly if nothing is needed from me.
**Вопросы:** decisions or answers that must come from me. Real blockers only.
**Дальше:** the next step, with a command if there is one.

### Length

No fixed line count, but every line earns its place:

- Cut restatements of my request, recaps of what you already said this turn, and process narration.
- Facts over adjectives: "3 tests fail in `estimate-sync.test.ts`", not "there are some issues".
- One clause per bullet; if it needs a "but", split it or move the caveat to **Состояние**.
- Don't list what you considered and rejected unless I asked for options.

### Next step — command priority

**Дальше** names **one** command (two only for a genuine fork). Never a menu.

Work genuinely finished — verified in scope, **Вопросы** empty — recommend the release commands,
which wrap the whole ritual (checks, commit, PR, merge, deploy ordering):

- `/release-dev` — ready for staging.
- `/release-prod` — staging was checked, ready for production. Never before staging.
- `/db-prod` — database / migration work ready for the production DB. Staging DB first.

Suggesting `/commit-push` → `/open-pr` → `/merge` as a sequence instead of a release command is a
downgrade. The raw steps are the **fallback**, and the report must say why release mode does not
apply:

- Work unfinished, checkpoint worth saving → `/commit-push`.
- Review or CI feedback needed before merge → `/open-pr`.
- Release path blocked (pending contract/mirror sync, migration not applied on staging, verification
  failed) → name the blocker, then the step that is safe now.
- A PR is already open and only the merge remains → `/merge`.
- Non-standard flow the release commands don't cover (hotfix, revert, branch surgery), or I asked
  for a specific git step.

Never recommend a release command in a report that still carries an open **Вопросы** item or an
unverified critical assumption — that contradicts itself.

Not every stop needs a command. Research answers, audits, and pauses usually end with a plain next
step or with nothing. A git command when nothing changed is noise.
```
