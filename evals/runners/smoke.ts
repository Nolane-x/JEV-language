import { parseControlledRequirement } from "../../packages/grounding/src/index.ts";
import { realizeControlledEnglish } from "../../packages/realizer-core/src/index.ts";
import { verifyControlledEquivalence } from "../../packages/verifier-core/src/index.ts";

const input = "The service must not delete more than 3 files.";
const parsed = parseControlledRequirement(input);
if (!parsed.ok) throw parsed.error;

const realized = realizeControlledEnglish(parsed.value.snapshot);
if (!realized.ok) throw realized.error;

const reparsed = parseControlledRequirement(realized.value);
if (!reparsed.ok) throw reparsed.error;

const report = verifyControlledEquivalence(
  parsed.value.snapshot,
  reparsed.value.snapshot,
);

console.log(
  JSON.stringify(
    {
      input,
      realized: realized.value,
      semanticEquivalent: report.equivalent,
    },
    null,
    2,
  ),
);
