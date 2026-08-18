# V11.6.1 → Sanad V12.5 Capability Audit

## Executive verdict

**Sanad V12.5 is architecturally better than V11.6.1, but it is NOT yet 100% feature-parity with V11.6.1.**

Audit basis:
- Legacy baseline: `superagent-v11-6-1-clean/worker.js`
- New baseline: `sanad-v12-5-full-life/Sanad_V12_5_FULL.js`
- V12.5 certification: 64 tools, 3 models, 19/19 live scenarios, zero syntax/TypeScript diagnostics and zero known critical failures *inside the current certification matrix*.

This audit intentionally does **not** treat “table exists”, “tool name exists”, or “CI is green” as proof of feature parity. A capability is counted as full only when the behavior is represented end-to-end.

### Scorecard — 64 parity checks

- ✅ **34 Full / equal-or-better**
- 🟡 **12 Partial / behavior changed**
- ❌ **13 Missing from V12.5**
- ⚠️ **5 Parity blockers / correctness risks that must be closed before claiming 100% parity**

So the right description today is:

> **V12.5 = much stronger Agent core + most V11 life-management domains, but not a lossless replacement for every V11 behavior yet.**

---

# 1. Agent brain, reliability and execution

| # | Capability | V11.6.1 | V12.5 | Result |
|---|---|---|---|---|
| 1 | One coherent Agent brain | Regex/handlers + deterministic engines + AI | Single `runAgent` brain | ✅ Improved |
| 2 | 3-model failover | Yes | Yes, same Gemini chain | ✅ Full |
| 3 | Egyptian natural language | Yes, mixed deterministic/AI | Model-first natural Agent | ✅ Improved |
| 4 | Multi-intent in one message | Multiple special compound handlers | Native multi-step plan | ✅ Improved |
| 5 | Durable Telegram inbox | `telegram_inbox_v106` | `sanad_inbox` | ✅ Full |
| 6 | Per-chat serialization | D1 chat leases | D1 chat leases | ✅ Full |
| 7 | Telegram update idempotency | Update ledger + receipts | Update ledger + per-step receipts | ✅ Improved |
| 8 | Mutation read-back verification | Strong in newer paths, inconsistent in old paths | General tool contract | ✅ Improved |
| 9 | Repair loop | Several repair/canonicalization layers | Explicit Agent Repair Loop | ✅ Improved |
| 10 | Goal-completion check | Multiple special guards | Goal Completion Gate | ✅ Improved |
| 11 | Atomic compound operation idea | Several transaction/rollback paths | Durable pre-operation snapshot | ✅ Improved conceptually |
| 12 | Atomic rollback covers **all** mutation domains | Legacy paths varied by feature | Snapshot excludes `sanad_users`, shopping sessions, fire ledgers, etc. | ⚠️ Blocker |

### Blocker A — atomicity is not universal

`SNAPSHOT_TABLES` contains 12 business tables, but excludes at least:
- `sanad_users` (profile + settings)
- `sanad_shopping_sessions`
- reminder/recurrence/prayer fire ledgers
- conversation history
- proactive/daily-brief fire state

Therefore a compound request such as **“غير مدينتي وبعدها اعمل عملية تانية”** can mutate profile/settings and later fail, while rollback restores only the snapshot tables. The current “atomic multi-tool mutations” claim is therefore stronger than the actual rollback coverage.

Required closure: either include all reversible user state in the operation snapshot or make non-snapshotted mutations independent/compensatable and prove that in tests.

---

# 2. Shopping

| # | Capability | V11.6.1 | V12.5 | Result |
|---|---|---|---|---|
| 13 | Add/read/update/remove shopping | Yes | Yes | ✅ Full |
| 14 | Shopping read-after-write proof | Newer V11 path yes, older path inconsistent | General verifier | ✅ Improved |
| 15 | Shopping session start/finish | Yes | Yes | ✅ Full |
| 16 | Progress/count | Yes | Yes | ✅ Full |
| 17 | Interactive checklist | Yes | Yes, toggle pending/bought | ✅ Full |
| 18 | `pending` / `bought` states | Yes | Yes | ✅ Full |
| 19 | `unavailable` state (“ملقتش”) | Yes | Tool contract does not support it | ❌ Missing |
| 20 | `skipped` state (“سيبها / مش هجيبها”) | Yes | Tool contract does not support it | ❌ Missing |
| 21 | Important/category shopping query semantics | Dedicated V11 plan/query behavior | Can be inferred by Agent from raw items, no dedicated query contract | 🟡 Partial |
| 22 | Shopping migration fidelity | Preserves 4 statuses in V11 | Migration maps everything except `bought` to `pending` | 🟡 Data-loss risk |

