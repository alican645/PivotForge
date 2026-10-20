# 07 — Excel Export, Grafik Entegrasyonu ve State Storing

Kaynak modüller: `12867` (ExportController, DataProvider), `60457` (exportPivotGrid), `98741` (Export çekirdeği), `91189` (MergedRangesManager), `47197` (prepareItems), `67705` (ChartIntegrationMixin), `93416` (StateStoringController).

---

## 1. Excel export

### 1.1 Akış

```
Kullanıcı: toolbar butonu / sağ tık / pivot.exportTo()
   └─ onExporting({ rtlEnabled, fileName: "PivotGrid", cancel: false })
        └─ (uygulama kodu) DevExpress.excelExporter.exportPivotGrid({ component, worksheet, ... })
             ├─ seçenek doğrulama + varsayılanlar
             ├─ Export.export(...)
             │    ├─ dataProvider = component.getDataProvider()
             │    ├─ pivot'un kendi loadPanel'i geçici kapatılır, export load panel'i gösterilir
             │    ├─ dataProvider.ready()                → hücre matrisi hazırlanır (setTimeout ile)
             │    ├─ sütun genişlikleri (keepColumnWidths)
             │    ├─ alan başlık satırları (export*FieldHeaders)
             │    ├─ her satır: hücre değeri, sayı formatı, hizalama, kalın yazı, birleştirme kaydı, customizeCell
             │    ├─ birleştirmeler uygulanır
             │    ├─ RTL görünümü, donmuş bölme
             │    └─ Promise → { from: {row, column}, to: {row, column} }
             └─ (uygulama kodu) workbook.xlsx.writeBuffer() → saveAs(...)
```

### 1.2 `exportPivotGrid` seçenekleri

| Seçenek | Varsayılan | Not |
|---|---|---|
| `component` | **zorunlu** | `NAME === "dxPivotGrid"` değilse hata |
| `worksheet` | **zorunlu** | ExcelJS worksheet |
| `topLeftCell` | `{ row: 1, column: 1 }` | String verilebilir (`"B3"`) → `worksheet.getCell` ile çevrilir |
| `keepColumnWidths` | `true` | Ekrandaki piksel genişlikleri Excel'e aktarılır |
| `loadPanel` | `{ enabled: true }` | Export sırasında gösterilen panel |
| `encodeExecutableContent` | `false` | `true` → hücre değerleri formül olarak yorumlanmayacak şekilde encode edilir |
| `mergeRowFieldValues` | `true` | Satır başlıklarını birleştir |
| `mergeColumnFieldValues` | `true` | Sütun başlıklarını birleştir |
| `exportFilterFieldHeaders` | `false` | Üstte filtre alanı caption'ları satırı |
| `exportDataFieldHeaders` | `false` | Sol üstte data alanı caption'ları |
| `exportColumnFieldHeaders` | `false` | Sütun alanı caption'ları |
| `exportRowFieldHeaders` | `false` | Satır alanı caption'ları (sol üst bilgi hücresinin altında) |
| `customizeCell({ excelCell, pivotCell })` | — | Her hücre için. `pivotCell` = matristeki hücre nesnesi + `area` (`row`/`column`/`data`, sol üst bilgi hücresinde yok), `rowIndex`, `columnIndex`. Başlıklarda `text`, `type` (`D`/`T`/`GT`), `path`, `expanded`; veri hücrelerinde `text`, `value`, `rowType`, `columnType`, `rowPath`, `columnPath`, `dataIndex`. Alan başlık hücrelerinde `{ text, value, headerType }` |

Hata mesajları: yapılandırma nesnesi yoksa, `component` PivotGrid değilse, `worksheet` nesne değilse.

### 1.3 DataProvider

| Konu | Davranış |
|---|---|
| Veri | `getColumnsInfo(true)`, `getRowsInfo(true)`, `getCellsInfo(true)` → **sanal kesme yok, tüm matris** |
| Hazırlık | `beginLoading` → `setTimeout` içinde matris → `endLoading` |
| Matris | Sol üstte boş bilgi hücresi (colspan = satır başlık sütun sayısı, rowspan = sütun başlık satır sayısı); altına satır başlıkları, sağına sütun başlıkları ve hücreler; `prepareItems` ile rowspan/colspan'li hücreler tekrar edilerek dikdörtgen matrise açılır |
| Hiç veri hücresi yoksa | Satır başlıkları kadar satır, kapalı sütun başlık sayısı kadar boş hücre üretilir |
| Sütun genişlikleri | Ekrandaki satır başlık + sütun genişlikleri; **virtual mod, window yok veya gizli** ise her sütun 100 px |
| Excel genişliği | `min(255, piksel / 7)` |
| Donmuş bölme | `xSplit` = satır başlık sütunları, `ySplit` = sütun başlık satırları + alan başlık satırları |
| Hücre tipi | Sol üst ve sütun başlıkları → stil 0 (orta hizalı string); satır başlıkları → stil 1 (varsayılan hizalı string); veri → ölçünün stili |

