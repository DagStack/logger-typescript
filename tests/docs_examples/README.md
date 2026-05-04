# docs_examples — auto-tests for `dagstack-logger-docs` snippets

Each test file mirrors a single MDX page in `dagstack/logger-docs` and copies
the page's TypeScript `<TabItem value="typescript">` snippet between the
markers `// --- snippet start ---` / `// --- snippet end ---`. Assertions sit
outside the markers and check that the snippet behaves the way the surrounding
prose claims — so docs drift surfaces here, before a reader hits a broken
example.

## Why a dedicated directory

The MDX snippets are user-facing examples that occasionally bend the core test
style — top-level `import` lines that the docs hoist into the snippet body,
short variable names like `sink` / `logger`, and intentionally minimalist
calls. Keeping them in their own directory avoids leaking those patterns into
`tests/*.test.ts`, which follows the unit-test style.

## Pages covered

| Test file                           | MDX page                                  |
| ----------------------------------- | ----------------------------------------- |
| `intro.test.ts`                     | `site/docs/intro.mdx`                     |
| `concepts_severity.test.ts`         | `site/docs/concepts/severity.mdx`         |
| `concepts_sinks.test.ts`            | `site/docs/concepts/sinks.mdx`            |
| `concepts_context.test.ts`          | `site/docs/concepts/context.mdx`          |
| `concepts_operations.test.ts`       | `site/docs/concepts/operations.mdx`       |
| `concepts_redaction.test.ts`        | `site/docs/concepts/redaction.mdx`        |
| `concepts_scoped_overrides.test.ts` | `site/docs/concepts/scoped-overrides.mdx` |
| `guides_configure.test.ts`          | `site/docs/guides/configure.mdx`          |
| `guides_testing.test.ts`            | `site/docs/guides/testing.mdx`            |
| `guides_custom_sink.test.ts`        | `site/docs/guides/custom-sink.mdx`        |

`site/docs/concepts/wire-formats.mdx` has no `<TabItem value="typescript">`
code block (the page documents three wire formats in language-agnostic prose
plus a single JSON example) — there is nothing to mirror, so no test file for
it.

## Rules for authors

1. **Snippet inside `// --- snippet start ---` / `// --- snippet end ---`** is
   copied verbatim from the MDX. Adjustments outside the markers are kept
   minimal (test fixtures, `BufferedStream` for `process.stderr`, sandbox
   paths in place of `/var/log/...`).
2. **Assertions live after the snippet** and reference the snippet's
   variables. They check the behaviour that the surrounding MDX prose claims.
3. **Drift docs ↔ binding** — if a snippet does not run as-is against the
   public API, leave a `NB:` comment explaining what was substituted (sandbox
   path, in-process callback in place of an external SDK, etc.) and assert
   against the real behaviour. Open a doc-fix or binding-fix ticket so the
   substitution disappears on the next sync.
4. **Registry isolation** — every test calls `_resetRegistryForTests()` in
   `beforeEach`, so cached `Logger.get(name)` instances do not leak between
   tests.
5. **Sandbox-friendly paths** — replace `/var/log/...` with `tmpdir()` paths
   created via `mkdtemp` and cleaned up in `afterAll`.
