/* TrackDesk — Demo Verisi
   localStorage boş iken otomatik yüklenir.
   Preview/demo modunda SABİT veridir: her müşteri için aynı 5 senaryo
   (gelecek sipariş, geçmişten açık işlem, ödenmiş işlem, açık devir,
   kapanmış devir) birebir tekrarlanır — sayfa yenilenince bu veriye döner. */

function buildDemoTransactions(slug) {
  return [
    {
      id: `tx-${slug}-future`,
      date: "2027-01-01",
      items: [
        { product: "Standart Seri - S-1000 Endüstriyel Paket", quantity: 10, unitPrice: 1200 },
        { product: "Hizmetler - Kurulum ve Montaj", quantity: 2, unitPrice: 1500 },
      ],
      paid: 0,
      stage: "created",
      note: "İleri tarihli sipariş — 2027 planlaması",
      collections: [],
      paymentDueDate: "2027-01-01",
    },
    {
      id: `tx-${slug}-open`,
      date: "2025-12-12",
      items: [
        { product: "Premium Seri - P-500 Premium Endüstriyel", quantity: 5, unitPrice: 2800 },
        { product: "Standart Seri - S-1000 Endüstriyel Paket", quantity: 5, unitPrice: 1200 },
      ],
      paid: 5000,
      stage: "delivered",
      note: "15.000 TL açık bakiye kaldı",
      collections: [{ id: `col-${slug}-open`, date: "2025-12-20", amount: 5000, note: "Kısmi tahsilat" }],
      paymentDueDate: "2025-12-26",
    },
    {
      id: `tx-${slug}-paid`,
      date: "2026-01-01",
      items: [
        { product: "Hizmetler - Teknik Danışmanlık", quantity: 1, unitPrice: 25000 },
      ],
      paid: 25000,
      stage: "delivered",
      note: "Yıllık danışmanlık sözleşmesi — peşin ödendi",
      collections: [{ id: `col-${slug}-paid`, date: "2026-01-01", amount: 25000, note: "Peşin" }],
      paymentDueDate: "",
    },
  ];
}

function buildDemoRollovers(slug) {
  return [
    {
      id: `rollover-${slug}-2026`,
      sourceYear: "2026",
      targetYear: "2027",
      amount: 10000,
      collectionMovements: [],
      note: "2026 yılından 2027'ye taşınacak devir bakiyesi",
      createdAt: "2026-06-01T09:00:00.000Z",
    },
    {
      id: `rollover-${slug}-2025`,
      sourceYear: "2025",
      targetYear: "2026",
      amount: 12000,
      collectionMovements: [
        { id: `rollover-${slug}-col-1`, date: "2026-01-15", amount: 12000, note: "Devir bakiyesi tam tahsilat" },
      ],
      note: "2025 yılından kapanan devir bakiyesi",
      createdAt: "2026-01-03T09:00:00.000Z",
    },
  ];
}

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
    {
      id: "00000001-0000-0000-0000-000000000001",
      name: "Alfa Ticaret Ltd. Şti.",
      contactPerson: "Ahmet Yılmaz",
      phone: "0532 111 22 33",
      taxNumber: "1234567890",
      address: "İstanbul, Kadıköy",
      note: "Sabit örnek veri — demo amaçlı",
      rollovers: buildDemoRollovers("alfa"),
      ledgerEntries: [],
      transactions: buildDemoTransactions("alfa"),
    },
    {
      id: "00000002-0000-0000-0000-000000000002",
      name: "Beta Gıda San. Tic. A.Ş.",
      contactPerson: "Fatma Kaya",
      phone: "0544 222 33 44",
      taxNumber: "2345678901",
      address: "Ankara, Çankaya",
      note: "Sabit örnek veri — demo amaçlı",
      rollovers: buildDemoRollovers("beta"),
      ledgerEntries: [],
      transactions: buildDemoTransactions("beta"),
    },
    {
      id: "00000003-0000-0000-0000-000000000003",
      name: "Ceylan Tekstil A.Ş.",
      contactPerson: "Mustafa Çelik",
      phone: "0505 333 44 55",
      taxNumber: "3456789012",
      address: "İzmir, Konak",
      note: "Sabit örnek veri — demo amaçlı",
      rollovers: buildDemoRollovers("ceylan"),
      ledgerEntries: [],
      transactions: buildDemoTransactions("ceylan"),
    },
    {
      id: "00000004-0000-0000-0000-000000000004",
      name: "Delta Hızır İnşaat Ltd.",
      contactPerson: "Hüseyin Demir",
      phone: "0533 444 55 66",
      taxNumber: "4567890123",
      address: "Bursa, Nilüfer",
      note: "Sabit örnek veri — demo amaçlı",
      rollovers: buildDemoRollovers("delta"),
      ledgerEntries: [],
      transactions: buildDemoTransactions("delta"),
    },
    {
      id: "00000005-0000-0000-0000-000000000005",
      name: "Xpro Teknoloji A.Ş.",
      contactPerson: "Zeynep Arslan",
      phone: "0546 555 66 77",
      taxNumber: "5678901234",
      address: "Ankara, Teknopark",
      note: "Sabit örnek veri — demo amaçlı",
      rollovers: buildDemoRollovers("xpro"),
      ledgerEntries: [],
      transactions: buildDemoTransactions("xpro"),
    },
  ],
};
