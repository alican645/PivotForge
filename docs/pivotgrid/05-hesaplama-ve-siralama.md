# 05 — Hesaplama, Sıralama ve Başlık Matrisi

Kaynak modüller: `81221` (özet sonrası hesaplar, `Cell`), `11075` (sıralama), `18509` (başlık/hücre matrisi), `47825` (aggregation).

---

## 1. İşlem sırası

```
store.load → ham values
   │
   ▼  PivotGridDataSource._update
1. başlık metinleri (formatHeaders)
2. yol önbelleği (_cacheByPath)
3. [displayMode/calculateSummaryValue varsa] önce NÖTR sıralama (her seviye asc, value'ya göre,
   özete göre sıralama yok), sonra applyDisplaySummaryMode
4. asıl sıralama (alanların sortOrder / sortBy / sortBySummaryField ayarlarıyla)
5. [runningTotal varsa] applyRunningTotal
   │
   ▼  DataController._update
6. başlık matrisleri (rowsInfo / columnsInfo) — toplam/GT/metric satırları eklenir
7. hücre matrisi (cellsInfo) — formatlanmış metinler
```

`summaryDisplayMode` önceki/sonraki kardeşe bağlı olduğundan (ör. `percentVariation`) hesaplama **nötr sıralanmış** (değere göre artan) ağaç üzerinde yapılır. Yani "önceki" her zaman değer sırasındaki önceki öğedir (ör. önceki yıl/ay); kullanıcı sonradan azalan veya özete göre sıralasa bile varyasyonlar değişmez.

---

## 2. Özet tipleri (`summaryType`)

| Store | Desteklenen |
|---|---|
| LocalStore | Ortak aggregator tablosu (`sum`, `min`, `max`, `avg`, `count`) + `custom`; bilinmeyen → `count` |
| RemoteStore | Sunucuya `summaryType || "count"` olarak gider |
| XmlaStore | Küpteki ölçü; özel hesap için `expression` |

### `custom` akışı (LocalStore)

```
seed():     options = { summaryProcess: "start", totalValue: undefined } → calculateCustomSummary(options)
step(v):    options.summaryProcess = "calculate"; options.value = v       → calculateCustomSummary(options)
finalize(): options.summaryProcess = "finalize"; delete options.value      → calculateCustomSummary(options)
sonuç = options.totalValue
```

Aynı `options` nesnesi hücre boyunca yeniden kullanılır; ara durum (ör. sayaç) bu nesneye yazılabilir. `calculateCustomSummary` tanımsızsa no-op atanır.

---

## 3. `summaryDisplayMode`

Hesaplama `applyDisplaySummaryMode` içinde, **her satır × sütun × ölçü** için ağaç üzerinde yapılır.

| Değer | Formül | Referans |
|---|---|---|
| `absoluteVariation` | `hücre − önceki` | Aynı satırda **önceki sütun** |
| `percentVariation` | `(hücre − önceki) / önceki` | Aynı |
| `percentOfColumnTotal` | `hücre / üst satır grubu` | Satır ekseninde ebeveyn (kökte kendisi → %100) |
| `percentOfRowTotal` | `hücre / üst sütun grubu` | Sütun ekseninde ebeveyn |
| `percentOfColumnGrandTotal` | `hücre / sütunun genel toplamı` | Satır ekseninde GT |
| `percentOfRowGrandTotal` | `hücre / satırın genel toplamı` | Sütun ekseninde GT |
| `percentOfGrandTotal` | `hücre / genel toplam` | Her iki eksende GT |

Kurallar:
- Pay tanımsız veya sonuç `NaN` → `null`.
- `percentVariation`'da önceki değer `0`/tanımsız → `null`.
- Varyasyonlarda `allowCrossGroupCalculation: true` ise önceki hücre **grup sınırını aşarak** aranır (önceki grubun son çocuğu).
- **`calculateSummaryValue` tanımlıysa `summaryDisplayMode` yok sayılır.**
- Mod adı `percent` ile başlıyorsa ve alanın `format`'ı yoksa `format: "percent"` atanır.
- Orijinal değerler `originalCell` kopyasında saklanır; tekrar hesaplamada oradan başlanır. Hesaplanan hücreler `postProcessedFlags[ölçü] = true` ile işaretlenir.

### Boş hücre takibi

Aynı geçişte her başlık öğesine ölçü başına `isEmpty[]` yazılır: hesap sonucu `null`/`undefined` olan hücreler boş sayılır. Bir başlığın bütün hücreleri boşsa `hideEmptySummaryCells: true` iken o başlık gizlenir (§7). Genel toplam satır/sütunu için `isEmptyGrandTotalRow` / `isEmptyGrandTotalColumn`.

---

## 4. `runningTotal`

| Alan özelliği | Anlamı |
|---|---|
| `runningTotal: "row"` | Satır boyunca (sütunlar arasında) birikim |
| `runningTotal: "column"` | Sütun boyunca (satırlar arasında) birikim |
| `allowCrossGroupCalculation` | Grup başında sıfırlamak yerine önceki grubun son değerinden devam |

