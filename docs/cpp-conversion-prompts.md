# Cache-optimized runner for the C++ (Drogon) conversion

## What changed

Do not paste a different phase prompt each time. All durable requirements,
phase-specific legacy files, decision gates, tests, and exit conditions now
live in `docs/cpp-drogon-conversion-plan.md`. The prompt below is intentionally
phase-neutral so it can remain byte-for-byte identical on every run.

Put mutable control data in `docs/ai-run-state.md` or the parity inventory,
never in the stable plan or above the cache boundary. A minimal state file can
contain:

```yaml
active_phase: 3
work_unit: next-smallest-coherent-unit
blocked_decisions: []
```

Change that file when the phase changes. If no state file exists, the runner
derives the active work from the inventory and repository evidence.

## Reusable prompt — paste exactly, without edits

```text
Continue the hotel-drogon conversion from the repository's recorded state.

Follow this execution protocol exactly:

1. Read docs/cpp-drogon-conversion-plan.md completely. Treat its AI_CONTEXT_ID, architecture, global rules, phase requirements, decision gates, and exit conditions as authoritative. Do not edit that plan during normal implementation work.
2. Only after the plan, read docs/phase1-parity-inventory.md and docs/ai-run-state.md if it exists. Then inspect the relevant repository files and Git state. Preserve unrelated user changes.
3. Use an explicitly recorded active phase when one exists. Otherwise select the earliest started but incomplete phase/work unit supported by repository evidence. If the state is genuinely ambiguous, or the plan marks the next action as a decision gate, stop before code and ask one focused question.
4. Before editing, state the selected phase, the smallest coherent work unit you will finish now, and the exact checks from that phase's exit condition that apply to it. Do not claim the whole phase unless every exit condition is evidenced.
5. Before implementing any feature, inspect the corresponding read-only PHPRetro-PDO checkout at the host path verified under the plan (Compose normally mounts ../legacy/phpretro-pdo). Port behavior, not PHP syntax. Never guess a PolarIS schema, hash format, permission, or emulator capability.
6. Implement and verify that one work unit completely. Run every available build, test, sanitizer, grep, or browser check required by the plan. A skipped, unavailable, or deferred check is a reported gap, not a pass.
7. Update docs/phase1-parity-inventory.md and docs/ai-run-state.md if present with evidence-backed status. Commit and push each meaningful verified step when access permits. Never simulate success, bypass CSRF, expose generic table writes, add an unapproved dependency, or overwrite unrelated work.
8. Finish with a concise report: files changed; verification commands and results; inventory/state updates; commit/push result; unmet exit conditions or blockers; exact next work unit.

Proceed without asking for confirmation unless a plan-defined decision gate, missing authority/credential, destructive action, ambiguous repository state, or failed verification requires it.
```

The text inside that fence is the runner. Do not add the phase number, date,
repository status, greeting, or task description before it. Prefer recording
those values in the mutable state file so the entire first user message stays
identical. If an override is unavoidable, append it after the runner under a
final `RUN_OVERRIDE:` line; never insert it into the runner.

## Required request order

DeepSeek caches only an overlapping prefix starting at token zero. The useful
request layout is therefore:

1. pinned client/system instructions and pinned tool definitions;
2. the stable conversion plan, injected verbatim as project/system context;
3. the reusable runner above;
4. mutable inventory and run state;
5. repository/tool results and the smallest dynamic override, if any.

Do not put timestamps, current branch/status, generated repository maps,
random IDs, changing tool descriptions, or the current phase before the
stable plan. Pin the model, client version, tool set, tool order, and upstream
account/route where the client allows it.

Merely telling the model to read a project file is weaker than injecting the
file as project/system context. A tool read happens after the initial user
request and after model-generated tool-call text; variation there can break
the prefix before the file content is reached. If the client cannot inject
project instructions, keep the runner identical and require the plan to be
read first in a single deterministic file read, but treat cross-session cache
reuse as best-effort.

Within a continuing conversation, append turns instead of rebuilding or
reordering history. Across new conversations, use the same serialized message
roles and content. Keep the prefix active: DeepSeek says unused entries may be
cleared after hours to days.

## Measuring the 99.50% target

Use the token-weighted ratio from the API response, not an average of
per-request percentages:

```text
cache_hit_rate =
  sum(prompt_cache_hit_tokens)
  / sum(prompt_cache_hit_tokens + prompt_cache_miss_tokens)
```

At 99.50%, cached tokens must be at least 199 times the missed tokens:

| Missed tokens per request | Cached tokens needed | Total input tokens |
| ---: | ---: | ---: |
| 16 | 3,184 | 3,200 |
| 32 | 6,368 | 6,400 |
| 64 | 12,736 | 12,800 |
| 128 | 25,472 | 25,600 |

This is why the dynamic tail must stay tiny. Do not inflate the stable prefix
with irrelevant padding to manipulate the percentage; cached input still has
cost and context/latency impact. Track these together:

- token-weighted warm hit rate;
- all-in hit rate including cold starts and context-version changes;
- cache-miss tokens per completed work unit;
- input cost per completed work unit;
- time to first token and total task latency.

DeepSeek's current cache is automatic and best-effort. With the current
prefix-unit behavior, the first variants of a new common prefix can miss while
the common unit is detected and persisted; changed context versions and idle
expiry also create legitimate cold starts. Report warm and all-in rates
separately, and do not describe 99.50% as guaranteed.

## Acceptance test

1. Log `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` for every call.
2. Start a fresh context version and run two controlled warm-up calls with the
   same stable prefix and two different tiny tails, so DeepSeek can detect and
   persist their common prefix unit.
3. Run at least 20 representative coding calls with the exact same prefix and
   only a small mutable tail.
4. Compute both warm and all-in token-weighted rates.
5. If warm performance is below target, compare the serialized requests from
   token zero and find the first changed field. Fix that field's placement or
   stability; changing prose later in the prompt cannot repair an earlier
   prefix break.
6. Re-run after normal idle periods and after a client restart so the result
   reflects the actual workflow rather than a selected burst.

If calls go through a gateway instead of `api.deepseek.com`, first verify that
it preserves message bytes/order, exposes the two DeepSeek usage fields, keeps
the model fixed, and uses sticky upstream credentials/routing. Otherwise the
gateway can cap the achievable hit rate regardless of these files.

## Official references

- [DeepSeek context-caching guide](https://api-docs.deepseek.com/guides/kv_cache/)
- [DeepSeek models and cache pricing](https://api-docs.deepseek.com/quick_start/pricing/)
