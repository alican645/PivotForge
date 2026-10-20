# 04 — Store Algoritmaları

Kaynak modüller: `47825` (LocalStore), `81383` (RemoteStore), `84265` (`forEachGroup`), `48063` (XmlaStore), `12062` (drill-down mixin).

Tüm store'lar aynı sözleşmeyi uygular:

| Metot | Görev |
|---|---|
| `getFields(fields)` | Alan keşfi |
| `load(options)` | `{ rows, columns, values, grandTotalRowIndex, grandTotalColumnIndex }` |
| `filter(...)` | Store filtresi |
| `key()` | Anahtar |
| `supportPaging()` | Sayfalama desteği |
| `createDrillDownDataSource(descriptions, params)` | Bir hücrenin ham kayıtları |

**Sonuç biçimi:**
- `rows` / `columns`: `{ value, index, text?, displayText?, key?, children? }` ağaçları.
- `values[satırIndex][sütunIndex]`: data alanı başına bir değer dizisi.
- Genel toplam satırı/sütunu `grandTotal*Index` (Local/Remote'ta `0`).

---

## 1. LocalStore (istemci tarafı)

Arka planda bir DevExtreme `DataSource` (`paginate(false)`) tutar; tüm kayıtları yükleyip gruplamayı JavaScript'te yapar.

### 1.1 Seçici (selector) üretimi

Her alan için (kullanıcı `selector` vermemişse):

| Durum | Seçici |
|---|---|
| `dataField` noktalı (`"a.b"`) | `compileGetter` |
| `dataField` yok | kaydın kendisi |
| `dataType: "date"` | Değer `Date` değilse `deserializeDate`; ardından `groupInterval` fonksiyonu |
| `dataType: "number"` | String ise `Number()`; pozitif sayısal `groupInterval` varsa `floor(v / n) * n` |
| diğer | ham değer |

Tarih aralıkları:

| `groupInterval` | Değer |
|---|---|
| `year` | `getFullYear()` |
| `quarter` | `floor(getMonth() / 3) + 1` |
| `month` | `getMonth() + 1` |
| `day` | `getDate()` |
| `dayOfWeek` | `getDay()` (0 = Pazar) |
| yok | tarih nesnesinin kendisi |

> Bu tablo dışındaki bir değer (ör. `"hour"`) tanınmaz; tarih ham hâliyle gruplanır.

Seçici atanırken varsayılan biçimlendirme de uygulanır (bkz. [03 §11](03-veri-kaynagi.md#11-yardimcilar-12062)).

### 1.2 Filtre fonksiyonu

Satır, sütun ve filtre alanlarındaki her `filterValues`'ı dolu alan için bir yüklem üretilir:
- Değer seçiciyle alınır (grup alanında seviye değerleri dizisi).
- `filterValues` içinde **`valueOf()` eşitliği** aranır (tarihler de karşılaştırılabilir; dizi değerler eleman eleman).
- `filterType: "exclude"` sonucu tersler.
- Dal yüklemesinde (`headerName` + `path`) ek yüklem: yol değerleri `toComparable` ile eşleşmeli.

Bütün yüklemler **VE** ile birleşir.

### 1.3 Gruplama ve aggregation

```
sonuç = { rows: [], columns: [], rowsHash: {length:1}, columnsHash: {length:1} }
values = []                                  // values[rowIdx][colIdx] = [ölçü0, ölçü1, ...]
for her kayıt:
    filtreyi geçmiyorsa atla
    satırIndeksleri = [0] + ağaca ekle(rows)      // 0 = genel toplam
    sütunIndeksleri = [0] + ağaca ekle(columns)
    her (satır, sütun) çifti için hücreyi al
    her ölçü için: ilkse seed, sonra step(birikmiş, değer)
sonda finalize (custom ve avg gibi aggregator'lar için)
```

Ağaca ekleme (`_`): mevcut seviyenin seçici değeri `"üst/./değer"` anahtarıyla hash'te aranır; yoksa yeni `{ value, index }` oluşturulur. Bir sonraki seviyeye **yalnızca** o yol açık yollarda (`expandedPathsHash`) varsa veya alan `expanded: true` ise inilir. Böylece kapalı dallar için hücre hesaplanmaz.

Her kayıt, ait olduğu **tüm ata seviyelerin** hücrelerine de eklenir. Ara toplamlar ve genel toplam ayrıca hesaplanmaz.

Aggregator seçimi:
- `summaryType: "custom"` → `calculateCustomSummary` üç aşamada (`start` → her değer için `calculate` → `finalize`) çağrılır; sonuç `totalValue`.
- Diğerleri: ortak `aggregators[summaryType]`; tanınmayan tip → **`count`**.
- Hücrede henüz değer yoksa ilk değer doğrudan yazılır; sonraki tanımsız değerler `step`'e girmez (toplama/sayıma katılmaz).

### 1.4 Zaman dilimleme

```
her 10.000. kayıtta (ilk kayıt hariç), döngü başından beri ≥ 300 ms geçtiyse:
    progressChanged(i / toplam)
    setTimeout(devam, 0)  → döngü kaldığı yerden sürer
```

10.000 satırlık bir veri tek dilimde biter; 100.000+ satırda arayüz donmadan ilerleme yüzdesi görünür (yükleme 1 sn'yi geçerse panelde).

### 1.5 Veri yükleme ve tarih filtreleri

- Kaynak `DataSource` yüklü değilse veya `reload` istendiyse yüklenir; değilse önbellekteki `items()` kullanılır.
- Store bir `ArrayStore` ise, tarih içeren filtre ifadelerinde alan adı **tarihe dönüştüren bir getter** ile değiştirilir (string ISO tarihlerle karşılaştırma doğru çalışsın diye).
- Store bir `CustomStore` ise ve filtre varsa filtre `items()` üzerinde istemcide uygulanır.

### 1.6 Alan keşfi ve drill-down

- `getFields`: tüm veri yüklenip `discoverObjectFields` çalışır.
- `getDrillDownItems(descriptions, { rowPath, columnPath, maxRowCount, customColumns })`: kayıtlar hem genel filtreden hem yol filtresinden geçirilir; `customColumns` verilirse yalnızca o alanlar kopyalanır; `maxRowCount > 0` ise erken durur.
- `createDrillDownDataSource` (mixin) bu sonucu `load` ve `totalCount` destekli bir `DataSource` olarak sunar.

---

## 2. RemoteStore (sunucu tarafı)

`remoteOperations: true` (veya `paginate: true`) ile seçilir. Gruplamayı **DevExtreme standart load parametreleri** ile sunucuya yaptırır; ASP.NET'te `DevExtreme.AspNet.Data`'nın `DataSourceLoader.Load` metodu bu formatı karşılar.

### 2.1 Alan keşfi

`store.load({ skip: 0, take: 20 })` → **ilk 20 kayıt** üzerinden `discoverObjectFields`.

### 2.2 İstek planı (`T`)

Bir pivot yüklemesi **birden çok** store isteğine bölünür:

```
satır seviyeleri  r ∈ [başlangıç … açık en derin seviye]
sütun seviyeleri  c ∈ [başlangıç … açık en derin seviye]

satır ve sütun alanı varsa:
    (dal yüklemesi satır değilse) sütun-yalnız istekler: her c seviyesi için, rows = []
    her (r, c) çifti için bir istek:
        rows    = satır alanları[başlangıç … r]
        columns = sütun alanları[başlangıç … c]
        filterExpression = (r'ye kadar açık satır yolları) VE (c'ye kadar açık sütun yolları)
yalnız tek eksen varsa: o eksenin seviye istekleri
ilk isteğe includeTotalSummary = true  (genel toplamlar)
```

Açık yolların filtresi: her açık yol `[alan0 = v0] and [alan1 = v1] ...` olur, yollar kendi aralarında `or` ile birleşir. Böylece yalnızca açık dalların alt grupları istenir.

### 2.3 Tek isteğin içeriği

| Parametre | Değer |
|---|---|
| `group` | Satır sonra sütun seviyeleri: `{ selector: dataField, groupInterval, desc: sortOrder === "desc" (yalnızca take varken), isExpanded: son seviye değilse true }` |
| `take` | Grup yoksa `1` (yalnızca toplam), aksi halde tanımsız |
| `skip` / `take` / `requireGroupCount` | `rowTake` (veya `columnTake`) varsa |
| `filter` | (filtre alanları + `filterValues`'ı/`searchValue`'ı olan satır/sütun alanları + dal yolu) VE `filterExpression` VE store'un kendi `filter()`'ı |
| `groupSummary` | Her data alanı için `{ selector: dataField, summaryType: summaryType || "count" }` |
| `totalSummary` | Aynısı, yalnızca `includeTotalSummary` isteğinde |

> `summaryType: "custom"` RemoteStore'da sunucuya `"custom"` olarak gider; `calculateCustomSummary` **çalışmaz**. Sunucunun özel aggregator'ı desteklemesi gerekir.

### 2.4 Filtre ifadesi üretimi

| Alan durumu | Üretilen ifade |
|---|---|
| `searchValue` (header filter araması) | `[dataField, "contains", searchValue]` |
| Basit değer | `[alan, "=", v]` (`exclude` → `"<>"`) |
| Tarih + string `groupInterval` | alan adı **`dataField.Year`**, **`dataField.Month`**, **`dataField.Day`**… (baş harfi büyük) |
| Tarih + `quarter` | `dataField.Month` üzerinde aralık: `[[alan, ">=", 3(q−1)+1], "and", [alan, "<", 3(q−1)+4]]` (`exclude` → `<` / `or` / `>=`) |
| Sayı + sayısal `groupInterval` | `[[alan, ">=", v], "and", [alan, "<", v + n]]` |
| Grup alanı, dizi değer | seviye ifadeleri `and` ile |
| Birden çok değer | `include` → `or`, `exclude` → `and` |
| Birden çok alan | `and` |

### 2.5 Cevap ayrıştırma

```
normalizeLoadResult(cevap) → { data, extra: { summary, groupCount } }
extra.summary → values[0][0]  (genel toplam)
groupCount varsa → başa skip kadar boş eleman eklenip uzunluk groupCount'a sabitlenir (sanal sayfalama)
forEachGroup(data, (grup, seviye) => ...)
    seviye < satır sayısı  → satır ağacına ekle (anahtar = "k0/k1/..")
    aksi halde              → sütun ağacına ekle
    grup.summary → values[satırIdx][sütunIdx]  (ilk yazan kazanır)
```

Anahtar dönüşümü: `number` alan + string anahtar → `Number`; `date` alan, `groupInterval` yok + `Date` değil → `deserializeDate`. Sunucunun gönderdiği `displayText` başlık metni olarak kullanılır.

### 2.6 Drill-down

`createDrillDownDataSource`, yol filtreleri + alan filtreleri + store filtresinden tek bir `filter` üretip yeni bir `DataSource` döner. Bu kaynağın her `load`'u store'a `filter` + `select: customColumns` ile gider (sunucu tarafı sayfalama korunur).

---

## 3. XmlaStore (OLAP / SSAS)

`store: { type: "xmla", url, catalog, cube, beforeSend }`

### 3.1 İletişim

| Ayrıntı | Değer |
|---|---|
| Yöntem | `POST`, `Content-Type: text/xml`, `dataType: "text"` |
| `beforeSend(ajaxSettings)` | İstekten önce ayarları değiştirmek için (kimlik doğrulama başlığı, `xhrFields.withCredentials` vb.) |
| Discover zarfı | SOAP `Discover`, `RequestType` + `CATALOG_NAME` / `CUBE_NAME` kısıtları |
| Execute zarfı | SOAP `Execute` + `Statement` (MDX HTML-escape edilir), `Catalog`, `ShowHiddenCubes=True`, `Timeout=3600`, `SspropInitAppName` |
| Yerel ayar | Geçerli dilin LCID'si varsa `<LocaleIdentifier>` |
| Ayrıştırma | `DOMParser("text/xml")`; parse hatası → `E4023` |
| SOAP Fault | `Error@Description` → `E4000` (loglanır ve reddedilir) |
| Hücre hatası | Değer `#N/A` olur, `W4002` uyarısı; ekranda `texts.dataNotAvailable` |

### 3.2 Şema keşfi (`getFields`)

Paralel 4 Discover: `MDSCHEMA_DIMENSIONS`, `MDSCHEMA_MEASURES`, `MDSCHEMA_HIERARCHIES`, `MDSCHEMA_LEVELS`, ardından `MDSCHEMA_MEASUREGROUPS`.

Üretilen alan:

| Özellik | Kaynak |
|---|---|
| `dataField` | `*_UNIQUE_NAME` |
| `caption` | `*_CAPTION` |
| `dimension` | Boyut başlığı; ölçüler için `DX_MEASURES` |
| `displayFolder` | `*_DISPLAY_FOLDER`; ölçülerde measure group başlığı |
| `isMeasure` | ölçüler için `true` |
| `isDefault` | Boyutun varsayılan hiyerarşisi |
| `groupName` / `hierarchyName` | Birden fazla seviyesi olan hiyerarşiler grup alanına dönüşür, seviyeleri `groupIndex = LEVEL_NUMBER − 1` |

Elenenler: görünmeyen 0. seviyeler, `DIMENSION_TYPE = 2` (ölçü boyutu).

### 3.3 MDX üretimi

```
WITH <hesaplanan ölçüler (expression), set'ler>
SELECT
   <sütun ekseni> DIMENSION PROPERTIES PARENT_UNIQUE_NAME, HIERARCHY_UNIQUE_NAME, MEMBER_VALUE ON columns,
   <satır ekseni> ... ON rows
FROM ( SELECT <filtre> ON 0 FROM ( ... FROM [cube] ) )
WHERE ( <dal dilimleri> )
CELL PROPERTIES VALUE, FORMAT_STRING, LANGUAGE, BACK_COLOR, FORE_COLOR, FONT_FLAGS
```

| Yapı | Üretim |
|---|---|
| Eksen | Her açık seviye için `CrossJoin(...)`; birden çok küme `Union(...)` |
| Hiyerarşi içi seviye | `Descendants({üye}, seviye, SELF_AND_BEFORE)` |
| Seviye üyeleri | `alan.allMembers`; arama varsa `Filter(..., instr(currentmember.member_caption, 'x') > 0)` |
| Boş satır eleme | `NonEmpty(küme, {ölçüler})` (sayfalama/sadece toplam istekleri hariç) |
| Sayfalama | `Subset(küme, başlangıç, adet)` + ayrı bir `COUNT([DX_rows])` sorgusu (`totalsOnly`) |
| Sıralama (sayfalı) | `Order(küme, alan.MEMBER_VALUE / .MEMBER_CAPTION, ASC/DESC)` |
| Filtre | `{alan.[değer], ...}`; `exclude` → `Except(alan.allMembers, {...})` (ebeveyn + `Descendants`) |
| Hesaplanan ölçü | Data alanında `expression` string'i → `member [alan] as <ifade>` |
| Ölçü yoksa | `[Measures]` |

### 3.4 Cevap ayrıştırma

- `Axis0` (sütun), `Axis1` (satır) `Tuple`'ları gezilir; her üye: `Caption`, `MEMBER_VALUE`, `LNum`, `UName`, `Hierarchy`, `PARENT_UNIQUE_NAME`, `LName`.
- Üyeler `PARENT_UNIQUE_NAME` ile ağaca yerleştirilir; görünmeyen seviyeler atlanıp çocuklar yukarı taşınır (`getVisibleChildren`).
- Tek kök üye ve boş ebeveyn ise genel toplam olarak kabul edilir.
- `Cell` öğeleri `CellOrdinal` sırasıyla `values[satır][sütun][ölçü]`'ye dağıtılır.

### 3.5 Drill-through

`drillthrough [maxrows N] SELECT <ölçü> on 0 FROM ... WHERE (<yol dilimleri>) [return <customColumns>]`. Sonuç `row` öğelerinden kayıtlara çevrilir; `_xHHHH_` kaçışları çözülür, köşeli parantezli adın son parçası alan adı olur.

### 3.6 Gecikme

`load` seçeneklerinde `delay` varsa sorgu `setTimeout(delay)` ile gönderilir.

---

## 4. Store karşılaştırması

| Özellik | LocalStore | RemoteStore | XmlaStore |
|---|---|---|---|
| Gruplama | istemci | sunucu (`group`) | OLAP sunucusu |
| `custom` özet | ✔ `calculateCustomSummary` | ✘ (sunucuya `"custom"` gider) | ✘ (`expression` ile) |
| `groupInterval` tarih | year/quarter/month/day/dayOfWeek | `alan.Year` vb. + quarter aralığı | hiyerarşi seviyeleri |
| Sayısal `groupInterval` | ✔ | ✔ aralık filtresi | — |
| Alan keşfi | tüm veri | ilk 20 kayıt | şema rowset'leri |
| `paginate` | ✘ | ✘ | ✔ |
| Header filter araması | istemci | `contains` filtresi | MDX `Filter/instr` |
| Drill-down | bellekte | sunucu filtreli DataSource | `drillthrough` |
| Uzun işlem | 10k satır / 300 ms dilimleme | paralel istekler | paralel istekler |
