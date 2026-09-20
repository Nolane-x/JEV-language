import { readFileSync } from "node:fs";
import {
  canonicalJson,
  sha256,
  type JsonValue,
} from "../packages/core-types/src/index.ts";
import {
  InMemoryProvenanceStore,
  type ProvenanceRecord,
} from "../packages/provenance/src/index.ts";

interface StableCoreReplayFixture {
  schemaVersion: "jl-v1-stable-core-demo-1";
  id: string;
  records: ProvenanceRecord[];
  expected: {
    snapshotIds: string[];
    canonicalDigest: string;
  };
  zeroGenerativeAudit: {
    jevNative: boolean;
    generativeModelCalls: number;
    generativeEmbeddingCalls: number;
    externalGenerationServices: number;
    violations: string[];
  };
}

const fixture = JSON.parse(
  readFileSync("examples/v1/stable-core-replay.json", "utf8"),
) as StableCoreReplayFixture;

if (
  !fixture.zeroGenerativeAudit.jevNative ||
  fixture.zeroGenerativeAudit.generativeModelCalls !== 0 ||
  fixture.zeroGenerativeAudit.generativeEmbeddingCalls !== 0 ||
  fixture.zeroGenerativeAudit.externalGenerationServices !== 0 ||
  fixture.zeroGenerativeAudit.violations.length !== 0
) {
  throw new Error("Stable-core replay fixture failed zero-generative audit.");
}

const store = new InMemoryProvenanceStore();
for (const record of fixture.records) store.add(record);
const snapshot = store.snapshot();
const snapshotIds = snapshot.map((record) => record.id);
const canonicalDigest = sha256(
  canonicalJson(snapshot as unknown as JsonValue),
);

if (
  JSON.stringify(snapshotIds) !==
    JSON.stringify(fixture.expected.snapshotIds) ||
  canonicalDigest !== fixture.expected.canonicalDigest
) {
  throw new Error(
    `Stable-core replay mismatch: ids=${JSON.stringify(snapshotIds)} digest=${canonicalDigest}`,
  );
}

process.stdout.write(
  JSON.stringify(
    {
      id: fixture.id,
      status: "pass",
      snapshotIds,
      canonicalDigest,
      zeroGenerative: true,
    },
    null,
    2,
  ) + "\n",
);
