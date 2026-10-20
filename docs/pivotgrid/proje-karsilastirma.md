# PivotForge — tersine mühendislik dokümanlarıyla karşılaştırma

Tarih: 18 Ekim 2026. Kaynak: bu klasördeki 01–09 dokümanları ve mevcut `src/`, `tests/` kodu.

Bu inceleme mevcut işlevsel karşılıkları gösterir; özelliklerin bu dokümanlardan hareketle geliştirildiğini veya DevExtreme ile birebir uyumlu olduğunu kanıtlamaz. “Var” temel davranışın kodda bulunduğu, “Kısmi” ise kapsam/API farklarının bulunduğu anlamına gelir. DevExtreme'e özgü iç sınıflar ve REA istatistikleri ürün özelliği olarak sayılmadı. Dokümanlardaki “bu projede kullanılıyor” ifadeleri tek başına kanıt kabul edilmedi.

## Eklenmiş işlevler

| Dokümandaki özellik | Projedeki karşılığı / kanıt |
|---|---|
| Çok seviyeli satır ve sütun gruplama, çoklu ölçü | `src/PivotForge.Core/PivotEngine.cs`, `PivotRequest.cs`; tarayıcıda `pivot-table.js` |
| Sum, count, min, max, average | `src/PivotForge.Core/PivotAggregation.cs`, `Aggregation/AggregateState.cs` |
| Yıl, çeyrek, ay, gün, haftanın günü gruplama | `PivotGroupInterval.cs`, `Grouping/PivotGroupLabels.cs`; `PivotGroupIntervalTests.cs` |
| Sayısal aralıklara gruplama | `PivotFieldRef.BinSize`, `PivotGroupInterval.Range`; `PivotRangeGroupingTests.cs` |
| Alan veri tipi | `PivotDataType.cs`, `PivotRequest.DataTypes`; `PivotDataTypeTests.cs` |
| Include/exclude filtreleri, değer arama ve tümünü seçme | `PivotFilter.cs`, `Grouping/PivotFilterPredicates.cs`, `pivot-filter-picker.js` |
| Diğer filtrelere göre ilgili değerleri listeleme | `pivot-widget.js` içindeki `showRelevantValues`, `/field-values`; `tests/e2e/relevant-values.spec.js` |
| Alan bazında artan/azalan sıralama | `PivotSort.cs`, `PivotEngine.SortRows/SortColumns`; `PivotFieldSortByValueTests.cs` |
| Özete ve karşı eksen yoluna göre sıralama | `PivotFieldBuilder.SortByValueKey/SortBySummaryPath`, `PivotEngine.ResolveGroupValues`; `PivotSortBySummaryTests.cs` |
| Satır/sütun ara toplamları ve genel toplamları | `PivotResult.cs`, `pivot-table.js`; `PivotColumnSubtotalTests.cs`, `tests/e2e/grand-totals.spec.js` |
| Boş özet satır/sütunlarını gizleme | `PivotRequest.HideEmptySummaryCells`, `PivotEngine.DropEmpty`; `PivotHideEmptyTests.cs` |
| Ölçüleri satırlara veya sütunlara yerleştirme | `PivotGridBuilder.ValuesPosition`, `pivot-table.js`; `tests/e2e/values-on-rows.spec.js` |
| Ağaç düzeni | `PivotGridBuilder.LayoutMode`, `pivot-table.js`; `tests/e2e/tree-layout.spec.js` |
| Satır/sütun genişletme-daraltma, tümünü açma-kapama | `pivot-table.js` içindeki `expandAll/collapseAll`; `tests/e2e/column-collapse.spec.js`, `toolbar.spec.js` |
| Alan görünürlüğü, sırası, başlangıç açılımı, toplam gösterimi | `PivotFieldBuilder.Visible/AreaIndex/Expanded/ShowTotals/ShowGrandTotals`; `tests/e2e/field-options.spec.js` |
| Alan bazında filtreleme/sıralama izni, genişlik ve satır kaydırma | `PivotFieldBuilder.AllowSorting/AllowFiltering/Width/WordWrap`; `tests/e2e/field-presentation.spec.js` |
| Sayı/para/yüzde formatlama ve özel metin | `PivotFieldBuilder` format metotları ve `CustomizeText`; `tests/e2e/customize-text.spec.js` |
| Satır, sütun ve genel toplam yüzdeleri | `PivotShowAs.cs`; isim eşlemesine aşağıda dikkat edilmeli |
| Üst satır/sütun grubu yüzdeleri | `PercentOfParentRowTotal`, `PercentOfParentColumnTotal`; `PivotParentShareTests.cs` |
| Önceki değerden fark ve yüzde fark | `DifferenceFromPrevious`, `PercentDifferenceFromPrevious`; `PivotEngine.cs` |
| İki yönde birikimli toplam ve grup sınırı kontrolü | `PivotRunningTotal.cs`, `PivotRunningTotals.cs`, `AllowCrossGroupCalculation`; `PivotRunningTotalTests.cs` |
| Drill-down | `/drill-down`, `pivot-drill-down.js`, `pivot-drill-down-modal.js` |
| Satır sanallaştırma, sayfa önbelleği ve önden yükleme | `pivot-virtual-data-source.js`, `/large/start`, `/large/page` |
| Sütun sanallaştırma | `PivotGridBuilder.VirtualColumns`, `pivot-table.js` içindeki sütun penceresi ve boşluk hücreleri |
| Yükleme göstergesi | `pivot-widget.js`: `loadPanel`, `loadPanelDelay`; `tests/e2e/load-panel.spec.js` |
| Sağ tık menüleri ve toolbar | `pivot-table.js`, `pivot-widget.js`; `tests/e2e/header-menu.spec.js`, `toolbar.spec.js` |
| RTL, kenarlıklar, yerelleştirme | `pivotforge.css`, `RtlEnabled`, `ShowBorders`, `Locale/Culture`, `pivot-locale-tr.js` |
| Excel export temel yetenekleri | `PivotExcelExporter.cs`: başlık birleştirme, genişlikler, sayı formatları, donmuş başlıklar, RTL; `PivotExcelExporterTests.cs` |
| Export öncesi değiştirme/iptal | `pivot-widget.js` içindeki `emitExporting`: belge hücrelerini değiştirme, dosya adını belirleme, `cancel` |

