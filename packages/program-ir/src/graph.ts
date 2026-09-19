import {
  canonicalJson,
  err,
  ok,
  sha256,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  PirFunction,
  PirModule,
  PirProgram,
  PirSymbol,
  ProgramHole,
} from "./model.ts";
import { validatePirProgram } from "./validator.ts";

export type PirGraphOperation =
  | { kind: "add-function"; value: PirFunction }
  | { kind: "replace-function"; value: PirFunction }
  | { kind: "remove-function"; id: string }
  | { kind: "add-module"; value: PirModule }
  | { kind: "replace-module"; value: PirModule }
  | { kind: "remove-module"; id: string }
  | { kind: "add-symbol"; value: PirSymbol }
  | { kind: "replace-symbol"; value: PirSymbol }
  | { kind: "remove-symbol"; id: string }
  | { kind: "add-hole"; value: ProgramHole }
  | { kind: "replace-hole"; value: ProgramHole }
  | { kind: "remove-hole"; id: string };

export interface PirGraphTransaction {
  baseRevision: string;
  operations: PirGraphOperation[];
}

export interface PirGraphSnapshot {
  revision: string;
  parentRevision?: string;
  program: PirProgram;
}

const jsonValue = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

const revisionFor = (
  parentRevision: string | undefined,
  program: PirProgram,
  operations: readonly PirGraphOperation[],
): string =>
  sha256(
    canonicalJson({
      parentRevision: parentRevision ?? null,
      program: jsonValue(program),
      operations: jsonValue(operations),
    }),
  );

const cloneProgram = (program: PirProgram): PirProgram =>
  structuredClone(program);

const arrayFor = <T>(
  value: T[] | undefined,
): T[] => value ?? [];

const replaceById = <T extends { id: string }>(
  values: T[],
  replacement: T,
  code: string,
): Result<T[]> => {
  const index = values.findIndex((value) => value.id === replacement.id);
  if (index < 0) {
    return err(
      new StructuredError(
        code,
        `Cannot replace missing PIR object ${replacement.id}.`,
      ),
    );
  }
  const next = values.map((value) => structuredClone(value));
  next[index] = structuredClone(replacement);
  return ok(next);
};

const removeById = <T extends { id: string }>(
  values: T[],
  id: string,
  code: string,
): Result<T[]> => {
  if (!values.some((value) => value.id === id)) {
    return err(
      new StructuredError(
        code,
        `Cannot remove missing PIR object ${id}.`,
      ),
    );
  }
  return ok(values.filter((value) => value.id !== id).map((value) => structuredClone(value)));
};

const addUnique = <T extends { id: string }>(
  values: T[],
  value: T,
): Result<T[]> =>
  values.some((existing) => existing.id === value.id)
    ? err(
        new StructuredError(
          "PIR_GRAPH_DUPLICATE",
          `PIR object already exists: ${value.id}.`,
        ),
      )
    : ok([...values.map((entry) => structuredClone(entry)), structuredClone(value)]);

