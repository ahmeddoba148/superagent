# Sanad V12.7 — 21-point correctness hardening matrix

V12.7 starts from the certified V12.6 head and treats these items as release-blocking invariants.

1. One Telegram inbox item per drain/lease; retrigger only after release.
2. Atomic rollback success may be claimed only after exact restore verification.
3. Delete/cancel mutations require all requested IDs to exist before mutation and exact postcondition after it.
4. `sendOnce` uses atomic DB claim before Telegram send and releases claim on send failure.
5. Scheduler checkpoint advances only after the whole successful scheduling round.
6. Daily brief delivery uses the scheduler window, not exact-minute equality.
7. Scheduler users and live watches are cursor/pagination driven.
8. Reminder create/update share the same date/time/past/conflict validation.
9. Reminder update performs dependency propagation exactly once.
10. Legacy migration completion marker is written only after complete migration success.
11. Critical catches (critic, repair, composer, migration, voice fallback, model stats) record failures instead of silently swallowing them.
12. Mutation snapshots are domain-scoped and size/row bounded; oversized snapshots fail before mutation.
13. Dependency creation is restricted to the actually supported reminder→reminder topology until broader realignment exists.
14. Context loading is routed by relevant life domains instead of loading the whole user state for every prompt.
15. `fallbackCompose` can claim changed success only for mutation observations with `ok=true`, `verified=true`, and `changed>0`.
16. Pending inbox recovery pages through backlog in bounded fair rounds instead of `LIMIT 20` only.
17. AI-inferred world facts default to low confidence and low-confidence inferred facts are excluded from trusted context.
18. Daily briefs use an atomic claim; failed Telegram send releases the claim for retry.
19. Profile/settings writes validate timezone, HH:MM, lat/lon, booleans, and enums before persistence.
20. Every mutation passes a centralized postcondition verifier; row existence alone is never sufficient proof of an update.
21. Recurrence/prayer fire claims are released when Telegram delivery fails, preventing permanent notification loss.

Release gate: V12.7 is not certified until static/pure checks and isolated live tests exercise these invariants, including concurrency/failure paths.