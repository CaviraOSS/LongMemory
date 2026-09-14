# Optional Evidence-First Answering

`answer_from_evidence` is a TypeScript library adapter above memory retrieval.
It works with caller-supplied evidence and a caller-owned language model. It does
not change `createMemory`, ingestion, recall, HTTP routes, MCP tools, or model
configuration. There is no built-in hosted provider, automatic search, retry,
training step, or extra verifier model.

Use it for evidence-grounded questions about documents, projects, personal
memories, historical records, or fictional material. It is not an unrestricted
chat or creative-writing API: answers require cited evidence. Existing recall
remains available for applications that need different answering behavior.

## Use Authorized Recall Results

```ts
import {
    answer_from_evidence,
    type evidence_reader_model,
    type long_memory,
    type public_recall_query,
} from 'longmemory';

export async function answer_authorized_query(
    memory: long_memory,
    model: evidence_reader_model,
    scoped_query: public_recall_query,
    signal?: AbortSignal,
) {
    const recalled = await memory.recall(scoped_query);
    if (!('context' in recalled)) throw new Error('Recall did not return an evidence context');
    return answer_from_evidence(
        {
            question: scoped_query.text,
            sources: recalled.context.evidence,
            knowledge: 'evidence-only',
            signal,
        },
        model,
    );
}
```

Construct `scoped_query` using your application's authenticated identity,
permissions, selected world, and temporal scope. Do not let an untrusted caller
choose another user's scope. The adapter itself has no database access and does
not authorize supplied sources. Only pass evidence the user may access and that
your selected model is allowed to process; apply redaction and retention rules
before calling it.

You can instead supply your own evidence objects. Each has a unique `id` and
`text`, with optional `speaker`, `observed_at` (Unix milliseconds), and `status`
(`current`, `superseded`, or `contradicted`). Other fields are stripped before
generation, including arbitrary metadata. IDs and quotes are preserved exactly.
Returned references refer to these supplied evidence objects; when the text is a
multi-source bundle, keep your original bundle provenance for further inspection.

## Model Contract

Provide an object with `generate(request): Promise<{ text: string }>`. The request
contains `system`, `user`, `json: true`, `max_tokens`, and an `AbortSignal`.
Map these to your model client's corresponding options and return its response
text. Local and hosted models use the same interface; no SDK is required by the
adapter. Use a model that can follow structured-output instructions.

The callback must disable tools/browsing, use the supplied prompts without
injecting private ambient context, and honor the output limit and abort signal.
The adapter makes at most one callback invocation, but cannot prevent retries or
tool calls performed internally by your callback. Keep that transport policy
explicit. The adapter will stop waiting on timeout/cancellation even if the
callback ignores the signal; it cannot force that provider to stop computing or
billing. Its post-response size check likewise cannot prevent upstream allocation
or token spending, so enforce streaming/response limits in your client too.

## Policies and Limits

| Option                               | Default               | Behavior                                                                                                                 |
| ------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `knowledge`                          | `evidence-only`       | No separate general-knowledge inference; deductions may use supplied evidence                                            |
| `knowledge: allow-general-inference` | Opt-in                | Allows recommendations/inference based on grounded premises, with an `inference` field separate from source-backed facts |
| `output_language`                    | Question language     | Model instruction; source excerpts remain in their original language                                                     |
| `question_time`                      | Unspecified           | Optional Unix-millisecond anchor for relative-time questions                                                             |
| `max_context_tokens`                 | 2048; maximum 32768   | Estimated allowance for serialized sources, not the whole prompt or a provider-exact token count                         |
| `max_output_tokens`                  | 2048; maximum 8192    | Requested limit passed to the model callback                                                                             |
| `max_response_chars`                 | 32768; maximum 131072 | Rejects larger returned strings before JSON parsing                                                                      |
| `timeout_ms`                         | 60000; maximum 300000 | Per-call timeout; combined with caller cancellation                                                                      |

Up to 64 sources are accepted, each at most 262144 UTF-16 code units. Sources
are considered in supplied order. Oversized sources are omitted whole, not
silently truncated; later smaller sources may still fit. `used_source_ids` means
sent to the model, not necessarily cited. `omitted_source_ids` identifies skipped
sources. No model call occurs if there is no usable evidence. Retrieval is the
caller's responsibility, and the adapter does not fetch omitted or missing data.

The model returns a small ledger of subject/relation/object facts with exact
source excerpts, a final answer, optional general inference, and missing-evidence
descriptions. These are declarative facts, not a reasoning transcript. The output
allows at most 32 facts with eight citations each; excessively large schemas fail
closed. This is intentionally bounded, not an exhaustive whole-corpus report API.

## Results and Errors

- `answered`: a nonempty answer and at least one fact whose citations pass the
  reference/excerpt checks. `missing_evidence` is empty.
- `insufficient_evidence`: `answer` and `inference` are null; missing evidence or
  ambiguity is described. Partial cited facts may be returned. Applications can
  render their own localized abstention; no fixed English user-facing answer is
  imposed. The no-source diagnostic message is internal English text.
- `invalid_response`: malformed, oversized, inconsistent, or unsupported output.
  `answer` is null and draft facts/inference are discarded. `validation_errors`
  contains a reason code such as `invalid_json`, `invalid_schema`,
  `unknown_source`, or `quote_not_in_source`. There is no automatic repair call.

Invalid requests and duplicate source IDs throw. Model errors, timeout, and
caller cancellation also reject the promise; they are not reported as successful
abstentions. Handle errors at your application boundary and do not expose provider
error details or private evidence in public logs.

`citations_verified` means only that every returned citation refers to a source
actually sent and that its quote is an exact contiguous excerpt. It does **not**
verify semantic entailment, source reliability, completeness, actor attribution,
arithmetic, language compliance, or the truth of the answer. A model can still
misinterpret a valid quote or leave unsupported claims in its answer. Evidence is
serialized as data and the prompt rejects source instructions, but this is not a
prompt-injection-proof security sandbox. Treat all returned strings as untrusted
when rendering them. Use appropriate review for consequential decisions.

The adapter never writes facts, infers supersession, changes memory contracts,
or merges event identities. Those remain core/application decisions. Automatic
follow-up retrieval is intentionally absent; a future bounded extension needs
independent evaluation and must preserve the original authorization and time scope.
