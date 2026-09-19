import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";

export type PirType =
  | { kind: "boolean" }
  | { kind: "number" }
  | { kind: "string" }
  | { kind: "record"; fields: Record<string, PirType> }
  | { kind: "list"; element: PirType };

export interface PirParameter {
  id: string;
  name: string;
  type: PirType;
}

export type PirExpression =
  | { kind: "hole"; id: string; expected: PirType }
  | { kind: "variable"; symbolId: string }
  | { kind: "property"; object: PirExpression; property: string }
  | {
      kind: "filter";
      collection: PirExpression;
      item: PirParameter;
      predicate: PirExpression;
    };

export interface PirFunction {
  kind: "function";
  id: string;
  name: string;
  parameters: PirParameter[];
  returnType: PirType;
  body: PirExpression;
}

export interface PirProgram {
  version: string;
  functions: PirFunction[];
}

export const samePirType = (a: PirType, b: PirType): boolean => {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "boolean":
    case "number":
    case "string":
      return true;
    case "list":
      return b.kind === "list" && samePirType(a.element, b.element);
    case "record": {
      if (b.kind !== "record") return false;
      const aKeys = Object.keys(a.fields).sort();
      const bKeys = Object.keys(b.fields).sort();
      return (
        aKeys.length === bKeys.length &&
        aKeys.every(
          (key, index) =>
            key === bKeys[index] &&
            b.fields[key] !== undefined &&
            samePirType(a.fields[key]!, b.fields[key]!),
        )
      );
    }
  }
};

type Scope = Map<string, PirType>;

const inferExpression = (
  expression: PirExpression,
  scope: Scope,
): Result<PirType> => {
  switch (expression.kind) {
    case "hole":
      return ok(expression.expected);
    case "variable": {
      const type = scope.get(expression.symbolId);
      return type === undefined
        ? err(
            new StructuredError(
              "PIR_UNKNOWN_SYMBOL",
              `Unknown PIR symbol: ${expression.symbolId}`,
            ),
          )
        : ok(type);
    }
    case "property": {
      const object = inferExpression(expression.object, scope);
      if (!object.ok) return object;
      if (object.value.kind !== "record") {
        return err(
          new StructuredError(
            "PIR_PROPERTY_NON_RECORD",
            "Property access requires a record type.",
          ),
        );
      }
      const type = object.value.fields[expression.property];
      return type === undefined
        ? err(
            new StructuredError(
              "PIR_PROPERTY_MISSING",
              `Record has no property ${expression.property}`,
            ),
          )
        : ok(type);
    }
    case "filter": {
      const collection = inferExpression(expression.collection, scope);
      if (!collection.ok) return collection;
      if (collection.value.kind !== "list") {
        return err(
          new StructuredError(
            "PIR_FILTER_NON_LIST",
            "Filter requires a list collection.",
          ),
        );
      }
      if (!samePirType(collection.value.element, expression.item.type)) {
        return err(
          new StructuredError(
            "PIR_FILTER_ITEM_TYPE",
            "Filter item type does not match collection element type.",
          ),
        );
      }
      const nested = new Map(scope);
      nested.set(expression.item.id, expression.item.type);
      const predicate = inferExpression(expression.predicate, nested);
      if (!predicate.ok) return predicate;
      if (predicate.value.kind !== "boolean") {
        return err(
          new StructuredError(
            "PIR_FILTER_PREDICATE",
            "Filter predicate must be boolean.",
          ),
        );
      }
      return ok(collection.value);
    }
  }
};

export const validatePirProgram = (program: PirProgram): Result<void> => {
  const ids = new Set<string>();
  for (const fn of program.functions) {
    if (ids.has(fn.id)) {
      return err(
        new StructuredError("PIR_DUPLICATE_ID", `Duplicate PIR id: ${fn.id}`),
      );
    }
    ids.add(fn.id);
    const scope = new Map(fn.parameters.map((parameter) => [parameter.id, parameter.type]));
    const body = inferExpression(fn.body, scope);
    if (!body.ok) return err(body.error);
    if (!samePirType(body.value, fn.returnType)) {
      return err(
        new StructuredError(
          "PIR_RETURN_TYPE",
          `Function ${fn.name} body does not match its return type.`,
        ),
      );
    }
  }
  return ok(undefined);
};

export const activeUserFilterGoal = (): PirProgram => {
  const userType: PirType = {
    kind: "record",
    fields: {
      active: { kind: "boolean" },
    },
  };
  const usersType: PirType = { kind: "list", element: userType };
  return {
    version: "0.1.0",
    functions: [
      {
        kind: "function",
        id: "function:filter-active-users",
        name: "filterActiveUsers",
        parameters: [
          { id: "param:users", name: "users", type: usersType },
        ],
        returnType: usersType,
        body: {
          kind: "hole",
          id: "hole:filter-active-users-body",
          expected: usersType,
        },
      },
    ],
  };
};
