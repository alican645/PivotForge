# DevExtreme dxPivotGrid 26.1.3 — Tersine Mühendislik Dokümantasyonu

> **Kaynak:** `https://cdn3.devexpress.com/jslib/26.1.3/js/dx.all.js` (5.467.391 bayt, build 10 Haziran 2026)
> **SHA-256:** `cd29840a482f149ae71ffb3031978e4634a68c4fe8742fa6582f8258c4856cf9`
> **Araç:** REA `rea-agents@6.5.0` (statik analiz; kod hiç çalıştırılmadı) + modül kaynaklarının satır satır okunması
> **Tarih:** 2026-10-18

Bu klasör PivotGrid'in **tüm özelliklerini, iç işleyişini, modüller arası bağlantılarını ve algoritmalarını** belgeler. DevExtreme kaynak kodu kopyalanmamıştır; davranışlar düz metin, tablo ve sözde kodla anlatılmıştır.

---

## Dosyalar

| # | Dosya | İçerik |
|---|---|---|
| 1 | [01-widget-secenekleri.md](01-widget-secenekleri.md) | Tüm `dxPivotGrid` seçenekleri, varsayılanları, bir seçenek değişince ne olduğu (`_optionChanged` tablosu), olaylar, public metotlar |
| 2 | [02-mimari-ve-yasam-dongusu.md](02-mimari-ve-yasam-dongusu.md) | Sınıf hiyerarşisi, başlatma sırası, DOM iskeleti, render hattı, `updateDimensions` boyut algoritması, scroll senkronizasyonu, sanal kaydırma, yükleme paneli, hücre tıklama |
| 3 | [03-veri-kaynagi.md](03-veri-kaynagi.md) | `PivotGridDataSource` iç yapısı: store seçimi, alan birleştirme, `descriptions`, yükleme hattı, `_update` sırası, expand/collapse, state, header filter değerleri, sayfalama önbelleği |
| 4 | [04-store-algoritmalari.md](04-store-algoritmalari.md) | `LocalStore` (istemci gruplama), `RemoteStore` (sunucu sorgusu üretimi ve cevap ayrıştırma), `XmlaStore` (MDX üretimi, SOAP, şema keşfi) |
| 5 | [05-hesaplama-ve-siralama.md](05-hesaplama-ve-siralama.md) | Özet tipleri, custom summary, `summaryDisplayMode`, `runningTotal`, `calculateSummaryValue` hücre API'si, sıralama algoritması, başlık ağacı ve toplam satırlarının üretimi |
| 6 | [06-arayuz-bilesenleri.md](06-arayuz-bilesenleri.md) | Tablo alanları (AreaItem), field panel, FieldChooserBase, FieldChooser (layout 0/1/2), sürükle-bırak kuralları, header filter, sağ tık menüleri, CSS sınıfları ve ikonlar |
| 7 | [07-export-grafik-state.md](07-export-grafik-state.md) | Excel export hattı (DataProvider → ExcelJS), `bindChart` algoritması, `stateStoring` kalıcılık mekanizması |
| 8 | [08-rea-ekleri.md](08-rea-ekleri.md) | REA'nın ürettiği ham istatistikler: modül bazında fonksiyon/çağrı sayıları, olaylar, dinleyiciler, zamanlayıcılar, bağımlılık tablosu, isimli fonksiyon envanteri |
| 9 | [09-stil-ve-tema.md](09-stil-ve-tema.md) | Fluent Blue Light temasının PivotGrid kuralları: renk paleti, tipografi, boşluklar, kenarlıklar, ikon glyph'leri, field chooser görünümü, RTL; projede özelleştirme örnekleri |

---

## Analiz nasıl yapıldı

REA üç kez çalıştırıldı:

| Çalışma | Girdi | Sonuç |
|---|---|---|
| 1 | `dx.all.js` (varsayılan 1 GB heap) | 2.028 webpack modülü bulundu, **worker heap'i doldu**, semantik grafik kısmi |
| 2 | `dx.all.js` (`--max-heap-mb 6144`, düğüm limiti 1.000.000) | Heap sorunu çözüldü ama sonuç **aktarım bayt bütçesini** aştı; semantik grafik yine boş |
| 3 | PivotGrid'e ait **39 modül ayrı dosyalar halinde** (`modules/<id>.js`) | **Kaynak limiti uyarısı yok.** 44.732 semantik düğüm, 43.317 ilişki, 1.261 fonksiyon, 4.325 çağrı noktası |

Modül seçimi:
1. 1. çalışmanın modül grafiğinde `PivotGrid`, `PivotGridDataSource`, `PivotGridExport`, `exportPivotGrid` export eden modüllerden başlanıp import kapanışı (537 modül) çıkarıldı.
2. Kapanışta PivotGrid'e özgü işaretler (`rowExpandedPaths`, `grandTotalColumnIndex`, `dx-pivotgrid`, `isMeasure`, `headerName`…) aranarak 31 modül bulundu.
3. Bu modüllerin dış bağımlılıkları arasından PivotGrid'in doğrudan kullandığı ortak grid altyapısı (sanal kaydırma, state storing, export çekirdeği, birleştirme yöneticisi…) eklendi → **39 modül**.
4. Her modül prettier ile açılıp baştan sona okundu; REA'nın çıkaramadığı `this.metot()` çağrı akışları elle izlendi.