Tablodaki JS dosyaları `src/PivotForge.AspNetCore/wwwroot/js/`, builder dosyaları `src/PivotForge.AspNetCore/Rendering/`, C# testleri `tests/PivotForge.Core.Tests/` altındadır.

## Kısmi veya farklı uygulanmış alanlar

| Alan | Mevcut | Fark / eksik |
|---|---|---|
| Field chooser / field panel | `pivot-field-designer.js`: arama, klasörler, dört alan bölgesi, sürükle-bırak ve ayarlar | DevExtreme'in popup chooser'ı, layout 0/1/2 seçenekleri ve ayrı field-panel API'si yok. |
| On-demand değişiklik uygulama | `deferLayoutUpdate`, `applyPending()` | Güncellemeyi erteleyip uygulama var; dokümandaki popup OK/Cancel ve kapanınca geri alma sözleşmesi yok. |
| Custom summary | `PivotEngine.CustomAggregates`, `PivotCustomAggregate` | C# tarafında değer listesi alan delegate var; JavaScript `start/calculate/finalize` callback sözleşmesi yok. |
| `calculateSummaryValue` | Hesaplanan alanlar, gizli bağımlılıklar ve `PivotRelativeFormulas.cs` üzerinden PREV/NEXT, parent, total ve SLICE karşılıkları | Genel `Cell` nesnesi, `children/child`, `field`, `isPostProcessed`, orijinal/işlenmiş değer seçimi API'si yok. SLICE bir üye ofseti kullanıyor; DevExtreme doğrudan hedef değer alıyor. |
| Toplamların konumu | `totalsPosition: before/after` | Satır ara toplamlarının konumu ayarlanıyor. `showTotalsPrior: rows/columns/both` ile iki ekseni bağımsız kontrol etme karşılığı yok; sütun ara toplamları grup sonrasında. |
| Sıralama seçenekleri | Başlık ve özet sıralama var | `sortingMethod` callback'i ve `sortBy: displayText/value/none` sözleşmesi yok. Standart modda başlık sıralaması da sunucuda çalışıyor; DevExtreme'in `sortLocal` davranışıyla aynı değil. |
| State saklama | `pivot-widget.js`: local/session, sürümlü JSON, alan düzeni, filtreler, sıralama, koşullu kurallar ve grafik | `customLoad/customSave`, `savingTimeout`, `visibilitychange` flush yok. Widget'ın `snapshotState()` çıktısı açılmış/kapanmış yolları içermiyor. Alt düzey renderer görünüm state'i ile otomatik widget kalıcılığı ayrı değerlendirilmelidir. |
| Grafik | `pivot-chart.js`: sütun, yığılmış sütun, çubuk, çizgi; ölçü seçimi | Bir seçili ölçü, varsayılan en fazla 8 seri, en dış grup seviyeleri kullanılıyor. `bindChart`, split panes, çoklu değer ekseni ve `processCell/customizeSeries/customizeChart` sözleşmesi yok. |
| Excel ayrıntıları | Birleştirme, genişlik, stiller ve hücre düzenleme var | ExcelJS kullanılmıyor; sunucuda OOXML üretiliyor. `topLeftCell`, ayrı `export*FieldHeaders`, bağımsız `merge*FieldValues` seçenekleri yok. Hücre modeli metin/sayı; dokümandaki Date → UTC dönüşümü yok. Metinler `inlineStr` olarak yazılıyor. |
| Header filter gelişmiş seçenekleri | Arama, seçme, include/exclude, ilgili değerler var | `search.mode/timeout/editorOptions` biçiminde DevExtreme yapılandırması yok. |
| Olaylar ve public metotlar | Yükleme, hata, seçim, çift tıklama, export ve görünüm olayları var | `onCellPrepared`, `onContextMenuPreparing`, `applyPartialDataSource`, `getScrollPath` gibi birebir API'ler yok. |

