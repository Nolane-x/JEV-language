import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  PirType,
} from "../../program-ir/src/index.ts";
import {
  pythonAstNode,
  pythonAstNodes,
  type PythonAstNode,
} from "./python-ast.ts";

const stringField = (
  node: PythonAstNode,
  key: string,
): string | undefined => {
  const value = node[key];
  return typeof value === "string" ? value : undefined;
};

const nameNode = (id: string): PythonAstNode => ({
  _type: "Name",
  id,
  ctx: { _type: "Load" },
});

const constantNode = (
  value: string | number | boolean | null,
): PythonAstNode => ({
  _type: "Constant",
  value,
  kind: null,
});

const tupleNode = (
  elements: PythonAstNode[],
): PythonAstNode => ({
  _type: "Tuple",
  elts: elements,
  ctx: { _type: "Load" },
});

const subscriptNode = (
  base: string,
  slice: PythonAstNode,
): PythonAstNode => ({
  _type: "Subscript",
  value: nameNode(base),
  slice,
  ctx: { _type: "Load" },
});

const unionNode = (
  members: PythonAstNode[],
): PythonAstNode => {
  if (members.length === 0) return nameNode("object");
  let current = members[0]!;
  for (const member of members.slice(1)) {
    current = {
      _type: "BinOp",
      left: current,
      op: { _type: "BitOr" },
      right: member,
    };
  }
  return current;
};

export const liftPythonAnnotation = (
  annotation: PythonAstNode | undefined,
  typeVariables: ReadonlySet<string> = new Set<string>(),
): Result<PirType> => {
  if (annotation === undefined) return ok({ kind: "unknown" });

  if (annotation._type === "Name") {
    const id = stringField(annotation, "id");
    if (id === undefined) {
      return err(
        new StructuredError(
          "PY_LIFT_TYPE_NAME",
          "Python annotation Name is missing its identifier.",
        ),
      );
    }
    if (typeVariables.has(id)) {
      return ok({
        kind: "type-variable",
        id: `type:${id}`,
        name: id,
      });
    }
    switch (id) {
      case "bool":
        return ok({ kind: "boolean" });
      case "int":
      case "float":
      case "complex":
        return ok({ kind: "number" });
      case "str":
        return ok({ kind: "string" });
      case "None":
        return ok({ kind: "null" });
      case "Any":
      case "object":
        return ok({ kind: "unknown" });
      default:
        return ok({
          kind: "named",
          symbolId: `type:${id}`,
        });
    }
  }

  if (annotation._type === "Constant") {
    return annotation.value === null
      ? ok({ kind: "null" })
      : err(
          new StructuredError(
            "PY_LIFT_TYPE_CONSTANT",
            "Only None is supported as a constant Python type annotation.",
          ),
        );
  }

  if (
    annotation._type === "BinOp" &&
    pythonAstNode(annotation.op)?._type === "BitOr"
  ) {
    const left = liftPythonAnnotation(
      pythonAstNode(annotation.left),
      typeVariables,
    );
    if (!left.ok) return left;
    const right = liftPythonAnnotation(
      pythonAstNode(annotation.right),
      typeVariables,
    );
    if (!right.ok) return right;
    const options = [
      ...(left.value.kind === "union"
        ? left.value.options
        : [left.value]),
      ...(right.value.kind === "union"
        ? right.value.options
        : [right.value]),
    ];
    if (
      options.length === 2 &&
      options.some((type) => type.kind === "null")
    ) {
      const inner = options.find((type) => type.kind !== "null");
      if (inner !== undefined) {
        return ok({ kind: "optional", inner });
      }
    }
    return ok({ kind: "union", options });
  }

  if (annotation._type === "Subscript") {
    const baseNode = pythonAstNode(annotation.value);
    const base =
      baseNode?._type === "Name"
        ? stringField(baseNode, "id")
        : undefined;
    const slice = pythonAstNode(annotation.slice);
    if (base === undefined || slice === undefined) {
      return err(
        new StructuredError(
          "PY_LIFT_TYPE_SUBSCRIPT",
          "Python generic annotation must use a named base and typed slice.",
        ),
      );
    }

    const tupleItems =
      slice._type === "Tuple"
        ? pythonAstNodes(slice.elts)
        : [slice];

    if (base === "list" || base === "List") {
      const element = liftPythonAnnotation(tupleItems[0], typeVariables);
      return element.ok
        ? ok({ kind: "list", element: element.value })
        : element;
    }

    if (base === "tuple" || base === "Tuple") {
      const elements: PirType[] = [];
      for (const item of tupleItems) {
        const lifted = liftPythonAnnotation(item, typeVariables);
        if (!lifted.ok) return lifted;
        elements.push(lifted.value);
      }
      return ok({ kind: "tuple", elements });
    }

    if (base === "set" || base === "Set") {
      const value = liftPythonAnnotation(tupleItems[0], typeVariables);
      return value.ok
        ? ok({
            kind: "collection",
            collectionKind: "set",
            value: value.value,
          })
        : value;
    }

    if (
      base === "Iterable" ||
      base === "Iterator" ||
      base === "Sequence"
    ) {
      const value = liftPythonAnnotation(tupleItems[0], typeVariables);
      return value.ok
        ? ok({
            kind: "collection",
            collectionKind: "iterable",
            value: value.value,
          })
        : value;
    }

    if (base === "dict" || base === "Dict" || base === "Mapping") {
      const key = liftPythonAnnotation(tupleItems[0], typeVariables);
      if (!key.ok) return key;
      const value = liftPythonAnnotation(tupleItems[1], typeVariables);
      if (!value.ok) return value;
      return ok({
        kind: "collection",
        collectionKind: "map",
        key: key.value,
        value: value.value,
      });
    }

    if (base === "Optional") {
      const inner = liftPythonAnnotation(tupleItems[0], typeVariables);
      return inner.ok
        ? ok({ kind: "optional", inner: inner.value })
        : inner;
    }

    if (base === "Union") {
      const options: PirType[] = [];
      for (const item of tupleItems) {
        const lifted = liftPythonAnnotation(item, typeVariables);
        if (!lifted.ok) return lifted;
        options.push(lifted.value);
      }
      return ok({ kind: "union", options });
    }

    if (
      base === "Awaitable" ||
      base === "Coroutine" ||
      base === "Future"
    ) {
      const value = liftPythonAnnotation(
        tupleItems[tupleItems.length - 1],
        typeVariables,
      );
      return value.ok
        ? ok({ kind: "promise", value: value.value })
        : value;
    }

    const argumentsList: PirType[] = [];
    for (const item of tupleItems) {
      const lifted = liftPythonAnnotation(item, typeVariables);
      if (!lifted.ok) return lifted;
      argumentsList.push(lifted.value);
    }
    return ok({
      kind: "generic",
      base: {
        kind: "named",
        symbolId: `type:${base}`,
      },
      arguments: argumentsList,
    });
  }

  return ok({ kind: "unknown" });
};

