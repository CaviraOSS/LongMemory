<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026  -  nullure (c) 2026
 ==========================================================
 file  : benchmarks/README.md
 usage : supports LongMemory benchmark readme
-->

# LongMemory Bench

An LongMemory-only, evidence-grounded benchmark runner. The primary artifact is
a product scorecard covering memory quality, retrieval, temporal behavior,
reliability, latency, context size, and explicitly configured embedding costs.

## Pipeline

```text
load cases -> health -> isolate -> ingest -> index -> search -> retrieval evaluation
														-> answer per cutoff -> AI judge per cutoff
														-> checkpoint -> report
```

Every run writes:

- `checkpoint.json` for phase-level resume
- `report.json` with per-case evidence and timings
- `report.md` for review and publishing
- a terminal scoreboard with quality, latency, token cost, and failures

## Commands

```powershell
pnpm bench
pnpm bench:ci
pnpm bench:data
pnpm bench:quality
pnpm bench:judge
pnpm bench:typecheck
```

`pnpm bench` runs the embedded production LongMemory engine against the deterministic smoke dataset. No server or API key is required. Smoke is a wiring and regression sanity suite with tiny, near-verbatim cases; its score is not comparative evidence and must not be used as a headline accuracy claim.

`pnpm bench:quality` loads `benchmarks/comparative.env`, then runs LongMemory
against official LongMemEval and LoCoMo,
uses K=5 for the headline scorecard, and requires an answerer plus a distinct AI
judge. `bench:compare` is retained as a compatibility alias for this command;
external-provider comparison is no longer part of the public benchmark path.

The scorecard reports `N/A` rather than zero when a metric has no valid dataset,
an official dataset run is incomplete, or cost pricing was not configured.
`report.json` includes numerator, denominator, unit, and reason for every field.

### Scorecard mapping

- LongMemEval and LoCoMo: judged Answer@5, only for complete dataset runs.
- Context recall/precision: macro evidence retrieval at K=5.
- Evidence completeness: questions retrieving every required evidence item at K=5.
- Current fact: direct `information-extraction` and `single-hop` questions.
- Update accuracy: `knowledge-update`; event order: `temporal-reasoning`.
- Abstention: `abstention` and `adversarial` questions.
- Contradiction resolution: correct latest answer with no forbidden stale evidence.
- Historical facts: `N/A` until a dedicated historical-fact dataset is added.
- BEAM-1M/10M: judged Answer@5 when the BEAM buckets are downloaded via
  `pnpm bench:data` and selected with `--datasets=beam-1m` or `beam-10m`;
  `--per-category` selects conversations per bucket (20 questions each).
  BEAM questions carry no turn-level evidence, so retrieval metrics exclude
  them and quality is judged from retrieved context only.
- Dollar costs: list-price estimates calculated only when
  `BENCH_EMBEDDING_INPUT_COST_PER_MILLION_USD` is set. Gemini Embedding 001 is
  configured at $0.15 per 1M input tokens; a free quota may bill less.

## AI Answer And Judge

AI evaluation is optional. Supply both models using `provider:model` specs:

```powershell
pnpm exec tsx benchmarks/src/cli.ts run `
	--providers=longmemory `
	--datasets=longmemeval,locomo `
	--cutoffs=5 `
	--answerer=copilot-answerer:gpt-5.6-luna `
	--judge=copilot-judge:gpt-5.6-luna
```

For every question and every cutoff, the runner:

1. slices the provider results to top-K;
2. builds a grounded answer prompt from that context;
3. generates a fresh hypothesis with the answerer model;
4. selects an abstention, temporal, preference, knowledge-update, or general judge rubric;
5. asks a separate judge model for structured `correct`/`incorrect` output;
6. records answer accuracy, answer/judge latency, prompt/context/completion tokens, explanation, and raw verdict.

Supported model providers are:

- `openai`, `anthropic`, `google`, and `openai-compatible` over native HTTP APIs;
- `ollama` over the local `/api/chat` endpoint;
- `codex` through the installed Codex app's non-interactive `codex exec` command;
- `claude-code` through `claude --print --output-format json`;
- `copilot` through `copilot --prompt --output-format json`; the official pair uses separate `copilot-answerer` and `copilot-judge` sessions.

Configure hosted keys with `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY`; see `comparative.env.example` for endpoint, executable, timeout, and retry settings.

Local examples:

```powershell
# Ollama: pull a generative/chat model first
ollama pull qwen3:8b
pnpm exec tsx benchmarks/src/cli.ts run `
	--providers=longmemory --datasets=smoke `
	--answerer=ollama:qwen3:8b --judge=ollama:qwen3:8b --no-resume

