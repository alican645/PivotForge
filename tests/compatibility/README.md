# DevExtreme calculation conformance

The reference is **DevExtreme 26.1.3**, executed in Playwright Chromium **151.0.7922.34** with `en-US` locale. `calculations.json` contains shared inputs and observed outputs, not vendor source. Ordinary Core tests consume this file offline.

**Current result: all 275 scenarios conform; no skipped compatibility tests. This is a bounded calculation/sorting corpus, not full widget behavioral compatibility.**

## Run

```sh
dotnet test tests/PivotForge.Core.Tests/PivotForge.Core.Tests.csproj --filter FullyQualifiedName~DevExtremeCalculationTests
```

If .NET 8 is not installed, use `DOTNET_ROLL_FORWARD=LatestMajor` or select `-f net10.0`.

## Refresh the reference deliberately

Install the repository's npm dependencies and Playwright Chromium, then supply the reference bundle:

```sh
curl -fsSL https://cdn3.devexpress.com/jslib/26.1.3/js/dx.all.js -o /tmp/pivotforge-dx-26.1.3.js
node tests/compatibility/generate.cjs /tmp/pivotforge-dx-26.1.3.js
```

The generator verifies the DevExtreme runtime version, SHA-256 and Chromium version. It never downloads executable code implicitly, and the bundle must not be committed or shipped. The observed hash is `d29fe967ece49e81f8b473119ffecc9a903dda6bcf5dac1dc4bf6843633a41d9`. It differs from the hash recorded in `docs/pivotgrid/README.md`; this corpus records the file actually executed on 2026-10-18. A future mismatch requires investigation, not silently updating the hash.

## Coverage

- Sum/count/min/max/average with negatives, zero, null, missing properties, and explicitly typed numeric strings.
- Seven percentage/variation display modes, detail cells, row/column subtotals, their intersections and grand totals.
- Ascending/descending label order, summary sorting, ties and empty summaries.
- Running totals in both directions, resetting or crossing groups, including a percentage display mode.
- Zero denominators and empty averages.
- Non-finite summary sorting on both axes, source-order permutations, nested groups, missing summary paths, and group sizes 15, 16, 17, 31, 32, 63, 64, 65, 128, 257 and 1,024. Large ordering cases compare headers only; small cases also check the cell matrix.

Axis paths and leaf order are exact. Every reference intersection is checked, with null distinct from zero. Finite numbers use relative tolerance `1e-12 * max(1, abs(expected))` because JavaScript uses binary doubles and PivotForge uses decimal. Reference NaN values are marked `nonFinite: "NaN"`; their numeric JSON representation is null. This checks the nullable-result contract, not IEEE-value identity.

## NaN summary ordering

An observed all-null average is NaN in DevExtreme, while a missing intersection is undefined. Nullable decimal represents both as null in the public result. The internal sorting value retains whether a null came from an observed empty Average or a missing intersection, so these cases no longer compare alike.

The NaN comparator falls back to labels against defined summaries and is non-transitive. Consequently, even two stable sorting algorithms can produce different output. For sibling arrays affected by NaN, `ReferenceHeaderSort` uses the reference Chromium's PowerSort traversal: binary insertion, natural runs, balanced minimum runs, boundary powers and galloping merges. It starts from observation order and sorts each hierarchy level independently. Finite summaries retain the normal .NET sorting path. No JavaScript runtime or new package dependency is required in production.

Algorithm references: [V8 array-sort.tq](https://github.com/v8/v8/blob/main/third_party/v8/builtins/array-sort.tq) and [CPython listsort.txt](https://github.com/python/cpython/blob/main/Objects/listsort.txt). The C# implementation is tested against the pinned browser, rather than assuming every stable sort is interchangeable. A different browser engine or Chromium release is not automatically covered by this non-finite ordering contract.

## Behavior changes in this increment

- An observed all-null sum is **zero**. A result with no records still has no sum. Average/min/max remain empty when all inputs are empty.
- A dictionary record may omit a field present elsewhere in the source; its value is empty. A field absent from the source schema still raises `PivotFieldNotFoundException`.
- Variation calculations use neutral ascending column order before the requested presentation sort. Column subtotals compare with sibling subtotals at the same depth.
- Missing/null summaries sort before numbers ascending and after numbers descending. Observed empty averages preserve NaN ordering semantics internally. Equal summaries use the requested direction for their label tie-break.

Consequences: zero sums survive empty-cell hiding and participate in value filters/Top-N; formulas using sums of null inputs now read zero. Existing null-propagation tests use Average where they need an actually empty aggregate. These are intentional behavior changes, not test-only accommodations.

## Not covered yet

Default-option parity (including cross-group defaults), arbitrary calculated callbacks, multiple measures with mixed display modes, date/group comparers, malformed numeric coercion, empty source/reference axis layout, collapsed headers, widget-level hide-empty pruning, and large sparse Cartesian axes need further cases. The seven modes are compared under explicit settings and fully expanded axes. A passing corpus is not a claim about these untested combinations.
