import {
  createSemanticId,
  type JsonValue,
  type SemanticId,
  type TrustLabel,
} from "../../core-types/src/index.ts";

export type ProvenanceId = SemanticId;
export type ProvenanceRef = ProvenanceId;

export type ProvenanceOriginType =
  | "user-input"
  | "external-content"
  | "deterministic-derivation"
  | "jev-decision"
  | "tool-result"
  | "configured-knowledge"
  | "generated-expression";

export interface ProvenanceRecord {
  id: ProvenanceId;
  originType: ProvenanceOriginType;
  sourceRefs: ProvenanceRef[];
  transformation?: string;
  timestamp?: string;
  trust: TrustLabel;
  metadata?: JsonValue;
}

export const createProvenance = (
  input: Omit<ProvenanceRecord, "id">,
): ProvenanceRecord => ({
  id: createSemanticId("prov"),
  ...input,
});

export class InMemoryProvenanceStore {
  #records = new Map<ProvenanceId, ProvenanceRecord>();

  add(record: ProvenanceRecord): void {
    this.#records.set(record.id, structuredClone(record));
  }

  get(id: ProvenanceId): ProvenanceRecord | undefined {
    const value = this.#records.get(id);
    return value === undefined ? undefined : structuredClone(value);
  }

  has(id: ProvenanceId): boolean {
    return this.#records.has(id);
  }

  snapshot(): ProvenanceRecord[] {
    return [...this.#records.values()]
      .map((record) => structuredClone(record))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
