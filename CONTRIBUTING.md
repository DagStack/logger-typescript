# Contributing

## Workflow

1. Open an issue in [dagstack/logger-typescript](https://github.com/dagstack/logger-typescript/issues) for non-trivial changes.
2. Branch off `main` as `feature/<issue-id>-<desc>`.
3. Implementation + tests + `CHANGELOG.md` update (the `[Unreleased]` section).
4. `make lint typecheck test` — clean, no errors.
5. PR into `main`, review, merge (squash).

## Normative reference

The public API contract is [`dagstack/logger-spec`](https://github.com/dagstack/logger-spec), ADR-0001. If the binding's behaviour diverges from the spec, that's a bug in the binding (or, more rarely, a proposal to amend the spec via an ADR amendment).

## Dev dependencies

- Node.js ≥20, npm.
- Git.

## Code style

- TypeScript strict mode (`tsconfig.json`).
- Prettier formatting (`npm run format`).
- ESLint flat config (`npm run lint`).
- UTF-8, LF line endings (see `.editorconfig` + `.gitattributes`).

## Commit style

Short title in the present tense. Body — optional. Identity — `demchenkoev@gmail.com`.