# Copilot CLI runs the official answerer and judge roles in isolated sessions.
# Name an explicit model because benchmark mode ignores user defaults.
copilot update
pnpm exec tsx benchmarks/src/cli.ts run `
	--providers=longmemory --datasets=smoke `
	--answerer=copilot-answerer:gpt-5.6-luna --judge=copilot-judge:gpt-5.6-luna --no-resume

# Requested official pair: two isolated Copilot CLI sessions
$env:BENCH_OFFICIAL_ANSWERER="copilot-answerer:gpt-5.6-luna"
$env:BENCH_OFFICIAL_JUDGE="copilot-judge:gpt-5.6-luna"
pnpm bench:quality
```

The official pair uses two isolated Copilot CLI role sessions, both with
`gpt-5.6-luna`. Codex remains an optional compatibility transport and is not
used by `bench:quality`. Copilot runs non-interactively in
a temporary directory with custom instructions and built-in MCP disabled; the
final `assistant.message` JSON event is used as the verdict. Processes are
terminated on timeout and do not receive this repository as their working tree.

AI mode performs `questions × cutoffs` answer calls and the same number of judge calls. For the 11-case smoke dataset at four cutoffs, that is 44 answer calls plus 44 judge calls and may consume local compute or paid subscription/API quota.

Deterministic evidence retrieval metrics always run, including in AI mode. Default `pnpm bench:ci` deliberately stays retrieval-only so repository CI never depends on paid model APIs.

## Datasets

- `smoke`: eleven tiny deterministic wiring checks covering extraction, preference, multi-session, temporal reasoning, knowledge update, abstention, single-hop, multi-hop, open-domain, adversarial, and summary retrieval. It is intentionally easy and not a comparative benchmark.
- `longmemeval`: official LongMemEval oracle JSON.
- Set `BENCH_LONGMEMEVAL_VARIANT=s` or `m` to download and load the corresponding
  cleaned non-oracle variant; the default remains `oracle`. Missing variants
  fail instead of silently falling back. Oracle contains only evidence sessions
  and must not be reported as LongMemEval-S.
- `locomo`: official LoCoMo JSON.
- `beam-1m`: BEAM 1M-token bucket (35 conversations, 700 validated questions).
- `beam-10m`: BEAM 10M-token bucket (10 conversations, 200 questions).

Download official files explicitly with `pnpm bench:data`. Benchmark execution never downloads data implicitly. BEAM 1M is ~170 MiB and BEAM 10M is ~500 MiB of JSON; a single 1M conversation is ~2,000 turns and a 10M conversation ~20,000 turns, so BEAM runs are embedding-volume heavy and require a semantic embedding profile with real quota (local Ollama or a paid Gemini tier).

Dataset evidence IDs are evaluator-only. Providers receive plain event text, event time, and neutral dataset/session metadata; they never receive evidence labels through IDs, metadata, custom fields, or text. Retrieval attribution uses opaque source provenance first and documented lexical overlap only as a fallback. The benchmark reports retrieval metrics separately from answer correctness; use official LongMemEval/LoCoMo with an answerer and AI judge for substantive comparisons.

Provider-visible `source_ref` values are opaque SHA-256 provenance references derived from a source turn. They contain no dataset ID, session ID, question ID, answer marker, or relevance label. The evaluator maps them back to source turns only after retrieval, preventing near-duplicate dialogue turns from corrupting provenance metrics without revealing gold evidence.

Official runs are rejected unless both `--answerer` and `--judge` are configured. All providers ingest the same plain conversation turns. LongMemory preserves raw turns internally for immutable provenance, but benchmark search renders the structured claims stored during production ingestion under a 2,048-token context budget; it does not return raw stored turns directly.

During retrieval engineering, `--retrieval-diagnostic` permits LongMemEval/LoCoMo without AI calls. Reports are labelled `retrieval diagnostic`, cannot be confused with official answer accuracy, and still require a real semantic embedding profile for LongMemory.

Use `--sample-offset=<n>` for deterministic holdouts. LoCoMo sampling maximizes distinct conversations across task categories, and questions sharing one corpus reuse a single ingestion/indexing pass. Development diagnostics and final Codex validation must use different offsets.

Different offsets can still overlap LoCoMo question IDs: verify disjointness
explicitly. Sampling preserves corpus diversity first, then includes remaining
questions up to the requested limit; it no longer discards all but one question
per corpus/category. `pnpm bench:full` requests all 500 LongMemEval and all 1,986
LoCoMo questions at K=5. `pnpm bench:quality` remains a 33-question sample.
Full runs make thousands of answer/judge calls and require sufficient quota.
Reports include the variant and selected/source counts in `dataset_coverage`.

`pnpm bench:check` runs deterministic sampler, exact-number extraction, evidence,
prompt-isolation, judge-parser, report-coverage, and smoke checks without hosted
models. Answer/judge protocol version 2 does not expose gold question categories
to the answerer, makes Copilot tools unavailable, and rejects contradictory
verdicts. Gold answers, categories, and evidence are evaluator-only.

Official LongMemory runs require a semantic embedding profile. The validated local profile is `LONGMEMORY_EMBEDDING_PROVIDER=ollama`, `LONGMEMORY_EMBEDDING_TIER=deep`, `LONGMEMORY_EMBEDDING_DIMENSION=768`, and `LONGMEMORY_OLLAMA_EMBEDDING_MODEL=embeddinggemma:latest`.

Gemini is also supported with `LONGMEMORY_EMBEDDING_PROVIDER=gemini`, `LONGMEMORY_GEMINI_EMBEDDING_MODEL=gemini-embedding-001`, and `LONGMEMORY_GEMINI_INPUTS_PER_MINUTE=90`. Free-tier Gemini projects may still hit a 1,000-input daily cap on full LoCoMo; such runs remain partial and never fall back silently.

LongMemory stores exact source text for immutable provenance alongside structured claims and a bounded derived summary. Recall ranks with semantic similarity, corrected BM25 IDF, entity overlap, temporal activation, conversation adjacency, role attribution, and query-conditioned preference/emotion signals. Returned benchmark context is rendered from stored claims, not reparsed or copied raw turns, and every provider is constrained by the same 2,048-token budget.

The validated evaluation pair is `copilot-answerer:gpt-5.6-luna` for answers
and `copilot-judge:gpt-5.6-luna` for judging. These aliases create separate
Copilot CLI role sessions; the provider/model suffix alone may still not be
identical as an answerer and judge. Model availability is account-specific and
must be preflighted through the same transport before a long run.

`pnpm bench:full`, `pnpm bench:ci:full`, and `pnpm bench:quality` require
explicit, distinct model specs through `BENCH_OFFICIAL_ANSWERER` and
`BENCH_OFFICIAL_JUDGE`. Official runs reject using the same provider/model as
both roles. Exact required `I don't know` abstentions are scored deterministically.

