# 06 — Arayüz Bileşenleri

Kaynak modüller: `96273` (AreaItem), `31045` (DataArea), `77195` (Horizontal/VerticalHeadersArea), `2997` (FieldsArea), `70317` (FieldChooserBase), `62989` (FieldChooser), `87691` (Sortable), `47331`, `56958`, `73944`, `16508` (sağ tık).

---

## 1. AreaItem — tablo alanı temeli

Her alan bir **grup elemanı** (`div`, `dxScrollable` taşır) ve içinde bir **tablo**dan oluşur.

### 1.1 Render (`render` → `_renderTableContent`)

1. Tablo varsa içi boşaltılır ve `style` kaldırılır; yoksa grup + tablo yaratılır.
2. Tabloya `data("area", alanAdı)` ve `data("data", hücreMatrisi)` iliştirilir (tıklama ve sağ tık bu matristen okur).
3. Bir `<colgroup>` eklenir.
4. Her hücre doğrudan DOM API ile (`createElement`) oluşturulur:
   - `rowspan` / `colspan` öznitelikleri,
   - alana özgü sınıf ve stiller (`_applyCustomStyles`),
   - `expanded` tanımlıysa `div.dx-expand-icon-container > span.dx-expand`,
   - metin `span` içine `innerHTML` ile yazılır; hücrede `wordWrapEnabled` tanımlıysa `white-space: normal / nowrap`,
   - `sorted` ise `span.dx-icon-sorted` (özete göre sıralı başlık).
5. Virtual moddaysa tablonun önüne `div.dx-virtual-content` eklenir.
6. `onCellPrepared` (handler varsa) her hücre için tetiklenir.

### 1.2 HTML güvenliği

`_getCellText`: metin boşsa `&nbsp`. `encodeHtml: true` ve metinde `<` veya `>` varsa metin bir `div`'in `text()`'i üzerinden escape edilir. **`<`/`>` içermeyen metinler escape edilmez**; `&amp;` gibi varlıklar olduğu gibi HTML olarak yorumlanır.

### 1.3 Ölçüm yardımcıları

| Metot | İş |
|---|---|
| `getRowsHeight()` | Her satırın `getBoundingClientRect().height`'ı (alt piksel düzeltmeli) |
| `setRowsHeight(h[])` | Satır yükseklikleri + tablo toplam yüksekliği |
| `getColumnsWidth()` | rowspan/colspan'i hesaba katarak her sütunun **en dar colspan'li** hücresinden gerçek genişlik |
| `setColumnsWidth(w[])` | `<col>` genişlikleri, `table-layout: fixed`; fazla sütunlar sonuncuya eklenir |
| `getColumnsCount()` | İlk satırın colspan toplamı |
| `reset()` | Sahte tablo, virtual sınıfı, genişlik/yükseklik, colgroup temizliği |
| `scrollTo({left, top}, force)` | RTL çevirisi + memoize; virtual'da sahte tabloyu kaydırır |

---

## 2. Alan türleri

| Sınıf | Alan adı | Grup sınıfları | Tablo bölümü | Scroll |
|---|---|---|---|---|
| `DataArea` | `data` | `dx-pivotgrid-area dx-pivotgrid-area-data` | `tbody` | ihtiyaca göre, `useNative` ayarlı, scrollbar görünür |
| `HorizontalHeadersArea` | `column` | `dx-pivotgrid-horizontal-headers dx-pivotgrid-area` | `thead.dx-pivotgrid-horizontal-headers` | yatay, scrollbar yok |
| `VerticalHeadersArea` | `row` | `dx-pivotgrid-vertical-headers dx-pivotgrid-area` | `tbody.dx-pivotgrid-vertical-headers` | dikey, scrollbar yok |
| `FieldsArea` | `fields` | `dx-pivotgrid-fields-area dx-area-fields dx-pivotgrid-drag-action` + `group="row|column|data|filter"` | `thead.dx-pivotgrid-fields-area-head` | — |

### 2.1 Hücre sınıfları

| Alan | Koşul | Sınıf / stil |
|---|---|---|
| Veri | satır veya sütun tipi `T` | `dx-total` |
| Veri | satır veya sütun tipi `GT` | `dx-grandtotal` |
| Veri | satır tipi `T`/`GT` | `dx-row-total` |
| Başlık | tip `T`/`GT` | `dx-row-total` + `dx-total` / `dx-grandtotal` |
| Başlık | `expanded` tanımlı | `dx-pivotgrid-expanded` / `dx-pivotgrid-collapsed` |
| Satır başlığı | son hücre | `dx-last-cell` |
| Satır başlığı | `isWhiteSpace` (tree layout boşluk sütunu) | `dx-white-space-column` |
| Satır başlığı satırı | ilk satır değil ve hücre açık | `tr.dx-expand-border` |
| Tümü | `width` | `min-width: <w>px` |
| Tümü | `sorted` | `dx-pivotgrid-sorted` |

