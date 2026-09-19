import ts from "@typescript/typescript6";
import {
  err,
  ok,
  StructuredError,
  type Result,
} from "../../core-types/src/index.ts";
import type { PirType } from "../../program-ir/src/index.ts";

const keywordType = (kind: ts.SyntaxKind): PirType | undefined => {
  switch (kind) {
    case ts.SyntaxKind.BooleanKeyword:
      return { kind: "boolean" };
    case ts.SyntaxKind.NumberKeyword:
      return { kind: "number" };
    case ts.SyntaxKind.StringKeyword:
      return { kind: "string" };
    case ts.SyntaxKind.VoidKeyword:
      return { kind: "void" };
    case ts.SyntaxKind.NeverKeyword:
      return { kind: "never" };
    case ts.SyntaxKind.UnknownKeyword:
    case ts.SyntaxKind.AnyKeyword:
      return { kind: "unknown" };
    case ts.SyntaxKind.NullKeyword:
      return { kind: "null" };
    default:
      return undefined;
  }
};

export const liftTypeScriptType = (
  node: ts.TypeNode | undefined,
  typeParameters: ReadonlySet<string> = new Set<string>(),
): Result<PirType> => {
  if (node === undefined) return ok({ kind: "unknown" });

  const primitive = keywordType(node.kind);
  if (primitive !== undefined) return ok(primitive);

  if (ts.isArrayTypeNode(node)) {
    const element = liftTypeScriptType(node.elementType, typeParameters);
    return element.ok
      ? ok({ kind: "list", element: element.value })
      : element;
  }

  if (ts.isTupleTypeNode(node)) {
    const elements: PirType[] = [];
    for (const entry of node.elements) {
      const lifted = liftTypeScriptType(entry, typeParameters);
      if (!lifted.ok) return lifted;
      elements.push(lifted.value);
    }
    return ok({ kind: "tuple", elements });
  }

  if (ts.isUnionTypeNode(node)) {
    const options: PirType[] = [];
    let sawUndefined = false;
    for (const entry of node.types) {
      if (entry.kind === ts.SyntaxKind.UndefinedKeyword) {
        sawUndefined = true;
        continue;
      }
      const lifted = liftTypeScriptType(entry, typeParameters);
      if (!lifted.ok) return lifted;
      options.push(lifted.value);
    }
    if (sawUndefined && options.length === 1) {
      return ok({ kind: "optional", inner: options[0]! });
    }
    if (sawUndefined) {
      options.push({ kind: "unknown" });
    }
    return ok({ kind: "union", options });
  }

  if (ts.isIntersectionTypeNode(node)) {
    const members: PirType[] = [];
    for (const entry of node.types) {
      const lifted = liftTypeScriptType(entry, typeParameters);
      if (!lifted.ok) return lifted;
      members.push(lifted.value);
    }
    return ok({ kind: "intersection", members });
  }

  if (ts.isTypeLiteralNode(node)) {
    const fields: Record<string, PirType> = {};
    for (const member of node.members) {
      if (!ts.isPropertySignature(member) || member.name === undefined) {
        return err(
          new StructuredError(
            "TS_LIFT_TYPE_LITERAL_MEMBER",
            "Only named property signatures are supported in lifted type literals.",
          ),
        );
      }
      const name = member.name.getText();
      const lifted = liftTypeScriptType(member.type, typeParameters);
      if (!lifted.ok) return lifted;
      fields[name] =
        member.questionToken === undefined
          ? lifted.value
          : { kind: "optional", inner: lifted.value };
    }
    return ok({ kind: "record", fields });
  }

  if (ts.isFunctionTypeNode(node)) {
    const parameters: PirType[] = [];
    for (const parameter of node.parameters) {
      const lifted = liftTypeScriptType(parameter.type, typeParameters);
      if (!lifted.ok) return lifted;
      parameters.push(lifted.value);
    }
    const returns = liftTypeScriptType(node.type, typeParameters);
    return returns.ok
      ? ok({ kind: "function", parameters, returns: returns.value })
      : returns;
  }

  if (ts.isParenthesizedTypeNode(node)) {
    return liftTypeScriptType(node.type, typeParameters);
  }

  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText();
    if (typeParameters.has(name) && node.typeArguments === undefined) {
      return ok({
        kind: "type-variable",
        id: `type:${name}`,
        name,
      });
    }

    const args: PirType[] = [];
    for (const argument of node.typeArguments ?? []) {
      const lifted = liftTypeScriptType(argument, typeParameters);
      if (!lifted.ok) return lifted;
      args.push(lifted.value);
    }

    if (name === "Array" && args.length === 1) {
      return ok({ kind: "list", element: args[0]! });
    }
    if (name === "Promise" && args.length === 1) {
      return ok({ kind: "promise", value: args[0]! });
    }
    if (name === "Set" && args.length === 1) {
      return ok({
        kind: "collection",
        collectionKind: "set",
        value: args[0]!,
      });
    }
    if (name === "Map" && args.length === 2) {
      return ok({
        kind: "collection",
        collectionKind: "map",
        key: args[0]!,
        value: args[1]!,
      });
    }

    const named: PirType = {
      kind: "named",
      symbolId: `type:${name}`,
      ...(args.length === 0 ? {} : { typeArguments: args }),
    };
    return ok(named);
  }

  return err(
    new StructuredError(
      "TS_LIFT_TYPE_UNSUPPORTED",
      `Unsupported TypeScript type syntax: ${ts.SyntaxKind[node.kind]}.`,
    ),
  );
};