### 1.4 Veri hücresi tipi ve formatı

`getCellDataType(dataField)`:

| Koşul | Tip |
|---|---|
| `customizeText` var | `string` (hücreye **görünen metin** yazılır) |
| `dataType` var | o tip |
| `format(1)` parse edilince 1 dönüyor | `number` |
| `format(new Date())` boş değil | `date` |
| diğer | `string` |

- `string` tipte hücreye `text`, diğerlerinde `value` yazılır.
- Sayı formatı DevExtreme formatından Excel `numFmt`'ye çevrilir (para birimi dahil).
- Veri hücreleri RTL değilse **sağa** hizalanır, dikey hizalama her zaman `top`; `wordWrapEnabled` → `wrapText`.
- Tarih değerleri ExcelJS için **yerel saat bileşenleri korunarak UTC'ye** çevrilir.
- Formatı olmayan ve `@ = + -` ile başlayan string değerlere `numFmt: "@"` (metin) uygulanır → **formül enjeksiyonu engellenir**.
- `isWhiteSpace` (tree layout boşluk sütunu) hücreleri boş yazılır.

### 1.5 Birleştirme

- Yalnızca başlık bölgesindeki (`row < sütunBaşlıkSatırı` veya `col < satırBaşlıkSütunu`) rowspan/colspan'li hücreler birleştirilir.
- `mergeColumnFieldValues: false` → sütun başlıklarında yatay birleştirme yapılmaz; `mergeRowFieldValues: false` → satır başlıklarında dikey birleştirme yapılmaz. Birleşmeyen hücrelere ana hücrenin değeri ve stili kopyalanır.
- Alan başlık satırları: filtre/data/sütun başlıkları satır boyunca birleştirilir; satır alanı başlıkları yalnızca `rowHeaderLayout: "tree"` iken birleştirilir. Alan başlıkları kalın ve ince gri (`FF7E7E7E`) kenarlıklıdır.
- Alan sayısı ayrılan hücreden fazlaysa caption'lar `", "` ile birleştirilip tek hücreye yazılır.
- RTL'de alan başlıkları ters `areaIndex` sırasıyla.

### 1.6 Bu projedeki kullanım

```js
onExporting(e) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Satış Analizi');
  DevExpress.excelExporter.exportPivotGrid({ component: e.component, worksheet })
    .then(() => workbook.xlsx.writeBuffer())
    .then(buf => saveAs(new Blob([buf], { type: 'application/octet-stream' }), 'SatisAnalizi.xlsx'));
}
```

İyileştirme fikirleri: `exportColumnFieldHeaders: true`, `exportRowFieldHeaders: true` (başlık açıklamaları); `customizeCell` ile `pivotCell.area === 'data' && pivotCell.value < 0` → kırmızı yazı.

---

## 2. `bindChart`

### 2.1 Bağlama

```
pivot.bindChart(chart, options)
 ├─ chart: dxChart örneği, eleman veya seçici; değilse → null döner
 ├─ chart daha önce başka pivot'a bağlıysa önceki bağ çözülür (eleman verisinde "dxPivotGridUnbinding")
 ├─ pivot "changed" → chart.option(yapılandırma)      ← her veri değişiminde
 ├─ ilk yapılandırma hemen uygulanır
 └─ unbind fonksiyonu döner; chart veya pivot dispose olunca otomatik çağrılır
```

### 2.2 Seçenekler

| Seçenek | Varsayılan | Etki |
|---|---|---|
| `dataFieldsDisplayMode` | — | `"singleAxis"` → tek değer ekseni; `"splitPanes"` → her ölçüye ayrı pane; diğer → her ölçüye ayrı eksen |
| `putDataFieldsInto` | — | `"series"` (varsayılan davranış) → seri adına `" | ölçü"`; `"args"` → argümana `" | ölçü"`; `"both"` → ikisine |
| `alternateDataFields` | — | `false` → önce ölçü döngüsü, sonra hücreler; aksi halde hücre başına tüm ölçüler |
| `inverted` | `false` | Seri = sütun yolu, argüman = satır yolu (normalde tersi) |
| `processCell(e)` | — | Her hücre için; `{ chartDataItem: {series, arg, val}, visible, ... }` döndürülürse birleştirilir |
| `customizeSeries(seriesName, seriesOptions)` | — | Seri ayarlarını değiştirir |
| `customizeChart(chartOptions)` | — | `valueAxis` / `panes` üzerine derin birleştirilir |

