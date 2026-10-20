# 09 — Stil ve Tema (Fluent Blue Light)

> **Kaynak:** `https://cdn3.devexpress.com/jslib/26.1.3/css/dx.fluent.blue.light.css` (802.385 bayt, build 10 Haziran 2026). Projede kullanılan tema bu.
> **Yöntem:** CSS iç içe `@` kurallarını da çözen bir ayrıştırıcıyla 5.398 kurala bölündü. Seçicisinde PivotGrid sınıfı geçen **190 kural** ayıklanıp tek tek okundu. DevExtreme CSS'i kopyalanmadı; değerler tablolar halinde özetlendi. Örnek CSS'ler bu proje için yazıldı.

Sınıfların hangi koşulda eklendiği için bkz. [06](06-arayuz-bilesenleri.md#2-alan-türleri). Bu dosya o sınıfların **nasıl göründüğünü** anlatır.

---

## 1. En önemli bulgu: tema değişkenleri PivotGrid'i etkilemiyor

Fluent teması `:root` altında 38 CSS değişkeni tanımlıyor (`--dx-color-primary`, `--dx-color-border`, `--dx-color-text`, `--dx-font-size`…). Ancak temanın bileşen kurallarında **hiçbir yerde `var(--dx-color-…)` kullanılmıyor**. Tüm dosyada `var(--dx-…)` geçen yalnızca 5 kural var ve bunlar CardView ile Scheduler'a ait. PivotGrid kurallarındaki renkler derleme sırasında **sabit değer** olarak yazılmış.

Sonuç:
- `:root { --dx-color-border: red; }` yazmak PivotGrid'in kenarlıklarını **değiştirmez**.
- Görünümü değiştirmenin yolları:
  1. Seçicileri doğrudan ezmek (§10),
  2. DevExpress ThemeBuilder ile özel tema derlemek,
  3. Başka bir hazır tema dosyası seçmek (`dx.fluent.blue.dark.css`, `dx.material.*`, `dx.generic.*`…).

Tanımlı değişkenler (başka bileşenlerde veya kendi CSS'inizde kullanmak için):

| Değişken | Değer |
|---|---|
| `--dx-component-color-bg` | `#ffffff` |
| `--dx-color-main-bg` | `#fafafa` |
| `--dx-color-primary` / `--dx-color-link` | `#0f6cbd` |
| `--dx-color-danger` | `#d13438` |
| `--dx-color-success` | `#107c10` |
| `--dx-color-warning` | `#fde300` |
| `--dx-color-border` / `--dx-color-separator` | `#e0e0e0` |
| `--dx-color-text` | `#242424` |
| `--dx-color-icon` | `#616161` |
| `--dx-component-height` | `32px` |
| `--dx-font-size` | `14px` |
| `--dx-font-size-icon` | `20px` |
| `--dx-border-width` / `--dx-border-radius` | `1px` / `4px` |
| `--dx-line-height` | `1.428571` |
| `--dx-datagrid-row-alternation-bg` | `#f5f5f5` |

---

## 2. Renk paleti (PivotGrid'de kullanılan sabit değerler)

| Renk | Değer | Nerede |
|---|---|---|
| Arka plan | `#ffffff` | Widget, sütun/data başlık hücreleri, açıklama hücresi, **ara toplam (`dx-total`)**, field chooser alan listeleri, tree layout boşluk sütunu |
| Genel toplam arka planı | `#f5f5f5` | `.dx-grandtotal` (başlık ve veri hücreleri) |
| Metin | `#242424` | Tüm hücreler, sıralama/filtre ikonları, açma okları, alan kutuları, field chooser başlıkları |
| Kenarlık | `#e0e0e0` | Tüm hücre kenarlıkları, grup bağlayıcı çizgisi, alan kutusu kenarlığı, field chooser listeleri |
| Alan kutusu arka planı | `#f0f0f0` | Field panel / field chooser'daki alan butonları |
| Sürüklenen kutu | `#f0f0f0` (%90 opak) | `.dx-drag` altındaki alan kutusu |
| Boş alan metni | `#707070` | "Alanları buraya bırakın" metni (`dx-empty-area-text`) |
| Vurgu (primary) | `#0f6cbd` | **Aktif filtreli** alanın filtre ikonu, sürükleme hedefi kenarlığı |
| Bırakma çizgisi | `gray` | Sürüklerken konum göstergesi |

Gölgeler:
- Sürüklenen alan kutusu: `0 3px 4px rgba(0,0,0,.15)` (aynı kuralda daha önce yazılmış `0 0 1px …, 0 1px 3px …` gölgesini ezer).
- Sürüklenen kaynak: `opacity: .5`. Sürükleme kapsayıcısı (`.dx-drag`): `opacity: .8`.

> **Ara toplamlar arka planla aynı renkte (beyaz);** yalnızca genel toplam gri. Ara toplamları ayırt eden şey üst ve alt kenarlıklardır (§5).

---

## 3. Tipografi

| Öğe | Boyut | Kalınlık | Not |
|---|---|---|---|
| Widget tabanı (`.dx-widget`) | 14px | 400 | Satır yüksekliği `1.428571`, renk `#242424` |
| Yazı tipi | — | — | `"segoe ui", -apple-system, BlinkMacSystemFont, "avenir next", avenir, "helvetica neue", "adwaita sans", cantarell, ubuntu, roboto, noto, helvetica, arial, sans-serif` |
| Veri hücreleri | **13px** | 400 | Başlıklardan 1px küçük |
| Satır / sütun başlıkları | 14px | **500** | Toplam başlıkları da aynı |
| Alan kutuları | 14px | 400 | Satır yüksekliği 20px |
| Field chooser alan başlıkları | 14px | 500 | **BÜYÜK HARF** (`text-transform: uppercase`) |
| İkon fontu | 14px (konteyner) / 20px (ikon) | — | `DXIcons` |

---

## 4. Yerleşim ve boşluklar

### 4.1 Tablo tabanı

- PivotGrid içindeki tüm `table/tr/td/th/thead/tbody` öğelerinde `margin`, `padding`, `border`, `outline` sıfırlanır.
- `border-collapse: collapse`, `border-spacing: 0`, `table-layout: auto` (boyut hesabından sonra JS bunu `fixed` yapar).
- Tüm `td`: `vertical-align: top`, `box-sizing: content-box`.
- `.dx-pivotgrid`: `width: 100%`, `position: relative`, `cursor: default`.
- `.dx-area-column-cell` ve `.dx-area-data-cell`: `width: 100%`. Sol sütun (satır başlıkları) içeriği kadar daralır, kalan genişliği veri alanı alır.
- `.dx-pivotgrid-area`: `white-space: nowrap`. `dx-word-wrap` varken `normal`, ancak açılır/sıralı başlık hücreleri yine `nowrap`; metin span'i sarılır, `inline-flex` olur.

### 4.2 Hücre iç boşlukları

| Hücre | `padding` |
|---|---|
| Tüm alan hücreleri | `10px 16px` |
| Açılır başlık (`dx-pivotgrid-expanded/collapsed`) | `10px 14px 10px 19px` |
| Açılır başlıktaki metin `span`'i | `0 5px 0 10px` |
| Son hücredeki genel toplam / satır toplamı başlığı | `padding-left: 22px` |
| Tree layout boşluk sütunu (`dx-white-space-column`) | `0`, genişlik **19px** |

Diğer ölçüler:
- Satır başlığı hücresi en az `50px` genişliğinde.
- Açma oku kapsayıcısı `14px` genişliğinde.
- Sıralama işareti (`dx-icon-sorted`): `14px` genişlik, `5px` sol boşluk.

### 4.3 Hizalama

| Alan | Yatay hizalama |
|---|---|
| Veri hücreleri | **sağ** |
| Sütun başlıkları | **orta** |
| Sütun başlığı, açılır olan | **sol** |
| Satır başlıkları | sol (varsayılan) |
| "Veri yok" metni (`dx-pivotgrid-nodata`) | Veri alanının tam ortası (`absolute` + `translate(-50%, -50%)`) |

---

## 5. Kenarlıklar

Tüm kenarlıklar `1px solid #e0e0e0`.

| Kural | Kenar |
|---|---|
| `dx-row-lines` (PivotGrid'de her zaman açık) | Her alan hücresinin **üstü**; veri alanının ilk satırında yok |
| Veri hücreleri | **Sol** kenar (ilk sütunda yok) → dikey çizgiler |
| Satır başlıkları | **Sağ** kenar (son hücrede yok), ilk satırda üst kenar yok |
| Açık satır başlığının satırı (`dx-expand-border`) | Üst kenar |
| Sütun başlıkları | **Dört kenar**; ilk sütunda sol, ilk satırda üst yok |
| Sütun başlıkları, dikey scroll varken (`dx-vertical-scroll`) | Sağ kenar |
| Ara/genel toplam satırları (`dx-row-total`) | **Üst ve alt** |
| Tree layout'ta `dx-total` | Alt kenar yok |
| Açıklama hücresi + satır başlık sütunu | Sağ (dikey ayırıcı) |
| Sütun başlık hücresi + açıklama hücresi + `dx-bottom-border` | Alt (yatay ayırıcı) |
| `showBorders: true` (`dx-pivotgrid-border`) | Dış çerçeve: sol, sağ, filtre başlığında üst, alt satırda alt |

> Görünen ızgara: yatay çizgiler `dx-row-lines` kuralından, dikey çizgiler veri hücresinin sol ve satır başlığının sağ kenarından gelir. `showBorders` yalnızca **dış çerçeveyi** ekler.

---

## 6. Açma okları ve ikonlar

| Durum | İkon | Glyph | Görünüm |
|---|---|---|---|
| Kapalı (`dx-pivotgrid-collapsed`) | `chevronright` | `\f010` | 20px DXIcons, `#242424`, 14px'lik kapsayıcıda dikey/yatay ortalanmış |
| Açık (`dx-pivotgrid-expanded`) | `chevrondown` | `\f016` | Aynı |
| Kapsayıcının kendi `::before`'u | `\f010` | — | `visibility: hidden` (yalnızca yer tutar) |
| RTL'de kapalı | — | — | Kapsayıcı `scaleX(-1)` ile yatay çevrilir |
| Özete göre sıralı başlık | `sorted` | `\f055` | Metnin sağında |
| Alan kutusunda artan / azalan | `sortup` / `sortdown` | `\f051` / `\f052` | 20×20px |
| Alan kutusunda filtre | `filter` | `\f050` | 20×20px; **aktif filtre `#0f6cbd`**, boş filtre `#242424` |

Açılır başlıklarda imleç `pointer`.

Toolbar ve field chooser ikonları (glyph kodlarıyla): `columnchooser` `\f04d`, `xlsxfile` `\f117`, `columnfield` `\f057`, `rowfield` `\f058`, `filter` `\f050`, `formula` `\f056`, `hierarchy` `\f124`, `detailslayout` `\f10b`, `smalliconslayout` `\f119`, `sortuptext` `\f053`, `sortdowntext` `\f054`, `menu` `\f00c`.

---

## 7. Toolbar ve field panel

### 7.1 Toolbar (`dx-pivotgrid-toolbar`)

| Konum | Stil |
|---|---|
| Sütun/filtre başlığında | Sağa yaslı (`float: right`), `margin-right: 10px`, `z-index: 1`; butonların üstünde `10px` boşluk, alan seçici butonu ile export butonu arasında `4px` |
| Açıklama hücresinde (field panel kapalıyken) | `padding-left: 8px`, butonlarda `1px` boşluk. Butonlar hover/active olmadıkça **şeffaf**: kenarlık, arka plan ve gölge yok |

RTL'de toolbar sola yaslanır.

### 7.2 Field panel başlıkları

| Öğe | Stil |
|---|---|
| Alan başlık satırı hücreleri | `padding: 14px 2px`; ilk hücrede soldan, son hücrede sağdan `10px` |
| Filtre başlığı | Alanlar arası `border-spacing: 8px 12px` (`separate`), hücreler `2px` |
| Sütun başlığındaki alan listesi | `display: block`, taşma gizli |
| Boş alan metni | `5px 0` boşluk, şeffaf kenarlık, `#707070`, `nowrap` |
| Grup bağlayıcı (`dx-group-connector`) | 2×2px, `#e0e0e0`, dikey ortada; `-prev` solda, `-next` sağda |

### 7.3 Alan kutusu (`dx-area-field.dx-area-box`)

| Özellik | Değer |
|---|---|
| Arka plan | `#f0f0f0` |
| Kenarlık | `1px solid #e0e0e0` |
| Köşe yarıçapı | `6px` |
| İç boşluk | `5px 10px` |
| Alt boşluk | Field chooser'da `4px`, PivotGrid içinde `0` |
| Yazı | 14px / 20px, 400, `#242424` |
| Metin taşması | `ellipsis` (`overflow: hidden`) |
| İkonlar arası | Göstergeler metnin `6px` sağında |
| İmleç | `pointer` |

Sürükleme konum göstergesi `gray` renkte, `2px` kalınlığında; yatayda `-3px`, dikeyde `-4px` kaydırılarak çizilir.

---

## 8. Field chooser

| Öğe | Stil |
|---|---|
| Kapsayıcı | `display: flex`, `height: 100%`, taşma gizli |
| Layout 0 ve 2 | Dikey flex (`column`) |
| Satırlar (`dx-row`) | Yatay flex. Layout 0/1'de birinci satır `flex-grow: 2`, ikinci `1`; layout 2'de birinci `3`, ikinci `4` (sarmalı) |
| Sütunlar (`dx-col`) | `%50` genişlik, dikey flex |
| Alan kutusu (`dx-area`) | `5px` iç boşluk, dikey flex, `flex-grow: 1` |
| Alan listesi (`dx-area-fields`) | `1px #e0e0e0` kenarlık, `8px` üst boşluk; `[group]` olanlar beyaz ve `5px` boşluklu |
| Sürükleme hedefi listesi | Kenarlık `#0f6cbd` |
| Alan başlığı (`dx-area-caption`) | 14px, 500, BÜYÜK HARF, `#242424` |
| Alan ikonu | 20×20px |
| TreeView öğesi | En az `36px` yükseklik, `9px 8px` boşluk; ikon 20px, sağında `5px` boşluk |
| TreeView araması | `5px` dış boşluk |
| Onay kutulu yaprak | Kök seviyede onay kutusu `8px`, açık klasörde `42px` soldan; açık klasörde öğe `20px` girintili |

Popup içeriği (`.dx-pivotgrid .dx-popup-content`): `10px` iç boşluk.

---

## 9. Sanal kaydırma ve diğer durumlar

| Durum | Stil |
|---|---|
| `dx-virtual-content` | Normalde gizli; `dx-virtual-mode`'da `relative` ve `block`, taşma gizli |
| Sanal moddaki tablolar | `position: absolute` (JS `top`/`left` ile konumlar) |
| Sahte tablo (sanal içerik içindeki klon) | Hücre metinleri gizli, renk ve arka plan şeffaf. Yalnızca ızgarayı gösteren bir iskelet gibi durur |
| `dx-overflow-hidden` | `overflow: hidden` |
| `dx-incompressible-fields` (ölçüm anı) | Alan kutuları sarılmaz, field panel `table-cell` olur |
| Scrollbar ölçüm elemanı | `-9999px`'te 100×100px `overflow: scroll` |
| `dx-pivotgrid-drag-action` | `touch-action: pinch-zoom` (dokunmatikte sürükleme ile kaydırma çakışmasın) |
| Sağ tık alt menüsü | `width: auto` |

RTL (`dx-rtl`) için 29 ayna kural var: kenarlıklar, toolbar, boşluklar, grup bağlayıcılar, açma okları ve sıralama işareti karşı tarafa alınır.

---

## 10. Projede özelleştirme

Tema değişkenleri işe yaramadığı için seçicileri ezmek gerekir. Kurallar tema dosyasından **sonra** yüklenmeli ve en az tema kadar özgül olmalı (`.dx-pivotgrid …`). Bu projede en uygun yer `Views/Home/Index.cshtml` içindeki `@section Styles` bloğu (tema `<link>`'inin altı) ya da ayrı bir `wwwroot/css/pivot-theme.css` dosyası.

Kapsamı yalnızca bu grid ile sınırlamak için `#salesPivot` ön ekini kullanın.

### 10.1 Renkleri tek yerden yönetmek

```css
/* Project-level tokens; DevExtreme rules use hardcoded values, so they are re-applied below */
#salesPivot {
    --pivot-border: #e0e0e0;
    --pivot-text: #242424;
    --pivot-grandtotal-bg: #eef4fb;
    --pivot-total-bg: #f7f9fc;
    --pivot-accent: #0f6cbd;
}

#salesPivot.dx-pivotgrid .dx-grandtotal { background-color: var(--pivot-grandtotal-bg); font-weight: 600; }
#salesPivot.dx-pivotgrid .dx-total { background-color: var(--pivot-total-bg); }
#salesPivot.dx-pivotgrid .dx-pivotgrid-area td { color: var(--pivot-text); }
```

### 10.2 Daha sıkı (kompakt) tablo

```css
/* Default padding is 10px 16px; expandable headers use 10px 14px 10px 19px */
#salesPivot.dx-pivotgrid .dx-pivotgrid-area td { padding: 6px 10px; }
#salesPivot.dx-pivotgrid .dx-pivotgrid-area td.dx-pivotgrid-expanded,
#salesPivot.dx-pivotgrid .dx-pivotgrid-area td.dx-pivotgrid-collapsed { padding: 6px 8px 6px 19px; }
```

> Boşluğu değiştirdikten sonra PivotGrid ölçüleri yeniden hesaplamalı. Stil sayfa yüklenirken mevcutsa sorun olmaz; sonradan eklenirse `pivotGrid.updateDimensions()` çağırın. Açma okunun konumu `19px` sol boşluğa göre hesaplandığı için bu değeri küçültmeyin.

### 10.3 Negatif kârı kırmızı göstermek

CSS tek başına değere göre seçim yapamaz; `onCellPrepared` ile sınıf eklenir:

```js
// Mark negative profit cells so CSS can style them
onCellPrepared(e) {
    if (e.area === 'data' && e.cell.dataType === 'number' && e.cell.value < 0) {
        e.cellElement.classList.add('pivot-negative');
    }
}
```

```css
#salesPivot.dx-pivotgrid .dx-pivotgrid-area-data td.pivot-negative { color: #d13438; }
```

### 10.4 Zebra satırlar

```css
/* Alternate data rows; totals keep their own background */
#salesPivot.dx-pivotgrid .dx-pivotgrid-area-data tbody tr:nth-child(even) td:not(.dx-total):not(.dx-grandtotal) {
    background-color: #fafafa;
}
```

> Satır başlıkları ayrı bir tabloda olduğu için aynı şeridi satır başlıklarına uygulamak `rowspan`'li hücreler yüzünden güvenilir değildir. Yalnızca veri alanına uygulayın.

### 10.5 Başlık ve veri yazı boyutunu eşitlemek

```css
/* Theme uses 13px for data and 14px/500 for headers */
#salesPivot.dx-pivotgrid .dx-pivotgrid-area.dx-pivotgrid-area-data { font-size: 14px; }
```

### 10.6 Field panel alan kutuları

```css
#salesPivot .dx-area-field.dx-area-box { border-radius: 4px; background-color: #fff; }
#salesPivot .dx-area-field.dx-area-box .dx-header-filter:not(.dx-header-filter-empty) { color: #d13438; }
```

### 10.7 Koyu tema

Değişkenler kullanılmadığı için koyu mod CSS ile türetilemez. Bunun yerine tema dosyası değiştirilmeli:

```html
<link rel="stylesheet" href="https://cdn3.devexpress.com/jslib/26.1.3/css/dx.fluent.blue.dark.css"/>
```

Çalışma anında geçiş en güvenli şekilde tema dosyası değiştirilip sayfa yenilenerek yapılır. PivotGrid boyutları ve ikon genişlikleri temaya göre ölçüldüğü için tema değişince grid'in yeniden render edilmesi gerekir.

---

## 11. Kural envanteri (190 kural)

| Grup | Kural sayısı | İçerik |
|---|---|---|
| Widget ve tablo tabanı | ~20 | Sıfırlama, genişlikler, `nowrap`, word-wrap istisnaları |
| Alanlar ve kenarlıklar | ~30 | Row lines, veri/başlık kenarlıkları, toplam satırları, `showBorders` çerçevesi |
| Tipografi ve renk | ~10 | 13/14px, 500 kalınlık, `#242424`, `#f5f5f5` genel toplam |
| Açma okları ve ikonlar | ~12 | DXIcons glyph'leri, konumlama, sıralama işareti |
| Toolbar ve field panel | ~25 | Butonlar, boşluklar, grup bağlayıcılar, boş alan metni |
| Alan kutuları ve sürükleme | ~20 | Kutu görünümü, sürükleme opaklığı ve gölgesi, konum göstergesi |
| Field chooser | ~35 | Flex layout'lar, alan listeleri, TreeView ayarları |
| Sanal mod ve yardımcılar | ~9 | Sanal içerik, sahte tablo, scrollbar ölçümü |
| RTL | 29 | Ayna kurallar |
