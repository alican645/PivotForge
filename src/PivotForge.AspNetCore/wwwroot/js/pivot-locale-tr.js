(function (root) {
  const PivotForge = root.PivotForge ??= {};
  const locales = PivotForge.locales ??= {};

  // Turkish. Registered rather than applied: a page loads this file and asks
  // for the locale by name, so a page with two pivots in two languages is a
  // matter of two options rather than two builds.
  //
  // The four sections match the four components that put text on screen. Each
  // is merged over that component's English defaults, so a key added upstream
  // and not translated yet degrades to English rather than to nothing.
  locales.tr = {
    // A partial rendererOptions object rather than only its texts, because a
    // locale legitimately owns presentation strings that live outside `texts`.
    table: {
      totalText: "Toplam",
      ariaLabel: "Pivot tablosu",
      texts: {
        rowLabels: "Satır Etiketleri",
        rowsHeading: "Satırlar",
        rowHeading: "Satır {0}",
        noData: "Veri yok",
        noValueFields: "Render edilecek bir değer alanı yok.",
        cellActions: "Hücre işlemleri",
        openDetails: "Detayı aç",
        copyCell: "Hücreyi kopyala",
        copyRow: "Satırı kopyala",
        sortByValue: "Bu değere göre sırala",
        filterByValue: "Bu değere göre filtrele",
        addConditionalFormat: "Koşullu biçimlendirme ekle",
        resizeColumn: "Sütun genişliğini değiştir",
        sortField: "{0} alanını sırala",
        sortActive: "{0} sıralaması aktif",
        filterField: "{0} alanını filtrele",
        filterActive: "{0} filtresi etkin",
        loading: "Yükleniyor..."
      }
    },
    designer: {
      available: "Alanlar",
      row: "Satırlar",
      column: "Sütunlar",
      data: "Değerler",
      filter: "Filtreler",
      remove: "Kaldır",
      search: "Alan ara...",
      format: "Biçim",
      settings: "Alan ayarları",
      filterValues: "Filtre değerleri",
      filterCount: "({0})",
      filterCountExcluded: "({0} hariç)",
      filterCondition: "({0})",
      filterConditionExcluded: "({0} değil)",
      operators: {
        Equals: "eşittir",
        Contains: "içerir",
        StartsWith: "ile başlar",
        EndsWith: "ile biter",
        Between: "arasında",
        GreaterThan: "büyüktür",
        LessThan: "küçüktür",
        Blank: "boş"
      },
      aggregation: "Değer ayarları",
      showAs: "Değerleri farklı göster",
      formatting: "Biçimlendirme",
      formatDecimals: "Ondalık basamak",
      fieldName: "Alan adı",
      rename: "Adı değiştir",
      resetName: "Sıfırla",
      position: "Konum",
      moveUp: "Yukarı taşı",
      moveDown: "Aşağı taşı",
      removeField: "Alanı kaldır",
      close: "Kapat",
      showAsLabels: {
        normal: "Normal",
        percentOfRowTotal: "Satır toplamının %'si",
        percentOfColumnTotal: "Sütun toplamının %'si",
        percentOfGrandTotal: "Genel toplamın %'si",
        differenceFromPrevious: "Öncekinden fark",
        percentDifferenceFromPrevious: "Öncekinden % fark",
        runningTotal: "Kümülatif toplam"
      },
      formatGrouping: "Binlik ayracı",
      formatTypes: {
        number: "Sayı",
        currency: "Para birimi",
        percent: "Yüzde"
      },
      lastValue: "Bir pivot en az bir değer alanı gerektirir.",
      aggregations: {
        sum: "Toplam",
        count: "Sayım",
        average: "Ortalama",
        min: "Minimum",
        max: "Maksimum"
      },
      calculatedField: "Hesaplanan alan",
      addCalculatedField: "Hesaplanan alan ekle",
      formula: "Formül",
      formulaHint: "+ - * / ve parantez kullanın. [Alan] alanın toplamıdır; Sum, Count, Avg, Min ve Max onu başka türlü özetler. Örnek: [Gelir] - [Gider]",
      insertField: "Alan ekle",
      save: "Kaydet",
      cancel: "Vazgeç",
      editFormula: "Formülü düzenle",
      deleteCalculatedField: "Hesaplanan alanı sil",
      formulaErrors: {
        noName: "Alana bir ad verin.",
        empty: "Bir formül yazın.",
        end: "Formül yarım kalmış.",
        unexpected: "'{0}' burada beklenmiyor.",
        bareWord: "Alan adlarını köşeli parantezle yazın: [{0}].",
        unclosed: "Bir alan adının kapanış ] işareti eksik.",
        emptyReference: "[] hiçbir alanı adlandırmıyor.",
        number: "'{0}' bir sayı değil.",
        argument: "{0}() köşeli parantezli bir alan alır, örneğin {0}([Tutar]).",
        expected: "'{0}' eksik.",
        unknownField: "[{0}] adında bir alan yok."
      },
      formulaBuilder: {
        pickField: "1. Bir alan seçin",
        pickOperator: "2. Bir işlem seçin",
        dropHere: "Bir alanı buraya sürükleyin ya da aşağıdan dokunun.",
        nextValue: "Sıradaki: bir alan ya da sayı ekleyin.",
        nextOperator: "Sıradaki: bir işlem seçin ya da Kaydet'e basın.",
        operators: {
          "+": "Topla",
          "-": "Çıkar",
          "*": "Çarp",
          "/": "Böl",
          "(": "Parantez aç",
          ")": "Parantez kapat"
        },
        number: "Sayı",
        addNumber: "Sayı ekle",
        invalidNumber: "'{0}' bir sayı değil.",
        undo: "Geri al",
        clear: "Temizle",
        removeToken: "Kaldır",
        summaryOf: "{0} nasıl özetlensin",
        typeFormula: "Formülü yazarak gir",
        useButtons: "Düğmelerle oluştur",
        cannotShow: "Bu formül düğmelerle gösterilemiyor; yazarak düzenlemeye devam edin."
      }
    },
    filterPicker: {
      title: "{0} filtresi",
      close: "Kapat",
      apply: "Uygula",
      cancel: "İptal",
      search: "Değerlerde ara",
      selectAll: "Tümünü seç",
      clear: "Temizle",
      blank: "(Boş)",
      operatorLabel: "Koşul",
      // What the value list asks is "one of these", which the designer's chip
      // does not need to say: it only names an operator other than this one.
      operators: {
        Equals: "şunlardan biri",
        Contains: "içerir",
        StartsWith: "ile başlar",
        EndsWith: "ile biter",
        Between: "arasında",
        GreaterThan: "büyüktür",
        LessThan: "küçüktür",
        Blank: "boş"
      },
      argument: "Değer",
      argumentFrom: "Başlangıç",
      argumentTo: "Bitiş",
      // The mode's only observable effect is on values the source does not have
      // yet, so the control says that rather than "include"/"exclude".
      modeLabel: "Sonradan eklenen değerler",
      modeInclude: "Gizlensin",
      modeExclude: "Gösterilsin",
      loading: "Değerler yükleniyor...",
      noValues: "Bu alan için değer bulunamadı",
      noMatches: "Aramayla eşleşen değer yok",
      failed: "Değerler alınamadı",
      summary: "{0} / {1} değer seçili",
      truncated: "İlk {0} değer gösteriliyor. Listede olmayan seçimler korunur."
    },
    conditionalPanel: {
      title: "Koşullu biçimlendirme",
      close: "Kapat",
      operatorLabel: "Koşul",
      operators: {
        greaterThan: "büyüktür",
        greaterThanOrEqual: "büyük veya eşittir",
        lessThan: "küçüktür",
        lessThanOrEqual: "küçük veya eşittir",
        equal: "eşittir",
        between: "arasındadır"
      },
      threshold: "Değer",
      threshold2: "İkinci değer",
      colorLabel: "Vurgu rengi",
      colors: {
        green: "Yeşil",
        amber: "Sarı",
        red: "Kırmızı",
        blue: "Mavi"
      },
      clear: "Ölçü kurallarını temizle",
      apply: "Kuralı ekle"
    },
    drillDown: {
      title: "Kaynak Kayıtlar",
      close: "Kapat",
      search: "Kayıtlarda ara",
      csv: "CSV",
      all: "Tümü",
      empty: "(Boş)",
      loading: "Kayıtlar yükleniyor...",
      noRecords: "Bu hücre için kaynak kayıt bulunamadı",
      noMatches: "Filtrelerle eşleşen kayıt yok",
      failed: "Kaynak kayıtlar alınamadı",
      allRows: "Tüm satırlar",
      allColumns: "Tüm sütunlar",
      truncated: "İlk {0} kayıt gösteriliyor.",
      summary: "{0} / {1} kayıt",
      columnFilter: "{0} filtresi"
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = locales.tr;
  }
})(typeof window !== "undefined" ? window : globalThis);
