<!--
     __                      __  ___
    / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
   / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
  / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
 /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/

 cavira oss (c) 2026 - nullure (c) 2026
 ==========================================================
 file  : benchmarks/FAILURE_ANALYSIS.md
 usage : evidence-grounded diagnosis of the latest benchmark failures
-->

# Why Benchmark Accuracy Is Still Low

## Current Assessment: After Evidence and Calendar Reranking

Updated: 2026-09-14. This assessment supersedes the historical audit below.
It uses saved runs and current source code, with no new hosted calls or production
changes. Results and benchmark analysis remain outside the `docs/` folder.

### Bottom Line

**LoCoMo is now the largest demonstrated accuracy gap. Better ranking has helped,
but the system still lacks reliable cross-session event coverage, fact-level
subject/predicate reasoning, and a reader that consistently gives a complete,
supported answer. Evaluation variability makes small gains difficult to attribute.**

The lightweight algorithm is a fixed-weight heuristic, not a trained neural
model. It recognizes selected surface patterns; it cannot reconstruct every
implicit event, resolve arbitrary pronouns, distinguish all false premises, or
verify a generated answer. Making it faster or adding another global weight does
not automatically solve those missing capabilities.

### Latest Verified Scores

| Completed run                                                                  | Version and scope                                        |     Judged result | Interpretation                                                    |
| ------------------------------------------------------------------------------ | -------------------------------------------------------- | ----------------: | ----------------------------------------------------------------- |
| [Combined evidence run](runs/2026-09-14-evidence-judged/report.json)           | Reranker v2; 18 LongMemEval oracle + 15 LoCoMo questions | **27/33, 81.82%** | Latest completed combined evaluation; repository 80% gate passes  |
| Same run, oracle subset                                                        | 18 selected from 500 oracle questions                    | **17/18, 94.44%** | Not full LongMemEval-S and not a verified full-dataset 92% result |
| Same run, LoCoMo subset                                                        | 15 selected from 1,986 questions                         | **10/15, 66.67%** | Five incorrect answers                                            |
| [Calendar/word-variant run](runs/2026-09-14-locomo-context-judged/report.json) | Reranker v3; LoCoMo only, same 15 questions              | **10/15, 66.67%** | Newer LoCoMo evidence improved; answer gate still fails           |

Do not combine the older 17/18 oracle subset with the newer 10/15 LoCoMo subset
and label that a new combined run. The current v3 implementation has no completed
combined or full-dataset judged result in these artifacts.

All listed runs use NVIDIA `nvidia/nemotron-3-embed-1b`, 2048-dimensional vectors,
K=5, a 2,048-estimated-token context allowance, protocol-v2 prompts, and separate
Copilot answerer/judge sessions using `gpt-5.6-luna`. Both latest judged runs
completed without execution failures or invalid/fallback-parsed judge verdicts.

On these sample sizes, exceeding 92% requires at least **31/33 combined** or
**14/15 LoCoMo**. Each is four net correct answers above its last observed score,
assuming no new regressions. This arithmetic is not a forecast or a population
accuracy guarantee; the same small development sets have been inspected repeatedly.

### What Improved, and Why It Was Not Enough

The earlier 23/33 audited result is historical, not today's best combined score.
Evidence reranking subsequently recovered the projects, model-kit count, Rachel
update, and Sam stress-relief answers in the v2 run. The calendar/order fix then
recovered Nate's coconut-milk ice-cream photo answer (`conv-42:qa:198`) in the v3
LoCoMo run.
These should no longer be listed as current demonstrated failures of those runs.

| LoCoMo retrieval, same 15 questions |           v2 |               v3 |
| ----------------------------------- | -----------: | ---------------: |
| Evidence recall                     |       47.78% |       **56.11%** |
| Rank-weighted context precision     |       41.33% |       **48.61%** |
| Complete annotated evidence         | 5/15, 33.33% | **6/15, 40.00%** |
| Judged answers                      |        10/15 |        **10/15** |

The photo answer changed from wrong to correct. Andrew's career answer changed
from correct to incorrect, offsetting it. The latter had **identical retrieved
text and reconstructed answer prompt** across the two runs. It is not a measured
retrieval regression. The answer changed from wildlife biologist to wildlife
conservationist, which the judge rejected as insufficiently similar to the
reference park-ranger/National Park Service role. Whether that boundary is right
requires rubric calibration; the score must not simply be edited to claim a gain.

### The Remaining Failures, Case by Case

The first five rows are the **latest v3 LoCoMo failures**. The last row is the
unresolved **v2 oracle counting case**, not an additional case from the v3 run.
Diagnoses overlap; they are not disjoint percentages of total failure causes.

