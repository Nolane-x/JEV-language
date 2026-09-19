import { describe, expect, it } from "vitest";
import type { SemanticId } from "../../packages/core-types/src/index.ts";
import { createCoreOntology } from "../../packages/ontology/src/index.ts";
import type { ProvenanceRef } from "../../packages/provenance/src/index.ts";
import {
  CORE_SPATIAL_ONTOLOGY,
  UnitDimensionRegistry,
  compareQuantityMeasurements,
  locationSupportsSpatialSemantics,
  validateComparison,
  validateMotionPath,
  validateQuantitySemantics,
  validateSpatialRelation,
  validateSuperlativeComparisonSet,
  type LocationNode,
} from "../../packages/semantic-graph/src/index.ts";

const sid = (value: string): SemanticId => value as SemanticId;
const provenance = ["prov:t351"] as ProvenanceRef[];

const registry = (): UnitDimensionRegistry => {
  const units = new UnitDimensionRegistry();
  for (const definition of [
    {
      id: "meter",
      dimension: "length",
      canonical: true,
      scaleToCanonical: 1,
    },
    {
      id: "kilometer",
      dimension: "length",
      canonical: false,
      scaleToCanonical: 1000,
    },
    {
      id: "centimeter",
      dimension: "length",
      canonical: false,
      scaleToCanonical: 0.01,
    },
    {
      id: "second",
      dimension: "time",
      canonical: true,
      scaleToCanonical: 1,
    },
  ]) {
    const added = units.register(definition);
    if (!added.ok) throw added.error;
  }
  return units;
};

