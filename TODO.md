# PivotForge — DevExpress Denklik Yol Haritası

DevExpress / DevExtreme PivotGrid'in belgelenmiş özellik kümesi ile PivotForge'un
`0.4.0-preview.8` sürümündeki durumu karşılaştırıldı. Kaynaklar dosyanın sonunda.

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

### 0.2 Olay bildirimi — ✅ `0.4.0-preview.7` ile tamamlandı

Bugün hiçbir olay bildirilemiyor. `pivotforge:ready` bir kaçış kapısı, sözleşme değil —
üstelik `widget.renderer.options`'a dışarıdan yazmayı gerektiriyor, yani iç yapıya dokunuyor.

Uygulanan tasarım: nitelik + DOM olayı birlikte. İkisi de her zaman tetikleniyor —
işleyici adı vermek DOM olayını kapatmıyor.

- [x] `on-selection-changed`, `on-cell-double-click`, `on-cell-copied`,
      `on-cell-filter-requested`, `on-view-state-changed`, `on-data-loaded`, `on-error`
      → adı verilen global fonksiyonu çağır
- [x] Her olay için `<pivot-grid>` elementinden `CustomEvent` yayınla
      (`pivotforge:selectionchanged` vb.), yayınlanan yükü belgele
- [x] `widget.renderer.options`'a dışarıdan yazma ihtiyacı ortadan kalktı: sunum
      seçenekleri 0.1 ile bildirimsel, olaylar 0.2 ile. Ayrı bir setter gerekmedi.

### 0.3 Başlangıç durumu — ✅ `0.4.0-preview.8` ile tamamlandı

- [x] `<pivot-filter field="Region" values="Marmara,Ege" />` — başlangıç filtresi
- [x] `<pivot-sort mode="RowTotalValue" value-field="Amount" direction="Descending" />`
- [x] `<pivot-conditional-rule ... />` — koşullu biçimlendirme kuralları
- [ ] Detay modalı ayarları: `drill-down-labels`. Sütunlar bilinçli olarak
      dışarıda: sütun biçimlendiricileri fonksiyon ve bir nitelikte ifade
      edilemiyor; katalogdan türetilen varsayılan zaten doğru çalışıyor.

---

## Bölüm 1 — Alan (field) seçenekleri

DevExpress alan başına 38 seçenek sunuyor. PivotForge'daki karşılıkları:

| DevExpress | Motor | Bildirimsel | Not |
|---|---|---|---|
| `dataField`, `caption`, `area`, `visible` | ✅ | ✅ | |
| `summaryType` (aggregation) | ✅ | ✅ | 5 tür: sum/count/average/min/max |
| `summaryDisplayMode` (`showAs`) | ✅ | ✅ | `show-as` niteliği ve `ShowAs()` metodu mevcut |
| `format` / `precision` | ✅ | ✅ | `0.4.0-preview.1`'de eklendi |
| `areaIndex` | ✅ | ✅ | `area-index` niteliği ve `AreaIndex()` metodu |
| `sortOrder` | ✅ | ✅ | `sort-order` niteliği; satır ve sütun ekseninde seviye başına yön |
| `sortBy` | ⚠️ | ❌ | Özet değere göre seviye sıralaması yok; yalnızca tablo geneli |
| `sortBySummaryField` / `Path` | ⚠️ | ⚠️ | `RowTotalValue` var ama sütun yoluna göre değil |
| `expanded` | ✅ | ✅ | Alan başına başlangıç durumu; yalnızca ilk çizimde |
| `showTotals` (alan başına) | ✅ | ✅ | `show-totals` niteliği ve `ShowTotals()` metodu |
| `showGrandTotals` (alan başına) | ❌ | ❌ | Yalnızca tablo geneli |
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

- [x] `area-index` ile açık sıra — yalnızca açılış düzenini kurar; kullanıcı bir
      çipi taşıdıktan sonra düzen sıranın sahibidir, bu yüzden `toFields()` bunu
      geri yaymaz
- [x] Alan başına `sort-order` — seviyeyi kendi üst grubunun içinde sıralar,
      hiyerarşi bozulmaz. İki eksen "bildirilmemiş"i farklı yorumluyor: satır
      ekseni aksi söylenmedikçe artan, sütun ekseni verinin geliş sırasını korur
      (ay adlarını ay numarasına göre sıralayan bir sorgu alfabetik sıralamayla
      bozulurdu). Kullanıcının başlığa tıklayarak kurduğu sıralama bildirime
      üstün gelir
- [ ] Alan başına `sort-by` — özet değere göre seviye sıralaması
- [x] `expanded` başlangıç durumu — `Row` alanında `expanded="false"` o seviyenin
      gruplarını **ilk** çizimde kapatıyor; sonrası kullanıcıya ait ve geri
      yüklenen `state-storing` görünümü ona üstün geliyor