Hesap (her hücre):

```
önceki = (çapraz grup ? gruplar arası önceki : aynı grupta önceki)
ham = value(true)  (post-processed değer)   orijinal = value(false)
önceki tanımlı ve ham/orijinal tanımlı → önceki.birikmiş + ham
yalnız önceki tanımlı                 → önceki.birikmiş
diğer                                 → ham
```

`runningTotal`, `summaryDisplayMode`'dan **sonra** uygulanır; yani `percentOfColumnTotal` + `runningTotal: "column"` ile kümülatif yüzde elde edilir.

---

## 5. `calculateSummaryValue`

Alana `calculateSummaryValue(cell)` verildiğinde dönen değer hücrenin yeni değeri olur.

### 5.1 Hazırlık: sahte hücre ile bağımlılık keşfi

`descriptions` oluşturulurken her `calculateSummaryValue` **bir kez sahte hücreyle** çağrılır:
- Sahte hücrenin `value(alan)` metodu yalnızca kayıt tutar: adı/caption'ı/dataField'ı verilen alan **alanı (`area`) tanımsızsa** `values` listesine eklenir.
- `grandTotal()` kendisini, `children()` boş dizi döner.

Sonuç: `cell.value("cost")` gibi başvurulan, grid'de görünmeyen alanlar da store'dan hesaplanır. Bu alanlar ekranda **sütun olarak görünmez** (alanları yok), ama hücrede değerleri bulunur.

> Bu yüzden `calculateSummaryValue` içinde koşullu dallanma yapıp bazı alanlara yalnızca bazı durumlarda başvurmak, bağımlılık keşfini kaçırabilir. Başvurulan tüm alanları fonksiyonun ilk satırlarında okuyun.

### 5.2 Hücre API'si (`Cell`)

`direction`: `"row"` veya `"column"`; verilmezse çoğu metotta varsayılan eksen.

| Metot | Dönüş |
|---|---|
| `value()` | Bu ölçünün orijinal değeri |
| `value(true)` | Post-processed (display mode / running total uygulanmış) değer |
| `value("alanAdı")` | Başka bir data alanının **orijinal** değeri |
| `value("alanAdı", true)` | Başka alanın post-processed değeri |
| `value("satır/sütun alanı")` | O eksende bu hücrenin ilgili seviyedeki başlık **değeri** |
| `isPostProcessed(alan?)` | Hücre o ölçü için işlendi mi |
| `parent(direction)` | Üst grup hücresi (kökte `null`) |
| `children(direction)` | Alt hücreler |
| `child(direction, değer)` | Bir alt seviyede belirli başlık değerindeki hücre |
| `prev(direction, allowCrossGroup)` / `next(...)` | Kardeş hücre; `allowCrossGroup` ile komşu gruplara geçer |
| `grandTotal(direction)` | O eksenin genel toplamı; yönsüz → iki eksende de GT |
| `slice(alan, değer)` | Bu hücrenin yolunda verilen alanın değeri değiştirilmiş hücre (ör. aynı ayın geçen yılı) |
| `field(area)` | `"data"` → bu ölçünün alanı; `"row"`/`"column"` → o eksendeki seviyenin alanı |
| `cell()` | Ham değer dizisi |

Alan argümanları `name`, `caption`, `dataField` veya alan nesnesi olabilir; çözümleme hücreler arası bir önbellekte (`fieldsCache`) tutulur.

### 5.3 Örnekler

```js
// Kâr marjı (bu projede kullanılıyor)
calculateSummaryValue: c => { const net = c.value('netAmount'); return net ? c.value('profit') / net : null; }

// Geçen yılın aynı dönemine göre değişim
calculateSummaryValue: c => {
  const prevYear = c.slice('Yıl', c.value('Yıl') - 1);   // 'Yıl' = groupInterval:'year' alanının caption'ı
  const p = prevYear && prevYear.value();
  return p ? (c.value() - p) / p : null;
}
```

---

## 6. Sıralama (`11075`)

Satırlar ve sütunlar ayrı ayrı, **her seviye kendi içinde** sıralanır (`foreachDataLevel`). Dal yüklemesinde yalnızca yolun altındaki seviyeler.

### 6.1 Karşılaştırma ölçütü

