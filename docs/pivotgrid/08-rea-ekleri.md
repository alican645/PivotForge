# 08 — REA Ekleri (Ham Analiz Verisi)

Bu dosyadaki tablolar REA'nın 3. çalışmasından (39 modül, ayrı dosyalar) **otomatik olarak üretildi**. Diğer dokümanlardaki davranış açıklamaları bu verilerle ve modül kaynaklarının okunmasıyla çıkarıldı.

Komut:

```bash
npx -y rea-agents@6.5.0 analyze-javascript-application <pivot-modules-dizini> --json \
  --max-heap-mb 6144 --max-semantic-nodes 1000000 --max-semantic-nodes-per-file 1000000 \
  --analysis-timeout-ms 1500000
```

## 1. Genel istatistikler

| Ölçü | Değer |
|---|---|
| Analiz edilen dosya | 39 |
| Okunan bayt | 335.435 |
| Ziyaret edilen AST düğümü | 62.014 |
| Parse hatası | 0 |
| Semantik düğüm | 44.732 |
| Semantik ilişki | 43.317 |
| Parmak izi (fingerprint) | 1.242 |
| Bilinmeyen (unknown) kayıt | 16.047 |

### Düğüm türleri

| Tür | Adet | Anlamı |
|---|---|---|
| `expression` | 30.527 | İfade (okuma/yazma/çağrı hedefi) |
| `call-site` | 4.325 | Fonksiyon çağrı noktası |
| `property-slot` | 3.580 | Nesne özelliği |
| `binding` | 2.340 | Değişken bağlaması |
| `parameter` | 1.668 | Fonksiyon parametresi |
| `function` | 1.261 | Fonksiyon / metot |
| `return-site` | 782 | return noktası |
| `literal` | 70 | Sabit |
| `listener` | 46 | Olay dinleyici kaydı (on/off) |
| `event` | 43 | Olay yayıcı |
| `boundary` | 40 | Tip dönüşümü / doğrulama sınırı |
| `module` | 39 | Modül |
| `timer` | 9 | Zamanlayıcı |
| `promise` | 2 | Promise işlemi |

### İlişki türleri

| İlişki | Adet |
|---|---|
| `aliases` | 16.427 |
| `reads` | 11.781 |
| `defines` | 4.754 |
| `reads-property` | 4.571 |
| `captures` | 2.897 |
| `argument-to-parameter` | 682 |
| `writes` | 673 |
| `writes-property` | 575 |
| `calls` | 415 |
| `returns-to-call` | 376 |
| `destructures` | 67 |
| `coerces` | 28 |
| `registers-listener` | 28 |
| `removes-listener` | 18 |
| `validates` | 10 |
| `schedules-timer` | 9 |
| `creates-promise` | 2 |
| `parses` | 2 |
| `returns-task` | 1 |
| `cancels-timer` | 1 |

Çözümleme durumu: `resolved` 24.035, `candidate` 19.282

> REA `calls` ilişkisini yalnızca **serbest fonksiyonlar** için çözebildi (292 benzersiz çağıran→çağrılan çifti). `this.metot()` biçimindeki sınıf içi çağrılar çözümsüz kaldı; bu akışlar [02](02-mimari-ve-yasam-dongusu.md)–[07](07-export-grafik-state.md) dosyalarında kaynak okunarak belgelendi.

## 2. Olay, dinleyici ve zamanlayıcıların yorumu