> REA yalnızca serbest fonksiyon çağrılarını (`calls` ilişkisi, 292 adet) çözebildi; sınıf metotları arası çağrılar (`this._update()` gibi) çözümsüz kaldı. Bu akışlar dokümanlarda okuma yoluyla belgelendi.

---

## Modül haritası (39 modül)

Ofset: `dx.all.js` satır 31'deki karakter kolonu. **PG** = PivotGrid'e özel, **Ortak** = DataGrid/TreeList ile paylaşılan.

### Çekirdek

| ID | Ofset | Tür | Export | Görev | Ayrıntı |
|---|---|---|---|---|---|
| `16508` | 1.634.636 | PG | `PivotGrid` | Widget sınıfı (`dxPivotGrid`) | [02](02-mimari-ve-yasam-dongusu.md) |
| `18509` | 1.556.032 | PG | `DataController` | Başlık/hücre matrisi, sanal sayfalama, state tetikleme | [02](02-mimari-ve-yasam-dongusu.md), [05](05-hesaplama-ve-siralama.md) |
| `87993` | 1.575.374 | PG | `PivotGridDataSource` | Alanlar, yükleme, expand/collapse, state | [03](03-veri-kaynagi.md) |
| `47825` | 1.628.091 | PG | `LocalStore` | İstemci tarafı gruplama ve aggregation | [04](04-store-algoritmalari.md) |
| `81383` | 1.665.111 | PG | `RemoteStore` | Sunucu tarafı gruplama sorguları | [04](04-store-algoritmalari.md) |
| `48063` | 1.687.611 | PG | `XmlaStore` | OLAP / MDX / XMLA | [04](04-store-algoritmalari.md) |
| `81221` | 1.680.411 | PG | `Cell`, `summaryDictionary`, `applyDisplaySummaryMode`, `applyRunningTotal` | Özet sonrası hesaplar | [05](05-hesaplama-ve-siralama.md) |
| `11075` | 1.593.848 | PG | `sort` | Başlık sıralama | [05](05-hesaplama-ve-siralama.md) |
| `12062` | 1.660.023 | PG | 18 yardımcı | Ağaç gezinme, format, alan keşfi, drill-down mixin | [03](03-veri-kaynagi.md) |
| `84265` | 1.673.138 | PG | `forEachGroup` | Uzak grup sonucunu gezme | [04](04-store-algoritmalari.md) |

### Arayüz

| ID | Ofset | Tür | Export | Görev |
|---|---|---|---|---|
| `96273` | 1.541.594 | PG | `AreaItem` | Tüm tablo alanlarının temel sınıfı |
| `31045` | 1.554.265 | PG | `DataArea` | Veri hücreleri |
| `77195` | 1.623.581 | PG | `HorizontalHeadersArea`, `VerticalHeadersArea` | Sütun / satır başlıkları |
| `2997` | 1.620.207 | PG | `FieldsArea` | Field panel |
| `70317` | 1.612.200 | PG | `FieldChooserBase` | Sürükle-bırak, header filter, alan tıklama |
| `62989` | 1.602.317 | PG | `FieldChooser` | `dxPivotGridFieldChooser` |
| `47331` | 1.601.317 | PG | `dragAndDropItemRender` | Sürüklenen öğe görünümü |
| `56958` | 1.619.862 | PG | `shouldCancelDragging`, `reverseSortOrder` | Sürükleme kuralları |
| `73944` | 1.600.063 | PG | `CLASSES`, `ICONS`, `ATTRIBUTES`, `SORT_ORDER` | Sabitler |
| `58537` | 1.554.110 | PG | `CLASSES` | Scrollbar ölçüm sınıfı |
| `87691` | 1.673.410 | PG | `Sortable` | PivotGrid'e özel sortable (sürükle-bırak motoru) |

### Entegrasyon

| ID | Ofset | Tür | Export | Görev |
|---|---|---|---|---|
| `12867` | 1.595.201 | PG | `ExportController`, `DataProvider` | Export veri sağlayıcısı |
| `60457` | 411.744 | PG | `exportPivotGrid` | ExcelJS yazıcısı |
| `67705` | 1.550.507 | PG | `ChartIntegrationMixin` | `bindChart` |

### Ortak grid altyapısı (PivotGrid'in kullandığı)

| ID | Ofset | Export | PivotGrid'de kullanımı |
|---|---|---|---|
| `89272` | 1.331.699 | `VirtualScrollController` | `scrolling.mode: "virtual"` satır/sütun sayfalaması |
| `93416` | 1.174.756 | `StateStoringController` | `stateStoring` |
| `98741` | 402.419 | `Export` | ExcelJS ortak yazma döngüsü |
| `91189` | 410.549 | `MergedRangesManager` | Excel hücre birleştirme |
| `47197` | 1.105.659 | `prepareItems` | Export matrisini rowspan/colspan'e göre düzleştirme |
| `32760` | 1.295.539 | `createColumnsInfo`, `foreachColumnInfo` | Sütun bilgisini görünür aralığa kesme |
| `11371` | 253.172 | `getMemoizeScrollTo` | Gereksiz scroll çağrılarını eleme |
| `53226` | 1.112.580 | grid_core utils | Load panel, "veri yok" metni |
| `15303` | 3.935.177 | header filter core | Header filter tarih/aralık ifadeleri (işaret aramasıyla bulundu; PivotGrid modüllerinden doğrudan import edildiği doğrulanmadı — PivotGrid header filter'ı `83040` mixin'i üzerinden kullanır) |