| Case                   | Evidence and answer observed                                                                                                                                                                            | Main blocker                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `conv-48:qa:88`        | Asked for Deborah's activities besides yoga; returns yoga/community events and general hobby advice, not the required biking, art shows, surfing, gardening and other activities; annotated recall is 0 | **Incomplete multi-event retrieval and weak exclusion semantics**                                   |
| `conv-41:qa:91`        | Correct convention passage is now rank one and includes "tech for good"; answer still says only "a convention"                                                                                          | **Reader omits required specificity despite available evidence**                                    |
| `conv-43:qa:70`        | Tim's Star Wars preference and Ireland plans are present; answer supplies three locations while the reference requires five                                                                             | **General-knowledge/list completeness and rubric policy**, not just missing personal memory         |
| `conv-43:qa:241`       | John signed the beverage deal; Tim congratulated him. Answer describes the supported congratulation instead of rejecting the intended false premise about Tim signing                                   | **Subject/action attribution and false-premise handling**; wording is also interpretation-sensitive |
| `conv-44:qa:53`        | Animal-related personal premises are present, but exact annotated nature/hiking sources are not selected; career answer is rejected despite unchanged context                                           | **Premise coverage plus answer/judge semantic calibration**                                         |
| `0a995998` (v2 oracle) | Answers one clothing item against reference three; pickup, return, replacement, and repeated mentions must be distinguished                                                                             | **Event/obligation counting and reader completeness**; v3 did not re-evaluate this case             |

The report cannot honestly reduce all five LoCoMo failures to "bad embeddings."
One is clearly a missing multi-event evidence problem; several already contain
the personal premises or required wording and fail later. Conversely, incomplete
gold recall does not always mean insufficient answer content: the same fact may
be repeated in an unannotated turn, and bundles can contain additional sources.

### Architectural Bottlenecks Still Present

