# NEXT AI HANDOFF — 2026-09-20

This file is the **continuation contract** for the next AI/agent working on `Nolane-x/JEV-language`.

If you are a new AI entering the repository, **read this file first**, then read:

1. `docs/IMPLEMENTATION-STATE.md`
2. `docs/TASK-LEDGER.yaml`
3. `docs/gates/M19-NATURAL-CONVERSATION.md`
4. `docs/research/NATURAL-CONVERSATION-RESEARCH-PROGRAM-v1.md`
5. `docs/evidence/CONVERSATION-RANKER-BOUNDARY-v4.json`
6. `relay/deployment-status.json`

Always start from the latest `main`. Do not branch from an older PR.

## Current continuation point

The active research milestone is:

`M19 natural-conversation research`

The engineering substrate for conversational response control is already substantially implemented. **Do not rebuild it from scratch.**

Already present on main:

- bounded conversation candidate ABI;
- Jev conversational surface-ranker Decision Pack;
- typed Response Semantic Plan;
- DialogueState → Response Semantic Plan bridge;
- English and Vietnamese conversational microgrammars;
- Response Semantic Plan → EN/VI proposal routing;
- exact-surface parser-bound semantic certification;
- verified candidate lattice;
- candidate-recall evaluation;
- anti-template style memory;
- bounded selection pipeline with confidence + probability-margin abstention;
- higher-level verified conversation-turn orchestration;
- higher-level DialogueState → verified conversational response selection;
- fixed M19 scenario pack;
- arm-neutral M19 observed runner;
- no-fabrication M19 stimulus freezer;
- browser BYOK Playground;
- production Cloudflare relay with browser contract `jev-relay-browser-v2`.

## Current web/relay state

The red Playground connection error reported earlier in the session was traced to a browser-only CORS visibility bug:

- the Worker returned `X-JEV-Relay: 1`;
- browser JavaScript could not read the header because it was not listed in `Access-Control-Expose-Headers`;
- the UI therefore rejected a healthy relay as unverified.

That path has been repaired and redeployed.

Current production evidence is in:

`relay/deployment-status.json`

Expected properties:

- `verified: true`
- browser contract: `jev-relay-browser-v2`
- browser-readable `X-JEV-Relay`
- verified GitHub Pages CORS origin
- verified browser-readable 401 envelope
- fixed relay URL:
  `https://jev-language-typesafe-relay.nolane-file.workers.dev`

The Playground now also preflights the relay when the BYOK modal opens, retries transient failures, caches a recent healthy preflight briefly, and distinguishes transient infrastructure warnings from credential errors.

**Do not remove the relay identity check or weaken it to hide an error.**
**Do not persist user API keys.**
The user's TypeSafe key must remain memory-only in the tab and only be forwarded transiently.

If a future browser regression appears, first compare the deployed Worker contract and Pages deployment against the evidence files before redesigning the transport.

## Live Jev evidence already spent

Do not repeat these runs merely to get prettier numbers.

Previously frozen conversational live evidence:

- multilingual baseline: 12 requests;
- stress v2: 18 requests;
- mirrored order-symmetry v3: 20 requests;
- boundary calibration v4: 20 requests.

Total conversational live Jev requests now used: **70**.

The v4 evidence is frozen in:

`docs/evidence/CONVERSATION-RANKER-BOUNDARY-v4.json`

Observed v4 summary:

- 20 / 20 successful requests;
- clear contextual preference: 10 / 10 agreement;
- clear-pair gate acceptance: 10 / 10;
- intentional near-tie gate abstention: 9 / 10;
- near-tie false-certainty rate: 0;
- mirrored order-invariant base pairs: 8 / 10;
- mean clear confidence: 0.977;
- mean clear margin: 0.98;
- mean near-tie confidence: 0.284;
- mean near-tie margin: 0.282;
- v4 usage: 9,230 input tokens / 680 output tokens.

Interpretation boundary:

v4 supports bounded ranker/calibration research. It **does not** prove unrestricted natural conversation or replace human M19 ratings.

## Natural-conversation task state

Treat the following as authoritative unless newer evidence on main supersedes it:

- NC-01: verified
- NC-02: verified
- NC-03: verified
- NC-04: verified
- NC-05: verified
- NC-06: verified
- NC-07: verified
- NC-08: verified
- NC-09: verified
- NC-10: verified
- NC-11: **partial**
- NC-12: verified
- NC-13: **partial**
- NC-14: **todo**
- NC-15: **partial**

Do not mark NC-11 verified merely because v4 looks good. It still needs an evidence-bound decision about calibration limits and preferably errors or human-backed disagreements.