const applyOperation = (
  program: PirProgram,
  operation: PirGraphOperation,
): Result<PirProgram> => {
  const next = cloneProgram(program);
  switch (operation.kind) {
    case "add-function": {
      const result = addUnique(next.functions, operation.value);
      if (!result.ok) return result;
      next.functions = result.value;
      return ok(next);
    }
    case "replace-function": {
      const result = replaceById(
        next.functions,
        operation.value,
        "PIR_GRAPH_FUNCTION_MISSING",
      );
      if (!result.ok) return result;
      next.functions = result.value;
      return ok(next);
    }
    case "remove-function": {
      const result = removeById(
        next.functions,
        operation.id,
        "PIR_GRAPH_FUNCTION_MISSING",
      );
      if (!result.ok) return result;
      next.functions = result.value;
      return ok(next);
    }
    case "add-module": {
      const result = addUnique(arrayFor(next.modules), operation.value);
      if (!result.ok) return result;
      next.modules = result.value;
      return ok(next);
    }
    case "replace-module": {
      const result = replaceById(
        arrayFor(next.modules),
        operation.value,
        "PIR_GRAPH_MODULE_MISSING",
      );
      if (!result.ok) return result;
      next.modules = result.value;
      return ok(next);
    }
    case "remove-module": {
      const result = removeById(
        arrayFor(next.modules),
        operation.id,
        "PIR_GRAPH_MODULE_MISSING",
      );
      if (!result.ok) return result;
      next.modules = result.value;
      return ok(next);
    }
    case "add-symbol": {
      const result = addUnique(arrayFor(next.symbols), operation.value);
      if (!result.ok) return result;
      next.symbols = result.value;
      return ok(next);
    }
    case "replace-symbol": {
      const result = replaceById(
        arrayFor(next.symbols),
        operation.value,
        "PIR_GRAPH_SYMBOL_MISSING",
      );
      if (!result.ok) return result;
      next.symbols = result.value;
      return ok(next);
    }
    case "remove-symbol": {
      const result = removeById(
        arrayFor(next.symbols),
        operation.id,
        "PIR_GRAPH_SYMBOL_MISSING",
      );
      if (!result.ok) return result;
      next.symbols = result.value;
      return ok(next);
    }
    case "add-hole": {
      const result = addUnique(arrayFor(next.holes), operation.value);
      if (!result.ok) return result;
      next.holes = result.value;
      return ok(next);
    }
    case "replace-hole": {
      const result = replaceById(
        arrayFor(next.holes),
        operation.value,
        "PIR_GRAPH_HOLE_MISSING",
      );
      if (!result.ok) return result;
      next.holes = result.value;
      return ok(next);
    }
    case "remove-hole": {
      const result = removeById(
        arrayFor(next.holes),
        operation.id,
        "PIR_GRAPH_HOLE_MISSING",
      );
      if (!result.ok) return result;
      next.holes = result.value;
      return ok(next);
    }
  }
};

export class InMemoryPirGraph {
  #program: PirProgram;
  #revision: string;
  #parentRevision: string | undefined;

  constructor(
    program: PirProgram = { version: "0.1.0", functions: [] },
  ) {
    const valid = validatePirProgram(program);
    if (!valid.ok) throw valid.error;
    this.#program = cloneProgram(program);
    this.#revision = revisionFor(undefined, this.#program, []);
  }

  static fromSnapshot(snapshot: PirGraphSnapshot): InMemoryPirGraph {
    const graph = new InMemoryPirGraph(snapshot.program);
    graph.#revision = snapshot.revision;
    graph.#parentRevision = snapshot.parentRevision;
    return graph;
  }

  get revision(): string {
    return this.#revision;
  }

  snapshot(): PirGraphSnapshot {
    return {
      revision: this.#revision,
      ...(this.#parentRevision === undefined
        ? {}
        : { parentRevision: this.#parentRevision }),
      program: cloneProgram(this.#program),
    };
  }

  beginTransaction(
    operations: PirGraphOperation[] = [],
  ): PirGraphTransaction {
    return {
      baseRevision: this.#revision,
      operations: structuredClone(operations),
    };
  }

  rollback(
    transaction: PirGraphTransaction,
  ): Result<PirGraphSnapshot> {
    if (transaction.baseRevision !== this.#revision) {
      return err(
        new StructuredError(
          "PIR_GRAPH_STALE_TRANSACTION",
          "Cannot rollback a PIR transaction created from a stale revision.",
        ),
      );
    }
    return ok(this.snapshot());
  }

  commit(
    transaction: PirGraphTransaction,
  ): Result<PirGraphSnapshot> {
    if (transaction.baseRevision !== this.#revision) {
      return err(
        new StructuredError(
          "PIR_GRAPH_STALE_TRANSACTION",
          "PIR transaction base revision does not match the current graph.",
        ),
      );
    }

    let candidate = cloneProgram(this.#program);
    for (const operation of transaction.operations) {
      const applied = applyOperation(candidate, operation);
      if (!applied.ok) return applied;
      candidate = applied.value;
    }

    const valid = validatePirProgram(candidate);
    if (!valid.ok) return err(valid.error);

    const parentRevision = this.#revision;
    const revision = revisionFor(
      parentRevision,
      candidate,
      transaction.operations,
    );
    this.#program = candidate;
    this.#parentRevision = parentRevision;
    this.#revision = revision;
    return ok(this.snapshot());
  }
}