const identifierForNamedType = (symbolId: string): ts.EntityName => {
  const raw = symbolId.startsWith("type:")
    ? symbolId.slice("type:".length)
    : symbolId;
  return ts.factory.createIdentifier(
    raw.replace(/[^A-Za-z0-9_$]/gu, "_"),
  );
};

export const lowerPirType = (type: PirType): ts.TypeNode => {
  switch (type.kind) {
    case "boolean":
      return ts.factory.createKeywordTypeNode(
        ts.SyntaxKind.BooleanKeyword,
      );
    case "number":
      return ts.factory.createKeywordTypeNode(
        ts.SyntaxKind.NumberKeyword,
      );
    case "string":
      return ts.factory.createKeywordTypeNode(
        ts.SyntaxKind.StringKeyword,
      );
    case "void":
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword);
    case "never":
      return ts.factory.createKeywordTypeNode(
        ts.SyntaxKind.NeverKeyword,
      );
    case "unknown":
      return ts.factory.createKeywordTypeNode(
        ts.SyntaxKind.UnknownKeyword,
      );
    case "null":
      return ts.factory.createLiteralTypeNode(
        ts.factory.createNull(),
      );
    case "list":
      return ts.factory.createArrayTypeNode(lowerPirType(type.element));
    case "tuple":
      return ts.factory.createTupleTypeNode(
        type.elements.map(lowerPirType),
      );
    case "optional":
      return ts.factory.createUnionTypeNode([
        lowerPirType(type.inner),
        ts.factory.createKeywordTypeNode(
          ts.SyntaxKind.UndefinedKeyword,
        ),
      ]);
    case "union":
      return ts.factory.createUnionTypeNode(
        type.options.map(lowerPirType),
      );
    case "intersection":
      return ts.factory.createIntersectionTypeNode(
        type.members.map(lowerPirType),
      );
    case "record":
      return ts.factory.createTypeLiteralNode(
        Object.entries(type.fields)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, field]) =>
            ts.factory.createPropertySignature(
              undefined,
              name,
              undefined,
              lowerPirType(field),
            ),
          ),
      );
    case "function":
      return ts.factory.createFunctionTypeNode(
        undefined,
        type.parameters.map((parameter, index) =>
          ts.factory.createParameterDeclaration(
            undefined,
            undefined,
            `arg${index}`,
            undefined,
            lowerPirType(parameter),
            undefined,
          ),
        ),
        lowerPirType(type.returns),
      );
    case "named":
      return ts.factory.createTypeReferenceNode(
        identifierForNamedType(type.symbolId),
        type.typeArguments?.map(lowerPirType),
      );
    case "generic":
      if (type.base.kind === "named") {
        return ts.factory.createTypeReferenceNode(
          identifierForNamedType(type.base.symbolId),
          type.arguments.map(lowerPirType),
        );
      }
      return ts.factory.createTypeReferenceNode(
        "UnknownGeneric",
        type.arguments.map(lowerPirType),
      );
    case "collection":
      if (type.collectionKind === "set") {
        return ts.factory.createTypeReferenceNode("Set", [
          lowerPirType(type.value),
        ]);
      }
      if (type.collectionKind === "map") {
        return ts.factory.createTypeReferenceNode("Map", [
          lowerPirType(type.key ?? { kind: "unknown" }),
          lowerPirType(type.value),
        ]);
      }
      return ts.factory.createTypeReferenceNode("Iterable", [
        lowerPirType(type.value),
      ]);
    case "type-variable":
      return ts.factory.createTypeReferenceNode(type.name, undefined);
    case "result":
      return ts.factory.createUnionTypeNode([
        ts.factory.createTypeLiteralNode([
          ts.factory.createPropertySignature(
            undefined,
            "ok",
            undefined,
            ts.factory.createLiteralTypeNode(
              ts.factory.createTrue(),
            ),
          ),
          ts.factory.createPropertySignature(
            undefined,
            "value",
            undefined,
            lowerPirType(type.ok),
          ),
        ]),
        ts.factory.createTypeLiteralNode([
          ts.factory.createPropertySignature(
            undefined,
            "ok",
            undefined,
            ts.factory.createLiteralTypeNode(
              ts.factory.createFalse(),
            ),
          ),
          ts.factory.createPropertySignature(
            undefined,
            "error",
            undefined,
            lowerPirType(type.error),
          ),
        ]),
      ]);
    case "variant":
      return ts.factory.createUnionTypeNode(
        Object.entries(type.cases)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([tag, payload]) =>
            ts.factory.createTypeLiteralNode([
              ts.factory.createPropertySignature(
                undefined,
                "kind",
                undefined,
                ts.factory.createLiteralTypeNode(
                  ts.factory.createStringLiteral(tag),
                ),
              ),
              ...(payload === null
                ? []
                : [
                    ts.factory.createPropertySignature(
                      undefined,
                      "value",
                      undefined,
                      lowerPirType(payload),
                    ),
                  ]),
            ]),
          ),
      );
    case "promise":
      return ts.factory.createTypeReferenceNode("Promise", [
        lowerPirType(type.value),
      ]);
  }
};
