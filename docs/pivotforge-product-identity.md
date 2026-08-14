# PivotForge Product Identity

## Product

- Product name: **PivotForge**
- Tagline: **Interactive pivot tables forged for .NET.**
- Positioning: A dependency-light pivot engine and interactive ASP.NET Core UI for building operational reporting experiences.
- Initial release: `0.1.0-preview.1`
- License: MIT
- Author: Alican
- Copyright: `Copyright (c) 2026 Alican`

The product name is written as `PivotForge`. Package IDs, assembly names, and
namespaces use PascalCase. The command-line and URL forms use lowercase where
required by their host.

## Package Family

### PivotForge.Core

- Package ID: `PivotForge.Core`
- Assembly name: `PivotForge.Core`
- Root namespace: `PivotForge.Core`
- NuGet title: `PivotForge Core`
- Short description: `A fast, dependency-light pivot table engine for .NET.`
- Description: `Build pivot results from objects, dictionaries, DataTables, JSON, and CSV with grouping, aggregation, filtering, sorting, show-as calculations, drill-down, pagination, cancellation, and Excel export.`
- Tags: `pivot pivot-table pivot-grid crosstab aggregation analytics reporting drill-down excel dotnet`

### PivotForge.AspNetCore

- Package ID: `PivotForge.AspNetCore`
- Assembly name: `PivotForge.AspNetCore`
- Root namespace: `PivotForge.AspNetCore`
- JavaScript namespace: `window.PivotForge`
- Static asset base path: `_content/PivotForge.AspNetCore/`
- NuGet title: `PivotForge for ASP.NET Core`
- Short description: `An interactive ASP.NET Core pivot table UI powered by PivotForge.`
- Description: `Add a field-driven pivot table workspace to ASP.NET Core applications with compact and tabular layouts, selection, drill-down, saved views, conditional formatting, exports, virtual scrolling, server-side chunk loading, request cancellation, and caching.`
- Tags: `aspnetcore pivot pivot-table pivot-grid data-grid virtualization drill-down reporting ui`
- Dependency: `PivotForge.Core` at the same release version

There will be no empty `PivotForge` meta-package in the first release. Each
published package must be independently useful and have a clear ownership
boundary.

## Visual Identity

- Primary mark: `assets/brand/pivotforge-icon.png`
- Source artwork: `assets/brand/pivotforge-icon-source.png`
- Package icon format: transparent PNG, 128 x 128, under 1 MB
- Charcoal: `#17212B`
- Teal: `#0F766E`
- Mint: `#63C7B7`
- Gold accent: `#D9A441`

The mark represents pivot cells converging on a forged center. It is used
without text at icon sizes. Product headings may pair the mark with the
`PivotForge` wordmark, but the package icon remains symbol-only.

## Versioning

- Preview line begins at `0.1.0-preview.1`.
- Preview increments use `preview.2`, `preview.3`, and so on.
- Backward-compatible features increment the minor version.
- Backward-compatible fixes increment the patch version.
- Breaking changes are allowed during `0.x` previews but must be documented.
- Stable `1.0.0` is published only after package installation, public API,
  documentation, and upgrade behavior have been validated in an external
  consumer application.
- A published package version is immutable and is never overwritten.

## Naming Availability

The NuGet V3 flat-container endpoint returned `404` for `PivotForge.Core` and
`PivotForge.AspNetCore` on 2026-08-14. This is a preliminary availability
check, not a reservation. Package IDs become owned only after a successful
nuget.org publication.

## Metadata Rules

- Package metadata is declared in SDK-style project files rather than a custom
  `.nuspec` file.
- `PackageLicenseExpression` is `MIT`.
- `PackageRequireLicenseAcceptance` is `false`.
- `PackageIcon` is `pivotforge-icon.png` and the icon is packed at the package
  root.
- Package README files are packed at the package root.
- Repository and project URLs are added after the public GitHub repository is
  created.
- Release builds produce deterministic `.nupkg` and `.snupkg` artifacts.