## Bulunmayan veya bu mimaride karşılığı gerekmeyenler

- **XMLA / OLAP / SSAS:** XMLA store, SOAP, MDX üretimi, küp şeması keşfi ve drill-through bulunamadı.
- **Tarayıcı LocalStore motoru:** hesaplama C# `PivotEngine` içinde. JavaScript'te yerel aggregation ve 10.000 satır/300 ms zaman dilimleme uygulanmıyor.
- **DevExtreme RemoteStore protokolü:** `group/groupSummary/totalSummary` sorgu üretimi yerine PivotForge'un kendi HTTP istek modelleri kullanılıyor.
- **Otomatik alan keşfi ve DevExtreme alan birleştirme sözleşmesi:** widget alanları açıkça tanımlanıyor; `retrieveFields`, `groupName/groupIndex` hiyerarşi sözleşmesi bulunamadı.
- **`showValues` ölçü seçeneği:** `visible`, `showTotals`, `showGrandTotals` var; dokümandaki ayrı `showValues` davranışı bulunamadı.
- **DevExtreme ölçüm/render iç yapısı:** dört senkron scroll alanı, 66666 px yükseklik tespiti ve `renderCellCountLimit` erteleme mekanizması bulunamadı. Proje kendi tablo, sticky başlık ve sanal pencere yapısını kullanıyor.
- **Fluent Blue Light tema eşitliği:** 09'daki 190 CSS kuralı/ikon sistemi aktarılmış değil. Projenin `--pt-*` değişkenlerine dayanan kendi teması var; RTL ve kenarlık gibi davranışlar mevcut.
- **08 REA ekleri:** modül/fonksiyon/çağrı sayıları analiz çıktısıdır; uygulanacak özellik değildir.

## İsim ve varsayılan farkları

| DevExtreme | PivotForge |
|---|---|
| `percentOfColumnTotal` (üst satır grubuna oran) | `PercentOfParentRowTotal` |
| `percentOfRowTotal` (üst sütun grubuna oran) | `PercentOfParentColumnTotal` |
| `percentOfColumnGrandTotal` | `PercentOfColumnTotal` |
| `percentOfRowGrandTotal` | `PercentOfRowTotal` |
| `allowSorting/allowFiltering: false` | Varsayılan `true` |
| `hideEmptySummaryCells: true` | Varsayılan `false` |
| `showTotalsPrior: none` | Satır toplamları varsayılan `before` |
| State anahtarı verilmezse `storage` | `pivotforge:state:` + açık anahtar veya container ID; ikisi de yoksa kayıt yok |

Bu farklar nedeniyle yalnızca isim eşleştirerek özellik uyumluluğu kabul edilmemeli.

## Doğrulama

- `node --test tests/*.test.js`: **881 test geçti; 0 başarısız, 0 atlanan**.
- C# ve Playwright test dosyaları özellik kanıtı olarak incelendi. Playwright bu incelemede çalıştırılmadı.
- `dotnet test ... --no-restore -f net10.0` test sayısı/çalıştırma sonucu üretmeden tamamlandı; bu nedenle .NET testleri geçti olarak raporlanmıyor.
- Yeni özellik eklenmedi ve uygulama kodu değiştirilmedi. Bu rapor işlev envanteridir; tüm DevExtreme uç durumlarının dinamik uyumluluk testi değildir.

## Hesaplama uyumluluğu çalışması — sonraki güncelleme

Bu envanterden sonra gerçek DevExtreme 26.1.3 / Chromium 151.0.7922.34 üzerinde üretilen karşılaştırmalı testler eklendi. 275 hesaplama/sıralama senaryosu eşleşiyor; atlanan uyumluluk testi yok. Boş sum, eksik kayıt alanı, nötr sırada fark hesabı, sütun ara toplamlarının farkı, boş/eşit özet sıralaması ve NaN ortalama sıralaması düzeltildi. Bu sayı tüm widget özelliklerinin uyumluluk oranı değildir. Kapsam, referans hash farkı ve yeniden üretim adımları: [uyumluluk testleri](../../tests/compatibility/README.md).
