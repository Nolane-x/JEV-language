import {
  err,
  ok,
  StructuredError,
  type Result,
  type SemanticId,
} from "../../core-types/src/index.ts";
import type { ConceptRef } from "../../ontology/src/index.ts";
import type { ProvenanceRef } from "../../provenance/src/index.ts";
import type {
  LocationNode,
  QuantityNode,
  QuantityRange,
  QuantityTolerance,
  SemanticRef,
} from "./nodes.ts";

export type ComparisonOperator =
  | "equal"
  | "not-equal"
  | "less-than"
  | "less-than-or-equal"
  | "greater-than"
  | "greater-than-or-equal";

export interface ComparisonSpec {
  id: string;
  left: SemanticRef;
  right: SemanticRef;
  operator: ComparisonOperator;
  dimension?: string;
  unit?: ConceptRef;
  tolerance?: QuantityTolerance;
}

export type SuperlativeExtreme = "minimum" | "maximum";

export interface SuperlativeComparisonSet {
  id: string;
  members: SemanticRef[];
  dimension: string;
  extreme: SuperlativeExtreme;
  selected?: SemanticRef[];
  tiesAllowed: boolean;
}

const finiteNonNegative = (value: number): boolean =>
  Number.isFinite(value) && value >= 0;

export const validateQuantityTolerance = (
  tolerance: QuantityTolerance | undefined,
): Result<void> => {
  if (tolerance === undefined) return ok(undefined);
  if (
    tolerance.absolute === undefined &&
    tolerance.relative === undefined
  ) {
    return err(
      new StructuredError(
        "SEM_QUANTITY_TOLERANCE_EMPTY",
        "Quantity tolerance must declare an absolute or relative tolerance.",
      ),
    );
  }
  if (
    tolerance.absolute !== undefined &&
    !finiteNonNegative(tolerance.absolute)
  ) {
    return err(
      new StructuredError(
        "SEM_QUANTITY_TOLERANCE_ABSOLUTE",
        "Absolute quantity tolerance must be finite and non-negative.",
      ),
    );
  }
  if (
    tolerance.relative !== undefined &&
    (!finiteNonNegative(tolerance.relative) || tolerance.relative > 1)
  ) {
    return err(
      new StructuredError(
        "SEM_QUANTITY_TOLERANCE_RELATIVE",
        "Relative quantity tolerance must be finite and in [0, 1].",
      ),
    );
  }
  return ok(undefined);
};

export const validateQuantityRange = (
  range: QuantityRange | undefined,
): Result<void> => {
  if (range === undefined) return ok(undefined);
  if (
    !Number.isFinite(range.minimum) ||
    !Number.isFinite(range.maximum) ||
    range.minimum > range.maximum
  ) {
    return err(
      new StructuredError(
        "SEM_QUANTITY_RANGE_INVALID",
        "Quantity ranges require finite bounds with minimum <= maximum.",
      ),
    );
  }
  return ok(undefined);
};

export const validateQuantitySemantics = (
  quantity: Pick<
    QuantityNode,
    "amount" | "comparator" | "approximate" | "tolerance" | "range"
  >,
): Result<void> => {
  if (!Number.isFinite(quantity.amount)) {
    return err(
      new StructuredError(
        "SEM_QUANTITY_AMOUNT_INVALID",
        "Quantity amount must be finite.",
      ),
    );
  }
  const tolerance = validateQuantityTolerance(quantity.tolerance);
  if (!tolerance.ok) return tolerance;
  const range = validateQuantityRange(quantity.range);
  if (!range.ok) return range;

  if (
    quantity.range !== undefined &&
    quantity.comparator !== "exact"
  ) {
    return err(
      new StructuredError(
        "SEM_QUANTITY_RANGE_COMPARATOR",
        "A bounded quantity range must not also carry a directional comparator.",
      ),
    );
  }
  if (
    quantity.approximate === false &&
    quantity.tolerance !== undefined
  ) {
    return err(
      new StructuredError(
        "SEM_QUANTITY_TOLERANCE_EXACTNESS",
        "Explicit tolerance requires approximate quantity semantics.",
      ),
    );
  }
  return ok(undefined);
};