### 2.2 Görünür başlık yolu (`getScrollPath`)

- Sütun: tablo `left` ofseti çıkarılarak, kaydırma konumunu içeren **colspan = 1** ilk hücrenin `path`'i.
- Satır: her satırın **son** hücresi (rowspan = 1) içinde konumu içeren ilki.

### 2.3 Scrollbar boşluğu

Data alanında native scrollbar çıktığında:
- Sütun başlık alanı scrollbar genişliği kadar daraltılır, `dx-vertical-scroll` sınıfı alır.
- Satır başlık alanının altına scrollbar yüksekliğinde boş bir `div` eklenir.

Scrollbar genişliği, `body`'ye geçici bir `div.dx-pivotgrid-scrollbar-measure-element` eklenip `offsetWidth − clientWidth` ile **bir kez** ölçülür (memoize).

---

## 3. Field panel (FieldsArea)

- Görünürlük: `fieldPanel.visible && fieldPanel.show<Alan>Fields`. Gizliyse grup `dx-hidden`.
- Her alan bir `td` içinde `FieldChooserBase.renderField(...)` ile çizilir (sıralama oku + header filter ikonu dahil).
- Aynı `groupName`'e sahip ardışık alanlar arasına `div.dx-group-connector` (`-prev` / `-next`) çizgileri eklenir.
- Alan yoksa `div.dx-empty-area-text` içinde `fieldPanel.texts.<alan>FieldArea`.
- Kodda "hamburger" (dar ekranda `Fields` butonu + popup) altyapısı bulunuyor ama `_shouldCreateButton()` her zaman `false` döndüğü için **bu sürümde devre dışı**.

---

## 4. FieldChooserBase (`dxPivotGridFieldChooserBase`)

PivotGrid'in kök elemanında ve FieldChooser'ın temelinde çalışan ortak altyapı. `HeaderFilterView` + header filter mixin + sütun durum ikonları mixin'leriyle genişletilmiş bir `Widget`.

### 4.1 Varsayılanlar

`allowFieldDragging: true`, `applyChangesMode: "instantly"`, `state: null`, `headerFilter` (grid ile aynı), `remoteSort: false`.

### 4.2 Alan butonu (`renderField`)

```
div.dx-area-field.dx-area-box [tabIndex=0] (data("field") = alan)
 └─ div.dx-area-field-content  (caption ?? dataField ?? "")
 + alan "data" değilse:
     allowSorting → sıralama oku (asc/desc)
     header filter ikonu (allowFiltering ve grup seviyesi değilse etkin; filterValues varsa dolu görünür)
 + groupName varsa öznitelik item-group=<groupName>
```

Grup seviyelerinde filtre durumu **grup alanının kendisinden** okunur.

### 4.3 Etkileşim

| Olay | Davranış |
|---|---|
| Tıklama / Enter / Space, hedef header filter ikonu | Header filter menüsü |
| Tıklama / Enter / Space, `allowSorting` ve alan `data` değil | Sıralama ters çevrilir. `remoteSort` (virtual scroll) → `field()` + `load()`; değilse `field()` + `sortLocal()` |
| `focusin` / `focusout` | Odaklı alan indeksi tutulur; her render'dan sonra odak geri verilir |

### 4.4 Header filter

- Tür: grup alanıysa `"tree"`, değilse `"list"`.
- Değer listesi `dataSource.getFieldValues(index, showRelevantValues, ...)` ile yüklenir; paginate + list modunda sunucu sayfalaması, aksi halde tüm liste bir ArrayStore'a konup istemcide aranır.
- Seçili durum: `filterValues` ile eşleşen öğeler işaretlenir; `filterType: "exclude"` ters seçim. Ağaç modunda değerler yol dizisi (`["2024", "1"]`) olarak saklanır.
- Uygula → `field(index, { filterValues, filterType })` → `load()`.
- Menü kapanınca alan butonuna odak döner.

### 4.5 Sürükle-bırak