## Lightweight Evidence Reranking

Associative recall now applies a deterministic evidence-aware algorithm to the
existing top-50 rerank window before the requested result limit. It requires no
neural weights, training data, GPU, additional service, or extra embedding calls.
It uses only question text and admitted memory content, never gold labels.

- Prefer a named person's own assertions or explicit statements about that
  person over another speaker merely addressing them. First-person questions
  favor user statements unless they explicitly ask about the assistant.
- Discount question-only passages and simple excluded-topic-only matches.
- For count/list questions, greedily reduce repeated vocabulary beyond the query
  terms to favor complementary events. This is a novelty heuristic, not exact
  event deduplication or a reliable event-counting engine.
- Preserve the strongest original counterevidence within the first three
  reranked candidates for named-person questions. Without this protection,
  false-premise questions lost the other person's event needed for abstention.
- Cache text features on immutable nodes with a WeakMap. Access gates, stored
  facts, source provenance, and the context budget are not relaxed or rewritten.

The evidence algorithm is enabled by default. Set `LONGMEMORY_EVIDENCE_RERANK=0`
to disable that stage. Manifests record `evidence_rerank` and
`evidence_rerank_version`; hit breakdowns expose `evidence_adjustment`, and
recall traces identify the inferred subject and candidate count. The older
`LONGMEMORY_SESSION_COVERAGE` option is separate and remains disabled by default.