- [x] Alan başına `show-totals` — `false` grup başlığını yerinde bırakıp
      toplamlarını kaldırıyor; bu, ara toplamlar tümüyle kapalıyken zaten
      kullanılan satır şeklinin aynısı, yani derin bir hiyerarşi yalnızca
      toplanmaya değer seviyelerde toplam gösterebiliyor
- [ ] Alan başına `show-grand-totals` — DevExpress'te sütun yönünde de anlamı
      var, renderer'da karşılığı yok; ayrı bir tasarım kararı gerektiriyor
- [ ] `group-interval` — tarih alanlarını yıl/çeyrek/ay/gün olarak gruplama
- [ ] `data-type` ve tür dönüşümü
- [ ] `width`, `word-wrap`
- [ ] Alan başına `allow-sorting` / `allow-filtering`

---

## Bölüm 2 — Filtreleme

**En büyük işlevsel açık.** Bugün filtre modeli şu kadar:

```csharp
public sealed record PivotFilter(
    string Field,
    IReadOnlyList<string?> Values,
    PivotFilterMode Mode = PivotFilterMode.Include);
```

Değer seçici artık pakette (`PivotFilterPicker`): motora `PivotEngine.DistinctValues`,
uç noktalara `POST /pivotforge/field-values`, tasarımcı çipine `▼` düğmesi eklendi.
Include/exclude ve satır başlığı hunisi de tamam. Kalan açık operatörler tarafında.

- [x] **Filtre değer seçici UI** (paketlenmiş) — arama kutulu, çoklu seçim,
      "Tümünü seç"/"Temizle", kesme uyarısı — tasarımcıdaki Filtreler bölgesi artık işlevsel
- [x] `filterType` — include / exclude — `<pivot-filter type="Exclude">`, seçicide mod
      düğmeleri, `setFilterMode`, kaydedilen görünümde saklanır
- [x] Excel benzeri başlık filtresi (`headerFilter`) — satır başlığındaki huni aynı
      `PivotFilterPicker`'ı aynı filtre girdisi üzerinde açar; filtre bölgeye değil
      alana ait olduğu için alan yerinde kalır ve taşınırken filtresini de taşır.
      Sütun ekseninde alan adı hücresi yok — orası ayrı bir iş (aşağıda)
- [ ] Sütun ekseninde başlık filtresi — alan adı satırı gerektirir (colSpan/rowSpan,
      sticky sütunlar, sanal boşluklar, Excel dışa aktarma modeli)
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
| Tasarımcıdan filtre seçimi | ✅ | çipteki `▼` düğmesi `PivotFilterPicker`'ı açar |

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

`state-storing` ile otomatik kayıt/geri yükleme eklendi. `PivotViewStore` ayrı bir
özellik olarak kalıyor: o, kullanıcının **adlandırılmış birden çok görünüm** tutup
aralarında geçmesi için — kendi durum şeması demoya ait, bildirimsel yol onu kullanmıyor.

- [x] `state-storing="Local|Session"` + `state-key` ile otomatik kaydet/geri yükle —
      alan düzeni, başlıklar, filtre seçimleri, toplama, biçim ve sıralama
- [x] `adoptLayout` kaydedilmiş **başlıkları** geri yüklüyor — `getState()` çıktısı
      doğrudan yapıcıya geri verilebiliyor
- [~] Kaydedilmiş görünümde koşullu biçimlendirme kurallarının taşınması —
      **kapsam dışı bırakıldı:** kurallar `pivot-conditional-rule` ile bildiriliyor ve
      tasarımcı onları düzenleyemiyor, yani kullanıcının değiştirdiği, kaybolabilecek
      bir şey yok. Tasarımcıya kural düzenleme eklenirse bu madde geri açılmalı.

---

## Bölüm 8 — Erişilebilirlik ve platform

Sürükleme Pointer Events'e taşındı; fare, dokunmatik, kalem ve klavye aynı
taşıma işlemini paylaşıyor. Tablo `role="grid"` ilan ediyor. Kalan tek açık
uyarlanabilir mobil düzen.

- [x] Dokunmatik sürükle-bırak — çipteki tutamaç (`⠿`) `touch-action: none`
      taşıyor, gövdesi taşımıyor: parmakla liste kaydırılabiliyor, tutamaçtan
      sürüklenebiliyor
- [x] Klavye ile alan taşıma — çipler gezinen `tabIndex` ile odaklanabilir
      (bölge başına bir durak), `Space` alır, oklar taşır, `Space`/`Enter`
      bırakır, `Esc` iptal eder, `Delete` kaldırır, `Enter` ayarlar modalini
      açar. Bırakılana kadar duruma hiçbir şey yazılmıyor, bu yüzden iptal
      bedava. Odak, taşımanın tetiklediği yeniden çizimin ardından alanla
      birlikte gidiyor.