`Sortable` (87691, PivotGrid'e özel) şu ayarlarla kurulur:

| Ayar | Değer |
|---|---|
| `itemSelector` | `.dx-area-field` |
| `itemContainerSelector` | `.dx-area-field-container` |
| `groupSelector` | `.dx-area-fields` (`group` özniteliği hedef alanı verir) |
| `groupFilter` | Yalnızca **aynı DataSource'u** kullanan grid / field chooser'lar arasında taşıma |
| `useIndicator` | `true` (bırakma çizgisi) |
| `direction` | grid: `"auto"`, field chooser: `""` |
| Otomatik kaydırma | Kenara yaklaşınca 10 ms aralıkla |

Sürükleme kuralları (`shouldCancelDragging`):

| Alan | Yasak hedefler |
|---|---|
| `isMeasure: true` (ölçü) | `row`, `column`, `filter` |
| `isMeasure: false` (boyut) | `data` |
| `isMeasure` tanımsız (dizi verisi) | serbest |

Bırakınca: `areaIndex`, gizli (`visible: false`) alanlar sayılarak düzeltilir → `field(index, { area, areaIndex })` → `instantly` ise `load()`, `onDemand` ise yalnızca görünüm güncellenir.

### 4.6 `applyChangesMode: "onDemand"`

`_processDemandState`: işlem öncesi kaynağın gerçek state'i saklanır, bileşenin bekleyen `state`'i geçici uygulanır (`skipLoading`), işlem yapılır, gerçek state geri yüklenir. Değişiklikler yalnızca `applyChanges()` (popup **OK**) ile `dataSource.state(...)`'e yazılır; `cancelChanges()` bekleyen state'i kaynağınkine eşitler.

---

## 5. FieldChooser (`dxPivotGridFieldChooser`)

### 5.1 Ek varsayılanlar

`height: 400`, `layout: 0`, `allowSearch: false`, `searchTimeout: 500`, `encodeHtml: true`, `onContextMenuPreparing: null`, `texts: { columnFields, rowFields, dataFields, filterFields, allFields }`.

### 5.2 Layout'lar

```
layout 0 (varsayılan)              layout 1                     layout 2
┌──────────┬──────────┐            ┌──────────┬──────────┐      ┌─────────────────────┐
│ Tüm      │ Satır    │            │ Tüm      │ Filtre   │      │ Tüm alanlar         │
│ alanlar  │ Sütun    │            │ alanlar  │ Satır    │      ├──────────┬──────────┤
├──────────┼──────────┤            │          │ Sütun    │      │ Filtre   │ Sütun    │
│ Filtre   │ Veri     │            │          │ Veri     │      │ Satır    │ Veri     │
└──────────┴──────────┘            └──────────┴──────────┘      └──────────┴──────────┘
dx-layout-0                         (sınıf yok)                  dx-layout-2
```

Her alan kutusu: başlık (`dx-area-icon` + caption) + kaydırılabilir `dx-area-fields[group=<alan>]` listesi.

### 5.3 "Tüm alanlar" ağacı (`dxTreeView`)

- Kaynak: `visible !== false` ve grup seviyesi olmayan alanlar.
- Klasörleme: önce `dimension`, sonra `displayFolder` (noktalı yollar iç içe klasör olur).
- Öğe ikonları: ölçü → `formula`, hiyerarşi (grup) → `hierarchy`, boyut → `detailslayout`; `isMeasure` tanımsız alanlarda ikon yok.
- Sıralama: ölçü klasörleri önce → klasörler yapraklardan önce → çok seviyeli hiyerarşiler sona → metne göre.
- Onay kutusu: `selected = alanı var mı`.
- Açık klasörler `_expandedPaths`'te tutulur; veri değişince ağaç yeniden kurulup kaydırma konumu korunur.

Onay kutusu davranışı:

| Seçim | Sonuç |
|---|---|
| Yaprak işaretlendi | Ölçüyse → `data`, değilse → **`column`** alanına |
| Yaprak işareti kaldırıldı | Alanı kaldırılır (`area: undefined`) |
| Klasör işaretlendi, içinde alanda olan alan yok | İçindeki `isDefault` (yoksa ilk) alan seçilir |
| Klasör işaretlendi, zaten alanda olan var | Tümü kaldırılır |

### 5.4 Metotlar

`applyChanges()`, `cancelChanges()`, `getDataSource()`, `updateDimensions()` (alan kutularının scrollable'larını günceller), `resetTreeView()` (aramayı temizler, tüm klasörleri kapatır).

### 5.5 Sağ tık

Field chooser kendi `dxContextMenu`'sunu kurar; `onContextMenuPreparing`'e `{ event, field, area, items: [] }` gönderir. **Varsayılan öğe yoktur**; `items` doldurulmazsa menü açılmaz. Grid içindeki popup'ta bu olay grid'in `onContextMenuPreparing`'ine yönlendirilir.

---

## 6. Sürükleme görünümü (`dragAndDropItemRender`)

| Kaynak | Sürüklenen klon |
|---|---|
| Alan kutusu (`dx-area-box`) | Klon; sürükleme hedefinde orijinal genişlik korunur |
| TreeView öğesi | Klon + `dx-area-box`, orijinal genişlik |
| Diğer | Yeni `div.dx-area-field.dx-area-box` (metin) |

Sürüklenen öğe `dx-pivotgrid-fields-container dx-widget` sarmalayıcısına konur (tema stilleri doğru uygulansın diye).

---

## 7. Sağ tık menüleri

### 7.1 Grid hücresi / başlığı

Satır veya sütun başlığında (`area` `"row"`/`"column"`):

| Öğe | Koşul | Eylem |
|---|---|---|
| **Tümünü genişlet** / **Tümünü daralt** (grup başı) | Hücrenin alanında `allowExpandAll`, hücre son seviyede değil, paginate kapalı | `expandAll(alan)` / `collapseAll(alan)` |
| **"<alan> göre sırala"** (her karşı-eksen alanı × her ölçü) | Hücre yaprak (`isLast`), paginate kapalı, karşı eksendeki alanda `allowSortingBySummary` | `field(karşıAlan, { sortBySummaryField: ölçü.name ‖ caption ‖ dataField, sortBySummaryPath: hücre.path, sortOrder: tersi })` → `load()`. Aktif olan öğede `sortuptext` / `sortdowntext` ikonu |
| **Tüm sıralamayı kaldır** | Karşı eksende `sortBySummaryField`'ı olan alan var | Tüm karşı-eksen alanlarında `sortBySummaryField`, `sortBySummaryPath`, `sortOrder` temizlenir → `load()` |

Her yerde:

| Öğe | Koşul |
|---|---|
| **Alan seçiciyi göster** | `fieldChooser.enabled` |
| **Excel'e aktar** | `export.enabled` |

Birden fazla ölçü varken hücrenin `dataIndex`'i yoksa öğe metni `"<alan> - <ölçü>"` biçimindedir. Son liste `onContextMenuPreparing`'den geçer; boşsa menü açılmaz.

### 7.2 Alan butonu

Alan butonuna sağ tıklandığında argümanda `field` bulunur; varsayılan öğeler yalnızca "Alan seçiciyi göster" ve "Excel'e aktar"dır.

---

## 8. CSS sınıfları ve ikonlar

### Widget ve düzen

`dx-pivotgrid`, `dx-pivotgrid-container`, `dx-row-lines`, `dx-pivotgrid-fields-container`, `dx-pivotgrid-border`, `dx-word-wrap`, `dx-overflow-hidden`, `dx-incompressible-fields`, `dx-bottom-row`, `dx-bottom-border`, `dx-filter-header`, `dx-data-header`, `dx-column-header`, `dx-area-description-cell`, `dx-area-column-cell`, `dx-area-row-cell`, `dx-area-data-cell`, `dx-area-tree-view`, `dx-pivotgrid-background`, `dx-pivotgrid-toolbar`, `dx-pivotgrid-field-chooser-button`, `dx-pivotgrid-export-button`, `dx-fieldchooser-popup`.

### Alanlar ve sanal mod

`dx-pivotgrid-area`, `dx-pivotgrid-area-data`, `dx-pivotgrid-horizontal-headers`, `dx-pivotgrid-vertical-headers`, `dx-virtual-mode`, `dx-virtual-content`, `dx-pivot-grid-fake-table`, `dx-vertical-scroll`, `dx-pivotgrid-scrollbar-measure-element`.

### Hücreler

`dx-total`, `dx-grandtotal`, `dx-row-total`, `dx-pivotgrid-expanded`, `dx-pivotgrid-collapsed`, `dx-pivotgrid-sorted`, `dx-icon-sorted`, `dx-expand-icon-container`, `dx-expand`, `dx-expand-border`, `dx-last-cell`, `dx-white-space-column`.

### Field panel / field chooser

`dx-pivotgrid-fields-area`, `dx-pivotgrid-fields-area-head`, `dx-pivotgrid-fields-area-hamburger`, `dx-fields-area-popup`, `dx-area`, `dx-area-box`, `dx-area-caption`, `dx-area-icon`, `dx-area-field`, `dx-area-field-container`, `dx-area-field-content`, `dx-area-fields`, `dx-area-fields-header`, `dx-pivotgrid-drag-action`, `dx-group-connector`, `dx-group-connector-prev`, `dx-group-connector-next`, `dx-empty-area-text`, `dx-pivotgridfieldchooser`, `dx-pivotgridfieldchooser-container`, `dx-pivotgridfieldchooser-context-menu`, `dx-layout-0`, `dx-layout-2`, `dx-all-fields`, `dx-col`, `dx-row`, `dx-treeview-border-visible`, `dx-header-filter`.

### Öznitelikler

`group`, `tree-view-item`, `allow-scrolling`, `item-group`.

### İkonlar

| Anahtar | İkon |
|---|---|
| all | `smalliconslayout` |
| column | `columnfield` |
| row | `rowfield` |
| filter | `filter` |
| data / measure | `formula` |
| hierarchy | `hierarchy` |
| dimension | `detailslayout` |
| toolbar alan seçici | `columnchooser` |
| toolbar / menü export | `xlsxfile` |
