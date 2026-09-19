import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  CandidateGenerationContext,
  CandidateGenerator,
  ExpansionCandidate,
} from "./model.ts";

export class CandidateGeneratorRegistry {
  readonly #generators = new Map<string, CandidateGenerator>();

  register(generator: CandidateGenerator): Result<void> {
    if (generator.id.trim() === "") {
      return err(
        new StructuredError(
          "SYNTH_GENERATOR_ID",
          "Candidate generator id must be non-empty.",
        ),
      );
    }
    if (this.#generators.has(generator.id)) {
      return err(
        new StructuredError(
          "SYNTH_GENERATOR_DUPLICATE",
          `Candidate generator already registered: ${generator.id}.`,
        ),
      );
    }
    this.#generators.set(generator.id, generator);
    return ok(undefined);
  }

  get(id: string): CandidateGenerator | undefined {
    return this.#generators.get(id);
  }

  list(): CandidateGenerator[] {
    return [...this.#generators.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
  }

  generate(context: CandidateGenerationContext): ExpansionCandidate[] {
    const generated = this.list().flatMap((generator) =>
      generator.supports(context)
        ? generator.generate(context).map((candidate) => ({
            ...candidate,
            provenance: {
              ...candidate.provenance,
              generatorId: generator.id,
            },
          }))
        : [],
    );

    const byId = new Map<string, ExpansionCandidate>();
    for (const candidate of generated) {
      if (!byId.has(candidate.id)) {
        byId.set(candidate.id, structuredClone(candidate));
      }
    }
    return [...byId.values()].sort(
      (a, b) =>
        a.heuristicCost - b.heuristicCost || a.id.localeCompare(b.id),
    );
  }
}
