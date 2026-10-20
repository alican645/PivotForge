# 01 — dxPivotGrid Seçenekleri, Olaylar ve Metotlar

Kaynak modül: `16508` (`PivotGrid` sınıfı, `_getDefaultOptions`, `_optionChanged`, `_initActions`).
Temel sınıf: `x.default` (`89275` → DevExtreme `Widget`). `ExportController` (`12867`) ve `ChartIntegrationMixin` (`67705`) prototipe `Object.assign` ile karıştırılır; bileşen `dxPivotGrid` adıyla kaydedilir.

---

## 1. Seçenekler ve varsayılanlar

### 1.1 Genel

| Seçenek | Varsayılan | Açıklama |
|---|---|---|
| `dataSource` | `null` | `PivotGridDataSource` örneği **(paylaşılır, dispose edilmez)** veya yapılandırma nesnesi (widget kendi örneğini oluşturur ve dispose eder) |
| `allowSorting` | `false` | Alan başlığına tıklayarak sıralama |
| `allowSortingBySummary` | `false` | Sağ tık → "özete göre sırala" |
| `allowFiltering` | `false` | Header filter ikonu |
| `allowExpandAll` | `false` | Sağ tık → "Tümünü genişlet / daralt" |
| `dataFieldArea` | `"column"` | Birden çok data alanı varsa başlıkları: `"column"` veya `"row"` |
| `showRowTotals` | `true` | Satır ara toplamları |
| `showRowGrandTotals` | `true` | Satır genel toplamı |
| `showColumnTotals` | `true` | Sütun ara toplamları |
| `showColumnGrandTotals` | `true` | Sütun genel toplamı |
| `showTotalsPrior` | `"none"` | `"rows"`, `"columns"`, `"both"` → toplamlar detaydan **önce** |
| `hideEmptySummaryCells` | `true` | Tüm değerleri boş olan başlıkları gizle (`showEmpty = !hideEmptySummaryCells`) |
| `rowHeaderLayout` | `"standard"` | `"tree"` → satır başlıkları tek sütunda girintili |
| `wordWrapEnabled` | `true` | Tabloya `dx-word-wrap` sınıfı |
| `showBorders` | `false` | Tabloya `dx-pivotgrid-border` sınıfı |
| `encodeHtml` | `true` | Hücre metninde `<` / `>` varsa HTML-encode |
| `activeStateEnabled` | `false` | — |
| `renderCellCountLimit` | `20000` | Hücre sayısı (satır × sütun) bunu aşarsa **ilk** `updateDimensions` `setTimeout` ile ertelenir (sanal moda geçirmez) |

> `allowSorting`, `allowSortingBySummary`, `allowFiltering`, `allowExpandAll` **alan seviyesinde tanımlı değilse** her alana kopyalanır (`_updateCalculatedOptions`). Alanda açıkça `undefined` verilmişse de widget değeri kullanılır.

### 1.2 `scrolling`

