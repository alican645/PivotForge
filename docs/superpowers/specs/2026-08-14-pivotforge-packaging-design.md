# PivotForge Packaging Design

## Goal

Publish the current pivot engine and interactive ASP.NET Core experience as a
coherent, installable, documented, and safely maintainable NuGet package
family under the PivotForge product name.

## Architecture

PivotForge ships as two packages. `PivotForge.Core` owns data processing and
has no ASP.NET Core dependency. `PivotForge.AspNetCore` is a Razor Class
Library that depends on Core and owns browser assets, web integration,
large-data session caching, and endpoint registration. The MVC demo remains a
consumer sample and is never packed.

The web package exposes one JavaScript namespace, `window.PivotForge`, and one
static asset root, `_content/PivotForge.AspNetCore/`. The inline orchestration
currently living in the demo view will move behind a reusable client API. The
consumer supplies fields, initial layout, data access, and endpoint options.

## Package Boundaries

`PivotForge.Core` contains the engine, request/result contracts, filters,
sorts, aggregations, show-as calculations, record readers, drill-down,
pagination, cancellation, and Excel export.

`PivotForge.AspNetCore` contains the renderer, workspace controller, styles,
state persistence, virtual data source, server cache service, service
registration, and endpoint helpers. Sample data, demo controllers, demo views,
and application-specific text stay in `samples`.

## Compatibility

The first release targets .NET 8 so it can be consumed by supported .NET 8 and
newer applications. Package preparation must prove that the existing code
compiles and behaves correctly on that target before the current .NET 10-only
target is removed.

## Consumer Flow

1. Install `PivotForge.AspNetCore`, which brings `PivotForge.Core` transitively.
2. Register PivotForge services and a data-provider delegate.
3. Map the PivotForge endpoints under an application-selected route prefix.
4. Reference the packaged CSS and JavaScript static assets.
5. Initialize the workspace with fields, layout, and optional feature flags.

Installing only `PivotForge.Core` supports API, worker, console, and custom UI
scenarios.

## Failure Behavior

Invalid pivot requests return typed validation failures. Cancelled calculations
must stop without populating the result cache. Expired large-data sessions
return an explicit gone response so the client can restart the session. Browser
requests use abort signals, stale responses cannot replace current state, and
prefetch failures do not hide already-rendered data.

## Quality Gates

- Core unit tests pass on every target framework.
- Browser module tests cover rendering, state, drill-down, cancellation, and
  LRU cache behavior.
- Release builds complete without warnings.
- Package validation and package-content inspection pass.
- Both packages install from a local feed into a clean consumer application.
- The consumer application passes desktop browser tests for normal and
  large-data modes.
- README installation commands are executed exactly as documented.

## Release Flow

Pull requests run restore, build, test, pack, and smoke installation. A signed
Git tag creates immutable package artifacts. NuGet publishing uses GitHub OIDC
Trusted Publishing when available, with a package-scoped API key only as a
fallback. The first public version is `0.1.0-preview.1`; `1.0.0` follows after
external consumer validation.
