# M9 — Multilingual Semantic Equivalence Gate Evidence

Status: **candidate — pending deterministic CI**

Specification basis: section 416, section 254, section 105, and the semantic-equivalence procedure in section 507 of the v0.4 master specification.

## Architecture

M9 evaluates language packs through the common `HumanLanguagePack` ABI verified in M8.

For semantic graph `G`:

```text
G → English realization → English parse → G_en
G → Vietnamese realization → Vietnamese parse → G_vi
```

The gate compares canonical semantic dimensions among `G`, `G_en`, and `G_vi`. It never uses surface-string equality as semantic evidence.

## Required section-416 semantic families

The shared corpus covers:

- simple facts;
- conditions;
- causality;
- negation;
- quantities;
- modality;
- reported claims;
- dialogue references;
- instructions as content.

The benchmark also retains absolute-time coverage from M8 because temporal preservation is a required cross-lingual dimension in section 254.

## New M9 semantic families

### Dialogue reference

English:

```text
Here, "it" refers to the service.
```

Vietnamese:

```text
Ở đây, "nó" chỉ dịch vụ.
```

Both parse to a shared `ReferenceNode` whose `resolved` entity is the software-service concept. The language-specific pronoun is retained only in source/annotation context and is not treated as universal semantics.

### Instruction as content

English:

```text
The instruction says the service must delete exactly 3 files.
```

Vietnamese:

```text
Chỉ dẫn yêu cầu dịch vụ xóa đúng 3 tệp.
```

Both parse to:

```text
IntentNode(intent = concept:core.instruction)
  └─ content → requirement constraint
       └─ delete action
            └─ exact quantity = 3 files
```

This represents an instruction **as semantic content**. It does not create an executable capability call, Action IR, or execution authority.

## Dimension-level evaluator

`compareControlledSemanticDimensions()` reports each dimension independently:

- semantic kind;
- predicate;
- role bindings;
- polarity;
- modality;
- quantity;
- time;
- condition;
- causality;
- attribution;
- reference;
- instruction content.

Each dimension is `pass`, `fail`, or `not-applicable`. A graph pair is equivalent only when no applicable dimension fails.

This makes semantic loss diagnosable rather than returning an unexplained boolean.

## Conformance

`tests/conformance/m9-multilingual-semantic-equivalence.conformance.test.ts` verifies for every corpus family:

1. independent English and Vietnamese surfaces parse to compatible JSG;
2. one semantic core realizes through English and Vietnamese independently;
3. each realization parses back;
4. source ↔ English-roundtrip semantic dimensions pass;
5. source ↔ Vietnamese-roundtrip semantic dimensions pass;
6. English-roundtrip ↔ Vietnamese-roundtrip semantic dimensions pass.

The suite deliberately does **not** assert generated surface text as gold.

A negative control compares positive and negative versions of the same event and requires the evaluator to report a failing `polarity` dimension.

## Evaluation manifest

`evals/manifests/m9-multilingual-semantic-equivalence.json` declares:

- supported languages;
- benchmark directions;
- semantic families;
- semantic dimensions;
- zero-failed-dimension pass policy;
- surface-gold disabled;
- `generativeLlmCalls = 0`;
- `liveJevRequests = 0`;
- deterministic D0 evaluation.

## Gate rule

Do not mark M9 **verified** until the complete branch head passes:

1. package-boundary validation;
2. strict TypeScript;
3. the full deterministic test suite;
4. every M9 corpus pair and both realization directions;
5. the negative-control semantic-loss check.

No live Jev request is required for M9.
