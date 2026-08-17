# V11 feature parity / safety matrix

- Base feature engine: SuperAgent V10.7.1 full single-file worker
- Durable Telegram D1 inbox / per-chat leases: retained
- Scheduling / recurrence / conflicts / snooze / advance alerts: retained
- LifeOS / world model / memory / projects / waiting / dependencies: retained
- Voice / live context / prayer / location / holidays: retained
- Shopping / sessions / audit / undo: retained
- Planner / executor / verifier / operation receipts: retained
- V11 semantic routing: added
- Fast execution pool: 10
- Complex execution pool: 10
- Router models: primary + 2 fallbacks
- Message length alone cannot promote route to complex
- Explicit multiline shopping entity-preservation invariant: added
- Stable deterministic identity response: added
- Model ranking uses existing D1 model_stats latency/success history
- Same Cloudflare bindings/secrets: retained

Certification scope: build-time syntax + structural checks. Live staging certification is still required before production adoption.
