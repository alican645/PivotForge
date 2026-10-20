# 02 — Mimari ve Yaşam Döngüsü

Kaynak modüller: `16508` (PivotGrid), `18509` (DataController), `89272` (VirtualScrollController), `96273` / `31045` / `77195` / `2997` (alanlar), `53226` (load panel).

---

## 1. Sınıflar ve sahiplik

```
dxPivotGrid (Widget)
 ├─ _dataController : DataController
 │    ├─ _dataSource : PivotGridDataSource   (paylaşılmışsa _isSharedDataSource = true)
 │    ├─ _stateStoringController : StateStoringController
 │    ├─ _rowsScrollController / _columnsScrollController : VirtualScrollController   (yalnızca virtual mod)
 │    └─ Callbacks: changed, loadingChanged, progressChanged, scrollChanged,
 │                  expandValueChanging, dataSourceChanged
 ├─ _fieldChooserBase : dxPivotGridFieldChooserBase   (widget kök elemanı üzerinde)
 ├─ _fieldChooserPopup : dxPopup  → içinde dxPivotGridFieldChooser
 ├─ _contextMenu : dxContextMenu
 ├─ _dataArea : DataArea
 ├─ _rowsArea : VerticalHeadersArea
 ├─ _columnsArea : HorizontalHeadersArea
 ├─ _rowFields / _columnFields / _filterFields / _dataFields : FieldsArea
 └─ _loadPanel
```

`FieldChooserBase`, PivotGrid'in **kendi kök elemanı üzerinde** ikinci bir bileşen olarak yaratılır. Sürükle-bırak, alan tıklama ve header filter bu bileşen üzerinden yürür; grid ve field chooser aynı altyapıyı paylaşır.

---

## 2. Başlatma sırası

```
_init()
 ├─ super._init()
 ├─ _initDataController()
 │    ├─ new DataController(options)
 │    │    ├─ _createDataSource()            → PivotGridDataSource'u bulur/yaratır, 6 olaya abone olur
 │    │    ├─ (virtual mod) 2 × VirtualScrollController
 │    │    ├─ new StateStoringController().init()   → window "visibilitychange" dinleyicisi
 │    │    ├─ load()                         → state açıksa önce state yüklenir, sonra dataSource.load()
 │    │    ├─ _update()                      → boş başlık matrisi
 │    │    └─ changed = Callbacks()          (load/_update'ten SONRA oluşturulur; ilk tetikleme kaybolmaz çünkü veri async gelir)
 │    ├─ changed        → _render()          (yalnızca window varsa)
 │    ├─ scrollChanged  → _scrollLeft/_scrollTop
 │    ├─ loadingChanged → _updateLoading()
 │    ├─ progressChanged→ _updateLoading(progress)
 │    ├─ dataSourceChanged → onChanged action
 │    └─ expandValueChanging → onExpandValueChanging (varsa)
 ├─ header filter deprecated uyarısı kontrolü
 ├─ _scrollLeft = _scrollTop = null
 └─ _initActions()  → onChanged, onContextMenuPreparing, onCellClick, onExporting, onCellPrepared
```

### DataController ↔ DataSource olay köprüsü

| DataSource olayı | DataController işleyicisi | Sonuç |
|---|---|---|
| `changed` | `_update()` + `dataSourceChanged.fire()` | Başlık matrisi yeniden kurulur → `changed` → widget `_render()` |
| `expandValueChanging` | `expandValueChanging.fire(e)` | `onExpandValueChanging` |
| `loadingChanged` | `loadingChanged.fire(e)` | Load panel |
| `progressChanged` | `progressChanged.fire(0.8 × e)` | Store ilerlemesi **%0–80** aralığına ölçeklenir |
| `fieldsPrepared` | `options.onFieldsPrepared(fields)` | Widget `allow*` seçeneklerini alanlara kopyalar |
| `customizeStoreLoadOptions` | `_handleCustomizeStoreLoadOptions` | Sanal + paginate modunda skip/take ayarı |

