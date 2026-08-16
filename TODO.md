# PivotForge — DevExpress Denklik Yol Haritası

DevExpress / DevExtreme PivotGrid'in belgelenmiş özellik kümesi ile PivotForge'un
`0.4.0-preview.6` sürümündeki durumu karşılaştırıldı. Kaynaklar dosyanın sonunda.

**Kapsam dışı (talep üzerine):** OLAP / SSAS, sunucu tarafı toplama (server mode),
uzaktan gruplama, milyon satır ölçeğinde sanal kaydırma.

**Yönlendirici ilke:** _az kodla çok iş._ Bir özelliğin "var" sayılması için motorda
çalışması yetmez — **tag helper'dan bildirilebilir olması** gerekir. Aşağıdaki tablolar
bu yüzden iki ayrı sütun taşıyor.

## Durum işaretleri

| İşaret | Anlamı |
|---|---|
| ✅ | Çalışıyor ve bildirimsel olarak erişilebilir |
| ⚠️ | Motorda var, ama **JS yazmadan kullanılamıyor** |
| ❌ | Hiç yok |

---

## Bölüm 0 — Bildirimsel yüzey açığı (en yüksek öncelik)

Bugün tag helper 12 nitelik açıyor; hepsi davranış anahtarı. Renderer'ın desteklediği
~28 seçeneğin **hiçbir sunum seçeneği** bildirilemiyor. Bu bölüm yeni özellik değil —
**zaten çalışan kodun önüne bildirim koymak.** En düşük maliyetli, en yüksek getirili iş.

### 0.1 Sunum nitelikleri — ✅ `0.4.0-preview.6` ile tamamlandı

Hepsi `rendererOptions`'a akar. Bildirilmeyen seçenek payload'a hiç yazılmaz,
böylece renderer kendi varsayılanını korur.

- [x] `selection-mode="Single|None"` → `selectionMode` — renderer yalnızca bu ikisini tanıyor
- [x] `context-menu="true|false"` → `contextMenu`
- [x] `subtotals="true|false"` → `subtotals`
- [x] `show-grand-total="true|false"` → `showGrandTotal`
- [x] `layout-mode="Tabular|Compact"` → `layoutMode`
- [x] `repeat-row-labels="true|false"` → `repeatRowLabels`
- [x] `min-column-width` / `max-column-width` → `minColumnWidth` / `maxColumnWidth`
- [x] `empty-text` / `total-text` → `emptyText` / `totalText`
- [x] Aynı seçenekler `PivotGridBuilder`'a fluent metot olarak

### 0.2 Olay bildirimi

Bugün hiçbir olay bildirilemiyor. `pivotforge:ready` bir kaçış kapısı, sözleşme değil —
üstelik `widget.renderer.options`'a dışarıdan yazmayı gerektiriyor, yani iç yapıya dokunuyor.

**Önerilen tasarım (onay bekliyor):** nitelik + DOM olayı birlikte. Nitelik yazan hiç JS
yazmaz; olay dinlemek isteyen iç yapıya dokunmadan dinler.

- [ ] `on-selection-changed`, `on-cell-double-click`, `on-cell-copied`,
      `on-cell-filter-requested`, `on-view-state-changed`, `on-data-loaded`, `on-error`
      → adı verilen global fonksiyonu çağır
- [ ] Her olay için `<pivot-grid>` elementinden `CustomEvent` yayınla
      (`pivotforge:selectionchanged` vb.), yayınlanan yükü belgele
- [ ] `widget.renderer.options`'a dışarıdan yazmayı gereksiz kılacak resmî
      `widget.setRendererOption(name, value)` yüzeyi

### 0.3 Başlangıç durumu

- [ ] `<pivot-filter field="Region" values="Marmara,Ege" />` — başlangıç filtresi
- [ ] `<pivot-sort field="Amount" mode="RowTotalValue" direction="Descending" />`
- [ ] `<pivot-conditional-rule ... />` — koşullu biçimlendirme kuralları
      (motorda `conditionalRules` var, bildirimi yok)
- [ ] Detay modalı ayarları: `drill-down-columns`, `drill-down-labels`

---

## Bölüm 1 — Alan (field) seçenekleri

DevExpress alan başına 38 seçenek sunuyor. PivotForge'daki karşılıkları:

| DevExpress | Motor | Bildirimsel | Not |
|---|---|---|---|
| `dataField`, `caption`, `area`, `visible` | ✅ | ✅ | |
| `summaryType` (aggregation) | ✅ | ✅ | 5 tür: sum/count/average/min/max |
| `summaryDisplayMode` (`showAs`) | ✅ | ⚠️ | 7 mod motorda var; **tag helper'da nitelik yok** |
| `format` / `precision` | ✅ | ✅ | `0.4.0-preview.1`'de eklendi |
| `areaIndex` | ✅ | ❌ | Sıra bildirim sırasından geliyor, açıkça verilemiyor |
| `sortOrder`, `sortBy` | ⚠️ | ❌ | Alan başına sıralama yok; yalnızca tablo geneli |
| `sortBySummaryField` / `Path` | ⚠️ | ❌ | `RowTotalValue` var ama sütun yoluna göre değil |
| `expanded` | ⚠️ | ❌ | `expandAll`/`collapseAll` var, alan başına başlangıç durumu yok |
| `showTotals` / `showGrandTotals` (alan başına) | ❌ | ❌ | Yalnızca tablo geneli |
| `dataType` | ❌ | ❌ | Tür dönüşümü yok |
| `groupInterval` (yıl/çeyrek/ay/gün) | ❌ | ❌ | **Önemli** — tarih gruplaması için ayrı alan açmak gerekiyor |
| `selector` / `sortingMethod` | ❌ | ❌ | Özel gruplama/sıralama fonksiyonu |
| `customizeText` | ❌ | ❌ | Hücre metnini özelleştirme |
| `calculateCustomSummary` | ❌ | ❌ | Bkz. Bölüm 3 |
| `calculateSummaryValue` | ❌ | ❌ | Özet sonrası işleme |
| `runningTotal` + `allowCrossGroupCalculation` | ⚠️ | ⚠️ | `RunningTotal` showAs modu var, çapraz grup seçeneği yok |
| `width`, `wordWrapEnabled` | ❌ | ❌ | |
| `displayFolder` | ❌ | ❌ | Alan seçicide klasörleme |
| `allowSorting`/`allowFiltering`/`allowExpandAll` (alan başına) | ❌ | ❌ | Yalnızca tablo geneli |

### Yapılacaklar

- [ ] `show-as` niteliği (motorda hazır, sadece bildirim eksik) — **en ucuz kazanç**
- [ ] `area-index` ile açık sıra
- [ ] Alan başına `sort-order` / `sort-by`
- [ ] `expanded` başlangıç durumu
- [ ] Alan başına `show-totals` / `show-grand-totals`
- [ ] `group-interval` — tarih alanlarını yıl/çeyrek/ay/gün olarak gruplama
- [ ] `data-type` ve tür dönüşümü
- [ ] `width`, `word-wrap`
- [ ] Alan başına `allow-sorting` / `allow-filtering`

---

## Bölüm 2 — Filtreleme

**En büyük işlevsel açık.** Bugün filtre modeli şu kadar:

```csharp
public sealed record PivotFilter(string Field, IReadOnlyList<string?> Values);
```

Operatör yok, `filterType` (include/exclude) yok, ve **paket tarafında hiçbir filtre
arayüzü yok.** Tasarımcının Filtreler bölgesine alan sürüklenebiliyor ama hangi değerlerin
seçileceğini belirleyecek UI yok — demo bunu kendi elle yazdığı menüyle çözüyor.

- [ ] **Filtre değer seçici UI** (paketlenmiş) — arama kutulu, çoklu seçim, "Tümü"
      — tasarımcıdaki Filtreler bölgesini işlevsel hale getirir
- [ ] `filterType` — include / exclude
- [ ] Excel benzeri başlık filtresi (`headerFilter`) — sütun/satır başlığından filtreleme
- [ ] Filtre operatörleri: içerir, başlar, arasında, boş/boş değil, Top-N
- [ ] Tarih aralığı filtreleri
- [ ] `hideEmptySummaryCells` — boş satır/sütunları gizle

---

## Bölüm 3 — Hesaplanmış alanlar

Hiç yok. DevExpress'te üç ayrı mekanizma var:

- [ ] `calculateCustomSummary` — özel toplama fonksiyonu
- [ ] `calculateSummaryValue` — hücre değerinin sonradan hesaplanması
      (ör. `Kâr = Gelir − Gider`, iki ölçüden türetilen üçüncü ölçü)