| Modül | REA bulgusu | Karşılığı |
|---|---|---|
| `18509` | `changed`, `customizeStoreLoadOptions`, `expandValueChanging`, `fieldsPrepared`, `loadingChanged`, `progressChanged` için 6 `on` + 6 `off` | DataController ↔ DataSource köprüsü (abone olma `_createDataSource`, çıkma `dispose`) |
| `47825` | `customizeStoreLoadOptions` `on`/`off` + `setTimeout(0)` | İç DataSource'un tarih filtresi düzeltmesi; 10k satır / 300 ms zaman dilimlemesi |
| `16508` | `scroll`/`stop` `on`/`off`, 3 × `setTimeout` | Scroll senkronu; hücre tıklamada expand ertelemesi, load panel gizleme, `renderCellCountLimit` boyut ertelemesi |
| `62989` | `changed` `on`/`off` | Field chooser'ın veri kaynağı aboneliği |
| `67705` | `changed`, `disposing` | `bindChart` yeniden çizimi ve otomatik unbind |
| `89272` | `scroll` `on`/`off`, `setTimeout` | Sanal kaydırma: pencere/üst scroller dinleme |
| `87691` | `scroll` `on`/`off`, `setTimeout(10)` | Sürükleme sırasında 10 ms aralıklı otomatik kaydırma |
| `93416` | `on`/`off` (window), `setTimeout(dinamik)`, `JSON.parse` sınırı | `visibilitychange` ile kayıt; `savingTimeout` gecikmesi; state okuma |
| `12867` | `setTimeout`, `parse` sınırı | Export matrisinin ertelenmiş hazırlanması; format → sayı tipi tespiti |
| `48063` | `setTimeout`, `Promise.then`, `parseInt/parseFloat` | `delay` seçeneği; XMLA cevap ayrıştırma |
| `98741` | `Promise.new` | `exportPivotGrid` dönüş Promise'i |

## 3. Modül istatistikleri

| Modül | Fonksiyon | Çağrı noktası | Property slot | Binding | Olay (ad) | Dinleyici | Zamanlayıcı |
|---|---|---|---|---|---|---|---|
| `87993` | 135 | 368 | 371 | 188 | — | 3 | — |
| `18509` | 124 | 334 | 444 | 191 | changed, customizeStoreLoadOptions, expandValueChanging, fieldsPrepared, loadingChanged, progressChanged | 12 | — |
| `16508` | 101 | 635 | 388 | 214 | scroll, stop | 5 | setTimeout(dinamik), setTimeout(dinamik), setTimeout(dinamik) |
| `48063` | 86 | 341 | 298 | 219 | — | 0 | setTimeout(dinamik) |
| `53226` | 71 | 240 | 214 | 142 | — | 0 | — |
| `47825` | 65 | 179 | 147 | 121 | customizeStoreLoadOptions | 2 | setTimeout(0) |
| `62989` | 61 | 270 | 183 | 102 | changed | 2 | — |
| `89272` | 60 | 147 | 53 | 83 | scroll | 4 | setTimeout(dinamik) |
| `96273` | 58 | 184 | 146 | 116 | — | 2 | — |
| `70317` | 52 | 186 | 148 | 79 | — | 4 | — |
| `81383` | 49 | 164 | 175 | 135 | — | 0 | — |
| `81221` | 48 | 130 | 135 | 131 | — | 0 | — |
| `12867` | 39 | 89 | 72 | 55 | — | 0 | setTimeout(dinamik) |
| `87691` | 38 | 217 | 126 | 91 | scroll | 6 | setTimeout(10) |
| `12062` | 35 | 101 | 96 | 85 | — | 0 | — |
| `60457` | 33 | 79 | 48 | 27 | — | 0 | — |
| `77195` | 33 | 76 | 59 | 41 | — | 0 | — |
| `67705` | 27 | 76 | 83 | 62 | changed, disposing | 4 | — |
| `93416` | 26 | 67 | 41 | 25 | — | 2 | setTimeout(dinamik) |
| `2997` | 20 | 111 | 45 | 26 | — | 0 | — |
| `31045` | 14 | 36 | 23 | 12 | — | 0 | — |
| `11075` | 14 | 27 | 31 | 33 | — | 0 | — |
| `98741` | 14 | 101 | 99 | 47 | — | 0 | — |
| `15303` | 11 | 62 | 46 | 42 | — | 0 | — |
| `91189` | 10 | 13 | 9 | 11 | — | 0 | — |
| `47331` | 9 | 36 | 20 | 11 | — | 0 | — |
| `47197` | 8 | 14 | 10 | 17 | — | 0 | — |
| `32760` | 4 | 7 | 8 | 16 | — | 0 | — |
| `11371` | 3 | 5 | 8 | 5 | — | 0 | — |
| `56958` | 3 | 2 | 5 | 1 | — | 0 | — |
| `84265` | 2 | 3 | 5 | 3 | — | 0 | — |
| `49344` | 1 | 1 | 5 | 2 | — | 0 | — |
| `73944` | 1 | 1 | 5 | 0 | — | 0 | — |
| `16075` | 1 | 1 | 5 | 2 | — | 0 | — |
| `80445` | 1 | 1 | 4 | 1 | — | 0 | — |
| `55633` | 1 | 1 | 4 | 1 | — | 0 | — |
| `55067` | 1 | 1 | 4 | 1 | — | 0 | — |
| `84789` | 1 | 18 | 16 | 2 | — | 0 | — |
| `58537` | 1 | 1 | 1 | 0 | — | 0 | — |