V11 explicitly supported `pending`, `bought`, `unavailable`, and `skipped`, including natural phrases inside an active shopping session. V12.5 currently exposes only `pending|bought` through `shopping.update` and legacy migration collapses the other states.

---

# 3. Reminders, appointments, calendar and recurrence

| # | Capability | V11.6.1 | V12.5 | Result |
|---|---|---|---|---|
| 23 | One-time reminders | Yes | Yes | ✅ Full |
| 24 | Appointment duration | Yes | Yes | ✅ Full |
| 25 | Advance alerts | Yes | Yes, multiple offsets | ✅ Full |
| 26 | Conflict detection | Yes | Yes | ✅ Full |
| 27 | Free-time search | Yes | Yes | ✅ Full |
| 28 | Schedule search | Yes | Yes | ✅ Full |
| 29 | Snooze engine | Yes | Yes | ✅ Full |
| 30 | Reminder inline buttons: Done / +10m / +1h | Yes | Delivered reminders are plain text; callback handler only implements shopping toggle | 🟡 Partial UX regression |
| 31 | Universal recurrence creation | Yes | Yes: minutes/hours/days/weeks/months/years | ✅ Full |
| 32 | Recurrence skip exception | Yes | Yes | ✅ Full |
| 33 | Recurrence cancel | Yes | Yes | ✅ Full |
| 34 | Pause/resume basic | Yes | Yes | ✅ Full |
| 35 | **Temporary pause until a date/time** | V11 stores `paused_until` and supports “pause one day / until …” | V12 pause tool only flips `active`; no `pause_until` argument | ❌ Missing |
| 36 | Full recurrence editing | Rich V11 schedule management | V12 update covers title/rule/end/max but not all lifecycle fields | 🟡 Partial |
| 37 | Shift one-time reminder | Yes | Yes | ✅ Full |
| 38 | Bulk shift one-time reminders | Yes | Yes | ✅ Full |
| 39 | Shift recurring rules/occurrences as first-class schedule targets | Broader schedule-rule management in V11 | `schedule.shift` explicitly returns `shift_only_one_time_supported` for non-reminders | 🟡 Partial |
| 40 | Pending conflict resolution state | `pending_conflicts` + force callback flow | No structured pending-conflict table/flow | 🟡 Partial |

V11 also had deterministic conflict follow-up/force interactions. V12 can return `schedule_conflict` and the Agent may reason around it, but the stateful conflict-resolution UX is not equivalent yet.

---

# 4. Dependencies and linked schedule behavior

| # | Capability | V11.6.1 | V12.5 | Result |
|---|---|---|---|---|
| 41 | Create/read/remove dependencies | Yes | Yes | ✅ Full basic |
| 42 | `after_start` relationship | Yes | Collapsed into generic `after` | 🟡 Partial |
| 43 | `after_end` relationship | Yes, duration-aware | Not represented | ❌ Missing |
| 44 | `before_start` relationship | Yes | Not represented | ❌ Missing |
| 45 | Dependency offset semantics | Recomputes target from source relation + offset | V12 mostly shifts target by source delta | 🟡 Weaker semantics |
| 46 | Dependency cycle detection | Explicit `dependencyGraphHasCycle` + self-tests | Only self-link guard found; no graph cycle guard | ❌ Missing |
| 47 | Dependency propagation | Recursive propagation | Recursive propagation for reminders | ✅ Basic |
| 48 | Canonicalization/dedup of dependency graph | Explicit V11 canonicalization | Simple DB uniqueness / no equivalent canonical graph layer | 🟡 Partial |

This is one of the biggest parity gaps. V11 could model things like:
- “B starts 30 minutes after A ends”
- “C is 1 hour before A starts”
- reject A→B→A loops

V12.5 cannot honestly be called dependency-feature-complete until those semantics return as clean Agent tools/guards.

---

# 5. Memory, world model, projects and life organization