### 2.3 Veri üretimi

```
her satır yolu (GT dahil) × her sütun yolu (GT dahil) × her ölçü:
    satırYazı = yol metinleri (kök → yaprak), GT ise texts.grandTotal
    sütunYazı = aynı
    series = (inverted ? sütunYazı : satırYazı).join(" - ")
    arg    = (inverted ? satırYazı : sütunYazı).join("/")
    val    = values[satır][sütun][ölçü] ?? null
    visible = satır yaprak seviyede VE sütun yaprak seviyede   ← en derin açık seviye
```

- `processCell`'e giden argüman: `rowPath`, `rowPathFormatted`, `rowFields`, `maxRowLevel`, `columnPath`, `columnPathFormatted`, `columnFields`, `maxColumnLevel`, `dataFields`, `dataIndex`, `dataValues`, `visible`, `chartDataItem`.
- **Yalnızca en derin açık seviyedeki** hücreler grafiğe girer; ara toplamlar ve kapalı dallar varsayılan olarak çizilmez (`processCell` ile `visible: true` yapılabilir).
- Chart'a `dataSource`, `seriesTemplate: { nameField: "series", customizeSeries }`, `valueAxis` (ölçü başına `name`, `title`, `valueType` (`number` → `numeric`, `date` → `datetime`), `label.format`, `label.customizeText`, splitPanes'te `pane`), `panes` yazılır.

---

## 3. `stateStoring`

### 3.1 Kontrolcü

DataGrid ile ortak `StateStoringController` (93416) PivotGrid'e bağımsız bir örnek olarak verilir.

| Konu | Davranış |
|---|---|
| Depolama | `type: "sessionStorage"` → session storage; diğer (varsayılan) → `window.localStorage`. Erişilemezse `E1007` hatası |
| Anahtar | `storageKey` tanımsızsa **`"storage"`** |
| Okuma | `JSON.parse(getItem(key))`; hata → `W1022` uyarısı, state yok sayılır |
| Yazma | `setItem(key, JSON.stringify(state))`; hata loglanır |
| `type: "custom"` | `customLoad()` (Promise dönebilir) / `customSave(state)` |
| Tarih geri yükleme | State içindeki `YYYY-MM-DDTHH:mm:ss(.sss)Z` biçimindeki **tüm string'ler** `Date`'e çevrilir (iç içe nesneler dahil) |
| Kayıt gecikmesi | Her değişiklikte önceki zamanlayıcı iptal edilir, `savingTimeout` (2000 ms) sonra yazılır |
| Kaybı önleme | `window` `visibilitychange` olayında bekleyen kayıt **hemen** yazılır |
| Dispose | Zamanlayıcı iptal, `visibilitychange` dinleyicisi kaldırılır |

### 3.2 PivotGrid ile akış

```
DataController.load()
 ├─ stateStoring açık ve henüz yüklenmemişse:
 │    controller.load() → (state varsa) dataSource.state(state)   → state içindeki alanlar + açık yollarla yükleme
 │                     → (yoksa)       dataSource.load()
 └─ değilse dataSource.load()

DataController._update() sonu (her başlık matrisi yeniden kurulduğunda)
 └─ stateStoring açık ve yükleme yoksa:
      controller.state(dataSource.state()) → controller.save()  (2 sn gecikmeli)
```

Saklanan state şeması için bkz. [03 §8](03-veri-kaynagi.md#8-state).

### 3.3 Pratik sonuçlar

- `fields` tanımında `area`, `areaIndex`, `expanded`, `sortOrder`, `sortBy`, `filterValues`, `filterType`, `summaryType`, `summaryDisplayMode`, `sortBySummaryField/Path` değiştirmek, kayıtlı state varken **etkisiz** kalır. `caption`, `format`, `customizeText`, `selector` değişiklikleri ise uygulanır.
- Alan eşleştirmesi `name` (yoksa `dataField`) iledir: aynı `dataField`'ı kullanan birden çok alan (ör. `orderDate` yıl/çeyrek/ay) **tanım sırasıyla** eşleşir. Alanların sırasını değiştirmek state'in yanlış alana uygulanmasına yol açabilir; bu yüzden bu tür alanlara `name` verin.
- Aynı origin'de birden fazla grid varsa her birine farklı `storageKey` verin; aksi halde hepsi `"storage"` anahtarını paylaşır.
- Bu projede anahtar `sales-pivot-state`; alan düzeni değişince tarayıcıdaki bu anahtar silinmeli.