The base feature adjustment is `0.24 * attribution + 0.06 * assertion`, minus
`0.16` for an excluded-only match, with a `0.12 * redundancy` penalty during
aggregate ordering. Version 3 adds the optional word-variant feature described below.
These are fixed engineering weights, not learned parameters or calibrated
probabilities. Subject/exclusion/count patterns are primarily English and are
not general coreference or temporal reasoning. Ambiguous multiple-person queries
receive no named-subject preference. Reported speech and unusual phrasing can
still fool the heuristic; related-but-unhelpful statements can still be selected.

### Validation, 2026-09-14

All runs below used NVIDIA `nvidia/nemotron-3-embed-1b`, 2048 dimensions, K=5,
and the existing 2,048-token budget. No fallback or cached alternate-provider
vectors were used. These are samples, not full-dataset results.

| Retrieval sample                              | Recall off / on | Rank-weighted precision off / on | Complete evidence off / on |
| --------------------------------------------- | --------------: | -------------------------------: | -------------------------: |
| Development, 33 questions                     | 63.94% / 67.11% |                  50.94% / 54.93% |            50.00% / 50.00% |
| Development-disjoint validation, 32 questions | 70.83% / 74.40% |                  60.22% / 57.84% |            60.71% / 67.86% |
| Fresh oracle holdout, 18 questions            | 78.89% / 83.89% |                  57.15% / 66.67% |            73.33% / 80.00% |

The first candidate regressed the 32-question set; its artifacts are retained.
Adding counterevidence retention corrected the losses. That set therefore became
repair validation, not an untouched holdout. The final 18-question comparison
used offset 9 with IDs disjoint from offsets 0, 3, and 6, and no tuning followed.
Both final validation comparisons had no per-case recall losses. The precision
decline on the 32-question set is a real tradeoff and is not hidden by the gains.

Fresh judged development run `2026-09-14-evidence-judged` completed all 33 cases:
LongMemEval oracle **17/18 (94.44%)**, LoCoMo **10/15 (66.67%)**, combined
**27/33 (81.82%)**, versus the prior audited **23/33 (69.70%)**. Four answers
changed from incorrect to correct: projects, model kits, Rachel's update, and
Sam's stress relief. There were no answer regressions or invalid verdicts in this
comparison. The 80% repository gate passed; the overall/full-dataset 92% target
remains unmet. Separate model calls can vary, so this is not a confidence-bounded
estimate of the algorithm's causal effect. Held-out comparisons were retrieval-only.

CPU-only timing on 50 saved candidates measured approximately 5.4ms warm median,
9.2ms warm p95, and 51.9ms for initial feature extraction with the final version,
including counterevidence retention. This is not end-to-end latency evidence.
There are at most 1,225 pairwise novelty comparisons for 50 candidates; their cost
depends on passage vocabulary. Cached token sets take memory proportional to the
analyzed text and become collectible with their source nodes. No dependencies
were added. Deployment timing should be measured on its own corpus and hardware.

Artifacts are under `benchmarks/runs/`: `2026-09-14-evidence-judged`,
`2026-09-14-evidence-validation-off`, `2026-09-14-evidence-validation-on`
(rejected first version), `2026-09-14-evidence-validation-v2`,
`2026-09-14-evidence-fresh-off`, and `2026-09-14-evidence-fresh-on`.
Offline regressions run with `node --import tsx benchmarks/src/check.ts --unit-only`.
The retained algorithm does not repair first-claim-only reconciliation, invent
missing events, guarantee correct abstention, or validate the reader's answer.

### LoCoMo Calendar Follow-up

