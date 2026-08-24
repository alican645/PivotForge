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
- [x] `allow-conditional-formatting` + paketlenmiş `PivotConditionalPanel` —
      okuyucu hücre menüsünden kural ekleyip ölçü kurallarını temizleyebiliyor.
      Menü, geri çağırması olmayan eylemi artık hiç göstermiyor.
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
| `groupInterval` (yıl/çeyrek/ay/gün) | ✅ | ✅ | `group-interval` niteliği ve `GroupInterval()` metodu; aynı kolon birden fazla seviyede |
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
- [x] `group-interval` — tarih alanlarını yıl/çeyrek/ay/gün/haftanın-günü olarak
      gruplama. Gruplama başlığın okunduğu yerde olduğu için kaynakta ikinci bir
      kolon gerekmiyor ve **aynı kolon birden fazla seviyede** yer alabiliyor;
      bu yüzden bir seviye artık alan adıyla değil `alan:aralık` anahtarıyla
      tanımlanıyor (`PivotFieldRef`). Etiket ile sıra tek konu: ay adı olarak
      okunur, ay numarasına göre sıralanır. Filtre, drill-down ve değer seçici
      aynı gruplamadan geçiyor
- [ ] `data-type` ve tür dönüşümü
- [ ] `width`, `word-wrap`
- [ ] Alan başına `allow-sorting` / `allow-filtering`

---

## Bölüm 2 — Filtreleme

**Tamamlandı.** Bölüm açıldığında filtre modeli şu kadardı:

```csharp
public sealed record PivotFilter(
    string Field,
    IReadOnlyList<string?> Values,
    PivotFilterMode Mode = PivotFilterMode.Include);
```

Bugün: paketlenmiş değer seçici (`PivotEngine.DistinctValues` +
`POST /pivotforge/field-values`), include/exclude, iki eksende başlık hunisi,
sekiz operatör, tarih aralığı için takvim kontrolü, boş satır/sütun eleme ve
Top-N.

- [x] **Filtre değer seçici UI** (paketlenmiş) — arama kutulu, çoklu seçim,
      "Tümünü seç"/"Temizle", kesme uyarısı — tasarımcıdaki Filtreler bölgesi artık işlevsel
- [x] `filterType` — include / exclude — `<pivot-filter type="Exclude">`, seçicide mod
      düğmeleri, `setFilterMode`, kaydedilen görünümde saklanır
- [x] Excel benzeri başlık filtresi (`headerFilter`) — satır başlığındaki huni aynı
      `PivotFilterPicker`'ı aynı filtre girdisi üzerinde açar; filtre bölgeye değil
      alana ait olduğu için alan yerinde kalır ve taşınırken filtresini de taşır