**1. No reliable inventory of distinct events across sessions.**
The [provider](src/providers/longmemory.ts) embeds raw turns, asks recall for a
larger internal list, and returns five anchors. The stored summaries concatenate
claims within a single turn; they are not cross-session event inventories.
[Consolidation defaults to off](../src/core/create_memory.ts#L193). Vocabulary
novelty is only a proxy for different events. The system cannot yet reliably
enumerate all non-yoga activities or count separate pickup/return obligations.

**2. Surface-pattern scoring is not semantic exclusion or identity resolution.**
The [reranker](../src/core/recall/rerank.ts#L171) infers a subject from speaker-name
tokens and uses a narrow explicit-subject pattern. The latest Tim trace reports
`subject: null` for the question spelling `Tims's`. Its exclusion score depends
on whether any remaining query term overlaps an assertion; generic wording about
"pursuing hobbies" can count as positive support while the actual event is yoga.
It does not subtract the excluded activity from a structured event set. The
calendar parser and suffix matching are useful limited corrections, not general
language understanding.

**3. Fact reconciliation remains first-claim-only.**
[Relationship creation](../src/core/engine/ingest_engine.ts#L404) and the current
claim index inspect only the first claim. Other clauses may never acquire update
or contradiction relationships. Claims still use regex-derived string subjects,
not consistently canonical entity references. Rachel's answer now passes in v2,
but that does not prove the previously observed malformed subjects and missed
non-first-claim updates are fixed. This is a verified code limitation with an
unmeasured contribution to the latest total, not a new failure count.

**4. Graph improvements do not cover every execution path.**
The [sparse/matrix condition](../src/core/recall/associative_recall.ts#L551) still
requires an exception-style query. The newer evidence reranker is more broadly
enabled; therefore it would now be wrong to say all reranking improvements are
bypassed. But ordinary queries still use the older diffuse graph signal. For the
five current LoCoMo failures, matrix mode is false and saved seed density spans
80.4-98.4%. No current ablation proves how much of their error this causes. Do not
enable another strategy everywhere merely because it exists.

**5. No closed-loop answer-support check.**
The [answer prompt](src/ai/prompts.ts#L23) asks the model to count, attribute,
abstain, and be concise. There is no semantic check that each requested list item
is covered, that a key qualifier survived, or that a premise refers to the right
actor. There is also no production second retrieval step when a count is
under-supported. The convention, location-list, and deal answers demonstrate
different ways a one-pass reader can fail after retrieval.

### What Is Not the Current Bottleneck

- **Provider outages:** both latest judged runs completed; neither used fallback.
- **Context-budget clipping:** no returned hit was removed by the budget in
  either run. Maximum recorded evidence context was **821 estimated tokens** in
  the combined v2 run and **455** in the v3 LoCoMo run, below 2,048. These counts
  are estimates and exclude some prompt overhead. Increasing the allowance alone
  will not supply evidence that the provider never returned.
- **Missing qualifier caused by rendering:** the current convention prompt
  retains "tech for good". Its omission happens in the answer, not storage.
- **CPU speed alone:** the measured selector optimization addresses runtime
  cost, not semantic support. No evidence shows slow retrieval caused these
  incorrect answers. Hosted search latency combines local work and API time.
- **NVIDIA alone:** changing providers has not been isolated from other code and
  reader changes in a controlled full comparison. Neither blame nor a promised
  benefit from another provider switch is justified by these artifacts.

### Measurement and Generalization Limits

**Reader/judge variability is real.** The older two NVIDIA runs had identical
reconstructed prompts but 19 changed answers. The latest career flip is another
unchanged-context example. The [Copilot transport](src/ai/model.ts#L274) does not
forward the manifest's temperature or maximum-token settings to the CLI or pin a
deterministic decoding seed. Separate sessions of the same model do not provide
an independent judge. Zero invalid verdicts means parsing succeeded, not that
all semantic judgments are stable or correct.

**The metrics answer different questions.** The latest LoCoMo ordinary
unique-source Precision@5 is **20.00%**, while displayed rank-weighted precision
is **48.61%**. [Source matching](src/metrics.ts#L62) credits a single source per
hit even for bundles. [Retrieval scoring](src/runner.ts#L304) precedes budget
fitting; that mismatch did not affect the current runs. The public loaders leave
`forbidden_ids` empty, so zero stale leakage is not a tested guarantee of correct
temporal reconciliation. Do not relabel these metrics as answer accuracy.

**Held-out evidence is limited.** After the calendar changes, 15 separately
hash-selected questions stayed at 30.29% recall, and six additional date-bearing
questions stayed at 66.67%. The first set did not exercise a positive calendar
score; all six in the second did. Neither had a per-case recall loss, but neither
showed aggregate gains. They share conversation corpora with development and were
retrieval-only: these checks do not establish better held-out answers.

Full cleaned LongMemEval-S, full LoCoMo, and a fresh combined v3 judged run have
not been executed in the listed evidence. A 94.44% score on 18 oracle questions
is not a SOTA comparison or proof that general memory accuracy exceeds 92%.

### Priorities to Reach a Defensible High Score

| Priority | Work                                                                                                                                                                      | How to determine whether it helps                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Pin exact prompts/context hashes, code/data revisions, model settings actually used, and per-case evidence sources; calibrate ambiguous judgments with independent review | Repeat frozen-context answers and judgments; separate variance from retrieval deltas without weakening gold rules                            |
| P1       | Build source-linked event/obligation records with subject, action, object, time, and distinct-event identity; interpret excluded activities                               | Recover complete event sets on unseen conversations; measure list/count completeness and duplicate/false-event rates                         |
| P1       | Add bounded answer-support and premise checks for counts, lists, qualifiers, and actors; request more evidence only when support is insufficient                          | Test with fixed retrieved context and evaluator-only gold-context diagnostics; report accuracy, abstention, latency, and call cost           |
| P2       | Reconcile all supported claims and canonical entities while keeping per-claim history                                                                                     | Generic multi-clause update tests, temporal QA, and no collateral retirement of unrelated facts in the same turn                             |
| P2       | Record rankings at admission, shortlist, rerank, and final context; compare subject-aware expansion, K=5/20/50, and selective/no diffusion                                | Fixed-budget, same-embedding ablations; show exactly where omitted evidence returns and which existing cases regress                         |
| P3       | Freeze the winning settings and evaluate full declared datasets with held-out questions/corpora and a distinct judge                                                      | Per-dataset and per-category judged accuracy, uncertainty, cost, source completeness, and uncached latency; no stitched cross-version totals |

The immediate recommendation is **event-set coverage plus answer verification,
supported by trustworthy evaluation**, rather than another broad rewrite, larger
token budget, or untrained neural layer. Any added model should be optional and
measured for both quality and resource cost. Expected percentage gains are unknown
until controlled experiments run; none are promised in this report.

### Fix Options and Selected Approach

Decision date: 2026-09-14. This is a design recommendation, not a newly tested
winner or an implementation claim. The comparison uses the current failure
evidence and the earlier low-resource requirement. No extra model calls were made.

Implementation follow-up: Stage A is now available as the optional, provider-
neutral `answer_from_evidence` library adapter. A fixed-context comparison found
12/15 correct versus 10/15 direct on development, and 7/15 versus 7/15 on the
separate validation set, with no invalid reader responses. These single-pass
diagnostics do not demonstrate broad gains. Defaults remain unchanged, and the
conditional follow-up retrieval in Stage B is not implemented. See the
[public API guide](../docs/answering.md) and
[experiment details](README.md#evidence-first-reader-experiment) for the boundaries,
measured overhead, and remaining limitations. The design rationale below is
retained as the original pre-implementation comparison.

| Option                                                              | What it could address                                                | Cost and risk                                                                                                                                                    | Decision                                                         |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| More regex rules, weights, or embedding swaps                       | A few identifiable ranking misses                                    | Low local cost, but accumulating special cases and no effect on correct-context reader mistakes; an embedding switch also requires re-embedding                  | Not the next main investment                                     |
| Tiny trained reranker / cross-encoder                               | Better semantic ranking and subject relevance                        | Needs representative training or a validated pretrained model, negatives, inference/deployment measurement; the inspected questions are not a sound training set | Consider after coverage diagnostics; not justified by size alone |
| Raise K or the token budget globally                                | Omitted turns that already rank just below the cutoff                | More context/noise and a changed protocol; current budget did not clip hits; cannot ensure distinct-event coverage                                               | Use as a controlled diagnostic, not a blanket fix                |
| Write-time canonical event inventory and claim-level reconciliation | Counts, exclusions, event identity, historical updates               | Strong long-term design, but higher implementation/migration cost and extraction-error risk; semantic extraction may require model calls                         | Best next core-memory project, but not the fastest isolated test |
| Evidence-first reader on fixed context                              | Missing qualifiers, counting available facts, actor/premise mistakes | Can use the existing single answer call with more structured output; references can be checked, but model semantics can still be wrong                           | **Best first implementation and experiment**                     |
| Evidence-first reader with one conditional follow-up retrieval      | The above plus explicitly identified missing evidence                | At most two answer calls and one extra recall/query-embedding call; bounded context; must keep permissions and temporal scope identical                          | **Selected target design**, contingent on the fixed-context test |

The choice is not "add another verifier model to every query." The proposed
reader extracts a small declarative evidence record and answers in the **same
initial model call**. It uses the already configured reader, not another service.
Do not claim this has zero overhead: structured output adds tokens and validation
work; the conditional second pass adds latency and model/embedding cost.

#### Why This Wins as the Next Step

- The convention qualifier is already present, yet the reader omits it. More
  retrieved turns are not needed to test that failure mechanism.
- The deal's actor and congratulator are both visible. An explicit subject/action
  evidence record can expose the mismatch before answering, though it cannot
  guarantee the model interprets the ambiguous question correctly.
- The latest career verdict flipped with identical context. Evaluation must be
  stabilized before attributing a small score gain to a new memory architecture.
- Deborah's activity list really is incomplete. A fixed-context reader cannot
  invent the missing events; this motivates a later targeted recall rather than
  hiding the limitation behind a stronger prompt.
- The current library exposes `recall`, not a built-in answer-generation API.
  This design belongs in a reusable, optional answering adapter above
  [the memory API](../src/core/create_memory.ts#L161), not in durable ingestion or
  as dataset-specific instructions that exist only in the evaluator.

#### Bounded Design

1. Run the current scoped recall unchanged. Give the reader only the question,
   question time, and returned evidence. Never expose gold categories, reference
   answers, relevance labels, or judge feedback.
2. In the existing answer call, request a compact structured result containing
   the final answer, supporting facts with source IDs and exact excerpts, and
   explicit unresolved evidence needs. Each fact identifies its subject, action
   or relation, and object; this is an evidence ledger, not a request for a long
   reasoning transcript. Keep supported facts separate from general-knowledge
   recommendations. Do not count repeated source mentions as distinct events.
3. Validate the schema, referenced IDs, excerpt membership, and output size using
   code. These checks prove provenance/format consistency, **not semantic
   entailment, completeness, or correct event deduplication**. A confidently wrong
   extraction can pass them and must remain part of the measured error rate.
4. Only after the fixed-context approach shows value, allow one follow-up recall
   for a concrete missing subject/event/time aspect. Keep the same owner/world,
   permissions, as-of time, and total context allowance. Untrusted text must not
   become tool instructions. Retain opposing evidence; do not retrieve only to
   confirm a proposed answer. A model's missing-evidence flag is a fallible trigger,
   not a calibrated confidence score.
5. Permit at most one second answer call. No autonomous search loop, external web
   browsing, repeated self-critique, or judge-guided retries. If the required
   personal evidence remains absent or outputs remain invalid, abstain. Any
   broader retrieval mode must report its actual evidence count and cost.

#### Experiment Order and Rejection Criteria

**Stage A: fixed-context reader comparison.** Freeze current retrieved text,
reader identity, context budget, judge rubric, and question IDs. Compare the
existing direct-answer call with the evidence-first call. Include generic tests
for omitted qualifiers, false subjects, count duplicates, absent evidence, and
valid third-party statements, plus new judged questions beyond the repeatedly
inspected development set. Repeat both conditions to expose answer/judge variance;
blind the judge to the condition. An independent review/calibrated second judge
should check ambiguous recommendations rather than silently relaxing the rubric.

Reject or defer this design if it shows no repeatable net benefit, worsens
supported abstention, or exceeds the agreed token/latency budget. A single
successful rerun of the known examples is insufficient. No uplift is currently
established beyond the limited follow-up diagnostics summarized above.

**Stage B: one-follow-up ablation.** Compare Stage A alone with Stage A plus the
bounded retrieval step, recording first-pass evidence, the generated subquery,
new sources, added tokens/calls, final answer, and reasons for abstention. Report
this as a distinct adaptive protocol. If the reader uses more than five source
anchors, do not label the answer metric Answer@5; keep the fixed-K baseline intact.

**Stage C: event inventory only where it adds measured value.** If relevant
events are still absent after the bounded recall, prioritize the canonical event
inventory over further reader prompting. It remains necessary architectural work,
but is not bundled into the initial experiment, so its benefit and regressions
can be attributed separately.

The selected approach does not solve every remaining case: a complete list of
Star Wars filming locations involves general knowledge and rubric policy, and
the career-answer boundary needs calibration. It neither guarantees 92% nor
replaces full-dataset, held-out validation. It is the best **next testable
investment**, not a proven final architecture.

### Current Assessment Evidence

- [Latest combined judged report](runs/2026-09-14-evidence-judged/report.json)
- [Latest LoCoMo judged report](runs/2026-09-14-locomo-context-judged/report.json)
- [General validation off](runs/2026-09-14-locomo-context-validation-off/report.json)
  and [on](runs/2026-09-14-locomo-context-validation-on/report.json)
- [Calendar validation off](runs/2026-09-14-locomo-context-calendar-validation-off/report.json)
  and [on](runs/2026-09-14-locomo-context-calendar-validation-on/report.json)
- [Implementation and experiment notes](README.md#locomo-calendar-follow-up)

The artifact audit checked completion, per-dataset denominators, all latest
incorrect verdicts, retrieved text, source evidence, context sizes, prompt
equivalence for unchanged-context cases, feature flags, and code paths. No new
answer/judge calls or production modifications were made for this refresh.

---

## Historical Audit: Before Evidence Reranking v2

The remainder is retained as the original diagnosis of
`2026-09-13-nvidia-audited` versus `2026-09-13-nvidia-judged`. References below to
"current," "latest," "all ten failures," or "the last two runs" refer to that
historical comparison only. Its 69.70% score, missing food-photo answer, Sam
attribution miss, and other examples must not override the current assessment.

Date: 2026-09-14. Historical scope: saved pre-v2 NVIDIA evaluations.
No production changes, new embeddings, or answer/judge calls were made for that audit.

## Executive Finding

LongMemory currently retrieves related conversation turns more reliably than it
retrieves a complete, correctly attributed set of facts needed to answer a
question. Cross-session counts, subject attribution, exclusion language, and
historical updates remain weak. The reader and evaluation rubric add further
errors even when useful evidence is present.

The recent correctness and CPU fixes did not address most of those semantics.
More importantly, **the last two NVIDIA runs delivered identical retrieved text
and identical reconstructed answer prompts for all 33 questions**. Their score
difference, 24/33 versus 23/33, is not evidence that the audited engine supplied
worse context. Nineteen generated answers changed; three verdicts flipped.

The 92% target is neither reached nor validated on full datasets. On this small
sample, at least 31/33 answers would be needed to exceed 92%; the result is 23/33.
Eight net additional correct answers would be needed, not a small rounding gain.

## Measurement Scope

Primary artifact: [audited report](runs/2026-09-13-nvidia-audited/report.json).
Comparison: [previous NVIDIA report](runs/2026-09-13-nvidia-judged/report.json).
Derived evidence: [failure ledger](runs/2026-09-14-failure-audit.json).

| Property                                  | Observed value                                                    |
| ----------------------------------------- | ----------------------------------------------------------------- |
| Completion                                | 33/33; zero execution failures                                    |
| Overall judged accuracy                   | 23/33, 69.70%                                                     |
| LongMemEval **oracle**                    | 14/18, 77.78%; 18 selected from 500                               |
| LoCoMo                                    | 9/15, 60.00%; 15 selected from 1,986                              |
| Embeddings                                | NVIDIA `nvidia/nemotron-3-embed-1b`, 2048 dimensions, no fallback |
| Answerer / judge                          | Separate Copilot sessions, both `gpt-5.6-luna`, protocol v2       |
| Answer-context limit                      | K=5; 2,048 estimated tokens                                       |
| Context recall                            | 63.94% over 30 cases with annotated evidence                      |
| Evidence completeness                     | 15/30, 50.00%                                                     |
| Displayed rank-weighted context precision | 50.94%                                                            |
| Ordinary unique-source Precision@5        | 23.67%                                                            |
| Invalid or fallback-parsed verdicts       | 0                                                                 |

These are deliberately selected, repeatedly inspected development questions,
not a random population sample or full LongMemEval-S. LoCoMo category 5 is
included. Other studies may exclude it, use token F1, use more context, or use
different readers and judges. Such scores are not directly interchangeable.

### Where the Failures Concentrate

| Category               | Correct / selected |
| ---------------------- | -----------------: |
| Multi-session          |            **0/3** |
| Multi-hop              |            **1/3** |
| Knowledge update       |                2/3 |
| Single-hop             |                2/3 |
| Adversarial            |                2/3 |
| Open-domain            |                2/3 |
| Temporal reasoning     |                5/6 |
| Information extraction |                3/3 |
| Preference             |                3/3 |
| Abstention             |                3/3 |

Among cases with annotated evidence, 14/15 with complete source recall were
judged correct, versus 6/15 with incomplete source recall. This is descriptive,
not a causal estimate: annotations can omit equivalent repeated statements,
include adversarial counterevidence, and undercount bundled sources.

## Root Causes

### 1. Relevance Is Not Answer-Bearing Evidence

**Confirmed in the saved hits and scoring code.**

- For Sam's stress-relief question, all five anchors are **Evan** speaking.
  Evan addresses Sam or describes his own painting; the actual Sam statements
  about snacks, views, and yoga are missing. A retrieved Evan yoga question has
  the needed Sam answer immediately after it, but bundles expand predecessors,
  not that successor.
- Deborah's question asks for activities **besides yoga**. Four anchors primarily
  discuss teaching or practicing yoga. Matching the excluded topic helps a
  candidate's lexical coverage rather than disqualifying it as the answer.
- First-person counting questions rank generic assistant advice above personal
  events. The projects question ranks a clustering tutorial first and generic
  performance metrics second. Neither adds a distinct led project.
- Nate's November food-photo question returns unrelated photos and other months.
  The correct coconut-ice-cream turn is in the source corpus but not the top five.

The [speaker signal](../src/core/recall/associative_recall.ts#L520) is enabled only
for first-person queries and uses generic `user`/`assistant` roles. For a named
third-person query such as Sam's, it is zero. Entity overlap matches name tokens
anywhere in a turn, including an addressee. It is not semantic subject resolution.
Sam's wrong top anchor receives full entity overlap despite being Evan's speech.

The [reranker](../src/core/recall/rerank.ts#L42) adds term coverage and bigram
bonuses. It is not a learned semantic reranker or an answer-support verifier.
The [default diversity selector](../src/core/recall/fusion.ts#L52) uses positional
rank and vector redundancy, not distinct events, obligations, or answer aspects.

Additional lexical probes confirmed `experimentation` does not normalize like
`experimenting`, while calendar `March` normalizes like `marching`. The latter
is consistent with John's veterans' marching event outranking the March
convention evidence. These probes show ambiguity, not the isolated percentage
contribution of the tokenizer; dense similarity and other features also rank hits.

### 2. Most Queries Bypass the New Retrieval Strategy

**Confirmed by saved diagnostics, not inferred from feature names.**

The [matrix route condition](../src/core/recall/associative_recall.ts#L548) is
`matrix_retrieval_enabled && exception_query`. Only `conv-50:qa:66` used it:
**1/33 queries**, and that question passed. All ten failures used the legacy route.
The entity gate affects matrix scores, not the ordinary direct-score path.

Ordinary queries use broad legacy seeds above a small direct-relevance threshold.
Mean seed density for those 32 queries was **90.28%**. In failed LoCoMo cases,
80.4-92.8% of the corpus became seeds; normalized activation entropy was roughly
0.98-0.99. Spreading an already broad signal over conversation links supplies
weak discrimination rather than targeted evidence expansion. This is a mechanism
supported by the trace; a no-spread ablation is still required to quantify harm.

[Session coverage](../src/core/recall/associative_recall.ts#L666) is separately
opt-in and was off. Default recency and session weights are also zero. Computing
matrix features for ordinary queries does not mean the final rank uses them.
Automatically enabling these paths is not a proven fix: the earlier small
session-coverage experiment did not improve recall and slightly reduced precision.

This also limits the relevance of the recent selector speedup: the optimized
evidence-set selector was not the selection path for the ten failures. Faster
execution of one strategy cannot repair questions routed elsewhere.

### 3. The Write Path Does Not Build a Reliable Fact Model

**Confirmed with stored extracted claims and an offline reproduction.**

[Ingestion](../src/core/engine/ingest_engine.ts#L404) reconciles only
`parsed.claims[0]`; its current-claim index also records only the first claim.
Canonical entity metadata exists, but claim subjects are still regex-derived
strings, not consistently resolver-linked identities.

Rachel demonstrates the resulting gap:

- The old relocation statement is stored with subject **`i'm`** and topic
  **`located_in:i'm`**, although it describes Rachel.
- The new relocation correctly names Rachel but is not the first claim in that
  turn. The first claim is about having visited Miami Beach.
- Both returned turns are marked active. Four hits discuss the earlier Chicago
  context; only one carries the newer suburbs update.

An independent probe ingested `The parcel arrived. Mira is in Oslo.` followed by
`The train arrived. Mira is in Rome.`. The second location claim was extracted,
but **no relationship edge was created**. Fixing valid-time ordering cannot help
a relationship that the write path never recognizes.

[Claim extraction](../src/core/engine/claim_extractor.ts#L68) also turns questions
into apparent facts, falls back to generic `action` claims, and splits text on
sentence punctuation. A stored model-kit name becomes `Spitfire Mk; V` in the
returned evidence. Dates and prices improved, but arbitrary names, pronouns,
questions, assertions, and updates still need semantic treatment.

The current dated summaries concatenate extracted statements **within one turn**.
They are not cross-session event inventories. The benchmark embeds each raw turn
before ingestion, and [consolidation defaults to off](../src/core/create_memory.ts#L193).
Adding canonical metadata and fixing replay does not by itself create linked,
self-contained facts or a complete list of a person's activities.

### 4. The Pipeline Stops Before Establishing Evidence Sufficiency

**Confirmed code path; larger-K benefits remain unmeasured.**

The [provider search](src/providers/longmemory.ts#L141) requests at least 20
internal results, with an internal 50-candidate lexical rerank, then returns only
five anchors. Conversation expansion is bounded and conditional. There is no
reader-driven second search when a count lacks events or a pronoun lacks context.

The answer-context budget removed or truncated **no returned hit in any of the
33 questions**. The largest reported evidence context was **825 estimated
tokens**, below the 2,048-token allowance. Increasing only the token budget will
not fix these results: the provider stops supplying evidence first. Some inputs
naturally returned fewer than five hits; that was not budget clipping.

The report saves top-five nodes and aggregate admission diagnostics, not the
full scored candidate list. All 33 cases had admitted count equal to retrieved
count, so hard admission gates are not rejecting this sample's hot corpus.
However, the artifacts cannot say whether an omitted turn ranked sixth, fiftieth,
or last, nor whether increasing K would retrieve it. Capture intermediate ranks
before changing weights or making a blanket larger-context claim.

### 5. Reader and Rubric Errors Remain After Retrieval

**Confirmed, including exact-prompt repeats.**

- Rachel's later suburbs update is in the prompt, yet the latest answer chooses
  Chicago. The previous run answered suburbs from the same prompt.
- The clothing prompt contains the blazer pickup, replacement-boots pickup,
  and a boots-return statement. The reader counts two. The exchange wording is
  potentially ambiguous, so both event resolution and reference interpretation
  deserve inspection rather than calling this a pure retrieval miss.
- John's full source statement, including “tech for good,” is present. The answer
  says only “a convention,” and the judge requires the more specific phrase.
- Tim's Star Wars and Ireland premises are present. The answer names three valid
  locations; the judge requires all five names in the reference. Those names are
  general knowledge, not the missing memory content. This tests answer completeness
  and rubric policy as well as memory.
- The adversarial deal question names Tim, while John signed the deal. The answer
  describes Tim's supported congratulation instead of rejecting the false premise.
  The sentence is not wholly fabricated, but it fails the intended abstention task.

The [answer prompt](src/ai/prompts.ts#L23) instructs attribution, counting, current
state, and abstention, but a prompt instruction is not a checked fact model or an
answer verifier. It asks for a concise final answer, which does not ensure complete
lists or required qualifiers. The [judge](src/ai/prompts.ts#L39) then applies
category-sensitive rubrics to that answer.

## Every Incorrect Answer

These are dominant diagnoses, not mutually exclusive causal labels. Five cases
have clear missing or wrong-subject evidence as a leading issue. The other five
also need reader, event-interpretation, or rubric work. Gold-source recall alone
does not establish whether the actual answer content is available.

| Case             | Observed failure                                                                                                      | Leading issue                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `0a995998`       | Counts 2 clothing items, reference 3; relevant obligations appear in returned text despite one annotated turn missing | Event counting / exchange ambiguity; two slots also spent on generic advice |
| `6d550036`       | Counts 1 project, reference 2; only 1/4 annotated turns; tutorials and repeated project discussion crowd the list     | Evidence selection plus interpreting current versus led projects            |
| `gpt4_59c863d7`  | Counts 4 kits, reference 5; Tiger tank missing, repeated F-15/B-29 context present                                    | Missing distinct event                                                      |
| `830ce83f`       | Answers Chicago instead of later suburbs, although suburbs is returned                                                | Reader latest-state error, amplified by malformed/unreconciled claims       |
| `conv-41:qa:91`  | Says convention, omits tech-for-good specificity despite full evidence                                                | Answer detail / rubric strictness                                           |
| `conv-42:qa:198` | Abstains; coconut-ice-cream source is absent, wrong photos/months retrieved                                           | Semantic/temporal ranking miss                                              |
| `conv-43:qa:70`  | Lists 3 Star Wars locations, judge expects 5; personal premises are present                                           | General-knowledge list completeness / rubric                                |
| `conv-43:qa:241` | Describes Tim congratulating John instead of abstaining about Tim sealing the deal                                    | False-premise and subject handling                                          |
| `conv-48:qa:88`  | Omits biking, art shows, surfing, gardening; yoga dominates; one gold source is inside a bundle                       | Exclusion semantics and multi-event coverage                                |
| `conv-49:qa:82`  | Abstains; all five anchors are Evan, not Sam; the Sam yoga reply follows a retrieved question                         | Subject attribution and backward-only context expansion                     |

The failure ledger retains the returned text, source statements, dates, hypotheses,
scores, extracted claims, score breakdowns, and bundle source references for review.

## What the Metrics Do Not Prove

### The Last Score Drop Is Not a Retrieved-Context Regression

Between the two NVIDIA runs:

- Stable matched-source ordering changed for **0/33** questions.
- Returned text changed for **0/33** questions.
- Reconstructed complete answer prompts changed for **0/33** questions.
- Generated answers changed for **19/33** questions.
- Two answers changed from correct to incorrect; one changed the other way.

Node IDs changed because the runs use different isolated worlds; they are not
appropriate cross-run retrieval identities. Compare source references and text.

The [Copilot adapter](src/ai/model.ts#L274) passes the model and prompt but does
not forward temperature, maximum output tokens, or a deterministic seed. The
manifest's temperature 0 is a requested configuration, not an enforced decoding
setting for this transport. Separate answerer/judge sessions of the same model
also do not eliminate correlated bias. The artifacts establish answer variation,
not which internal model/backend behavior caused it.

### Source Recall Is Not Complete Answer Support

[Matching](src/metrics.ts#L53) assigns one `evidence_id` per hit even when its
text contains multiple source nodes. For Deborah, reported recall is **0/5**, but
the fifth hit includes gold source `D15:11`: provenance shows **1/5**. The answer
uses running and workshops from that source. This undercounts retrieval but does
not rescue the answer: four annotated source turns are still absent.

Conversely, the clothing query retrieves a repeated blazer statement that is
not the particular annotated turn. A relevant idea can be present despite less
than perfect gold-turn recall. Open-domain and adversarial evidence IDs also
have different meanings from direct factual answer locations.

[Retrieval scoring](src/runner.ts#L298) uses pre-budget hits, whereas generation
uses fitted context. It is a general measurement risk, but not responsible here
because the budget altered no returned context.

The [scorecard](src/scorecard.ts#L48) calls a rank-weighted, gold-denominator measure
“context precision.” The run's ordinary unique-source Precision@5 is **23.67%**,
not 50.94%. That rank-weighted implementation also lacks duplicate-source
deduplication, so repeated source credits can inflate it in other runs.

The loaders populate empty `forbidden_ids`; consequently zero stale leakage is
not evidence that stale facts were eliminated. “Contradiction resolution” partly
reuses update correctness plus that untested condition, rather than an independent
contradiction benchmark. Do not use those green checks to dismiss the Rachel issue.

## Why Recent Fixes Did Not Reach 92%

The work improved durability, isolation, provider integration, and local CPU cost.
Those are valuable engineering outcomes, but they are not substitutes for better
answer-bearing evidence. The latest quality run completed without key failures,
fallback vectors, invalid verdict parsing, or context clipping. Those problems
are not the current explanation for 69.70%.

In addition, the optimized selector primarily benefits a route used by one
question here. The corpus is still scanned for each query, and matrix features
are computed even for queries whose final ranking uses the legacy path. Remaining
CPU work is a scaling concern, not evidence that latency caused wrong answers.
Hosted search latency includes embedding API time; the stored p50/p95 cannot
isolate local algorithm speed without separate timing instrumentation.

No controlled NVIDIA-versus-Gemini-versus-Ollama comparison with otherwise frozen
code and reader outputs was performed in this audit. A different embedding model
does not resolve subjects, exclusions, event counts, or judge-policy differences
by itself. It is not supported to blame NVIDIA alone or promise that replacing it
again will reach 92%.

## Prioritized Next Experiments

1. **Make attribution measurable.** Store exact answer-context hashes and all
   candidate stage ranks, route flags, bundle sources, and whether evidence was
   removed by gates, ranking, or context fitting. Score source unions and answer
   support separately. Preserve existing official denominators for comparisons.
2. **Fix subject, predicate, and time semantics.** Distinguish speaker, addressee,
   asserted subject, question, and proposal. Reconcile every supported fact with
   source spans and canonical identities. Do not simply supersede an entire
   multi-fact turn when one clause changes, or drop all assistant turns: some
   benchmark questions legitimately ask about assistant-provided information.
3. **Measure candidate coverage before tuning scores.** Evaluate K=5/20/50 with
   a fixed budget and recorded intermediate ranks. Test subject-aware reranking,
   interpretation of exclusions, and bounded question/answer neighbor expansion.
   Compare selective diffusion with no diffusion and the current legacy route.
   Use question text only; never route by gold category or evidence IDs.
4. **Represent distinct events across sessions.** Build provenance-linked event
   inventories or faithful session summaries for counts and lists. Deduplicate
   mentions of the same item without merging separate pickup/return obligations.
   Test on new cases rather than adding branches for these ten known questions.
5. **Evaluate the reader separately.** Freeze retrieved context and repeat answers
   and judgments; run an evaluator-only gold-context diagnostic to estimate reader
   headroom. Gold context must never enter production retrieval. Require explicit
   support for current-state answers, completeness, and false-premise handling.
   Use a genuinely different judge and calibrate it against reviewed examples;
   do not loosen the rubric solely to improve a displayed score.
6. **Validate generalization last.** Reserve unseen IDs, pin data and code revisions,
   and execute full cleaned LongMemEval-S and the declared LoCoMo category set.
   Report per-dataset quality, repeated-run variation, costs, and local/network
   latency separately. Keep oracle results and sampled results explicitly labelled.

Expected percentage gains are unknown until those controlled experiments run.
The first priority is evidence semantics and attribution, not another broad
performance refactor or an unmeasured change of embedding provider.

## Reproduction and Limits

Run `node --import tsx tmp/report_failure_audit.ts` to regenerate the failure ledger
from the two saved reports and local source datasets. Append a case ID to print
its evidence record. The script asserts selected-case identity and reconstructed
context counts. It does not call external services or modify production modules.

The ledger records SHA-256 hashes of both source reports. This audit also used
offline probes for second-clause reconciliation and lexical normalization.
Original full model-event logs and byte-exact sent prompts are not stored in the
reports; prompt equality was reconstructed from saved hits, dates, questions, and
the unchanged prompt builder. No stage-level candidate ablation or new judged
holdout was run. Assertions about rankings identify observed behavior and code
mechanisms, not measured counterfactual gains.
