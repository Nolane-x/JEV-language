import { parseControlledRequirement } from "../packages/grounding/src/index.ts";
import { realizeControlledEnglish } from "../packages/realizer-core/src/index.ts";
import {
  auditZeroGenerative,
} from "../packages/evaluation-core/src/index.ts";
import { verifyControlledEquivalence } from "../packages/verifier-core/src/index.ts";

const input = "The service must not delete more than 3 files.";

const parsed = parseControlledRequirement(input);
if (!parsed.ok) throw parsed.error;

const realized = realizeControlledEnglish(parsed.value.snapshot);
if (!realized.ok) throw realized.error;

const reparsed = parseControlledRequirement(realized.value);
if (!reparsed.ok) throw reparsed.error;

const equivalence = verifyControlledEquivalence(
  parsed.value.snapshot,
  reparsed.value.snapshot,
);
if (!equivalence.equivalent) {
  throw new Error(
    `Round-trip semantic equivalence failed: ${JSON.stringify({
      left: equivalence.left ?? null,
      right: equivalence.right ?? null,
    })}`,
  );
}

const audit = auditZeroGenerative({
  generativeModelCalls: 0,
  generativeEmbeddingCalls: 0,
  externalGenerationServices: 0,
});
if (!audit.ok) throw audit.error;

console.log(
  JSON.stringify(
    {
      demo: "native-v0.4-roundtrip",
      input,
      realized: realized.value,
      semanticEquivalent: equivalence.equivalent,
      zeroGenerative: audit.value,
    },
    null,
    2,
  ),
);