export const validateComparison = (
  comparison: ComparisonSpec,
): Result<void> => {
  if (
    comparison.id.trim() === "" ||
    comparison.left.trim() === "" ||
    comparison.right.trim() === ""
  ) {
    return err(
      new StructuredError(
        "SEM_COMPARISON_IDENTITY",
        "Comparison id and operands must be non-empty.",
      ),
    );
  }
  const tolerance = validateQuantityTolerance(comparison.tolerance);
  if (!tolerance.ok) return tolerance;
  return ok(undefined);
};

export const validateSuperlativeComparisonSet = (
  comparison: SuperlativeComparisonSet,
): Result<void> => {
  if (
    comparison.id.trim() === "" ||
    comparison.dimension.trim() === "" ||
    comparison.members.length === 0 ||
    new Set(comparison.members).size !== comparison.members.length
  ) {
    return err(
      new StructuredError(
        "SEM_SUPERLATIVE_SET_INVALID",
        "Superlative sets require id, dimension, and unique non-empty members.",
      ),
    );
  }
  if (
    comparison.members.some((member) => member.trim() === "") ||
    comparison.selected?.some(
      (selected) => !comparison.members.includes(selected),
    ) === true
  ) {
    return err(
      new StructuredError(
        "SEM_SUPERLATIVE_SELECTION_INVALID",
        "Selected superlative members must belong to the comparison set.",
      ),
    );
  }
  if (
    comparison.selected !== undefined &&
    !comparison.tiesAllowed &&
    comparison.selected.length > 1
  ) {
    return err(
      new StructuredError(
        "SEM_SUPERLATIVE_TIE_FORBIDDEN",
        "This superlative comparison does not permit ties.",
      ),
    );
  }
  return ok(undefined);
};

export interface UnitDefinition {
  id: string;
  dimension: string;
  canonical: boolean;
  scaleToCanonical: number;
  offsetToCanonical?: number;
  symbols?: string[];
}

export interface UnitConversionEvidence {
  sourceUnit: string;
  targetUnit: string;
  dimension: string;
  input: number;
  output: number;
  provenance: ProvenanceRef[];
  formula: {
    scale: number;
    offset: number;
  };
}

export class UnitDimensionRegistry {
  readonly #units = new Map<string, UnitDefinition>();

  register(definition: UnitDefinition): Result<void> {
    if (
      definition.id.trim() === "" ||
      definition.dimension.trim() === "" ||
      !Number.isFinite(definition.scaleToCanonical) ||
      definition.scaleToCanonical <= 0 ||
      (definition.offsetToCanonical !== undefined &&
        !Number.isFinite(definition.offsetToCanonical))
    ) {
      return err(
        new StructuredError(
          "SEM_UNIT_DEFINITION_INVALID",
          "Units require id, dimension, positive finite scale, and finite optional offset.",
        ),
      );
    }
    if (this.#units.has(definition.id)) {
      return err(
        new StructuredError(
          "SEM_UNIT_DUPLICATE",
          `Unit already registered: ${definition.id}`,
        ),
      );
    }
    this.#units.set(definition.id, structuredClone(definition));
    return ok(undefined);
  }

  get(id: string): UnitDefinition | undefined {
    const unit = this.#units.get(id);
    return unit === undefined ? undefined : structuredClone(unit);
  }

  validateUnitDimension(unitId: string, dimension: string): Result<void> {
    const unit = this.#units.get(unitId);
    if (unit === undefined) {
      return err(
        new StructuredError(
          "SEM_UNIT_UNKNOWN",
          `Unknown unit: ${unitId}`,
        ),
      );
    }
    if (unit.dimension !== dimension) {
      return err(
        new StructuredError(
          "SEM_UNIT_DIMENSION_MISMATCH",
          `Unit ${unitId} belongs to ${unit.dimension}, not ${dimension}.`,
        ),
      );
    }
    return ok(undefined);
  }

