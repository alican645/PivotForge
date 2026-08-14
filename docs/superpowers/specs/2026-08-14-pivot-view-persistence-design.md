# Pivot View Persistence Design

## Goal

Persist the latest pivot configuration in browser `localStorage` and allow users to save, restore, update, and delete multiple named pivot views.

## Scope

The persisted state contains:

- Row, column, value, and filter layout
- Value aggregation and formatting settings
- Active row sort
- Compact/tabular mode, repeated labels, and subtotal visibility
- Custom field aliases
- Renderer column widths
- Expanded/collapsed row groups

Transient row or cell selection is not persisted.

## User Interface

Add a `Görünümler` control to the pivot toolbar. Its menu contains:

- A saved-view selector
- A view-name input
- `Kaydet` for a new view
- `Güncelle` for the selected view
- `Sil` for the selected view

The menu shows an empty state when no named views exist. Selecting a view restores and runs it immediately. When the active configuration differs from the loaded named view, the UI marks it as modified.

## Storage Model

Use two versioned `localStorage` entries:

- `pivot-table:last-state:v1`: latest working state
- `pivot-table:saved-views:v1`: named view collection

Each state payload contains `version`, `layout`, `viewSettings`, `sort`, `fieldAliases`, `columnWidths`, and `collapsedGroups`. Named views additionally contain a stable id, name, creation timestamp, and update timestamp.

Storage access is isolated behind small read/write helpers. Parsing failures, unavailable storage, unknown schema versions, invalid fields, and malformed values fall back safely without preventing the pivot table from running.

## Data Flow

On startup, load and validate the latest state before the first field-panel render and pivot request. If no valid state exists, use the current defaults.

After a successful pivot render, serialize the current state and update the latest-state entry. Changes that do not require a server request, such as column resizing or group collapse, also trigger persistence through a renderer state-change callback.

Saving creates a snapshot. Loading replaces the current configuration, synchronizes controls and renderer state, renders the field panel, and runs the pivot. Updating replaces the selected snapshot. Deleting removes only the named snapshot and leaves the current pivot unchanged.

## Renderer API

Add renderer methods for serializable view state:

- `getViewState()` returns column widths and collapsed groups.
- `applyViewState(state)` replaces renderer view state and rerenders when possible.
- `onViewStateChanged` notifies the host after column-width or group-state changes.

The host page owns the complete saved-view model; the renderer owns only table-specific state.

## Validation

Only known fields may appear in rows, columns, filters, aliases, and values. Aggregations, format types, layout modes, booleans, widths, and collapsed-group keys are normalized against supported values. Duplicate or blank view names are rejected. Saving an existing name updates that view rather than creating a duplicate.

## Testing

- Renderer view-state snapshot and restoration
- Defensive cloning of returned state
- Storage payload validation and malformed-data fallback
- Named view create, overwrite, load, and delete behavior
- Automatic last-state restoration after reload
- Full restoration of layout, filters, sort, aliases, widths, and collapsed groups
- Browser verification for toolbar interaction and persistence after page reload