Do not mark NC-13 complete until **real observed A/B outputs** have been captured for every preregistered M19 item/arm pair and frozen through the no-fabrication path.

Do not mark NC-14 complete without **real blinded human ratings**.

Do not fabricate evaluator ratings, synthetic “human” labels, fake preference data, or fake M19 arm outputs.

## Exact next actions

### Priority 1 — absorb v4 into NC-11

Read:

- `docs/evidence/CONVERSATION-RANKER-BOUNDARY-v4.json`
- `packages/evaluation-core/src/conversation-ranker-calibration.ts`
- `tests/conformance/conversation-ranker-calibration.conformance.test.ts`

Then:

1. add deterministic analysis for v4 clear-vs-near-tie behavior;
2. report selective coverage, near-tie abstention, false certainty, and order sensitivity;
3. keep the current confidence/margin thresholds unchanged unless evidence justifies changing them;
4. update the research ledger/state with the new 70-request total and v4 observations;
5. preserve the fact that two near-tie pairs changed candidate after A/B mirroring while remaining low-certainty/abstained.

### Priority 2 — finish NC-13 with real M19 stimuli

Read:

- `evals/manifests/m19-natural-conversation.json`
- `evals/scenarios/m19-natural-conversation-v1.json`
- `packages/evaluation-core/src/m19-observed-runner.ts`
- `packages/evaluation-core/src/m19-observed-stimulus.ts`
- `docs/research/M19-OBSERVED-STIMULUS-CAPTURE-v1.md`

Then:

1. execute both anonymous M19 arms on the fixed scenarios;
2. use real observed outputs only;
3. retain the arm-code-to-system mapping outside the evaluator-facing bundle;
4. capture exact transcripts, latency, cost, semantic evidence, observation evidence, and timestamps;
5. require exactly one capture for each item/arm pair;
6. freeze the complete 8-stimulus bundle through `freezeM19ObservedStimuli(...)`;
7. inspect the frozen evaluator worksheet for accidental system-identity leakage.

If the required second arm/system cannot be executed with available tooling, leave NC-13 partial and document the blocker instead of substituting synthetic output.

### Priority 3 — NC-14 human ratings

Only after NC-13 real stimuli are frozen:

1. generate/use the existing pseudonymous evaluator worksheet;
2. collect preregistered blinded ratings from real humans;
3. import them through the strict M19 rating path;
4. freeze ratings + failures + aggregate report with canonical digests;
5. report negative or mixed results unchanged.

This step has an unavoidable human dependency. An AI may prepare the kit, but may not impersonate the evaluators.

### Priority 4 — NC-15 error-driven iteration

Once real M19 failures exist:

1. cluster failures by semantic accuracy, coherence, reference/correction handling, social/register mismatch, code-switch handling, template leakage, and unnatural realization;
2. decide whether each failure belongs to DialogueState, Response Semantic Plan, language microgrammar, candidate recall, parser/certifier, ranker, or style memory;
3. add a minimal bounded fix;
4. add a regression test before claiming improvement;
5. rerun only the minimum live evaluation needed to falsify or support the fix.

## Architecture that must not be violated

The intended conversational execution path is:

```text
DialogueState
→ Response Semantic Plan
→ native bounded language proposals
→ exact-surface parse
→ deterministic semantic certification
→ verified candidate lattice
→ Jev bounded ranking
→ confidence/margin gate
→ selected response or explicit ambiguity
→ bounded style-memory update
```

Jev remains a bounded typed judge/ranker in this architecture.

Do not silently introduce another free-form generative LLM into the native core.
Do not bypass semantic certification merely to increase naturalness.
Do not turn parser failures into fake success.
Do not force a winner when confidence/margin says the result is ambiguous.

## Validation before every merge

Run the repository's standard deterministic gate:

```bash
npm install
npm run check
```

At the end of this session, the latest observed full main CI passed:

- **104 test files**
- **768 tests**

The exact counts may rise as new tests are added; the requirement is that the latest main CI is green.

Live TypeSafe/Jev work must remain explicitly bounded and secret-backed. Never print or commit `TYPESAFE_API_KEY`.

## Completion rule for the next AI

A new AI should be able to continue without this chat.

Before ending its own session it should:

1. update `docs/TASK-LEDGER.yaml`;
2. update `docs/IMPLEMENTATION-STATE.md`;
3. update this handoff if the continuation point changes materially;
4. freeze new live evidence under `docs/evidence/`;
5. leave main green;
6. leave no ambiguous “what next?” state.

If those documents disagree, prefer the newest machine-readable evidence and latest green `main`, then repair the documents in the same session.