İlerleme yüzdesi: store %0–80, satır başlık matrisi %80–90, sütun başlık matrisi %90–100 (`0.8 + 0.1·rowProgress + 0.1·columnProgress`).

---

## 3. DOM iskeleti (`_renderContentImpl`)

İlk render'da widget elemanına `dx-pivotgrid`, `dx-row-lines`, `dx-pivotgrid-fields-container` sınıfları eklenir ve şu tablo kurulur:

```
div.dx-pivotgrid-container
 └─ table  (width:100%, [dx-pivotgrid-border], [dx-word-wrap])
     ├─ tr: td.dx-filter-header (colspan=2)                  ← filtre alanları (field panel)
     ├─ tr: td.dx-data-header | td.dx-column-header          ← data alanları | sütun alanları
     ├─ tr: td.dx-area-description-cell | td.dx-area-column-cell   ← toolbar | sütun başlıkları
     └─ tr.dx-bottom-row: td.dx-area-row-cell | td.dx-area-data-cell ← satır başlıkları | veri
```

- `rowHeaderLayout: "tree"` ise `td.dx-area-row-cell`'e `dx-area-tree-view` eklenir.
- Tablodaki **her `td`** için `dxclick` (namespace `dxPivotGrid`) dinleyicisi tek yerden bağlanır (event delegation).
- Toolbar (`div.dx-pivotgrid-toolbar`) şu öncelikle yerleşir: field panel görünür ve filtre alanı açıksa `dx-filter-header`'a; değilse data/sütun alanı açıksa `dx-column-header`'a; hiçbiri değilse `dx-area-description-cell`'e. Fluent temada butonlar `stylingMode: "text"`, diğerlerinde `"contained"`.

Her render'da:
1. `FieldChooserBase` seçenekleri güncellenir (`dataSource`, `encodeHtml`, `allowFieldDragging`, `headerFilter`, `visible`, `remoteSort = (scrolling.mode === "virtual")`).
2. `DataArea.render(cellsInfo)`, `VerticalHeadersArea.render(rowsInfo)`, `HorizontalHeadersArea.render(columnsInfo)`.
3. Sütun başlığının `<thead>`'i veri tablosunun başına taşınır (genişlik ölçümü için).
4. İlk render'da: load panel, toolbar, üç alanın `dxScrollable`'ı.
5. Tüm scroll dinleyicileri sökülür (`scroll`, `stop`).
6. Field panel (`FieldsArea` × 4) render edilir; sortable kurulur; odak geri yüklenir.
7. `_update(isFirst)` → `updateDimensions()`; ilk render'da hücre sayısı `renderCellCountLimit`'i aşıyorsa `setTimeout` ile ertelenir.

---

## 4. Boyut algoritması (`updateDimensions`)

PivotGrid dört ayrı tabloyu (satır başlık, sütun başlık, veri, alan paneli) **piksel düzeyinde hizalı** tutar.

### 4.1 Kapsayıcı yüksekliği tespiti (`_detectHasContainerHeight`)

1. `_hasHeight` önceden belirlenmişse ve `height` seçeneğinin `"auto"` olup olmama durumu değişmemişse ölçüm atlanır.
2. Eleman gizliyse atlanır.
3. İçerik geçici olarak `dx-hidden` yapılır, elemana **66666 px** yüksekliğinde bir `div` eklenir.
4. Eleman yüksekliği 66666 değilse → kapsayıcının sabit bir yüksekliği vardır (`_hasHeight = true`).
5. Geçici div kaldırılır.

`_hasHeight = false` ise grid içerik kadar uzar, dikey kaydırma **pencere/üst kaydırıcılar** üzerinden yapılır (`subscribeToWindowScrollEvents`).

### 4.2 Adımlar