| # | Capability | V11.6.1 | V12.5 | Result |
|---|---|---|---|---|
| 49 | Long-term memories | Yes | Layered typed memories | ✅ Improved |
| 50 | Personal entities/world graph | Yes | Yes | ✅ Full |
| 51 | World relationships/edges | Yes | Yes at runtime | ✅ Full |
| 52 | Reject low-confidence inferred world facts | V11 normalizer drops low-confidence updates | V12 `world.upsert/link` accept clamped confidence without a minimum trust guard | 🟡 Partial safety regression |
| 53 | Projects | Yes | Yes | ✅ Full |
| 54 | Project tasks | Yes | Yes + structural project/task guard | ✅ Improved |
| 55 | Waiting-for list | Yes | Yes | ✅ Full |
| 56 | Personal **Life Inbox** (“حط دي في الانبوكس”) | Dedicated `life_inbox` table + panel/commands | No V12 equivalent | ❌ Missing |

The Life Inbox matters because it is different from reminders, waiting items, projects, or memory: it is an **unprocessed capture bucket**. That “dump it now, organize later” workflow disappeared.

---

# 6. Location, prayer, Hijri, holidays, live reality, voice and proactivity

| # | Capability | V11.6.1 | V12.5 | Result |
|---|---|---|---|---|
| 57 | Per-user location/timezone | Yes | Yes | ✅ Full |
| 58 | Prayer times | Yes | Yes | ✅ Full |
| 59 | Prayer-relative reminders/rules | Yes | Yes | ✅ Full |
| 60 | Hijri date + Islamic occasion detection | Yes (`hijri`, `hijriOccasion`) | Prayer tool strips Hijri payload; no Hijri capability | ❌ Missing |
| 61 | Public holidays | Yes + Arabic labels | Yes, raw holiday API data | 🟡 Partial: Arabic labeling lost |
| 62 | Weather | Yes/live reality integration | Dedicated `weather.read` | ✅ Full |
| 63 | Live news + persistent watches | Yes | Yes | ✅ Full |
| 64 | Composite “live reality” summary (time + place + Hijri + Islamic occasion + prayers + holidays + live context) | Dedicated V11 experience | `/live` only tells user to ask for news; domains exist separately | 🟡 Partial |

---

# Important findings outside the 64-row score

These are not counted twice in the scorecard, but they materially affect a “100% replacement” claim.

## A. Telegram interaction parity is not complete

V11 callback layer included:
- reminder `done`, `+10m`, `+1h`
- recurrence toggle / skip / pause-one-day / resume
- prayer toggle / skip / delete
- settings toggles
- conflict force
- bulk confirmation
- shopping controls

V12.5 callback handler currently implements **shopping toggle only**. The underlying text tools cover some of those actions, but the Telegram product experience is not parity-complete.

## B. Voice exists, but V11 hardening was not fully carried forward

V11 voice path explicitly enforced:
- max file size
- bounded total STT budget
- per-provider timeouts
- fallback timing

V12.5 defines `VOICE_MAX_BYTES` but the constant is not used in the current transcription function, and the voice network calls are not wrapped in the same bounded timeout structure. Voice capability exists, but its reliability hardening regressed.

## C. `system.clear_all` is not actually “all user data”

V11 `clearEverythingV105` deleted profile/settings, conversation messages, life inbox, projects, waiting, shopping, world graph, rules, fire state, etc.

V12.5 `system.clear_all` deletes only `SNAPSHOT_TABLES`. It leaves items such as:
- `sanad_users` profile/settings
- conversation history
- fire ledgers
- shopping sessions
- operation snapshots/audit history
- proactive/brief fire records

So **“امسح كل حاجة وابدأ من الصفر” is not parity-safe today**.

## D. Legacy V11 migration is best-effort, not lossless

The current V12 migration handles major data sets, but these parity gaps were found:

1. `agent_settings` are not migrated → brief/proactive/delete preferences can reset.
2. `life_inbox` is not migrated.
3. `event_dependencies` are not migrated.
4. `life_edges` are not migrated → entities migrate, relationships do not.
5. `project_tasks.project_id` is copied while projects receive newly generated IDs → relationship integrity depends on legacy/new ID coincidence and is not formally mapped.
6. schedule/reminder/prayer fire ledgers are not migrated → duplicate delivery risk around the cutover window.
7. legacy audit/undo history is not migrated.
8. shopping migration collapses `unavailable/skipped` into `pending`.

This is the second major blocker after dependency semantics.

## E. Operational diagnostics were reduced