  convert(input: {
    value: number;
    sourceUnit: string;
    targetUnit: string;
    provenance: ProvenanceRef[];
  }): Result<UnitConversionEvidence> {
    if (!Number.isFinite(input.value)) {
      return err(
        new StructuredError(
          "SEM_UNIT_VALUE_INVALID",
          "Unit conversion input must be finite.",
        ),
      );
    }
    const source = this.#units.get(input.sourceUnit);
    const target = this.#units.get(input.targetUnit);
    if (source === undefined || target === undefined) {
      return err(
        new StructuredError(
          "SEM_UNIT_UNKNOWN",
          "Unit conversion requires both units to be registered.",
        ),
      );
    }
    if (source.dimension !== target.dimension) {
      return err(
        new StructuredError(
          "SEM_UNIT_DIMENSION_MISMATCH",
          "Unit conversion cannot cross semantic dimensions.",
        ),
      );
    }
    if (input.provenance.length === 0) {
      return err(
        new StructuredError(
          "SEM_UNIT_CONVERSION_PROVENANCE",
          "Unit conversion evidence requires at least one provenance reference.",
        ),
      );
    }

    const sourceOffset = source.offsetToCanonical ?? 0;
    const targetOffset = target.offsetToCanonical ?? 0;
    const canonical =
      input.value * source.scaleToCanonical + sourceOffset;
    const output =
      (canonical - targetOffset) / target.scaleToCanonical;
    const scale = source.scaleToCanonical / target.scaleToCanonical;
    const offset =
      (sourceOffset - targetOffset) / target.scaleToCanonical;

    return ok({
      sourceUnit: source.id,
      targetUnit: target.id,
      dimension: source.dimension,
      input: input.value,
      output,
      provenance: [...input.provenance],
      formula: { scale, offset },
    });
  }
}

export interface QuantityMeasurement {
  amount: number;
  unit: string;
  tolerance?: QuantityTolerance;
}

export interface QuantityNearMatchResult {
  equivalent: boolean;
  leftAmount: number;
  rightAmountInLeftUnit: number;
  delta: number;
  allowedDelta: number;
  conversion: UnitConversionEvidence | null;
}

const allowedTolerance = (
  measurement: QuantityMeasurement,
): number => {
  const absolute = measurement.tolerance?.absolute ?? 0;
  const relative =
    (measurement.tolerance?.relative ?? 0) * Math.abs(measurement.amount);
  return Math.max(absolute, relative);
};

export const compareQuantityMeasurements = (
  left: QuantityMeasurement,
  right: QuantityMeasurement,
  registry: UnitDimensionRegistry,
  provenance: ProvenanceRef[],
): Result<QuantityNearMatchResult> => {
  if (
    !Number.isFinite(left.amount) ||
    !Number.isFinite(right.amount) ||
    left.unit.trim() === "" ||
    right.unit.trim() === ""
  ) {
    return err(
      new StructuredError(
        "SEM_QUANTITY_COMPARISON_INVALID",
        "Quantity comparison requires finite amounts and explicit units.",
      ),
    );
  }
  const leftTolerance = validateQuantityTolerance(left.tolerance);
  if (!leftTolerance.ok) return leftTolerance;
  const rightTolerance = validateQuantityTolerance(right.tolerance);
  if (!rightTolerance.ok) return rightTolerance;

  let convertedRight = right.amount;
  let conversion: UnitConversionEvidence | null = null;
  if (left.unit !== right.unit) {
    const converted = registry.convert({
      value: right.amount,
      sourceUnit: right.unit,
      targetUnit: left.unit,
      provenance,
    });
    if (!converted.ok) return converted;
    convertedRight = converted.value.output;
    conversion = converted.value;
  } else {
    const dimension = registry.get(left.unit)?.dimension;
    if (dimension === undefined) {
      return err(
        new StructuredError(
          "SEM_UNIT_UNKNOWN",
          `Unknown unit: ${left.unit}`,
        ),
      );
    }
  }

  const delta = Math.abs(left.amount - convertedRight);
  const rightAbsoluteTolerance =
    (right.tolerance?.absolute ?? 0) *
    Math.abs(conversion?.formula.scale ?? 1);
  const rightRelativeTolerance =
    (right.tolerance?.relative ?? 0) * Math.abs(convertedRight);
  const allowedDelta = Math.max(
    allowedTolerance(left),
    rightAbsoluteTolerance,
    rightRelativeTolerance,
  );

  return ok({
    equivalent: delta <= allowedDelta,
    leftAmount: left.amount,
    rightAmountInLeftUnit: convertedRight,
    delta,
    allowedDelta,
    conversion,
  });
};

export type SpatialRelationKind =
  | "inside"
  | "contains"
  | "overlaps"
  | "touches"
  | "near"
  | "far"
  | "left-of"
  | "right-of"
  | "above"
  | "below"
  | "in-front-of"
  | "behind"
  | "north-of"
  | "south-of"
  | "east-of"
  | "west-of";