describe("T351-T360 comparison, quantity, and space conformance", () => {
  it("T351 validates an explicit comparison schema without collapsing operands", () => {
    const result = validateComparison({
      id: "comparison:height",
      left: sid("entity:a"),
      right: sid("entity:b"),
      operator: "greater-than",
      dimension: "length",
      tolerance: { absolute: 0.01 },
    });
    expect(result.ok).toBe(true);

    const invalid = validateComparison({
      id: "",
      left: sid("entity:a"),
      right: sid("entity:b"),
      operator: "equal",
    });
    expect(invalid.ok).toBe(false);
  });

  it("T352 models superlatives over an explicit comparison set and tie policy", () => {
    const valid = validateSuperlativeComparisonSet({
      id: "superlative:tallest",
      members: [sid("entity:a"), sid("entity:b"), sid("entity:c")],
      dimension: "height",
      extreme: "maximum",
      selected: [sid("entity:b")],
      tiesAllowed: false,
    });
    expect(valid.ok).toBe(true);

    const duplicate = validateSuperlativeComparisonSet({
      id: "superlative:duplicate",
      members: [sid("entity:a"), sid("entity:a")],
      dimension: "height",
      extreme: "maximum",
      tiesAllowed: true,
    });
    expect(duplicate.ok).toBe(false);

    const forbiddenTie = validateSuperlativeComparisonSet({
      id: "superlative:no-tie",
      members: [sid("entity:a"), sid("entity:b")],
      dimension: "height",
      extreme: "maximum",
      selected: [sid("entity:a"), sid("entity:b")],
      tiesAllowed: false,
    });
    expect(forbiddenTie.ok).toBe(false);
  });

  it("T353 refines quantities with tolerance and bounded ranges", () => {
    expect(
      validateQuantitySemantics({
        amount: 10,
        comparator: "exact",
        approximate: true,
        tolerance: { absolute: 0.5, relative: 0.02 },
      }).ok,
    ).toBe(true);

    expect(
      validateQuantitySemantics({
        amount: 10,
        comparator: "exact",
        range: {
          minimum: 9.5,
          maximum: 10.5,
          inclusiveMinimum: true,
          inclusiveMaximum: true,
        },
      }).ok,
    ).toBe(true);

    expect(
      validateQuantitySemantics({
        amount: 10,
        comparator: "at-least",
        range: { minimum: 9, maximum: 11 },
      }).ok,
    ).toBe(false);

    expect(
      validateQuantitySemantics({
        amount: 10,
        comparator: "exact",
        approximate: false,
        tolerance: { absolute: 0.1 },
      }).ok,
    ).toBe(false);
  });

  it("T354 enforces unit dimensions instead of accepting surface-compatible numbers", () => {
    const units = registry();
    expect(units.validateUnitDimension("meter", "length").ok).toBe(true);
    expect(units.validateUnitDimension("second", "length").ok).toBe(false);

    const crossDimension = units.convert({
      value: 1,
      sourceUnit: "meter",
      targetUnit: "second",
      provenance,
    });
    expect(crossDimension.ok).toBe(false);
  });

  it("T355 installs a minimal spatial ontology with location/path/distance hooks", () => {
    const ontology = createCoreOntology();
    expect(
      ontology.isA(
        CORE_SPATIAL_ONTOLOGY.spatialRegionConcept,
        CORE_SPATIAL_ONTOLOGY.locationConcept,
      ),
    ).toBe(true);
    expect(ontology.getConcept(CORE_SPATIAL_ONTOLOGY.pathConcept)).toBeDefined();
    expect(
      ontology.isA(
        CORE_SPATIAL_ONTOLOGY.distanceConcept,
        "concept:core.quantity" as SemanticId,
      ),
    ).toBe(true);
    expect(
      ontology.relationDomain("relation:core.spatial-relation" as SemanticId),
    ).toEqual(["concept:core.location"]);
    expect(
      ontology.getRole("role:core.source-location" as SemanticId)?.range,
    ).toEqual(["concept:core.location"]);
  });

  it("T356 represents motion source/goal/path without inventing a route", () => {
    const motion = validateMotionPath({
      id: "motion:delivery",
      movingEntity: sid("entity:parcel"),
      motionEvent: sid("event:delivery"),
      source: sid("location:warehouse"),
      goal: sid("location:customer"),
      via: [sid("location:hub")],
      path: sid("path:route-7"),
    });
    expect(motion.ok).toBe(true);

    expect(
      validateMotionPath({
        id: "motion:empty",
        movingEntity: sid("entity:parcel"),
      }).ok,
    ).toBe(false);
  });

  it("T357 keeps relative-location uncertainty explicit and dimension-checked", () => {
    const units = registry();
    expect(
      validateSpatialRelation(
        {
          id: "space:near",
          source: sid("location:a"),
          target: sid("location:b"),
          relation: "near",
          uncertainty: {
            kind: "radius",
            amount: 250,
            unit: "meter",
            confidence: 0.7,
          },
        },
        units,
      ).ok,
    ).toBe(true);

    expect(
      validateSpatialRelation(
        {
          id: "space:bad-radius",
          source: sid("location:a"),
          target: sid("location:b"),
          relation: "near",
          uncertainty: {
            kind: "radius",
            amount: 3,
            unit: "second",
          },
        },
        units,
      ).ok,
    ).toBe(false);
  });

  it("T358 preserves unit-conversion provenance and the applied affine formula", () => {
    const units = registry();
    const converted = units.convert({
      value: 1.25,
      sourceUnit: "kilometer",
      targetUnit: "meter",
      provenance,
    });
    expect(converted.ok).toBe(true);
    if (converted.ok) {
      expect(converted.value.output).toBe(1250);
      expect(converted.value.provenance).toEqual(provenance);
      expect(converted.value.dimension).toBe("length");
      expect(converted.value.formula).toEqual({ scale: 1000, offset: 0 });
    }

    expect(
      units.convert({
        value: 1,
        sourceUnit: "kilometer",
        targetUnit: "meter",
        provenance: [],
      }).ok,
    ).toBe(false);
  });

  it("T359 distinguishes true unit equivalence from quantitative near misses", () => {
    const units = registry();

    const equivalent = compareQuantityMeasurements(
      { amount: 1000, unit: "meter" },
      { amount: 1, unit: "kilometer" },
      units,
      provenance,
    );
    expect(equivalent.ok).toBe(true);
    if (equivalent.ok) {
      expect(equivalent.value.equivalent).toBe(true);
      expect(equivalent.value.delta).toBe(0);
      expect(equivalent.value.conversion?.provenance).toEqual(provenance);
    }

    const insideTolerance = compareQuantityMeasurements(
      {
        amount: 10,
        unit: "meter",
        tolerance: { absolute: 0.25 },
      },
      { amount: 10.2, unit: "meter" },
      units,
      provenance,
    );
    expect(insideTolerance.ok).toBe(true);
    if (insideTolerance.ok) {
      expect(insideTolerance.value.equivalent).toBe(true);
    }

    const nearMiss = compareQuantityMeasurements(
      {
        amount: 10,
        unit: "meter",
        tolerance: { absolute: 0.25 },
      },
      { amount: 10.26, unit: "meter" },
      units,
      provenance,
    );
    expect(nearMiss.ok).toBe(true);
    if (nearMiss.ok) {
      expect(nearMiss.value.equivalent).toBe(false);
      expect(nearMiss.value.delta).toBeCloseTo(0.26, 10);
      expect(nearMiss.value.allowedDelta).toBe(0.25);
    }
  });

  it("T360 keeps physical-location semantics distinct from virtual/logical locations", () => {
    const base = {
      schemaVersion: "0.1.0",
      ontologyVersion: "0.1.0",
      provenance,
      trust: "user-content" as const,
      value: {
        kind: "string" as const,
        value: {
          kind: "surface-literal" as const,
          value: "zone",
          origin: "parsed-literal" as const,
        },
      },
    };
    const physical: LocationNode = {
      ...base,
      id: sid("location:physical"),
      kind: "location",
      locationKind: "physical",
    };
    const virtual: LocationNode = {
      ...base,
      id: sid("location:virtual"),
      kind: "location",
      locationKind: "virtual",
    };

    expect(locationSupportsSpatialSemantics(physical)).toBe(true);
    expect(locationSupportsSpatialSemantics(virtual)).toBe(false);

    const units = registry();
    expect(
      validateSpatialRelation(
        {
          id: "space:west",
          source: physical.id,
          target: sid("location:other"),
          relation: "west-of",
          uncertainty: {
            kind: "qualitative",
            level: "medium",
            confidence: 0.6,
          },
        },
        units,
      ).ok,
    ).toBe(true);
  });
});