V11 exposes a protected `/diagnostics` path and keeps model statistics/failure diagnostics. V12.5 has `/health`, `/ready`, `/selftest`, `/status`, and failure rows, but no equivalent protected diagnostics surface or model-stat history.

## F. Direct-chat latency/resilience path changed

V11.6.1 had a special fast direct-chat path and deterministic replies for very basic greetings. V12.5 intentionally routes ordinary conversation through the Agent brain. This is architecturally cleaner, but it removes the deterministic “AI provider not needed for basic greeting” behavior and increases the configured total AI budget from the old direct-chat budget to the larger Agent budget. This is not necessarily worse, but it is **not behavioral parity** and should be benchmarked.

## G. Direct command shortcuts changed

V11 advertised `/tomorrow` and `/list`. V12.5 advertises richer project/waiting/prayer/status shortcuts but does not expose `/tomorrow` or `/list` as direct commands. Natural language can cover the intent, but exact command parity is incomplete.

---

# What V12.5 genuinely does better than V11

The audit is not saying “go back to V11”. The opposite: **V12 is the correct base**.

V12.5 improvements that should be kept:

1. Single Agent Loop instead of competing regex/handler paths.
2. Structured 64-tool runtime.
3. General mutation verification contract.
4. Goal Completion Gate.
5. Structural dependency references with `$step:N.field`.
6. Explicit temporal/life grounding.
7. Durable operation snapshots and verified receipts.
8. Multi-domain requests in one message.
9. Cleaner typed memory layers.
10. Much smaller and more understandable core.
11. Live test proves real D1 persistence instead of trusting reply text.

The job is therefore **not to restore the 15K-line spaghetti**. It is to port the missing V11 behaviors into clean V12 tools/guards.

---

# Required closure plan before calling it “Ultimate / 100% V11 parity”

## P0 — Must fix before 100% claim

1. Expand atomic snapshot/compensation to profile/settings and every mutating domain.
2. Make `system.clear_all` truly clear all intended user data with explicit verified scope.
3. Restore full dependency semantics: `after_start`, `after_end`, `before_start`, offsets, canonicalization and cycle guard.
4. Build lossless legacy-ID mapping for projects/tasks, entities/edges and dependencies.
5. Migrate V11 settings, inbox, dependency graph, world edges and fire ledgers.

## P1 — Feature parity

6. Restore shopping `unavailable` and `skipped` states.
7. Add temporary recurrence pause-until and richer recurrence editing.
8. Restore Life Inbox as first-class tools: `inbox.read/add/close/classify`.
9. Restore Hijri date and Islamic occasion awareness.
10. Restore Arabic holiday labels.
11. Restore Telegram reminder/rule/prayer/settings/conflict interaction buttons.
12. Restore protected diagnostics/model telemetry.

## P2 — Hardening / polish

13. Restore bounded voice file-size + timeout budgets.
14. Add external API timeouts/stale-cache fallback for prayer/weather/news/holiday paths.
15. Restore `/tomorrow` and `/list` aliases.
16. Benchmark fast casual chat latency and add a safe lightweight fallback if it improves reliability without reintroducing router spaghetti.

---

# Certification expansion required

The existing 19-scenario live matrix is valuable but does not exercise every tool or every V11 parity edge. Before “Ultimate”, add live/deterministic gates for at least:

- dependency cycle A→B→A rejection
- after-end and before-start propagation
- temporary pause-until
- unavailable/skipped shopping state round-trip
- Life Inbox round-trip
- Hijri/live-reality output
- voice > max-size rejection and provider timeout fallback
- profile/settings mutation followed by forced later failure → full rollback
- `system.clear_all` verified against every intended user-data table
- V11 migration fixture with non-contiguous project/entity IDs
- V11 life edges/dependencies/settings migration
- fire-ledger cutover with no duplicate reminders
- reminder/recurrent/prayer callback actions
- `/tomorrow` and `/list`

---

# Final conclusion

**Do not grow V12 back to 15,000 lines just to make the number look impressive.**

The audit shows why 1,400 lines can still carry a large amount of capability, but it also proves that the current size partly comes from **features/guards that have not yet been ported**, not only from cleaner architecture.

The correct next release is a parity-closure release built on the existing V12 brain:

> **Sanad V12.6 / Ultimate Parity = V12.5 Agent architecture + every useful V11 behavior above + expanded certification.**

Only after the P0/P1 closure and the expanded matrix pass should the project claim **full V11 replacement with no known parity gaps**.
