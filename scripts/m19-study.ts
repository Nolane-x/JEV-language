import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createM19RatingWorksheet,
  freezeM19HumanStudyEvidence,
  importM19RatingWorksheets,
  type M19BlindedBundle,
  type M19FailureRecord,
  type M19RatingContext,
  type M19RatingWorksheet,
  type M19StudyManifest,
} from "../packages/evaluation-core/src/index.ts";

type ArgMap = Map<string, string[]>;

const DEFAULT_MANIFEST = "evals/manifests/m19-natural-conversation.json";

const usage = (): string => `
M19 study operator CLI

Prepare an evaluator worksheet:
  npm run m19:prepare -- \
    --bundle <blinded-bundle.json> \
    --contexts <contexts.json> \
    --out <worksheet.json>

Freeze returned evaluator worksheets:
  npm run m19:freeze -- \
    --bundle <blinded-bundle.json> \
    --contexts <contexts.json> \
    --worksheet <evaluator-a.json> \
    --worksheet <evaluator-b.json> \
    [--failures <failures.json>] \
    [--frozen-at <ISO-8601>] \
    --out <evidence.json>

Optional for both commands:
  --manifest <manifest.json>   Defaults to ${DEFAULT_MANIFEST}
`.trim();

const parseArgs = (values: readonly string[]): ArgMap => {
  const args: ArgMap = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index]!;
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    const entries = args.get(key) ?? [];
    entries.push(value);
    args.set(key, entries);
    index += 1;
  }
  return args;
};

const one = (
  args: ArgMap,
  key: string,
  options: { required?: boolean; fallback?: string } = {},
): string | undefined => {
  const values = args.get(key) ?? [];
  if (values.length > 1) {
    throw new Error(`--${key} may be supplied only once.`);
  }
  if (values.length === 1) return values[0]!;
  if (options.fallback !== undefined) return options.fallback;
  if (options.required) throw new Error(`Missing required --${key}.`);
  return undefined;
};

const many = (args: ArgMap, key: string): string[] => [...(args.get(key) ?? [])];

const readJson = async <T>(path: string): Promise<T> => {
  const text = await readFile(resolve(path), "utf8");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON: ${path}`);
  }
};

const writeJson = async (path: string, value: unknown): Promise<void> => {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const prepare = async (args: ArgMap): Promise<void> => {
  const manifestPath = one(args, "manifest", { fallback: DEFAULT_MANIFEST })!;
  const bundlePath = one(args, "bundle", { required: true })!;
  const contextsPath = one(args, "contexts", { required: true })!;
  const outputPath = one(args, "out", { required: true })!;

  const [manifest, bundle, contexts] = await Promise.all([
    readJson<M19StudyManifest>(manifestPath),
    readJson<M19BlindedBundle>(bundlePath),
    readJson<M19RatingContext[]>(contextsPath),
  ]);

  const worksheet = createM19RatingWorksheet(manifest, bundle, contexts);
  if (!worksheet.ok) {
    throw new Error(`${worksheet.error.code}: ${worksheet.error.message}`);
  }

  await writeJson(outputPath, worksheet.value);
  process.stdout.write(
    `Prepared ${worksheet.value.rows.length} blinded stimuli -> ${outputPath}\n`,
  );
};

const freeze = async (args: ArgMap): Promise<void> => {
  const manifestPath = one(args, "manifest", { fallback: DEFAULT_MANIFEST })!;
  const bundlePath = one(args, "bundle", { required: true })!;
  const contextsPath = one(args, "contexts", { required: true })!;
  const worksheetPaths = many(args, "worksheet");
  const failuresPath = one(args, "failures");
  const outputPath = one(args, "out", { required: true })!;
  const frozenAt = one(args, "frozen-at") ?? new Date().toISOString();

  if (worksheetPaths.length === 0) {
    throw new Error("Supply at least one completed --worksheet.");
  }

  const [manifest, bundle, contexts, worksheets, failures] = await Promise.all([
    readJson<M19StudyManifest>(manifestPath),
    readJson<M19BlindedBundle>(bundlePath),
    readJson<M19RatingContext[]>(contextsPath),
    Promise.all(
      worksheetPaths.map((path) => readJson<M19RatingWorksheet>(path)),
    ),
    failuresPath
      ? readJson<M19FailureRecord[]>(failuresPath)
      : Promise.resolve([] as M19FailureRecord[]),
  ]);

  const ratings = importM19RatingWorksheets(
    manifest,
    bundle,
    contexts,
    worksheets,
  );
  if (!ratings.ok) {
    throw new Error(`${ratings.error.code}: ${ratings.error.message}`);
  }

  const evidence = freezeM19HumanStudyEvidence({
    manifest,
    bundle,
    contexts,
    ratings: ratings.value,
    failures,
    frozenAt,
  });
  if (!evidence.ok) {
    throw new Error(`${evidence.error.code}: ${evidence.error.message}`);
  }

  await writeJson(outputPath, evidence.value);
  process.stdout.write(
    `Frozen M19 study status=${evidence.value.status} ratings=${evidence.value.ratingCount} evaluators=${evidence.value.evaluatorCount} -> ${outputPath}\n`,
  );
};

const main = async (): Promise<void> => {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const args = parseArgs(rest);
  if (command === "prepare") {
    await prepare(args);
    return;
  }
  if (command === "freeze") {
    await freeze(args);
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`M19 study CLI failed: ${message}\n`);
  process.exitCode = 1;
});