| `sortBy` | Karşılaştırılan |
|---|---|
| `"displayText"` | `text` |
| `"none"` | `index` (store'dan geliş sırası) |
| `"value"` veya **tanımsız** | `value` |

> Varsayılan `value`'dur. Ay adlarını alfabetik sıralamak için `sortBy: "displayText"` gerekir; `month` aralığı varsayılan olarak 1–12 sayısal sırada gelir.

- `sortingMethod(a, b)` verilirse yukarıdakilerin yerine geçer.
- Header filter değerleri (`getFieldValues`) her zaman `asc` sıralanır; alanın `sortBy` / `sortingMethod` ayarı korunur, özete göre sıralama uygulanmaz.
- Display mode öncesindeki nötr geçişte `sortOrder` yok sayılıp `asc`, `sortBy` yok sayılıp `value` kullanılır (`sortingMethod` yine geçerlidir).

### 6.2 Özete göre sıralama

`sortBySummaryField` tanımlıysa önce özet değeri karşılaştırılır, eşitlikte §6.1 ölçütü:

```
ölçü    = findField(values, sortBySummaryField)
karşı eksen hücresi = sortBySummaryPath verilmişse o yolun index'i, yoksa karşı eksenin genel toplamı
değer(öğe) = values[satır][sütun][ölçü]   (satır sıralanıyorsa satır = öğe.index, sütun = karşı index)
```

`sortBySummaryPath` yol eşlemesi `key` veya metin yolu ile de yapılır (XMLA anahtarları için).

`sortOrder: "desc"` karşılaştırmanın işaretini çevirir. Tanımsız değerler `asc`'de başa gelir.

### 6.3 Ne zaman sıralanır

| Tetik | Yeniden yükleme |
|---|---|
| Her `_update` | hayır |
| Alan başlığına tıklama (standart scroll) | hayır — `sortLocal()` |
| Alan başlığına tıklama (`scrolling.mode: "virtual"`) | evet — `field()` + `load()` |
| Sağ tık "özete göre sırala" | evet — `field()` + `load()` |
| `paginate` aktif | istemcide hiç sıralanmaz (MDX `Order`) |

---

## 7. Başlık matrisi (`18509`)

DataController, veri kaynağının ağaçlarını tablo hücrelerine (`rowspan`/`colspan`) dönüştürür.

### 7.1 Başlık öğesi tipleri

| `type` | Anlamı | CSS (data alanında) |
|---|---|---|
| `"D"` | Veri (normal başlık) | — |
| `"T"` | Ara toplam | `dx-total`, (satırda) `dx-row-total` |
| `"GT"` | Genel toplam | `dx-grandtotal`, (satırda) `dx-row-total` |

Metric öğeleri (`isMetric: true`) birden fazla data alanı olduğunda her yaprağın altına (veya `dataFieldArea: "row"` ise satırlara) eklenen ölçü başlıklarıdır.

### 7.2 Üretim adımları (`_getViewHeaderItems`)

```
1. ağaçtan görünüm öğeleri: type "D", value, path, text, index, key, isEmpty;
   yol uzunluğu < alan sayısı ve çocuk listesi boş değilse expanded = (çocuk var mı)
2. showGrandTotals → GT öğesi; showTotalsPrior ise başa, değilse sona
3. ara toplamlar: açık her "D" öğesinin yanına (prior ise önüne) bir "T" kopyası
   - alanın showTotals: false ise eklenmez (tree layout'ta yine eklenir)
   - prior modunda asıl öğenin expanded'ı null yapılır (ok ikonu T'de görünür)
4. her yaprağa depthSize = derinlik farkı (kısa dallar alt seviyelere yayılır)
5. birden fazla data alanı → yapraklara metric çocuklar (gizli GT/T/değerler hariç)
6. hideEmptySummaryCells → tüm ölçüleri boş yapraklar ve boşalan ebeveynler silinir
7. her öğe: wordWrapEnabled, isLast, sorted (özete göre sıralı yaprak), text
8. boşsa tek bir boş öğe
```

Metin kuralı (`getHeaderItemText`): `displayText` > `caption` > (GT ise `texts.grandTotal`) > `text`; ara toplamda `texts.total` biçimi (`"{0} Total"`) uygulanır.

### 7.3 Gizleme kuralları

| Alan özelliği | Etki |
|---|---|
| `showTotals: false` | O ölçünün ara toplam metric'i gizlenir |
| `showGrandTotals: false` | O ölçünün GT metric'i gizlenir; **bütün** ölçülerde `false` ise ve sütun alanı yoksa kural yok sayılır |
| `showValues: false` | O ölçünün değer (D) metric'i gizlenir; `showValues` tanımsız ve `showTotals: false` ise de gizlenir |
| Tüm ölçülerde `showGrandTotals: false` | `showRowGrandTotals` / `showColumnGrandTotals` fiilen kapanır |
| Satır/sütun alanında `showTotals: false` | O seviyenin "T" satırları eklenmez |

Tüm ölçülerin değerleri ve ara toplamları gizliyse derinlik 1'e indirilir.

### 7.4 Hücre matrisi (`createCellsInfo`)

Her satır yaprağı × sütun yaprağı için:

```
ölçü = (dataFieldArea "row" ? satır.dataIndex : sütun.dataIndex) || 0
değer = values[satır.dataSourceIndex ?? GTRow][sütun.dataSourceIndex ?? GTCol][ölçü]
hücre = { text: formatCellValue(değer), value, format, dataType,
          columnType, rowType, rowPath, columnPath, dataIndex, width? }
```

`formatCellValue`: değer `"#N/A"` ise `texts.dataNotAvailable`, değilse `formatValue` (format + `customizeText`). `visible: false` ölçüler hücre üretmez.

### 7.5 Genel toplam indeksleri

Store GT indeksi vermediyse: satır/sütun ağacındaki görünür öğe sayısı GT indeksi olarak atanır (`getHeaderIndexedItems`).
