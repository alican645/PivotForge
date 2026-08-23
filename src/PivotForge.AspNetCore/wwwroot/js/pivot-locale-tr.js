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
        filterActive: "{0} filtresi etkin"
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
