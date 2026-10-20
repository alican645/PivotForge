# 03 — PivotGridDataSource İç Yapısı

Kaynak modül: `87993` (`PivotGridDataSource`), yardımcılar `12062`, sıralama `11075`, özet sonrası hesaplar `81221`.

---

## 1. Yapıcı

| Seçenek | İşlenişi |
|---|---|
| `store` / doğrudan dizi | `createStore` ile store seçilir (bkz. §2) |
| `fields` | `_fields` |
| `retrieveFields` | Tanımsızsa `true` — store'dan alan keşfi yapılır ve verilen alanlarla birleştirilir |
| `paginate` | `_paginate` (gerçek etkisi için store'un `supportPaging()` vermesi gerekir) |
| `pageSize` | Varsayılan **40** (yalnızca paginate'te kullanılır) |
| `descriptions` | Verilirse alan keşfi atlanır |
| `onChanged`, `onLoadError`, `onLoadingChanged`, `onProgressChanged`, `onFieldsPrepared`, `onExpandValueChanging` | Olay adının başına `on` + büyük harf eklenip `this.on(...)` ile bağlanır |
| Store hiç oluşmazsa | Seçenek nesnesinin kendisi (`store` veya tamamı) **hazır veri** (`{rows, columns, values}`) olarak `_data`'ya kopyalanır |

İçsel durum: `_data = { rows: [], columns: [], values: [] }`, `_loadingCount`, `_isFieldsModified`, `_descriptions`, `_storeFields`, `_lastLoadOptions`, `_delayedLoadTask`.

---

## 2. Store seçimi (`createStore`)

```
seçenekler düz nesne ve load fonksiyonu var
    → remoteOperations || paginate ? RemoteStore : LocalStore      (CustomStore gibi davranır)
store verilmemişse seçeneğin kendisi store kabul edilir
store.type === "xmla"
    → new XmlaStore(store)
store düz nesne ve type'ı var  ||  store bir DevExtreme Store örneği  ||  dizi
    → remoteOperations || paginate ? RemoteStore : LocalStore
store zaten LocalStore/RemoteStore/XmlaStore örneği
    → olduğu gibi
```

Local/Remote store'a `normalizeDataSourceOptions` sonucu aktarılır; `onChanged` ve `onLoadingChanged` iptal edilir, `onProgressChanged` → kaynağın `progressChanged` olayı.

### `supportPaging` tablosu

| Store | `supportPaging()` | `paginate()` sonucu |
|---|---|---|
| LocalStore | `false` | her zaman `false` |
| RemoteStore | `false` | her zaman `false` |
| XmlaStore | `true` | `paginate: true` ise `true` |

> **`paginate: true` yalnızca OLAP/XMLA'da işe yarar.** Local/Remote store'da `paginate: true` vermenin tek etkisi RemoteStore'un seçilmesidir.

---

## 3. Olaylar

| Olay | Public mi | Tetikleyen |
|---|---|---|
| `changed` | evet | `_update` bitince; `sortLocal()` |
| `loadError` | evet | `load` reddedilince |
| `loadingChanged` | evet | `_loadingCount` 0 ↔ >0 geçişi |
| `progressChanged` | evet | Store ilerlemesi |
| `fieldsPrepared` | evet | Alanlar hazırlanınca (`_fieldsPrepared`) |
| `expandValueChanging` | evet | `expandHeaderItem` / `collapseHeaderItem` |
| `fieldChanged` | **iç** | `field(id, options)` |
| `customizeStoreLoadOptions` | **iç** | `_loadCore` — DataController sanal sayfalama için skip/take ayarlar |

---

## 4. Alanların hazırlanması

### 4.1 Alan kimliği ve birleştirme (`mergeFields`)

Store'un keşfettiği alanlar (`getFields`) ile kullanıcı alanları şu kimlikle eşleştirilir:

```
id = (dataField || groupName) + (groupInterval ? groupName + groupInterval : "NOGROUP") + (retrieveFields ? "" : groupName)
```

- Eşleşen alan: store alanı + kullanıcı alanı birleştirilir (kullanıcı değerleri kazanır), `_initProperties` sıfırlanır.
- `dataType` yoksa aynı `dataField`'lı başka bir alandan alınır.
- `retrieveFields: true` ise kullanıcı tarafından tanımlanmamış keşfedilen alanlar sona eklenir (field chooser'da görünür, alanı yok).
- `groupName` + `groupInterval` olup `groupIndex`'i olmayan alanlara aynı gruptaki en büyük `groupIndex + 1` atanır.

### 4.2 `_fieldsPrepared`

1. Her alana sırası `index` olarak yazılır.
2. Hesaplanan özellikler güncellenir (`format`, `selector`, `customizeText`, `caption`, `allow*`).
3. `fieldsPrepared` olayı tetiklenir (widget `allow*` değerlerini kopyalar).
4. Olay sırasında `caption` değiştirildiyse yeni caption kalıcı (`_initProperties`'e) yazılır.
5. `_descriptions = _createDescriptions()`.

### 4.3 Otomatik caption

```
ad = dataField || groupName || ""
groupInterval string ise   ad += "_" + groupInterval
summaryType varsa ve "custom" değilse  son ek = " (" + BaşHarfiBüyük(summaryType) + ")"
caption = titleize(ad) + son ek
```

Örnek: `dataField: "netAmount", summaryType: "sum"` → `Net Amount (Sum)`; `orderDate` + `groupInterval: "year"` → `Order Date Year`.

### 4.4 `_initProperties` mekanizması (`setFieldProperty`)

Bir alan özelliği iç kod tarafından ilk kez değiştirildiğinde eski değer `field._initProperties[ad]` içine saklanır. Böylece:
- `fields(...)` ile yeniden birleştirmede veya state uygulanırken hesaplanmış değerler (`format`, `caption`, `allow*`) **kullanıcının orijinal değerine** geri döndürülebilir.
- Widget `allow*` kopyalaması yalnızca kullanıcı bu özelliği vermemişse yapılır.

### 4.5 `descriptions` (`_createDescriptions`)

Yükleme için kullanılan, alana göre gruplanmış görünüm:

```
{ rows: [], columns: [], values: [], filters: [] }
```

1. Her alanın `areaIndex`'i alan içinde normalize edilir (`normalizeIndexes`).
2. Bir alan şu durumlarda eklenmez:
   - alanı (`area`) yoksa,
   - bir grubun seviyesiyse (`groupName` + sayısal `groupIndex`),
   - `visible: false` ve alanı `data`/`filter` değilse.
3. Grup alanı (`groupName`, `groupIndex` yok) satır/sütun alanındaysa seviyeleri (`levels`) eklenir; seviyelerden birinin `filterValues`'ı varsa grup ayrıca `filters`'a da eklenir.
4. Her liste `areaIndex`'e (eşitse `groupIndex`'e) göre sıralanır.
5. **Her data alanının `calculateSummaryValue`'ı bir sahte hücre ile bir kez çağrılır** (`createMockSummaryCell`). Bu çağrıda `cell.value("alan")` ile adı geçen ve alanı olmayan alanlar `values`'a eklenir → görünmeyen ama hesaplanan yardımcı ölçüler. Bkz. [05](05-hesaplama-ve-siralama.md#5-calculatesummaryvalue).

### 4.6 Grup seviyeleri (`getFieldsByGroup`)

Gruptaki seviye alanlarına grup alanından şunlar miras geçer (seviyede tanımlı değilse): `areaIndex`, `area`, `expanded`, `dataField`, `dataType`, `sortBy`, `sortOrder`, `sortBySummaryField`, `sortBySummaryPath`, `visible`, `showTotals`, `showGrandTotals`. Seviyeler `groupIndex`'e göre sıralanır; `visible: false` seviyeler dışlanır.

---

## 5. Yükleme hattı

```
load(options)
 ├─ beginLoading()                        (loadingChanged: true)
 ├─ store varsa: executeAsync (bir sonraki tick) ile ertelenir → _delayedLoadTask
 ├─ descriptions yoksa: getFields() → _fieldsPrepared() → _loadCore
 └─ varsa: _loadCore

_loadCore(options, deferred)
 ├─ reload = options.reload || (paginate && alanlar değişti)
 ├─ options ← descriptions (rows, columns, values, filters) ile genişletilir
 ├─ columnExpandedPaths / rowExpandedPaths verilmemişse mevcut veriden hesaplanır
 ├─ paginate ise pageSize, options.area varsa headerName ("rows"/"columns")
 ├─ fire("customizeStoreLoadOptions", [[options], reload])   → sanal sayfalama ayarı
 ├─ reload değilse: _processPagingCache  (önbellekte olan sayfaları atla)
 ├─ rowTake/columnTake 0'a inmiş istekler elenir; hiç kalmadıysa _update
 └─ her istek için store.load(...)  → hepsi bitince:
      ├─ istekte path varsa       → applyPartialDataSource (bir dala alt öğe ekleme)
      ├─ paginate ve veri doluysa → mergePartialDataSource (sayfa birleştirme)
      └─ aksi halde               → _data'yı değiştir, _lastLoadOptions sakla, _update
```

### 5.1 `_update` — sonuçların işlenme sırası

```
1. formatHeaders     → her başlık öğesine text = formatValue(value, alan)  (async, ağaç gezerek)
2. updateCache(rows), updateCache(columns) → "_cacheByPath" sözlüğü: "a.b.c" → başlık öğesi
3. bir data alanında summaryDisplayMode veya calculateSummaryValue varsa:
     a. nötr sıralama (her seviye değere göre artan; sortOrder/sortBy/özet sıralaması yok sayılır)
        — "önceki kardeş" kavramı kullanıcı sıralamasından bağımsız olsun diye
     b. veri boş değilse applyDisplaySummaryMode
4. sıralama (sort)
5. veri boş değilse ve runningTotal varsa applyRunningTotal
6. _data = sonuç; deferred varsa çözülünce:
     _isFieldsModified = false, fire("changed")
```

> Sıralama `paginate` açıkken **istemcide yapılmaz** (`_sort` → `!this._paginate`); sıralama MDX `Order(...)` ile sunucuya bırakılır.

---

## 6. Expand / collapse

| Metot | Davranış |
|---|---|
| `expandHeaderItem(area, path)` | Öğe yoksa veya zaten açıksa `false`. `collapsedChildren` varsa (daha önce açılmış) çocuklar geri takılır ve **yeniden yükleme olmadan** `_update`. Yoksa `expandValueChanging` (`needExpandData: true`) tetiklenir ve yalnızca o dal için `load({area, path, ...})` yapılır |
| `collapseHeaderItem(area, path)` | Çocuklar `collapsedChildren`'a taşınır (önbellek), alanın `expanded`'ı `false`, `_update`; paginate'te yeniden yükleme |
| `expandAll(fieldId)` | Alanın (ve grup seviyelerinin) `expanded = true` → **tam yükleme** |
| `collapseAll(fieldId)` | O seviyedeki tüm açık öğelerin çocukları `collapsedChildren`'a taşınır, `_update` (yükleme yok) |

Dal yüklemesi (`applyPartialDataSource`) gelen başlıkları mevcut ağaca yerleştirir, yeni indeksler üretir (`updateHeaderItemChildren` / `updateHeaderItems`) ve gelen hücre değerlerini bu yeni indekslere kopyalar (`updateDataSourceCells`). Toplam satır/sütun değerleri `grandTotalRowIndex` / `grandTotalColumnIndex`'e eşlenir.

---

## 7. Sayfalama önbelleği

Yalnızca `paginate()` `true` iken (XMLA):

1. `_processPagingCacheByArea`: istenen aralığın başındaki öğeler için karşı eksende değer zaten varsa skip ileri, take geri alınır.
2. Kalan aralık `pageSize`'ın katlarına yuvarlanır (`floor(skip/pageSize)·pageSize` … `ceil((skip+take)/pageSize)·pageSize`).
3. Gelen sayfa `mergePartialDataSource` ile mevcut veriye eklenir.

DataController tarafında (`_handleCustomizeStoreLoadOptions`): satır kontrolcüsünün `beginPageIndex…endPageIndex` aralığı `rowSkip/rowTake`'e çevrilir; açık her başlık yolu için o yola düşen satır/sütun sayıları hesaplanıp ayrı istekler üretilir (`_processPagingForExpandedPaths`).

---

## 8. State

### 8.1 Okuma: `state()`

```
{
  fields: [ { dataField, name, area, areaIndex, sortOrder, filterType, filterValues,
              sortBy, sortBySummaryField, sortBySummaryPath, expanded,
              summaryType, summaryDisplayMode }, ... ],
  columnExpandedPaths: [ [değer, değer], ... ],
  rowExpandedPaths:    [ [değer], ... ]
}
```

Açık yollar: çocuğu olan ve kendi seviyesindeki alanı `expanded: false` olan öğeler (alan zaten `expanded: true` ise tek tek yol saklanmaz). Son yüklemedeki alan sırası değiştiyse eski yollar alınmaz.

### 8.2 Yazma: `state(state, skipLoading)`

1. Varsayılan `{ rowExpandedPaths: [], columnExpandedPaths: [] }` ile birleştirilir.
2. Alanlar `name` (yoksa `dataField`) ile eşleştirilir; **aynı kimliğe sahip birden çok alan sırayla** eşlenir.
3. Yalnızca yukarıdaki 11 özellik uygulanır; state'te `summaryType` / `summaryDisplayMode` `undefined` ise alanınki korunur.
4. `format`, `selector`, `customizeText`, `caption` kullanıcının orijinal değerine döndürülür.
5. `skipLoading` değilse `load(state)` → açık yollar yükleme seçeneği olarak gider.

Descriptions henüz yoksa önce `getFields()` yapılır.

---

## 9. Header filter değerleri (`getFieldValues`)

```
getFieldValues(fieldIndex, applyOtherFilters, { searchValue, skip, take })
```

1. Alan (veya grup seviyeleri) **sütun** alanına konur: `expanded: true`, `filterValues: null`, `sortOrder: "asc"`, `sortBySummaryField: null`, `searchValue`.
2. `rows: []`, `values: data alanları`, `skipValues: true`.
3. `applyOtherFilters` (`headerFilter.showRelevantValues`) ise diğer filtreli alanlar `filters`'a eklenir.
4. `store.load` → başlıklar formatlanır → skip/take uygulanır → (take yoksa) sıralanır → `columns` döner.

FieldChooserBase paginate'te değerleri sayfalı ister; diğer durumda tüm listeyi bir `ArrayStore`'a koyup DevExtreme'in standart arama/sayfalamasını kullanır.

---

## 10. Diğer metotlar

| Metot | Not |
|---|---|
| `fields()` / `fields(arr)` | Setter `mergeFields` + `_fieldsPrepared` çalıştırır (yükleme yapmaz) |
| `field(id)` / `field(id, opts)` | `id`: index, `name`, `caption` veya `dataField`. `sortOrder` verilirse grup seviyelerine de yazılır. State dışı özellikler kalıcı (`_initProperties`) yazılır. Descriptions yeniden kurulur, `fieldChanged` tetiklenir; **yükleme yapmaz** |
| `getAreaFields(area, collectGroups)` | `collectGroups` veya `"data"` için alan listesinden; aksi halde descriptions'tan (grup seviyeleri açılmış hâli) |
| `getSummaryFields()` | `summaryType`'ı tanımlı data alanları |
| `filter(...)` | Store'un `filter`'ına iletilir |
| `reload()` | `load({ reload: true })` |
| `sortLocal()` | Mevcut veriyi yeniden sıralar ve `changed` (yükleme yok) |
| `isEmpty()` | Görünür data alanı yok veya `values` boş |
| `createDrillDownDataSource(opts)` | Store'a iletilir (bkz. [04](04-store-algoritmalari.md)) |
| `dispose()` | Olaylar temizlenir, bekleyen gecikmeli yükleme iptal edilir |

---

## 11. Yardımcılar (`12062`)

| Fonksiyon | İş |
|---|---|
| `foreachTree(items, cb, postOrder)` | Ağacı gezer; `cb(path, index)`, `path[0]` = mevcut öğe, sonrası ataları |
| `foreachTreeAsync` | Aynısı; **10.000 öğede bir 300 ms'den fazla geçtiyse** `Deferred` dönerek bölünür |
| `createPath(path)` | Kökten yaprağa `key || value` dizisi |
| `findField(fields, id)` | `name`, `caption`, `dataField` veya `index` ile arama |
| `formatValue(value, field)` | `format` uygular, `customizeText({value, valueText})` varsa onu kullanır; `NaN` → `""` |
| `getCompareFunction(getter)` | Tanımsızlar başa gelir |
| `getExpandedLevel(options, axis)` | Yüklenecek en derin seviye (açık yollar + `expanded` alanlar) |
| `discoverObjectFields(items, fields)` | Bkz. aşağı |
| `setDefaultFieldValueFormatting(field)` | Bkz. aşağı |
| `getFiltersByPath(fields, path)` | Bir yolu `filterType: "include"` filtrelerine çevirir (drill-down) |
| `mergeArraysByMaxValue(a, b)` | Eleman bazında maksimum (satır yükseklikleri) |
| `storeDrillDownMixin` | `getDrillDownItems` sonucunu `ArrayStore` üzerinden `DataSource` olarak sunar |

### Alan keşfi (`discoverObjectFields`)

- İlk kaydın anahtarları gezilir; **`__` ile başlayan anahtarlar atlanır**.
- Değer tanımsızsa sonraki kayıtlarda aranır (tip tahmini için).
- Tarih alanı: bir grup alanı (`groupName` = anahtar) + **`year`, `quarter`, `month`** seviyeleri (`groupIndex` 0, 1, 2) üretilir.
- İç içe nesne: özyinelemeli; `dataField` `"a.b"` olur, `displayFolder` = üst yol.

### Varsayılan biçimlendirme (`setDefaultFieldValueFormatting`)

| Tip | Kural |
|---|---|
| `date` + `groupInterval` | `year` → sayı metni, `month` → yerel ay adı, `quarter` → yerel çeyrek biçimi, `dayOfWeek` → yerel gün adı |
| `date`, `groupInterval` yok | Global tarih formatı |
| `number` + pozitif `groupInterval` | `customizeText`: `"<başlangıç> - <başlangıç + aralık>"` |