const sanitizeIdentifier = (value: string): string => {
  const normalized = value.replace(/[^A-Za-z0-9_]/gu, "_");
  return /^[A-Za-z_]/u.test(normalized)
    ? normalized
    : `_${normalized}`;
};

export const lowerPirTypeToPythonAnnotation = (
  type: PirType,
): PythonAstNode => {
  switch (type.kind) {
    case "boolean":
      return nameNode("bool");
    case "number":
      return nameNode("float");
    case "string":
      return nameNode("str");
    case "null":
    case "void":
      return constantNode(null);
    case "never":
      return nameNode("NoReturn");
    case "unknown":
      return nameNode("object");
    case "record":
      // Shared PIR records are structural. Python lowers them as mappings
      // rather than assuming JavaScript property/object identity.
      return subscriptNode(
        "dict",
        tupleNode([nameNode("str"), nameNode("object")]),
      );
    case "list":
      return subscriptNode(
        "list",
        lowerPirTypeToPythonAnnotation(type.element),
      );
    case "tuple":
      return subscriptNode(
        "tuple",
        tupleNode(type.elements.map(lowerPirTypeToPythonAnnotation)),
      );
    case "optional":
      return unionNode([
        lowerPirTypeToPythonAnnotation(type.inner),
        constantNode(null),
      ]);
    case "union":
      return unionNode(
        type.options.map(lowerPirTypeToPythonAnnotation),
      );
    case "intersection":
      return nameNode("object");
    case "function":
      return nameNode("object");
    case "named":
      return nameNode(
        sanitizeIdentifier(
          type.symbolId.replace(/^type:/u, ""),
        ),
      );
    case "generic":
      if (type.base.kind === "named") {
        return subscriptNode(
          sanitizeIdentifier(
            type.base.symbolId.replace(/^type:/u, ""),
          ),
          type.arguments.length === 1
            ? lowerPirTypeToPythonAnnotation(type.arguments[0]!)
            : tupleNode(
                type.arguments.map(lowerPirTypeToPythonAnnotation),
              ),
        );
      }
      return nameNode("object");
    case "collection":
      if (type.collectionKind === "map") {
        return subscriptNode(
          "dict",
          tupleNode([
            lowerPirTypeToPythonAnnotation(
              type.key ?? { kind: "unknown" },
            ),
            lowerPirTypeToPythonAnnotation(type.value),
          ]),
        );
      }
      if (type.collectionKind === "set") {
        return subscriptNode(
          "set",
          lowerPirTypeToPythonAnnotation(type.value),
        );
      }
      return subscriptNode(
        "Iterable",
        lowerPirTypeToPythonAnnotation(type.value),
      );
    case "type-variable":
      return nameNode(sanitizeIdentifier(type.name));
    case "result":
      return unionNode([
        lowerPirTypeToPythonAnnotation(type.ok),
        lowerPirTypeToPythonAnnotation(type.error),
      ]);
    case "variant":
      return nameNode("object");
    case "promise":
      return subscriptNode(
        "Awaitable",
        lowerPirTypeToPythonAnnotation(type.value),
      );
  }
};
