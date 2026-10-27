/* TrackDesk — Demo Verisi
   localStorage boş iken (preview modunda her açılışta) yüklenir.
   Tüm tarihler BUGÜNE göre hesaplanır: demo hangi gün açılırsa açılsın
   bugünkü işlemler, dünkü kayıtlar, ileri tarihli planlar, vadesi bugün
   gelen, vadesi geçmiş, kısmi ödenmiş ve kapanmış kayıtlar hep bulunur.
   Her firma farklı bir senaryoyu temsil eder. */

(function () {
  const pad = (value) => String(value).padStart(2, "0");
  const toDateText = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  const today = new Date();
  today.setHours(12, 0, 0, 0);

  // Bugünden `offset` gün sonrası (negatif = geçmiş).
  const day = (offset) => {
    const date = new Date(today);
    date.setDate(date.getDate() + offset);
    return toDateText(date);
  };

  const thisYear = String(today.getFullYear());
  const previousYear = String(today.getFullYear() - 1);

  // Devir tahsilatları, devrin hedef yılından (bu yıl) önceye düşmesin.
  const dayInThisYear = (offset) => {
    const date = day(offset);
    return date < `${thisYear}-01-01` ? `${thisYear}-01-01` : date;
  };

  const item = (brand, product, quantity, unitPrice) => ({ product: `${brand} - ${product}`, quantity, unitPrice });
  const payment = (id, offset, amount, note) => ({ id, date: day(offset), amount, note });

  window.TRACKDESK_SEED_STATE = {
    catalog: [
      {
        brand: "Standart Seri",
        products: [
          "S-100 Standart Paket",
          "S-200 Ekonomik Paket",
          "S-500 Toplu Paket",
          "S-1000 Endüstriyel Paket",
        ],
      },
      {
        brand: "Premium Seri",
        products: [
          "P-50 Premium Mini",
          "P-100 Premium Standart",
          "P-250 Premium Plus",
          "P-500 Premium Endüstriyel",
        ],
      },
      {
        brand: "Hizmetler",
        products: [
          "Kurulum ve Montaj",
          "Periyodik Bakım",
          "Teknik Danışmanlık",
          "Acil Servis",
          "Özel Tasarım",
        ],
      },
    ],

    customers: [
      // Vadeli çalışan düzenli müşteri: bugün yeni sipariş, vadesi dün dolmuş
      // kısmi ödenmiş işlem, ileri tarihli plan ve kısmen tahsil edilmiş devir.
      {
        id: "00000001-0000-0000-0000-000000000001",
        name: "Alfa Ticaret Ltd. Şti.",
        contactPerson: "Ahmet Yılmaz",
        phone: "0532 111 22 33",
        taxNumber: "1234567890",
        address: "İstanbul, Kadıköy",
        note: "15 gün vadeli çalışır, genelde düzenli öder.",
        rollovers: [
          {
            id: "rollover-alfa",
            sourceYear: previousYear,
            targetYear: thisYear,
            amount: 10000,
            collectionMovements: [
              { id: "rollover-alfa-col-1", date: dayInThisYear(-20), amount: 4000, note: "Devir bakiyesinden kısmi ödeme" },
            ],
            note: `${previousYear} yılından devreden açık bakiye`,
            createdAt: `${thisYear}-01-02T09:00:00.000Z`,
          },
        ],
        ledgerEntries: [],
        transactions: [
          {
            id: "tx-alfa-today",
            date: day(0),
            items: [item("Standart Seri", "S-500 Toplu Paket", 20, 450)],
            stage: "created",
            collections: [],
            paymentDueDate: day(15),
            note: "Telefonla sipariş — öğleden sonra teslim",
          },
          {
            id: "tx-alfa-overdue",
            date: day(-16),
            items: [item("Premium Seri", "P-250 Premium Plus", 10, 1200)],
            stage: "delivered",
            collections: [payment("col-alfa-overdue", -10, 4000, "Kısmi ödeme — nakit")],
            paymentDueDate: day(-1),
            note: "15 gün vadeli, vadesi dün doldu",
          },
          {
            id: "tx-alfa-paid",
            date: day(-40),
            items: [item("Hizmetler", "Periyodik Bakım", 1, 6500)],
            stage: "delivered",
            collections: [payment("col-alfa-paid", -40, 6500, "Peşin")],
            paymentDueDate: "",
            note: "",
          },
          {
            id: "tx-alfa-future",
            date: day(3),
            items: [
              item("Standart Seri", "S-1000 Endüstriyel Paket", 5, 1200),
              item("Hizmetler", "Kurulum ve Montaj", 1, 1500),
            ],
            stage: "created",
            collections: [],
            paymentDueDate: day(18),
            note: "Planlı sevkiyat + kurulum",
          },
        ],
      },

      // Ödemeyi vade gününde yapan müşteri: ödeme günü BUGÜN olan işlem,
      // bugün teslim edilip parası alınmamış işlem, dünkü kısmi ödeme,
      // kapanmış devir.
      {
        id: "00000002-0000-0000-0000-000000000002",
        name: "Beta Gıda San. Tic. A.Ş.",
        contactPerson: "Fatma Kaya",
        phone: "0544 222 33 44",
        taxNumber: "2345678901",
        address: "Ankara, Çankaya",
        note: "Malı teslim alır, ödemeyi vade gününde yapar.",
        rollovers: [
          {
            id: "rollover-beta",
            sourceYear: previousYear,
            targetYear: thisYear,
            amount: 5000,
            collectionMovements: [
              { id: "rollover-beta-col-1", date: dayInThisYear(-30), amount: 5000, note: "Devir bakiyesi kapandı" },
            ],
            note: `${previousYear} yılından devreden bakiye`,
            createdAt: `${thisYear}-01-02T09:00:00.000Z`,
          },
        ],
        ledgerEntries: [],
        transactions: [
          {
            id: "tx-beta-due-today",
            date: day(-15),
            items: [item("Standart Seri", "S-200 Ekonomik Paket", 30, 350)],
            stage: "delivered",
            collections: [],
            paymentDueDate: day(0),
            note: "Ödeme günü bugün",
          },
          {
            id: "tx-beta-today",
            date: day(0),
            items: [item("Premium Seri", "P-100 Premium Standart", 8, 900)],
            stage: "delivered",
            collections: [],
            paymentDueDate: "",
            note: "Ürün verildi, para alınmadı",
          },
          {
            id: "tx-beta-yesterday",
            date: day(-1),
            items: [item("Standart Seri", "S-100 Standart Paket", 40, 150)],
            stage: "delivered",
            collections: [payment("col-beta-yesterday", -1, 2000, "Teslimatta kısmi ödeme")],
            paymentDueDate: day(14),
            note: "",
          },
          {
            id: "tx-beta-paid",
            date: day(-60),
            items: [item("Hizmetler", "Teknik Danışmanlık", 1, 15000)],
            stage: "delivered",
            collections: [payment("col-beta-paid", -55, 15000, "Havale")],
            paymentDueDate: "",
            note: "",
          },
        ],
      },

      // Peşin çalışan, açık hesabı olmayan müşteri.
      {
        id: "00000003-0000-0000-0000-000000000003",
        name: "Ceylan Tekstil A.Ş.",
        contactPerson: "Mustafa Çelik",
        phone: "0505 333 44 55",
        taxNumber: "3456789012",
        address: "İzmir, Konak",
        note: "Peşin çalışır, açık hesabı yok.",
        rollovers: [],
        ledgerEntries: [],
        transactions: [
          {
            id: "tx-ceylan-yesterday",
            date: day(-1),
            items: [item("Premium Seri", "P-50 Premium Mini", 50, 180)],
            stage: "delivered",
            collections: [payment("col-ceylan-yesterday", -1, 9000, "Peşin")],
            paymentDueDate: "",
            note: "",
          },
          {
            id: "tx-ceylan-week",
            date: day(-8),
            items: [item("Hizmetler", "Acil Servis", 1, 3500)],
            stage: "delivered",
            collections: [payment("col-ceylan-week", -8, 3500, "Kartla ödendi")],
            paymentDueDate: "",
            note: "",
          },
          {
            id: "tx-ceylan-month",
            date: day(-35),
            items: [item("Standart Seri", "S-500 Toplu Paket", 10, 450)],
            stage: "delivered",
            collections: [payment("col-ceylan-month", -30, 4500, "Havale")],
            paymentDueDate: "",
            note: "",
          },
        ],
      },

      // Ödemeleri geciken, en yüksek borçlu müşteri: 30 gündür vadesi geçmiş
      // işlem, ödenmemiş fatura, bugünkü acil iş ve hiç tahsil edilmemiş devir.
      {
        id: "00000004-0000-0000-0000-000000000004",
        name: "Delta Hızır İnşaat Ltd.",
        contactPerson: "Hüseyin Demir",
        phone: "0533 444 55 66",
        taxNumber: "4567890123",
        address: "Bursa, Nilüfer",
        note: "Ödemeleri gecikiyor — haftalık takip et.",
        rollovers: [
          {
            id: "rollover-delta",
            sourceYear: previousYear,
            targetYear: thisYear,
            amount: 15000,
            collectionMovements: [],
            note: `${previousYear} yılından devreden açık bakiye`,
            createdAt: `${thisYear}-01-02T09:00:00.000Z`,
          },
        ],
        ledgerEntries: [],
        transactions: [
          {
            id: "tx-delta-overdue",
            date: day(-45),
            items: [
              item("Standart Seri", "S-1000 Endüstriyel Paket", 20, 1200),
              item("Hizmetler", "Kurulum ve Montaj", 4, 1500),
            ],
            stage: "delivered",
            collections: [payment("col-delta-overdue", -25, 10000, "Çek ile kısmi ödeme")],
            paymentDueDate: day(-30),
            note: "15 gün vadeli — 30 gündür gecikmede",
          },
          {
            id: "tx-delta-unpaid",
            date: day(-20),
            items: [item("Premium Seri", "P-500 Premium Endüstriyel", 6, 2800)],
            stage: "delivered",
            collections: [],
            paymentDueDate: "",
            note: "Fatura kesildi, ödeme bekleniyor",
          },
          {
            id: "tx-delta-today",
            date: day(0),
            items: [item("Hizmetler", "Acil Servis", 1, 3500)],
            stage: "created",
            collections: [],
            paymentDueDate: "",
            note: "Şantiyeden acil çağrı",
          },
        ],
      },

      // Toplu ödeme yapan müşteri: birden çok açık işlem (toplu tahsilat
      // denemesi için), bugün peşin kapanan iş, yarın ve ileri tarihli planlar.
      {
        id: "00000005-0000-0000-0000-000000000005",
        name: "Xpro Teknoloji A.Ş.",
        contactPerson: "Zeynep Arslan",
        phone: "0546 555 66 77",
        taxNumber: "5678901234",
        address: "Ankara, Teknopark",
        note: "Toplu ödeme yapar; tahsilatı açık işlemlere dağıt.",
        rollovers: [],
        ledgerEntries: [],
        transactions: [
          {
            id: "tx-xpro-partial",
            date: day(-6),
            items: [item("Premium Seri", "P-100 Premium Standart", 10, 900)],
            stage: "delivered",
            collections: [payment("col-xpro-partial", -6, 3000, "Peşinat")],
            paymentDueDate: day(9),
            note: "",
          },
          {
            id: "tx-xpro-open",
            date: day(-3),
            items: [item("Standart Seri", "S-200 Ekonomik Paket", 20, 350)],
            stage: "delivered",
            collections: [],
            paymentDueDate: day(12),
            note: "",
          },
          {
            id: "tx-xpro-today",
            date: day(0),
            items: [item("Hizmetler", "Teknik Danışmanlık", 1, 4000)],
            stage: "delivered",
            collections: [payment("col-xpro-today", 0, 4000, "Peşin")],
            paymentDueDate: "",
            note: "",
          },
          {
            id: "tx-xpro-tomorrow",
            date: day(1),
            items: [item("Hizmetler", "Özel Tasarım", 1, 12000)],
            stage: "created",
            collections: [],
            paymentDueDate: day(16),
            note: "Yarın teslim — tasarım onayı alındı",
          },
          {
            id: "tx-xpro-planned",
            date: day(10),
            items: [item("Hizmetler", "Periyodik Bakım", 2, 6500)],
            stage: "created",
            collections: [],
            paymentDueDate: "",
            note: "Aylık bakım planı",
          },
        ],
      },
    ],
  };
})();