| Alt seçenek | Varsayılan | Not |
|---|---|---|
| `mode` | `"standard"` | `"virtual"` → satır/sütun sanal sayfalaması (bkz. [02](02-mimari-ve-yasam-dongusu.md#7-sanal-kaydirma)) |
| `useNative` | `"auto"` | Yalnızca **data alanı** için; başlık alanları her zaman simüle scroll ve gizli scrollbar kullanır |
| `timeout` | `300` | — |
| `minTimeout` | `10` | — |
| `renderingThreshold` | `150` | — |
| `removeInvisiblePages` | `true` | — |
| `virtualRowHeight` | `50` | Sanal hesapta tahmini satır yüksekliği |
| `virtualColumnWidth` | `100` | Sanal hesapta tahmini sütun genişliği |
| `loadTwoPagesOnStart` | `true` | — |

### 1.3 `fieldChooser` (popup)

| Alt seçenek | Varsayılan | Not |
|---|---|---|
| `enabled` | `true` | Toolbar butonu + sağ tık öğesi |
| `allowSearch` | `false` | TreeView araması |
| `searchTimeout` | `500` | — |
| `layout` | `0` | `0`, `1`, `2` (bkz. [06](06-arayuz-bilesenleri.md)) |
| `applyChangesMode` | `"instantly"` | `"onDemand"` → popup'a **OK / Cancel** butonları eklenir |
| `title` | `dxPivotGrid-fieldChooserTitle` | — |
| `width` / `height` | `600` / `600` | — |
| `minWidth` / `minHeight` | `250` / `250` | Popup yeniden boyutlandırılabilir (`resizeEnabled: true`) |
| `texts` | `{}` | FieldChooser'a aktarılır |
| `encodeHtml` | — | Verilmezse widget `encodeHtml` değeri |

Popup sabit ayarları: `shading: false`, `showCloseButton: true`, `resizeEnabled: true`. FieldChooser bileşeni popup **ilk açıldığında** (`onShown`) oluşturulur; kapanınca `resetTreeView()` + `cancelChanges()` çağrılır.

### 1.4 `fieldPanel`

| Alt seçenek | Varsayılan |
|---|---|
| `visible` | `false` |
| `showColumnFields` / `showRowFields` / `showDataFields` / `showFilterFields` | `true` |
| `allowFieldDragging` | `true` |
| `texts.columnFieldArea` / `rowFieldArea` / `dataFieldArea` / `filterFieldArea` | yerelleştirilmiş; boş alanda gösterilir |

### 1.5 `headerFilter`

| Alt seçenek | Varsayılan |
|---|---|
| `width` / `height` | `252` / `325` |
| `allowSelectAll` | `true` |
| `showRelevantValues` | `false` → `true` ise değer listesi **diğer alanların filtreleri uygulanarak** yüklenir |
| `search.enabled` | `false` |
| `search.timeout` | `500` |
| `search.mode` | `"contains"` |
| `search.editorOptions` | `{}` |
| `texts.emptyValue` / `ok` / `cancel` | yerelleştirilmiş; boş metinli değerler `emptyValue` ile gösterilir |

### 1.6 `stateStoring`

| Alt seçenek | Varsayılan |
|---|---|
| `enabled` | `false` |
| `type` | `"localStorage"` (`"sessionStorage"`, `"custom"`) |
| `storageKey` | `null` → **gerçek anahtar `"storage"`** |
| `customLoad` / `customSave` | `null` |
| `savingTimeout` | `2000` ms |

Ayrıntı: [07](07-export-grafik-state.md#3-statestoring).

### 1.7 `loadPanel`

| Alt seçenek | Varsayılan |
|---|---|
| `enabled` | `true` |
| `text` | `Loading` |
| `width` / `height` | `200` / `70` |
| `showIndicator` / `showPane` | `true` / `true` |

> **Deprecated:** `loadPanel.indicatorSrc` → 25.2'den beri `loadPanel.indicatorOptions.src`.

### 1.8 `export`

| Alt seçenek | Varsayılan |
|---|---|
| `enabled` | `false` |
| `fileName` | `"PivotGrid"` |

> `exportTo()` `onExporting`'e `{ rtlEnabled, fileName: "PivotGrid", cancel: false }` gönderir — **`export.fileName` bu argümana aktarılmaz**, sabit `"PivotGrid"` gelir. Dosya adını `onExporting` içinde kendiniz belirlemelisiniz.

### 1.9 `texts`

| Anahtar | Kaynak | Not |
|---|---|---|
| `grandTotal` | `dxPivotGrid-grandTotal` | GT başlığı; `bindChart` da kullanır |
| `total` | `dxPivotGrid-total` (formatter) | `"{0} Total"` biçimi; ara toplam başlığı |
| `noData` | `dxDataGrid-noDataText` | — |
| `showFieldChooser` | `dxPivotGrid-showFieldChooser` | — |
| `expandAll` / `collapseAll` | `dxPivotGrid-expandAll` / `collapseAll` | — |
| `sortColumnBySummary` / `sortRowBySummary` | formatter | `{0}` = alan caption'ı |
| `removeAllSorting` | `dxPivotGrid-removeAllSorting` | — |
| `exportToExcel` | `dxDataGrid-exportToExcel` | — |
| `dataNotAvailable` | `dxPivotGrid-dataNotAvailable` | XMLA hata hücresi (`#N/A`) yerine gösterilir |

---

## 2. Bir seçenek değişince ne olur (`_optionChanged`)

| Değişen seçenek | Tepki |
|---|---|
| `allowSorting`, `allowSortingBySummary`, `allowFiltering`, `allowExpandAll` | Önce alanlara yeniden kopyalanır, sonra aşağıdaki "tam yeniden kurulum" |
| `dataSource`, `scrolling`, `stateStoring` (ve yukarıdakiler) | **Tam yeniden kurulum:** DataController dispose edilip yeniden oluşturulur → field chooser popup gizlenir → field chooser yeniden kurulur → `_invalidate()` |
| `texts`, `showTotalsPrior`, `showRowTotals`, `showRowGrandTotals`, `showColumnTotals`, `showColumnGrandTotals`, `hideEmptySummaryCells`, `dataFieldArea` | Veri yeniden **yüklenmez**; yalnızca `DataController.updateViewOptions()` → başlık matrisi yeniden hesaplanır |
| `rowHeaderLayout` | `dx-area-tree-view` sınıfı değiştirilir + `updateViewOptions()` |
| `useNativeScrolling`, `encodeHtml`, `renderCellCountLimit`, `onExpandValueChanging` | **Hiçbir şey yapılmaz** (bir sonraki render'da etkili olur; `onExpandValueChanging` için DataController yeniden kurulmalıdır) |
| `rtlEnabled` | Temel işlem + field chooser + context menu + load panel yeniden; `_invalidate()` |
| `export` | Yalnızca toolbar (`_renderDescriptionArea`) |
| `onCellClick`, `onContextMenuPreparing`, `onExporting`, `onExported`, `onFileSaving`, `onCellPrepared` | Action yeniden oluşturulur |
| `fieldChooser` | Field chooser + toolbar yeniden |
| `loadPanel` | `loadPanel.enabled` ise bekleyen gizleme zamanlayıcısı temizlenip panel yeniden; diğer alt seçeneklerde panel yeniden + `_invalidate()` |
| `fieldPanel` | Toolbar + `_invalidate()` |
| `headerFilter` | Field chooser + `_invalidate()` |
| `showBorders`, `wordWrapEnabled` | Sınıf değiştirilir + `updateDimensions()` |
| `height`, `width` | `_hasHeight` sıfırlanır (yükseklik yeniden ölçülür) + `resize()` |

> `onExpandValueChanging` DataController kurulurken okunur; çalışma anında değiştirmek etkisizdir.

---

## 3. Olaylar

| Olay | Argümanlar | Not |
|---|---|---|
| `onCellClick` | `area`, `cell`, `rowIndex`, `columnIndex`, `cellElement`, `rowFields`, `columnFields`, `dataFields`, `event`, `cancel` | `cancel = true` → genişletme/daraltma yapılmaz. Expand/collapse `setTimeout` ile tetiklenir |
| `onCellPrepared` | `area`, `rowIndex`, `columnIndex`, `cellElement`, `cell` + varsayılan argümanlar | Her render'da tüm hücreler için; yalnızca handler varsa döngü çalışır |
| `onContextMenuPreparing` | Hücrede: `area`, `cell`, `rowIndex`, `columnIndex`, `cellElement`; alan butonunda: `field`; ikisinde de `rowFields`, `columnFields`, `dataFields`, `event`, `items` | `items` değiştirilebilir; boş bırakılırsa menü açılmaz. Field chooser'ın menüsü de buraya yönlendirilir |
| `onExpandValueChanging` | `area`, `path`, `expanded`, `needExpandData` | DataSource olayından köprülenir |
| `onExporting` | `rtlEnabled`, `fileName`, `cancel` | Export butonu, sağ tık veya `exportTo()` |
| `onChanged` | — | DataSource `changed` sonrası (iç action) |
| `onContentReady` | — | **Yükleme devam ederken tetiklenmez** |

---

## 4. Public metotlar

| Metot | Ne yapar |
|---|---|
| `getDataSource()` | DataController'ın veri kaynağı |
| `getFieldChooserPopup()` | Popup örneği |
| `bindChart(chart, options)` | Bkz. [07](07-export-grafik-state.md#2-bindchart); unbind fonksiyonu döner, chart değilse `null` |
| `exportTo()` | `onExporting`'i tetikler |
| `updateDimensions()` | Boyut senkronizasyonu (Deferred döner) |
| `resize()` | `updateDimensions()` |
| `applyPartialDataSource(area, path, data)` | Bir başlık dalına dışarıdan veri ekler |
| `getScrollPath(area)` | Görünür ilk başlığın yolu (`"column"` → yatay, diğerleri dikey) |
| `hasScroll(area)` | İlgili başlık alanında kaydırma var mı |
| `isReady()` | Widget hazır **ve** yükleme yok |
| `addWidgetPrefix(name)` | `dx-pivotgrid-<name>` |

---

## 5. Kullanım ipuçları (koddan çıkan)

- `scrolling`, `stateStoring` veya `allow*` seçeneklerini çalışma anında değiştirmek **DataController'ı baştan kurar**, yani veri yeniden yüklenir. Toplam gösterimi gibi görsel seçenekler ise yeniden yüklemeden uygulanır.
- `dataSource` olarak hazır bir `PivotGridDataSource` vermek, aynı kaynağın birden fazla bileşende (grid + field chooser + chart) paylaşılmasını sağlar; widget dispose edilince kaynak **dispose edilmez**, yalnızca olay abonelikleri kaldırılır.
- `export.fileName` kullanılmıyor; dosya adını `onExporting` içinde `saveAs(..., 'Ad.xlsx')` ile verin.
