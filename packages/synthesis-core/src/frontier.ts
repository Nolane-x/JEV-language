import type {
  SearchFrontier,
  SynthesisState,
} from "./model.ts";

const compareStates = (a: SynthesisState, b: SynthesisState): number =>
  a.accumulatedCost - b.accumulatedCost ||
  a.openHoles.length - b.openHoles.length ||
  a.depth - b.depth ||
  a.id.localeCompare(b.id);

export class BestFirstFrontier implements SearchFrontier {
  readonly kind = "best-first";
  readonly #states: SynthesisState[] = [];

  get size(): number {
    return this.#states.length;
  }

  push(state: SynthesisState): void {
    this.#states.push(structuredClone(state));
    this.#states.sort(compareStates);
  }

  pop(): SynthesisState | undefined {
    const value = this.#states.shift();
    return value === undefined ? undefined : structuredClone(value);
  }

  snapshot(): SynthesisState[] {
    return this.#states.map((state) => structuredClone(state));
  }
}

export class BeamFrontier implements SearchFrontier {
  readonly kind = "beam";
  readonly #states: SynthesisState[] = [];

  constructor(readonly width: number) {
    if (!Number.isInteger(width) || width < 1) {
      throw new Error("Beam width must be a positive integer.");
    }
  }

  get size(): number {
    return this.#states.length;
  }

  push(state: SynthesisState): void {
    this.#states.push(structuredClone(state));
    this.#states.sort(compareStates);
    if (this.#states.length > this.width) {
      this.#states.length = this.width;
    }
  }

  pop(): SynthesisState | undefined {
    const value = this.#states.shift();
    return value === undefined ? undefined : structuredClone(value);
  }

  snapshot(): SynthesisState[] {
    return this.#states.map((state) => structuredClone(state));
  }
}