```
1. Ölçüm öncesi sıfırlama
   - satır alan paneli görünür ve layout "tree" değilse: satır başlıklarının colspan'leri
     alan sayısına göre düzeltilir, alan paneli <thead>'i satır tablosuna taşınır
   - tabloya dx-incompressible-fields eklenir
   - tüm alanlar reset() (genişlik/yükseklik/colgroup temizlenir)

2. deferUpdate (okuma fazı)
   - satır yükseklikleri: max(satır başlık yüksekliği, veri satırı yüksekliği)  ← mergeArraysByMaxValue
   - sütun başlık yükseklikleri ile toolbar yüksekliği karşılaştırılır
   - _hasHeight ise kullanılabilir yükseklik =
       eleman yüksekliği − filtre başlığı − data başlığı − max(sütun başlık, toolbar) − kenarlıklar
   - kullanılabilir genişlik = eleman genişliği − satır başlık genişliği − kenarlıklar
   - veri tablosu bu genişliği 0–2 px aşıyorsa fark sütunlara eşit dağıtılıp düşülür
   - dikey scroll gerekli mi (yükseklik farkı ≥ 1 px), yatay scroll gerekli mi

3. deferRender (yazma fazı)
   - thead'ler geri taşınır, dx-incompressible-fields kaldırılır
   - sütun başlıklarına: grup genişliği, scrollbar boşluğu, sütun genişlikleri
   - satır başlıklarına: grup yüksekliği, scrollbar boşluğu, sütun genişlikleri, satır yükseklikleri
   - veri alanına: sütun genişlikleri, satır yükseklikleri, grup genişlik/yükseklik
   - _hasHeight yoksa ve genişlik değiştiyse (scrollbar çıktı) farkı sütunlara dağıtır
   - filtre alanı yüksekliği değiştiyse (alan butonları satır kaydırdı) yükseklik yeniden düzeltilir
   - virtual mod: _setVirtualContentParams(...)
   - veri alanının scroll yönü: yalnız yatay / yalnız dikey / ikisi
   - üç dxScrollable.update() → bitince scroll konumu geri yüklenir, scroll olayları bağlanır,
     alan odağı geri yüklenir
```

Sütun genişliği tablosu `<colgroup>` ile yazılır ve `table-layout: fixed` uygulanır; tablo genişliği sütun toplamına eşitlenir.

---

## 5. Scroll senkronizasyonu

Üç `dxScrollable` vardır:

| Alan | Yön | Scrollbar | `useNative` |
|---|---|---|---|
| Sütun başlıkları | yatay | `never` | `false` |
| Satır başlıkları | dikey | `never` | `false` |
| Veri | ihtiyaca göre | görünür | `scrolling.useNative` (`"auto"` → cihazın native scroll desteği) |

Akış (`_subscribeToEvents`):
1. Her alanın `scroll` ve `stop` olaylarına aynı işleyici bağlanır.
2. Olay geldiğinde yeni `left`/`top` hesaplanır (alanın yönüne göre yalnız ilgili eksen alınır; `_hasHeight` yoksa `top` yok sayılır).
3. Değişmişse `_updateScrollPosition`: diğer iki alan `scrollTo` ile aynı konuma getirilir; `_scrollUpdating` bayrağı döngüyü engeller.
4. Virtual moddaysa `DataController.setViewportPosition(left, top)`.

RTL'de yatay ofset `scrollWidth − clientWidth − left` olarak çevrilir. `getMemoizeScrollTo` (11371) aynı tamsayı konuma tekrar `scrollTo` çağrılmasını engeller.

---

## 6. Yükleme paneli

- Panel veri alanının grup elemanı üzerine ortalanır (`calculateLoadPanelPosition`).
- Render başında widget'a `dx-overflow-hidden` eklenir; panel gösterilirken ve panel gizlenirken bu sınıf kaldırılır.
- **İlerleme yüzdesi yalnızca yükleme 1 saniyeden uzun sürerse** panel mesajına yazılır (`%45` gibi); aksi halde `loadPanel.text`.
- Panel kapanması `setTimeout(0)` ile ertelenir (art arda yüklemelerde titremeyi önler).

---

## 7. Sanal kaydırma

`scrolling.mode: "virtual"` iken DataController iki `VirtualScrollController` (89272, DataGrid ile ortak) kurar:

| Parametre | Satır | Sütun |
|---|---|---|
| Toplam öğe | `rowsInfo.length` | ilk sütun satırındaki colspan toplamı |
| Sayfa boyutu | `rowPageSize()` → varsayılan **20** | `columnPageSize()` → varsayılan **20** |
| Görünüm öğe boyutu | `virtualRowHeight` (50) | `virtualColumnWidth` (100) |
| Görünüm boyutu | yükseklik / öğe boyutu | genişlik / öğe boyutu |

Çalışma:
1. `updateDimensions` → `calculateVirtualContentParams` → kontrolcülere ölçülen satır yükseklikleri / sütun genişlikleri verilir, `loadIfNeed()` çağrılır.
2. Dönen `contentTop`, `contentLeft`, `width`, `height` ile her alan bir `div.dx-virtual-content` içinde konumlanır (`dx-virtual-mode` sınıfı).
3. `getRowsInfo()` / `getColumnsInfo()` yalnızca görünür sayfa aralığını (`beginPageIndex … endPageIndex`) keser; kesilen başlıkların `rowspan` / `colspan` değerleri aralığa sığacak şekilde küçültülür.
4. Kaydırma sırasında **sahte tablo** (`dx-pivot-grid-fake-table`) — tablonun bir klonu — yarım sayfa adımlarla kaydırılarak yeni sayfa render edilene kadar boşluk görünmesi engellenir.
5. Değişiklik süresi (`changingDuration`) ölçülür; paginate açıksa sabit 300 ms kabul edilir.

`paginate` açıksa (yalnızca XMLA) kontrolcülerin `load()`'u veri kaynağını yeniden yükler ve `customizeStoreLoadOptions` ile görünür sayfa için `rowSkip/rowTake/columnSkip/columnTake` hesaplanır; açık başlık yollarının (`expandedPaths`) her biri için ayrı skip/take üretilir. Bkz. [03](03-veri-kaynagi.md#7-sayfalama-onbellegi).

> Export sırasında `getRowsInfo(true)` / `getColumnsInfo(true)` / `getCellsInfo(true)` çağrılır; sanal kesme **atlanır**, tüm matris dışa aktarılır. Sanal modda sütun genişlikleri sabit 100 px kabul edilir.

---

## 8. Hücre tıklama ve genişletme

```
td dxclick
 └─ _createEventArgs(td)
      ├─ td bir alan butonunun içindeyse → { field } (alan argümanları)
      └─ değilse → { area, rowIndex, columnIndex, cellElement, cell }
           cell = tablo.data("data")[rowIndex][cellIndex]
 └─ hücre varsa ve (area varsa veya sol üst hücreyse)
      ├─ onCellClick(args)
      └─ !args.cancel ve cell.expanded tanımlıysa
           setTimeout → DataController.expandHeaderItem / collapseHeaderItem(area, cell.path)
```

Her alan tablosu render edilirken `data("area")` ve `data("data")` (hücre matrisi) tabloya iliştirilir; tıklamada hücre nesnesi DOM'dan değil bu matristen bulunur.

---

## 9. Sağ tık menüsü akışı

1. `dxContextMenu` widget elemanını hedef alır; `onPositioning` içinde **varsayılan olarak iptal edilir**.
2. Hedef `td` bulunur → olay argümanları üretilir → `_getContextMenuItems`.
3. Öğe listesi boş değilse menü açılır.

Öğelerin koşulları ve davranışları için bkz. [06](06-arayuz-bilesenleri.md#7-sağ-tık-menüleri).

---

## 10. Dispose

- Load panel gizleme zamanlayıcısı temizlenir.
- DataController dispose:
  - Paylaşılan kaynakta 6 olay aboneliği kaldırılır; değilse kaynak dispose edilir (bekleyen gecikmeli yükleme iptal edilir).
  - Sanal kaydırma kontrolcüleri ve state controller dispose (bekleyen kayıt zamanlayıcısı iptal, `visibilitychange` kaldırılır).
  - Tüm Callbacks boşaltılır.
