# ADR-0001 — TypeScript monorepo and central package manifest

- Status: accepted
- Date: 2026-09-19

## Context

The specification requires strict TypeScript, package boundaries, maturity declarations, and a package dependency DAG, while not mandating a package manager.

## Decision

Use a single strict TypeScript compilation unit during bootstrap, with architectural packages represented as directories and a machine-readable `packages/manifest.json`. The manifest declares maturity, layer, and dependencies for every package. A CI script verifies dependency direction and cycles.

Individual publishable package manifests may be introduced when package APIs stabilize.

## Alternatives considered

- Independent npm package for every architectural package immediately.
- Single undifferentiated `src/` tree.

## Consequences

Bootstrap remains lightweight while package boundaries stay explicit and machine-verifiable. Publication metadata is deferred.

## Migration impact

Future package splitting must preserve the declared DAG.

## Spec sections affected

146, 150, 151, 396-400, 402.

## Evidence/tests

`npm run check:boundaries`.
