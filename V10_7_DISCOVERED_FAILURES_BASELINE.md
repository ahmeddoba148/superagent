# V10.7 discovered-failure baseline

Source: cancelled V10.6 user mega live matrix, run 31964514526 / job 95207498223.

The harness contains 259 cases. The user intentionally stopped the long run after 49 cases had executed live.

Observed partial baseline:
- Executed: 49
- Passed: 10
- Failed: 39
- Unexecuted: 210 (no claim is made about them)

Systemic failures observed in the executed slice:
- Natural shopping requests were sometimes routed to reminder/schedule state.
- Many natural shopping phrasings produced no shopping mutation at all.
- Quantity add/set/increment/multiply semantics were largely unsupported.
- Deletion by natural reference/category/order was largely unsupported.
- Follow-up/context references and dedupe/merge quantity math were unreliable.
- Some requests exhausted the available AI attempts/time budget and produced runtime failures.

V10.7 architectural response:
- Semantic-first natural-language planner instead of regex-first routing.
- Shopping is a first-class AI action in the same agent schema as scheduling.
- Current shopping state is injected into planner context.
- Structured quantity/brand/size/category/store/priority/optional metadata.
- Transactional multi-operation shopping executor with rollback and audit snapshot.
- Clarification for ambiguous references; no persistent write on ambiguity.
- Query/no-write separation.
- Deterministic direct handlers remain only as an outage/fallback layer.
- Cloudflare editor RegExp/string tuple inference warning fixed in generated build.