- [x] Sütun ekseninde başlık filtresi — asıl engel filtreleme değildi, **isimlendirme**
      idi: bir sütun başlığı `2024` yazar, ait olduğu alanı hiç yazmaz, dolayısıyla
      huniyi asacak hücre yoktu. Köşe bloğunda her sütun seviyesine kendi ad hücresi
      verildi; bu da satır alan adlarını kendi satırına indirdi (Excel'in yerleşimi).
      Filtre yolunun kendisi zaten alan-anahtarı tabanlı olduğu için motor, seçici ve
      kaydedilen görünüm tarafında tek satır değişmedi. Ad hücreleri yalnızca
      filtrelenebilir bir sütun alanı varken çiziliyor — renderer'ın "geri çağrı yoksa
      denetim yok" kuralı, artık hücre düzeyinde. Excel çıktısı çizilen tablodan
      okunduğu için ad satırı oraya da gidiyor
- [x] Filtre operatörleri — `Equals` (varsayılan), `Contains`, `StartsWith`,
      `EndsWith`, `Between`, `GreaterThan`, `LessThan`, `Blank`. Operatör ayrı bir
      kavram değil: `PivotFilter.Values` operatörün argüman listesi olarak ikinci
      bir görev üstleniyor. "İçermez"/"boş değil" için ayrı operatör yok —
      `Exclude` modu hangi operatör kullanıldıysa onu olumsuzluyor. Seçicide
      koşul satırı, `<pivot-filter operator="...">` ile bildirim, gruplu
      seviyelerde de çalışıyor
- [x] Top-N — `<pivot-top-n field="Region" count="3" />`. Diğer filtrelerden farkı
      **toplama sonrası** çalışması: karşılaştırdığı gruplar kayıtlar toplanana
      kadar var olmuyor. Üç karar: sayı tablo genelinde değil **her üst grubun
      içinde** sayılıyor (yoksa tek bir bölge bütün kotayı doldururdu); elenen
      satırlar sonuçtan **tümüyle** çıkıyor, yani genel toplam ekrandaki
      satırların toplamına eşit; toplamı çıkarmayla düzeltmek yerine kayıtlar
      bir kez daha taranıyor, çünkü bir alt kümenin ortalaması parçalarının
      ortalamalarından geri çıkarılamaz. Hiçbir şeye toplanmayan grup her iki
      yönde de sonda; eşitlikler etikete göre bozuluyor, böylece aynı veri her
      zaman aynı satırları veriyor (büyük veri uç noktası sonucu önbelleğe
      alıyor). `value-key` ile sıralayan ölçü, `mode="Bottom"` ile diğer uç
      seçiliyor
- [x] Tarih aralığı filtreleri — motor tarafı `Between` ile zaten çalışıyordu;
      eksik olan seçicideki kontroldü. Argüman kutusu artık tarih tutan bir
      alanda `<input type="date">`. Bu kozmetik değil: takvim `2026-06-05`
      döndürüyor ve karşılaştırmanın iki tarafının da tarih olarak okuduğu tek
      yazım bu — metin kutusuna `05.06.2026` yazan bir okuyucu **metin**
      karşılaştırması alıyordu. Hangi alanın takvim alacağı bildirilmiyor,
      **değerlerin kendisinden** okunuyor: motor da aynı şekilde karar veriyor,
      yani veriyle anlaşmak motorla anlaşmak demek. Sayı tarihten önce
      deneniyor, bu yüzden `2024` bir yıl değil sayı; gruplu seviyeler de
      kendiliğinden çözülüyor (`Haziran` ve `Pazartesi` iki taraf için de tarih
      değil). Zaten yazılmış ama takvimin gösteremeyeceği bir argüman silinmek
      yerine metin kutusunda kalıyor

- [x] `hideEmptySummaryCells` — hiç veri düşmeyen satır ve sütunları düşürür.
      Sütun ekseni seviyelerinin çarpımı olduğu için seyrek veride hiç
      gerçekleşmemiş sütunlar kalır; satır ekseni yalnızca verinin gösterdiğini
      üretir, oradaki boşluk değerlerin tümünün null'a toplanmasıdır. Eleme
      tarayıcıda değil **motorda** yapılıyor: sayfalama, Excel ve detay listesi
      hangi satırların var olduğu konusunda aynı şeyi söylesin diye

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
| CSV dışa aktarma | ✅ |
| Dışa aktarılan hücreyi özelleştirme (`onExporting`) | ❌ |
| PDF / yazdırma | ❌ |

- [x] CSV dışa aktarma — `widget.exportToCsv()` + `PivotForge.download()`.
      Excel'in gönderdiği aynı dışa aktarma modelinden üretiliyor, yani ikisi
      ayrışamıyor; birleşik hücreler açılıyor ve her satır en genişe göre
      dolduruluyor. `delimiter` ve `values: "raw"` seçenekleri var.
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
- [x] `state-storing` koşullu biçimlendirme kurallarını taşıyor — okuyucunun
      eklediği kural yenilemeden sağ çıkıyor. Saklanan liste bildirilenlerin
      yerine geçiyor (eklenmiyor): kayıt anında bildirilenler zaten listedeydi,
      eklemek her yenilemede onları çoğaltırdı ve temizlenen bir kural geri
      gelirdi. Renderer'ın işleyemeyeceği kural tek tek atılıyor,
      `PivotForge.isConditionalRule` ile.

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
- [x] **Varsayılan dil İngilizce** — dört bileşenin (tablo, tasarımcı, filtre
      seçici, detay modali) ekrana koyduğu her metin artık İngilizce. Türkçe bir
      **locale paketine** taşındı: `js/pivot-locale-tr.js` sayfaya eklendiğinde
      metinler geri geliyor. Paket adı `CultureInfo.CurrentUICulture`'dan
      türetiliyor, yani request localization yapılandırılmış bir uygulama hiçbir
      grid bunu bildirmeden kendi dilinde çalışıyor; `locale` niteliği sabitliyor.
      Paketi bulunmayan bir ad grid'i düşürmüyor — konsola uyarı yazıp İngilizce
      kalıyor, çünkü eksik bir çeviri dosyası sayfayı kaybetmeye değmez
- [x] `designerLabels` — tasarımcının etiketlerinin ilk bildirimsel yolu
      (öncesinde hiç yoktu), `designerLabels.filterPicker` ile değer seçiciye de
      ulaşıyor
- [ ] `.NET` tarafında `IStringLocalizer` entegrasyonu — locale paketi elden
      yazılmak yerine kaynak dosyalarından üretilsin
- [ ] İngilizce dışında ikinci bir paket (en yakın aday: `pivot-locale-de.js`),
      paket şemasının gerçekten dile bağımsız olduğunu kanıtlamak için

---

## Bölüm 10 — Paket olgunluğu

DevExpress denkliğinden gelmeyen, "yayınlanabilir paket" tarafındaki açıklar.

- [x] **Uç noktalarda alan beyaz listesi** — `PivotForgeOptions.AllowedFields`.
      Öncesinde uç noktalar tarayıcının bildirdiği her alan adını okuyordu:
      kaynak nesnede rapora ait olmayan bir özellik varsa satır başlığı olarak
      ekrana gelebiliyordu, üstelik detay listesi zaten **tüm kaydı** geri
      veriyordu. Liste iki işi birden yapıyor: bildirilmeyen alanı adlayan istek
      reddediliyor (hangi alan olduğunu söylemeden — söylemek, uç noktayı
      "kayıtta şu alan var mı" sorusunun cevabına çevirirdi) ve drill-down
      yalnızca listedeki alanları döndürüyor. Boş liste eski davranış, yani
      yükseltmede kimsenin sayfası bozulmuyor
- [x] `Directory.Build.props` — ortak derleme ayarları kökte, paketleme meta
      verisi `src/` altında. İki csproj'da geriye yalnızca gerçekten farklı olan
      kaldı: `PackageId`, `Title`, `Description`, `PackageTags`.
- [x] `Directory.Packages.props` — test paketlerinin sürümü tek yerde. `src/`
      altındaki iki paket burada hiç geçmiyor ve bu bilinçli: ikisinin de
      `PackageReference`'ı yok, buraya düşecek ilk satır tüketiciye miras
      kalacak bir bağımlılık olurdu. `artifacts/` kendi dosyasıyla dışarıda
      bırakıldı — smoke projeleri yayınlanmış bir sürümü sabitlemeli.
- [x] `CHANGELOG.md` — Keep a Changelog biçiminde, on dört sürümün tamamı.
      `PackageReleaseNotes` artık metni kopyalamak yerine buraya bağlanıyor;
      yayın akışına da etiketlenen sürümün günlükte tarihli bir bölümü olduğunu
      doğrulayan bir adım eklendi.
- [x] `net8.0;net10.0` çoklu hedefleme — `net8.0` taban olarak kalıyor (LTS ve
      ilk önizlemeden beri gönderilen), kimse düşmüyor. Test projeleri de aynı
      iki hedefe alındı: gönderilen ikili test edilmeliydi. `net8.0` ASP.NET
      testleri ASP.NET Core 8 runtime'ı istiyor — CI'de var, yerel makinede
      `DOTNET_ROLL_FORWARD=LatestMajor` ile çalıştırılabiliyor.
- [ ] `IQueryable` / EF Core sağlayıcısı — bugün her şey belleğe çekiliyor
- [ ] Blazor bileşeni
- [ ] Benchmark'lar (BenchmarkDotNet)
- [ ] Yayınlanmış demo / doküman sitesi

---

## Önerilen sıra

Sizin önceliğiniz "az kodla çok iş" olduğu için sıralama işlevsel büyüklüğe göre değil,
**bildirimsel kapsamı en hızlı büyüten** işe göre:

1. **Bölüm 0** — bildirimsel yüzey. Yeni özellik yok, mevcut motorun önüne bildirim.
   Tag helper'ı kendi kendine yeterli hale getiren tek adım bu.
2. **Bölüm 1'in ucuz kalemleri** — `show-as`, `area-index`, `expanded`, alan başına toplamlar.
3. ~~**Bölüm 2** — filtreleme.~~ Tamamlandı.
4. **Bölüm 8** — ~~dokunmatik + klavye + ARIA~~ tamam; kalan yalnızca mobil düzen.
5. **Bölüm 3** — hesaplanmış alanlar. En büyük tasarım işi, en sona.

---

## Kaynaklar

- [dxPivotGrid Configuration — DevExtreme API Reference](https://js.devexpress.com/jQuery/Documentation/ApiReference/UI_Components/dxPivotGrid/Configuration/)
- [PivotGridDataSource fields — DevExtreme API Reference](https://js.devexpress.com/jQuery/Documentation/ApiReference/Data_Layer/PivotGridDataSource/Configuration/fields/)
- [JavaScript Pivot Grid — DevExtreme genel bakış](https://js.devexpress.com/overview/pivotgrid/)
- [Pivot Grid — DevExpress ASP.NET Core belgeleri](https://docs.devexpress.com/AspNetCore/400790/devextreme-based-controls/controls/pivot-grid)
- [Integrated Field Chooser — ASP.NET Core demo](https://demos.devexpress.com/aspnetcore/Demo/PivotGrid/IntegratedFieldChooser/)
