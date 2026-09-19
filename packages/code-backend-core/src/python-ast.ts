import { spawnSync } from "node:child_process";
import {
  err,
  ok,
  StructuredError,
  type JsonValue,
  type Result,
} from "../../core-types/src/index.ts";
import type {
  NormalizedCompilerDiagnostic,
  ParsedSource,
  SourceDocument,
  TypecheckResult,
} from "./backend.ts";

export interface PythonAstNode {
  _type: string;
  _start?: number;
  _end?: number;
  [key: string]: JsonValue | undefined;
}

const bridgeScript = String.raw`
import ast
import json
import sys

mode = sys.argv[1]
filename = sys.argv[2]
payload = json.load(sys.stdin)

def syntax_diagnostic(exc):
    return {
        "code": "PY_SYNTAX_" + exc.__class__.__name__.upper(),
        "severity": "error",
        "message": exc.msg,
        "sourceId": filename,
        **({"line": exc.lineno} if exc.lineno is not None else {}),
        **({"column": exc.offset} if exc.offset is not None else {}),
        **({"endLine": exc.end_lineno} if getattr(exc, "end_lineno", None) is not None else {}),
        **({"endColumn": exc.end_offset} if getattr(exc, "end_offset", None) is not None else {}),
        "category": "SyntaxError",
    }

def offset_for(text, lineno, byte_column):
    if lineno is None or byte_column is None:
        return None
    lines = text.splitlines(keepends=True)
    if lineno < 1 or lineno > len(lines):
        return None
    line = lines[lineno - 1]
    prefix = line.encode("utf-8")[:byte_column].decode("utf-8", errors="ignore")
    return sum(len(item) for item in lines[:lineno - 1]) + len(prefix)

def encode(node, text):
    if isinstance(node, ast.AST):
        result = {"_type": node.__class__.__name__}
        for field in node._fields:
            result[field] = encode(getattr(node, field), text)
        if hasattr(node, "lineno") and hasattr(node, "col_offset"):
            start = offset_for(text, getattr(node, "lineno", None), getattr(node, "col_offset", None))
            end = offset_for(text, getattr(node, "end_lineno", None), getattr(node, "end_col_offset", None))
            if start is not None:
                result["_start"] = start
            if end is not None:
                result["_end"] = end
        return result
    if isinstance(node, list):
        return [encode(item, text) for item in node]
    if isinstance(node, tuple):
        return [encode(item, text) for item in node]
    if node is None or isinstance(node, (str, int, float, bool)):
        return node
    return str(node)

def decode(value):
    if isinstance(value, list):
        return [decode(item) for item in value]
    if not isinstance(value, dict) or "_type" not in value:
        return value
    kind = value["_type"]
    cls = getattr(ast, kind)
    fields = {
        key: decode(item)
        for key, item in value.items()
        if key not in ("_type", "_start", "_end")
    }
    node = cls(**fields)
    return node

if mode == "parse":
    text = payload["text"]
    try:
        tree = ast.parse(text, filename=filename, mode="exec", type_comments=True)
        print(json.dumps({"ok": True, "ast": encode(tree, text)}, ensure_ascii=False))
    except SyntaxError as exc:
        print(json.dumps({"ok": False, "diagnostics": [syntax_diagnostic(exc)]}, ensure_ascii=False))
elif mode == "unparse":
    try:
        tree = decode(payload["ast"])
        tree = ast.fix_missing_locations(tree)
        text = ast.unparse(tree)
        if not text.endswith("\n"):
            text += "\n"
        print(json.dumps({"ok": True, "text": text}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "diagnostics": [{
                "code": "PY_UNPARSE_" + exc.__class__.__name__.upper(),
                "severity": "error",
                "message": str(exc),
                "sourceId": filename,
                "category": "UnparseError",
            }]
        }, ensure_ascii=False))
elif mode == "compile":
    text = payload["text"]
    try:
        compile(text, filename, "exec")
        print(json.dumps({"ok": True, "diagnostics": []}, ensure_ascii=False))
    except SyntaxError as exc:
        print(json.dumps({"ok": False, "diagnostics": [syntax_diagnostic(exc)]}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "diagnostics": [{
                "code": "PY_COMPILE_" + exc.__class__.__name__.upper(),
                "severity": "error",
                "message": str(exc),
                "sourceId": filename,
                "category": "CompileError",
            }]
        }, ensure_ascii=False))
else:
    raise SystemExit("unsupported bridge mode")
`;