### Modül bağımlılıkları (webpack `require` kimlikleri)

| Modül | Doğrudan bağımlılık sayısı | PivotGrid içi bağımlılıklar |
|---|---|---|
| `16508` | 30 | `12062`, `12867`, `18509`, `2997`, `31045`, `53226`, `62989`, `67705`, `70317`, `77195` |
| `53226` | 24 | — |
| `70317` | 21 | `12062`, `47331`, `53226`, `56958`, `73944`, `87691` |
| `84789` | 18 | `16075`, `49344`, `55067`, `55633`, `80445` |
| `87993` | 17 | `11075`, `12062`, `47825`, `48063`, `81221`, `81383` |
| `62989` | 14 | `12062`, `70317`, `73944`, `87993` |
| `12062` | 14 | `58537` |
| `47825` | 13 | `12062` |
| `18509` | 12 | `12062`, `32760`, `87993`, `89272`, `93416` |
| `48063` | 11 | `12062` |
| `81383` | 10 | `12062`, `84265` |
| `96273` | 9 | `11371` |
| `12867` | 9 | `47197` |
| `2997` | 8 | `70317`, `96273` |
| `77195` | 6 | `96273` |
| `60457` | 5 | `91189`, `98741` |
| `31045` | 4 | `12062`, `96273` |
| `67705` | 4 | `12062` |
| `47331` | 3 | `73944` |
| `81221` | 3 | `12062` |
| `11075` | 3 | `12062` |
| `15303` | 2 | — |
| `80445` | 1 | `48063` |
| `56958` | 1 | `73944` |
| `58537` | 0 | — |
| `73944` | 0 | — |

### İsimli fonksiyonlar (REA `function` düğümleri, `_` önekli iç olanlar hariç)