- [x] ~~Tablo içinde klavye gezinme~~ — **zaten vardı:** ok tuşları, Enter/Space,
      Ctrl+C, ContextMenu/Shift+F10 ve gezinen `tabIndex` (`pivot-table.js:931-1010`)
- [x] ARIA rolleri ve ekran okuyucu desteği — tablo `role="grid"` ilan ediyor;
      `rowgroup`/`row`/`columnheader`/`rowheader`/`gridcell` rolleri tek bir
      hücre fabrikasından geçiyor, böylece unutulabilecek bir yer kalmıyor.
      `aria-selected` artık gerçekten işliyor (düz tabloda ekran okuyucu onu
      atıyordu). Ayrıca: `aria-label` niteliğiyle bildirilebilen erişilebilir
      ad, sanallaştırmada doğru sayıyı veren `aria-rowcount`/`aria-rowindex`,
      sıralanabilir başlıkta `aria-sort`, daralt/genişlet düğmelerinde
      `aria-expanded` + ad, tasarımcı bölgelerinde başlığıyla adlandırılmış
      `role="group"`
- [ ] Uyarlanabilir (adaptive) mobil düzen — mevcut `@media (max-width: 720px)`
      yalnızca demo düzenini kapsıyor; tasarımcı bölgeleri ve filtre seçici
      kapsam dışı

---

## Bölüm 9 — Yerelleştirme

- [x] ~~`"tr-TR"` koda gömülü~~ — **sekiz yerdeydi.** Sunucuda harmanlama artık
      `CultureInfo.CurrentCulture`'dan çözülüyor (istek başına, yani ASP.NET'in
      request localization'ı doğrudan işliyor) ve `new PivotEngine(culture)` ile
      sabitlenebiliyor; tarayıcıda sayı biçimlendirme okuyucunun kendi yerelini
      izliyor, `culture` niteliğiyle sabitlenebiliyor. Bunlar kozmetik değildi:
      Türkçe'de Ç ayrı bir harf, başka yerlerde C'nin varyantı — `Corum` ile
      `Çanakkale` iki kültürde yer değiştiriyor. Filtre seçicinin değer listesi
      de aynı harmanlamayı kullanıyor.
      İstemcinin bildirdiği kültür sunucuya **geçirilmiyor**: tarayıcının bir
      kültür iddia ederek sunucunun sıralamasını değiştirebilmesi istenmeyen
      bir şey.
- [x] `texts` merkezî metin sözlüğü — renderer'ın ekrana koyduğu her metin
      (`Veri yok`, `Satır Etiketleri`, bağlam menüsü, sütun genişletme ve
      sıralama ipuçları) `rendererOptions.texts` üzerinden değiştirilebiliyor;
      bildirilmeyen anahtar gömülü Türkçe varsayılanını koruyor
- [ ] `.NET` tarafında `IStringLocalizer` entegrasyonu — metinler JavaScript'te
      elden verilmek yerine kaynak dosyalarından gelsin

---

## Önerilen sıra

Sizin önceliğiniz "az kodla çok iş" olduğu için sıralama işlevsel büyüklüğe göre değil,
**bildirimsel kapsamı en hızlı büyüten** işe göre:

1. **Bölüm 0** — bildirimsel yüzey. Yeni özellik yok, mevcut motorun önüne bildirim.
   Tag helper'ı kendi kendine yeterli hale getiren tek adım bu.
2. **Bölüm 1'in ucuz kalemleri** — `show-as`, `area-index`, `expanded`, alan başına toplamlar.
3. **Bölüm 2** — filtre değer seçici. Tasarımcının Filtreler bölgesi bugün işlevsiz;
   bu onu tamamlayan parça.
4. **Bölüm 8** — ~~dokunmatik + klavye + ARIA~~ tamam; kalan yalnızca mobil düzen.
5. **Bölüm 3** — hesaplanmış alanlar. En büyük tasarım işi, en sona.

---

## Kaynaklar

- [dxPivotGrid Configuration — DevExtreme API Reference](https://js.devexpress.com/jQuery/Documentation/ApiReference/UI_Components/dxPivotGrid/Configuration/)
- [PivotGridDataSource fields — DevExtreme API Reference](https://js.devexpress.com/jQuery/Documentation/ApiReference/Data_Layer/PivotGridDataSource/Configuration/fields/)
- [JavaScript Pivot Grid — DevExtreme genel bakış](https://js.devexpress.com/overview/pivotgrid/)
- [Pivot Grid — DevExpress ASP.NET Core belgeleri](https://docs.devexpress.com/AspNetCore/400790/devextreme-based-controls/controls/pivot-grid)
- [Integrated Field Chooser — ASP.NET Core demo](https://demos.devexpress.com/aspnetcore/Demo/PivotGrid/IntegratedFieldChooser/)