interface BridgeResponse {
  ok: boolean;
  ast?: PythonAstNode;
  text?: string;
  diagnostics?: Array<
    NormalizedCompilerDiagnostic & {
      endLine?: number;
      endColumn?: number;
    }
  >;
}

const pythonCommands = (): string[] => {
  const configured = process.env.JEV_PYTHON?.trim();
  return configured === undefined || configured === ""
    ? ["python3", "python"]
    : [configured];
};

const runBridge = (
  mode: "parse" | "unparse" | "compile",
  filename: string,
  payload: JsonValue,
): Result<BridgeResponse> => {
  let lastError: Error | undefined;

  for (const command of pythonCommands()) {
    const processResult = spawnSync(
      command,
      ["-c", bridgeScript, mode, filename],
      {
        input: JSON.stringify(payload),
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
    );

    if (processResult.error !== undefined) {
      lastError = processResult.error;
      continue;
    }
    if (processResult.status !== 0 && processResult.stdout.trim() === "") {
      return err(
        new StructuredError(
          "PY_BRIDGE_PROCESS",
          processResult.stderr.trim() ||
            `Python bridge exited with status ${processResult.status ?? "unknown"}.`,
          { command },
        ),
      );
    }

    try {
      const parsed = JSON.parse(processResult.stdout) as BridgeResponse;
      return ok(parsed);
    } catch (error) {
      return err(
        new StructuredError(
          "PY_BRIDGE_PROTOCOL",
          error instanceof Error
            ? error.message
            : "Python bridge returned invalid JSON.",
          {
            command,
            stderr: processResult.stderr.slice(0, 2_000),
            stdout: processResult.stdout.slice(0, 2_000),
          },
        ),
      );
    }
  }

  return err(
    new StructuredError(
      "PY_RUNTIME_UNAVAILABLE",
      lastError?.message ??
        "Neither python3 nor python could be executed.",
    ),
  );
};

const sourceFileName = (document: SourceDocument): string =>
  document.path ?? `/virtual/${document.sourceId}.py`;

export const parsePythonDocument = (
  document: SourceDocument,
): Result<ParsedSource<PythonAstNode>> => {
  const result = runBridge(
    "parse",
    sourceFileName(document),
    { text: document.text },
  );
  if (!result.ok) return result;

  return ok({
    document: structuredClone(document),
    ast:
      result.value.ast ??
      ({
        _type: "Module",
        body: [],
        type_ignores: [],
      } satisfies PythonAstNode),
    diagnostics: (result.value.diagnostics ?? []).map(
      ({ endLine: _endLine, endColumn: _endColumn, ...diagnostic }) =>
        diagnostic,
    ),
  });
};

export const printPythonAst = (
  ast: PythonAstNode,
  sourceId = "generated",
): Result<string> => {
  const result = runBridge(
    "unparse",
    `/virtual/${sourceId}.py`,
    { ast: ast as unknown as JsonValue },
  );
  if (!result.ok) return result;
  if (!result.value.ok || result.value.text === undefined) {
    const diagnostic = result.value.diagnostics?.[0];
    return err(
      new StructuredError(
        diagnostic?.code ?? "PY_UNPARSE_FAILED",
        diagnostic?.message ?? "Python AST unparse failed.",
      ),
    );
  }
  return ok(result.value.text);
};

export const compilePythonDocument = (
  document: SourceDocument,
): TypecheckResult => {
  const result = runBridge(
    "compile",
    sourceFileName(document),
    { text: document.text },
  );
  if (!result.ok) {
    return {
      ok: false,
      diagnostics: [
        {
          code: result.error.code,
          severity: "error",
          message: result.error.message,
          sourceId: document.sourceId,
          category: "Runtime",
        },
      ],
    };
  }

  const diagnostics = (result.value.diagnostics ?? []).map(
    ({ endLine: _endLine, endColumn: _endColumn, ...diagnostic }) =>
      diagnostic,
  );
  return {
    ok: result.value.ok && diagnostics.length === 0,
    diagnostics,
  };
};

export const pythonAstNode = (
  value: JsonValue | undefined,
): PythonAstNode | undefined =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  typeof (value as Record<string, JsonValue>)._type === "string"
    ? (value as unknown as PythonAstNode)
    : undefined;

export const pythonAstNodes = (
  value: JsonValue | undefined,
): PythonAstNode[] =>
  Array.isArray(value)
    ? value
        .map((item) => pythonAstNode(item))
        .filter((item): item is PythonAstNode => item !== undefined)
    : [];