### Kayıt / sarmalayıcı modüller

`84789` (global `DevExpress.ui.*` / `DevExpress.data.*` kaydı), `49344` → `49406` (`dxPivotGrid`), `55633` (`dxPivotGridFieldChooser`), `55067` (`PivotGridDataSource`), `80445` (`XmlaStore`), `16075`, `6285` / `54594` (`DevExpress.excelExporter.exportPivotGrid`).

---

## Genel veri akışı

```
              ┌──────────────────────── dxPivotGrid (16508) ────────────────────────┐
 kullanıcı ──►│ option değişikliği / hücre tıklama / sağ tık / field chooser        │
              │        │                                                            │
              │        ▼                                                            │
              │  DataController (18509) ──── StateStoringController (93416)         │
              │        │   ▲ changed / loadingChanged / progressChanged             │
              │        ▼   │ expandValueChanging / fieldsPrepared                   │
              │  PivotGridDataSource (87993)                                        │
              │        │ customizeStoreLoadOptions (sanal sayfalama ayarı)          │
              │        ▼                                                            │
              │  LocalStore (47825) │ RemoteStore (81383) │ XmlaStore (48063)       │
              │        │ {rows, columns, values, grandTotal*Index}                  │
              │        ▼                                                            │
              │  _update: format → cache → displayMode (81221) → sort (11075)       │
              │           → runningTotal (81221) → "changed"                        │
              │        ▼                                                            │
              │  DataController._update → rowsInfo / columnsInfo (başlık matrisi)    │
              │        ▼                                                            │
              │  _render → AreaItem'lar (96273, 31045, 77195, 2997) → DOM            │
              │        ▼                                                            │
              │  updateDimensions → genişlik/yükseklik senkronu → scroll bağlama     │
              └─────────────────────────────────────────────────────────────────────┘
```

---

## En önemli bulgular (dokümanlar boyunca ayrıntılı)

1. **`paginate: true` yalnızca XMLA ile çalışır.** `paginate()` = `_paginate && store.supportPaging()`; `supportPaging()` LocalStore ve RemoteStore'da `false`, yalnızca XmlaStore'da `true` döner. ([03](03-veri-kaynagi.md))
2. **`renderCellCountLimit` sanal moda geçirmez**; hücre sayısı bu sınırı aşarsa yalnızca ilk boyut hesabı `setTimeout` ile ertelenir. ([02](02-mimari-ve-yasam-dongusu.md))
3. **LocalStore zaman dilimlemesi yapar:** her 10.000 satırda bir, 300 ms'den fazla geçtiyse ilerleme bildirir ve `setTimeout(0)` ile ana iş parçacığını bırakır. 10.000 satırlık veri tek seferde işlenir. ([04](04-store-algoritmalari.md))
4. **Alan başlığına tıklayıp sıralamak yeniden yükleme yapmaz** (`sortLocal`); yalnızca `scrolling.mode: "virtual"` iken (`remoteSort`) store'a tekrar gidilir. ([06](06-arayuz-bilesenleri.md))
5. **`calculateSummaryValue` içinde `cell.value('x')` ile adı geçen ve alanı olmayan alanlar** descriptions oluşturulurken otomatik olarak `values`'a (gizli veri alanı) eklenir. ([05](05-hesaplama-ve-siralama.md))
6. **`stateStoring.storageKey` verilmezse anahtar `"storage"`** olur; aynı origin'deki başka bir grid ile çakışabilir. Sayfa gizlenirken (`visibilitychange`) bekleyen kayıt hemen yazılır. ([07](07-export-grafik-state.md))
7. **RemoteStore tarih `groupInterval`'ı sunucuya `alan.Year` / `alan.Month` biçiminde gönderir**; `quarter` ise `alan.Month` üzerinde 3 aylık aralık filtresine çevrilir. ([04](04-store-algoritmalari.md))
8. **Excel export, `@ = + -` ile başlayan metinlere metin formatı (`@`) uygular** (formül enjeksiyonuna karşı); tarihleri ExcelJS için UTC'ye çevirir; başlık bölgesini dondurur. ([07](07-export-grafik-state.md))
9. **Kapsayıcı yüksekliği 66666 px hilesiyle tespit edilir:** geçici 66666 px'lik bir div eklenir; eleman yüksekliği değişmiyorsa sabit yükseklik var sayılır. ([02](02-mimari-ve-yasam-dongusu.md))
10. **Otomatik caption** = `titleize(dataField[_groupInterval])` + ` (Sum)` gibi özet son eki. ([03](03-veri-kaynagi.md))
