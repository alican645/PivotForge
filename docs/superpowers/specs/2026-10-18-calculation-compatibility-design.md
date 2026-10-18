# Calculation compatibility, first increment

The user approved starting with shared-data differential tests and fixing measured calculation differences. Reference: DevExtreme 26.1.3 LocalStore, executed in Chromium. PivotForge remains a server-side decimal engine; no vendor code ships with it.

Use checked-in inputs and observed outputs rather than handwritten expectations or a production dependency on DevExtreme. A standalone Playwright script loads a caller-provided vendor bundle, verifies version/hash, and generates JSON containing row/column paths, every detail/subtotal/grand-total intersection, and ordered leaf headers. xUnit consumes the same records and configuration, maps public concepts to PivotForge, and compares null exactly and numeric results within a documented floating-point tolerance.

Scope: the five basic aggregates, null/zero/numeric-string inputs with explicit numeric typing, all seven percentage/variation modes, neutral versus descending calculation order, summary sorting, two running-total directions and group boundaries. Start with fully expanded axes. Widget pruning, collapsed paths, dates, arbitrary callbacks, and XMLA remain later increments; raw datasource emptiness is not equivalent to widget visibility.

Plan:
1. Restore and run the existing Core tests.
2. Record reference provenance and implement a reproducible fixture generator.
3. Add an offline xUnit differential test across detail cells and totals.
4. Run red tests, correct measured engine differences, and retain targeted regression cases.
5. Run Core on both targets, integration tests, and JS regression tests. Document coverage and remaining limits.

No percentage claim about full DevExtreme compatibility follows from this bounded corpus. Reference refresh is explicit, never part of ordinary tests. The CDN bundle is temporary and not committed. Any changed existing expectation must be backed by an observed reference result.

## Implementation outcome

The corpus now contains 275 reference cases. Two initially skipped NaN summary-order cases were resolved by preserving observed-empty-average provenance and adding a sibling-level reference PowerSort for affected groups. Browser version is pinned alongside the vendor hash because a non-transitive comparator depends on traversal. Added tests cross insertion/run/merge boundaries and cover 1,024 groups on either axis. Finite-summary sorting keeps its existing .NET path.