- **`87993`** (54): `87993`, `applyPartialDataSource`, `assignGroupIndexes`, `beginLoading`, `collapseAll`, `collapseHeaderItem`, `createDrillDownDataSource`, `createLocalOrRemoteStore`, `createStore`, `dispose`, `endLoading`, `equalFields`, `expandAll`, `expandHeaderItem`, `field`, `fields`, `filter`, `findHeaderItem`, `formatHeaderItems`, `formatHeaders`, `getAreaFields`, `getData`, `getExpandedPaths`, `getFieldId`, `getFieldStateId`, `getFieldValues`, `getFields`, `getFieldsByGroup`, `getFieldsById`, `getFieldsState`, `getHeaderItemsLastIndex`, `getSummaryFields`, `isAreaField`, `isDisposed`, `isEmpty`, `isLoading`, `load`, `mergeFields`, `mergePartialDataSource`, `off`, `paginate`, `reload`, `setFieldProperties`, `setFieldsState`, `setFieldsStateCore`, `sortFieldsByAreaIndex`, `sortLocal`, `state`, `store`, `updateCache`, `updateCalculatedFieldProperties`, `updateDataSourceCells`, `updateHeaderItemChildren`, `updateHeaderItems`
- **`18509`** (35): `18509`, `beginLoading`, `calculateVirtualContentParams`, `columnPageIndex`, `columnPageSize`, `createCellsInfo`, `createScrollController`, `createSortPaths`, `dispose`, `endLoading`, `foreachRowInfo`, `formatCellValue`, `getCellsInfo`, `getColumnsInfo`, `getDataSource`, `getHeaderIndexedItems`, `getHeaderItemText`, `getHiddenGrandTotalsTotals`, `getHiddenTotals`, `getHiddenValues`, `getRowsInfo`, `isLoading`, `itemsCount`, `load`, `onChanged`, `pageCount`, `rowPageIndex`, `rowPageSize`, `setViewportPosition`, `subscribeToWindowScrollEvents`, `totalColumnCount`, `totalRowCount`, `updateLoading`, `updateViewOptions`, `updateWindowScrollPosition`
- **`16508`** (18): `16508`, `addWidgetPrefix`, `applyPartialDataSource`, `getDataSource`, `getFieldChooserPopup`, `getScrollPath`, `hasScroll`, `isReady`, `onClick`, `onContextMenuPreparing`, `onFieldsPrepared`, `onHidden`, `onItemClick`, `onPositioning`, `onResize`, `onShown`, `resize`, `updateDimensions`
- **`48063`** (38): `48063`, `addSlices`, `checkError`, `createDrillDownAxisSlice`, `declare`, `execXMLA`, `fillCrossJoins`, `fillDataSourceAxes`, `filter`, `generateAxisFieldsFilter`, `generateAxisMdx`, `generateCrossJoin`, `generateDrillDownMDX`, `generateFrom`, `generateMDX`, `generateMdxCore`, `getDrillDownItems`, `getFields`, `getGrandTotalIndex`, `getItem`, `getNodeText`, `getVisibleChildren`, `key`, `load`, `parseAxes`, `parseCells`, `parseDimensionsDiscoverRowSet`, `parseDiscoverRowSet`, `parseDrillDownRowSet`, `parseMeasureGroupDiscoverRowSet`, `parseResult`, `parseStringWithUnicodeSymbols`, `prepareDataFields`, `preparePathValue`, `processMember`, `processTotalCount`, `sendQuery`, `supportPaging`
- **`53226`** (26): `53226`, `byKey`, `calculateLoadPanelPosition`, `checkChanges`, `combineFilters`, `equalSortParameters`, `focusAndSelectElement`, `getContentHeightLimit`, `getDisplayValue`, `getFormatByDataType`, `getGroupRowSummaryText`, `getHeaderFilterGroupParameters`, `getIndexByKey`, `getLastResizableColumnIndex`, `getPointsByColumns`, `getSelectionRange`, `getWrappedLookupDataSource`, `isElementInCurrentGrid`, `isVirtualRowRendering`, `logHeaderFilterDeprecatedWarningIfNeed`, `normalizeLookupDataSource`, `proxyMethod`, `render`, `renderLoadPanel`, `renderNoDataText`, `setSelectionRange`
- **`47825`** (8): `47825`, `ctor`, `filter`, `getDrillDownItems`, `getFields`, `key`, `load`, `seed`
- **`62989`** (12): `62989`, `applyChanges`, `cancelChanges`, `getDataSource`, `itemTemplate`, `onItemClick`, `onItemCollapsed`, `onItemExpanded`, `onItemSelectionChanged`, `onPositioning`, `resetTreeView`, `updateDimensions`
- **`89272`** (37): `89272`, `beginPageIndex`, `dispose`, `endPageIndex`, `getContentOffset`, `getDelayDeferred`, `getItemIndexByPosition`, `getItemOffset`, `getItemSize`, `getItemSizes`, `getScrollingTimeout`, `getViewportItemIndex`, `getViewportParams`, `getViewportPosition`, `getVirtualContentSize`, `handleDataChanged`, `isAppendMode`, `isScrollingBack`, `isVirtual`, `isVirtualMode`, `itemsCount`, `load`, `loadIfNeed`, `off`, `option`, `pageIndex`, `pageSize`, `reset`, `scrollTo`, `setContentItemSizes`, `setViewportItemIndex`, `setViewportPosition`, `subscribeToWindowScrollEvents`, `viewportHeight`, `viewportItemSize`, `viewportSize`, `virtualItemsCount`
- **`96273`** (25): `96273`, `disableVirtualMode`, `element`, `getColumnsCount`, `getColumnsWidth`, `getData`, `getGroupHeight`, `getGroupWidth`, `getRowsHeight`, `getRowsLength`, `groupElement`, `headElement`, `off`, `option`, `render`, `reset`, `resetColumnsWidth`, `scrollTo`, `setColumnsWidth`, `setGroupHeight`, `setGroupWidth`, `setRowsHeight`, `setVirtualContentParams`, `tableElement`, `updateScrollable`
- **`70317`** (14): `70317`, `addWidgetPrefix`, `apply`, `focusFieldElement`, `groupFilter`, `handleFieldClick`, `handleHeaderFilterIconClick`, `load`, `onChanged`, `onDragging`, `renderField`, `renderSortable`, `restoreFieldFocus`, `subscribeToEvents`
- **`81383`** (7): `81383`, `createDrillDownDataSource`, `filter`, `getFields`, `key`, `load`, `supportPaging`
- **`81221`** (12): `81221`, `cell`, `child`, `children`, `field`, `grandTotal`, `isPostProcessed`, `next`, `parent`, `prev`, `slice`, `value`
- **`12867`** (21): `12867`, `exportTo`, `getCellData`, `getCellDataType`, `getCellMerging`, `getCellType`, `getColumnAreaRowCount`, `getColumns`, `getColumnsWidths`, `getDataFieldStyles`, `getDataProvider`, `getFrozenArea`, `getGroupLevel`, `getHeaderStyles`, `getRowAreaColCount`, `getRowsCount`, `getStyleId`, `getStyles`, `isColumnAreaCell`, `isRowAreaCell`, `ready`
- **`87691`** (2): `87691`, `dispose`
- **`12062`** (2): `12062`, `createDrillDownDataSource`
- **`60457`** (1): `60457`
- **`77195`** (7): `77195`, `getScrollPath`, `hasScroll`, `processScrollBarSpacing`, `renderScrollable`, `setVirtualContentParams`, `updateColspans`
- **`67705`** (3): `67705`, `bindChart`, `customizeSeries`
- **`93416`** (14): `93416`, `dispose`, `getColumnsController`, `getDataController`, `getExportController`, `init`, `isEnabled`, `isLoaded`, `isLoading`, `load`, `optionChanged`, `publicMethods`, `save`, `state`
- **`2997`** (6): `2997`, `isVisible`, `onClick`, `reset`, `setGroupHeight`, `setGroupWidth`
- **`31045`** (8): `31045`, `getScrollableDirection`, `getScrollbarWidth`, `getUseNativeValue`, `renderScrollable`, `reset`, `setVirtualContentParams`, `updateScrollableOptions`
- **`11075`** (1): `11075`
- **`98741`** (9): `98741`, `export`, `exportRow`, `getCellStyles`, `getFullOptions`, `setAlignment`, `setColumnsWidth`, `setNumberFormat`, `tryConvertToExcelNumberFormat`
- **`15303`** (2): `15303`, `defaultCalculateFilterExpression`
- **`91189`** (7): `91189`, `addMergedRange`, `applyMergedRages`, `findMergedCellInfo`, `isCellInMergedRanges`, `updateMergedCells`, `updateMergedRanges`
- **`47331`** (1): `47331`
- **`47197`** (1): `47197`
- **`32760`** (1): `32760`
- **`11371`** (1): `11371`
- **`56958`** (1): `56958`
- **`84265`** (1): `84265`
- **`49344`** (1): `49344`
- **`73944`** (1): `73944`
- **`16075`** (1): `16075`
- **`80445`** (1): `80445`
- **`55633`** (1): `55633`
- **`55067`** (1): `55067`
- **`84789`** (1): `84789`
- **`58537`** (1): `58537`