- [ ] İfade tabanlı hesaplanmış alan (kullanıcının UI'dan tanımlayabildiği)

Bunun bir kısmı sunucu tarafında (`PivotForge.Core`) delegate ile, bir kısmı istemcide
JS fonksiyonuyla çözülebilir. Tasarım kararı gerektirir.

---

## Bölüm 4 — Düzen ve görünüm

| Özellik | Durum |
|---|---|
| Tabular / Compact düzen | ✅ `layout-mode` |
| Satır başlığı ağaç düzeni (`rowHeaderLayout: tree`) | ❌ |
| `showTotalsPrior` — toplamları önde göster | ❌ |
| `showBorders` | ❌ |
| Sütun genişliği sürükleme | ✅ |
| Genişlet / daralt | ✅ motorda, ⚠️ bildirimi yok |
| `wordWrapEnabled` | ❌ |
| `rtlEnabled` | ❌ |
| Yükleme göstergesi (`loadPanel`) | ⚠️ `dataLoading` olayı var, hazır gösterge yok |

- [ ] Ağaç düzeni satır başlıkları
- [ ] `show-totals-prior`
- [ ] Paketlenmiş yükleme göstergesi
- [ ] RTL desteği
- [ ] `word-wrap`

---

## Bölüm 5 — Alan seçici (Field Chooser / Field Panel)

PivotForge'un tasarımcısı bu konuda iyi durumda — `0.4.0-preview.5` ile ayarlar modali
DevExpress'in alan menüsüne yaklaştı.

| Özellik | Durum |
|---|---|
| Dört bölgeli alan paneli | ✅ |
| Sürükle-bırak, bölge içi sıralama | ✅ |
| Alanlar listesine geri sürükleme | ✅ |
| Alan arama | ✅ |
| Ayarlar modali (ad, konum, özet, showAs, biçim, kaldır) | ✅ |
| Alan seçicide klasörleme (`displayFolder`) | ❌ |
| Bağımsız (standalone) alan seçici | ❌ |
| Tasarımcıdan sıralama paneli | ❌ |
| Tasarımcıdan filtre seçimi | ❌ (Bölüm 2) |

- [ ] Sıralama paneli — tasarımcıdan `sortBy` sürmek
- [ ] `display-folder` ile alan gruplama
- [ ] Alan seçiciyi ayrı bileşen olarak kullanabilme

---

## Bölüm 6 — Dışa aktarma

| Özellik | Durum |
|---|---|
| Gerçek `.xlsx` (OOXML) | ✅ |
| CSV dışa aktarma | ❌ |
| Dışa aktarılan hücreyi özelleştirme (`onExporting`) | ❌ |
| PDF / yazdırma | ❌ |

- [ ] CSV dışa aktarma
- [ ] Dışa aktarma öncesi hücre özelleştirme kancası
- [ ] Yazdırma görünümü

---

## Bölüm 7 — Durum kalıcılığı

`PivotViewStore` var ve çalışıyor, ama otomatik değil.

- [ ] `state-storing="local|session"` niteliği ile otomatik kaydet/geri yükle
- [ ] `adoptLayout` kaydedilmiş **başlıkları** (caption override) geri yüklemiyor —
      `getState().captions` dışarı veriliyor ama geri okunmuyor
- [ ] Kaydedilmiş görünümde koşullu biçimlendirme kurallarının taşınması

---

## Bölüm 8 — Erişilebilirlik ve platform

**Bugün en zayıf alan.** Sürükle-bırakta **0 touch handler** var.

- [ ] Dokunmatik sürükle-bırak — tablet/telefonda tasarımcı çalışmıyor
- [ ] Klavye ile alan taşıma — çipler odaklanabilir ama işletilemiyor
- [ ] Tablo içinde klavye gezinme (`tabIndex`, ok tuşları)
- [ ] ARIA rolleri ve ekran okuyucu desteği (WCAG)
- [ ] Uyarlanabilir (adaptive) mobil düzen

---

## Bölüm 9 — Yerelleştirme

- [ ] `"tr-TR"` beş yerde koda gömülü — kültür bir seçenek olmalı
- [ ] `texts` benzeri merkezî metin sözlüğü (tasarımcı etiketleri kısmen özelleştirilebiliyor,
      renderer metinleri değil)
- [ ] `.NET` tarafında `IStringLocalizer` entegrasyonu

---

## Önerilen sıra

Sizin önceliğiniz "az kodla çok iş" olduğu için sıralama işlevsel büyüklüğe göre değil,
**bildirimsel kapsamı en hızlı büyüten** işe göre:

1. **Bölüm 0** — bildirimsel yüzey. Yeni özellik yok, mevcut motorun önüne bildirim.
   Tag helper'ı kendi kendine yeterli hale getiren tek adım bu.
2. **Bölüm 1'in ucuz kalemleri** — `show-as`, `area-index`, `expanded`, alan başına toplamlar.
3. **Bölüm 2** — filtre değer seçici. Tasarımcının Filtreler bölgesi bugün işlevsiz;
   bu onu tamamlayan parça.
4. **Bölüm 8** — dokunmatik + klavye. Erişilebilirlik borcu ve mobil kullanımın önkoşulu.
5. **Bölüm 3** — hesaplanmış alanlar. En büyük tasarım işi, en sona.

---

## Kaynaklar

- [dxPivotGrid Configuration — DevExtreme API Reference](https://js.devexpress.com/jQuery/Documentation/ApiReference/UI_Components/dxPivotGrid/Configuration/)
- [PivotGridDataSource fields — DevExtreme API Reference](https://js.devexpress.com/jQuery/Documentation/ApiReference/Data_Layer/PivotGridDataSource/Configuration/fields/)
- [JavaScript Pivot Grid — DevExtreme genel bakış](https://js.devexpress.com/overview/pivotgrid/)
- [Pivot Grid — DevExpress ASP.NET Core belgeleri](https://docs.devexpress.com/AspNetCore/400790/devextreme-based-controls/controls/pivot-grid)
- [Integrated Field Chooser — ASP.NET Core demo](https://demos.devexpress.com/aspnetcore/Demo/PivotGrid/IntegratedFieldChooser/)