Version 3 adds two deterministic retrieval signals, with no additional model
service or embedding calls:

- A soft calendar score recognizes one English month/year or month/day/year
  expression, using UTC boundaries. Explicit date mentions and simple relative
  references (`last month`, `last week`, `yesterday`) can match an observation
  recorded later. Invalid dates, multiple dates, and range/before/after queries
  are left neutral. This is not full event-time extraction: an unrelated date
  in a multi-topic passage may still influence the score.
- A bounded derivational match connects longer English words through a small
  suffix set such as `-ation` or `-ment`. The match receives a 0.12 bonus and
  counts as assertion support. It does not change global token normalization;
  morphological resemblance is not proof of semantic equivalence.

Calendar support contributes at most 0.20 before shortlist truncation. Calendar
queries preserve the evidence-aware ordering instead of applying the default
positional diversity pass a second time. Explicit caller diversity settings still
apply. In the diagnostic photo case, that second pass had moved a source with
the third-highest score to seventh place. The fix retains that source in top-K
without increasing K, the token budget, or weakening any admission gate.

Set `LONGMEMORY_CALENDAR_RERANK=0` to disable both calendar promotion and its
ordering policy. Set `LONGMEMORY_DERIVATION_RERANK=0` to disable the word-variant
feature. Disabling both reproduces the version-2 feature set with evidence
reranking still enabled. Calendar ranking is independent of
`LONGMEMORY_EVIDENCE_RERANK`; disabling all three restores the pre-feature path.
Manifests record both flags, and score breakdowns expose `calendar_adjustment`.

| LoCoMo development sample, 15 questions |      Version 2 |      Version 3 |
| --------------------------------------- | -------------: | -------------: |
| Judged answers                          | 10/15 (66.67%) | 10/15 (66.67%) |
| Context recall                          |         47.78% |         56.11% |
| Rank-weighted precision                 |         41.33% |         48.61% |
| Complete evidence                       |         33.33% |         40.00% |

Nate's food-photo answer changed from abstention to the correct coconut-milk
ice cream answer. An open-domain career answer changed from correct to incorrect
despite identical retrieved text, offsetting the gain. The judge rejected
"wildlife conservationist" in the new run; neither answer instructions nor the
judge rubric was changed. The result therefore supports a retrieval improvement,
not a demonstrated improvement in aggregate judged accuracy. The 80% answer gate
still fails, and the broader 92% goal remains unmet.

Two paired NVIDIA-only retrieval validations used different question IDs from
the inspected development sets:

| Validation                                    | Recall off / on | Precision off / on | Completeness off / on |
| --------------------------------------------- | --------------: | -----------------: | --------------------: |
| 15 hash-selected, category-balanced questions | 30.29% / 30.29% |    21.30% / 21.30% |       26.67% / 26.67% |
| 6 additional date-bearing questions           | 66.67% / 66.67% |    50.00% / 50.00% |       66.67% / 66.67% |

Neither validation had a per-case recall loss. The first had no positive calendar
matches and is only a general regression check. All six date-bearing questions
exercised calendar ranking and five changed source ordering, but aggregate quality
was unchanged. These small, question-disjoint sets share conversation corpora with
development; they are not independent-corpus or full-dataset generalization tests.
No further changes were made in response to their answers or labels.

All runs used NVIDIA `nvidia/nemotron-3-embed-1b`, 2048-dimensional vectors, K=5,
the existing 2,048-token budget, and no provider fallback. The judged run retained
the separate Copilot role sessions and protocol-v2 answer/judge prompts. No
end-to-end latency improvement is claimed. Date parsing is neutral for queries
without an explicit supported calendar expression. Exclusion semantics, complete
multi-event inventories, false-premise handling, and reader list/detail
completeness remain unresolved.

Artifacts: `runs/2026-09-14-locomo-context-judged/report.json`,
`runs/2026-09-14-locomo-context-validation-{off,on}/report.json`, and
`runs/2026-09-14-locomo-context-calendar-validation-{off,on}/report.json`.
The baseline is the LoCoMo subset of `runs/2026-09-14-evidence-judged/report.json`.
Earlier development probes remain in `runs/2026-09-14-locomo-calendar`,
`runs/2026-09-14-locomo-contextual`, and `runs/2026-09-14-calendar-rank`.