export type SpatialUncertainty =
  | {
      kind: "radius";
      amount: number;
      unit: string;
      confidence?: number;
    }
  | {
      kind: "qualitative";
      level: "low" | "medium" | "high" | "unknown";
      confidence?: number;
    };

export interface SpatialRelationSpec {
  id: string;
  source: SemanticRef;
  target: SemanticRef;
  relation: SpatialRelationKind;
  uncertainty?: SpatialUncertainty;
}

export interface MotionPathSpec {
  id: string;
  movingEntity: SemanticRef;
  motionEvent?: SemanticRef;
  source?: SemanticRef;
  goal?: SemanticRef;
  via?: SemanticRef[];
  path?: SemanticRef;
}

const validateConfidence = (value: number | undefined): boolean =>
  value === undefined ||
  (Number.isFinite(value) && value >= 0 && value <= 1);

export const validateSpatialRelation = (
  relation: SpatialRelationSpec,
  registry?: UnitDimensionRegistry,
): Result<void> => {
  if (
    relation.id.trim() === "" ||
    relation.source.trim() === "" ||
    relation.target.trim() === ""
  ) {
    return err(
      new StructuredError(
        "SEM_SPATIAL_RELATION_INVALID",
        "Spatial relations require id, source, and target.",
      ),
    );
  }
  if (
    relation.uncertainty !== undefined &&
    !validateConfidence(relation.uncertainty.confidence)
  ) {
    return err(
      new StructuredError(
        "SEM_SPATIAL_CONFIDENCE_INVALID",
        "Spatial uncertainty confidence must be in [0, 1].",
      ),
    );
  }
  if (relation.uncertainty?.kind === "radius") {
    if (
      !finiteNonNegative(relation.uncertainty.amount) ||
      relation.uncertainty.unit.trim() === ""
    ) {
      return err(
        new StructuredError(
          "SEM_SPATIAL_RADIUS_INVALID",
          "Spatial radius uncertainty requires a non-negative amount and unit.",
        ),
      );
    }
    if (registry !== undefined) {
      const unit = registry.validateUnitDimension(
        relation.uncertainty.unit,
        "length",
      );
      if (!unit.ok) return unit;
    }
  }
  return ok(undefined);
};

export const validateMotionPath = (
  motion: MotionPathSpec,
): Result<void> => {
  if (
    motion.id.trim() === "" ||
    motion.movingEntity.trim() === ""
  ) {
    return err(
      new StructuredError(
        "SEM_MOTION_PATH_INVALID",
        "Motion path requires id and moving entity.",
      ),
    );
  }
  const via = motion.via ?? [];
  if (
    via.some((ref) => ref.trim() === "") ||
    new Set(via).size !== via.length
  ) {
    return err(
      new StructuredError(
        "SEM_MOTION_VIA_INVALID",
        "Motion via locations must be unique non-empty references.",
      ),
    );
  }
  if (
    motion.source === undefined &&
    motion.goal === undefined &&
    motion.path === undefined &&
    via.length === 0
  ) {
    return err(
      new StructuredError(
        "SEM_MOTION_PATH_EMPTY",
        "Motion semantics require at least one source, goal, path, or via location.",
      ),
    );
  }
  return ok(undefined);
};

export interface SpatialOntologyHooks {
  locationConcept: ConceptRef;
  spatialRegionConcept: ConceptRef;
  pathConcept: ConceptRef;
  distanceConcept: ConceptRef;
  spatialRelation: ConceptRef;
  sourceRole: ConceptRef;
  goalRole: ConceptRef;
  pathRole: ConceptRef;
}

export const CORE_SPATIAL_ONTOLOGY: SpatialOntologyHooks = {
  locationConcept: "concept:core.location" as ConceptRef,
  spatialRegionConcept: "concept:core.spatial-region" as ConceptRef,
  pathConcept: "concept:core.path" as ConceptRef,
  distanceConcept: "concept:core.distance" as ConceptRef,
  spatialRelation: "relation:core.spatial-relation" as ConceptRef,
  sourceRole: "role:core.source-location" as ConceptRef,
  goalRole: "role:core.goal-location" as ConceptRef,
  pathRole: "role:core.path" as ConceptRef,
};

export const locationSupportsSpatialSemantics = (
  location: LocationNode,
): boolean => location.locationKind === "physical";