## Evidence-First Reader Experiment

The public, opt-in `answer_from_evidence` library adapter was compared with the
existing direct-answer prompt using identical saved NVIDIA evidence. Ordinary
benchmark commands still use the direct reader; no default scorecard protocol,
gold rubric, retrieval configuration, or embedding profile was changed.

Each question ran both conditions, alternating the first condition by index.
Both used separate Copilot answerer/judge role sessions with `gpt-5.6-luna`,
zero retry attempts after a failure, at most five saved hits, and the same
2,048-token evidence allowance. Structured output adds prompt/output overhead;
evidence serialization differs between conditions. Both allow general inference
from grounded personal premises, with no gold categories sent to either reader.
The same existing judge receives only the final answer, not the condition or
ledger. Invalid reader output receives no credit. Exact required abstentions
retain the existing deterministic scoring rule.

| Fixed-context diagnostic                 |         Direct | Evidence-first | Invalid reader output |
| ---------------------------------------- | -------------: | -------------: | --------------------: |
| Development, 15 LoCoMo questions         | 10/15 (66.67%) | 12/15 (80.00%) |                     0 |
| Separate validation, 15 LoCoMo questions |  7/15 (46.67%) |  7/15 (46.67%) |                     0 |

The two development gains were the Star Wars recommendation and false-premise
deal question. There were no per-case verdict regressions in either comparison.
No evidence was omitted by the adapter's allowance. The unchanged validation
score limits the conclusion: this is promising opt-in behavior, not proof of
general improvement or 92% accuracy. Only one paired pass was run; independent
judge calibration, repetitions, full datasets, and other-domain model evaluations
remain pending. The validation IDs differ from development but share conversation
corpora and were previously used for retrieval checks. Mocked non-conversational
and multilingual tests validate API contracts, not real-world model accuracy.

Average answer-call duration was 10.42s direct versus 11.55s evidence-first on
development, and 10.09s versus 11.39s on validation. Mean returned output size
rose from 63.7 to 578.4 characters and from 37.1 to 621.9 characters respectively.
These include the ledger; they are not token/cost estimates. Hosted service
variation and prompt differences preclude a deployment latency guarantee. The
CLI transport still does not enforce the requested decoding/token settings, and
the adapter cannot cancel work inside a callback that ignores its AbortSignal.

Artifacts: `runs/2026-09-14-reader-development/diagnostic.json` and
`runs/2026-09-14-reader-validation/diagnostic.json`. Each records source-report
and context hashes, both answers and judgments, the ledger, validation status,
and observed durations/output sizes. Reproduction is in `tmp/evidence_reader_eval.ts`.
No new embeddings, follow-up searches, or automatic answer repairs were used.
The ordinary answer path remains unchanged, and automatic follow-up retrieval
is deferred rather than enabled on this limited evidence.

## Flags

| Flag                                  | Meaning                                          |
| ------------------------------------- | ------------------------------------------------ |
| `--providers=longmemory`              | Benchmark target (LongMemory only)               |
| `--datasets=smoke,longmemeval,locomo` | Dataset set                                      |
| `--per-category=2`                    | Maximum official cases per category              |
| `--cutoffs=1,5,10,20`                 | Retrieval cutoffs                                |
| `--run-id=<id>`                       | Stable checkpoint identity                       |
| `--out=<directory>`                   | Artifact directory                               |
| `--answerer=<provider:model>`         | Generate a fresh answer at each cutoff           |
| `--judge=<provider:model>`            | Judge each cutoff answer with category rules     |
| `--no-resume`                         | Replace an existing checkpoint                   |
| `--require-all`                       | Fail when any provider is unavailable or partial |
| `--gate`                              | Apply configured quality gates                   |
| `--no-color`                          | Disable terminal colors                          |

A resume is accepted only when its secret-free manifest matches datasets, cases, cutoffs, providers, endpoints, routes, runtime environment, answerer, and judge configuration. API keys are never persisted. Completed checkpoints can render reports while providers are offline. Run latency benchmarks without concurrent builds or tests.
