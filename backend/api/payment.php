<?php
require_once dirname(__DIR__) . '/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/auth_helpers.php';

requireAuthenticatedUser();

if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    sendJson(['success' => false, 'message' => 'Sadece POST metodu kabul edilir.'], 405);
}

try {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) {
        sendJson(['success' => false, 'message' => 'Gecersiz JSON verisi.'], 400);
    }

    $customerId = (int) ($body['customer_id'] ?? 0);
    $amount     = (float) ($body['amount'] ?? 0);
    $note       = trim((string) ($body['note'] ?? ''));

    if ($customerId <= 0) {
        sendJson(['success' => false, 'message' => 'Musteri ID gecersiz.'], 400);
    }
    if ($amount <= 0) {
        sendJson(['success' => false, 'message' => 'Tahsilat tutari sifirdan buyuk olmalidir.'], 400);
    }

    $pdo = getDbConnection();

    // Acik borclari collections tablosindan hesaplayarak getir, en eskiden yeniye
    $stmt = $pdo->prepare(
        'SELECT t.id, t.transaction_date, t.total_amount,
                COALESCE(SUM(c.amount), 0) AS collected_total
         FROM transactions t
         LEFT JOIN collections c ON c.transaction_id = t.id
         WHERE t.customer_id = :cid
         GROUP BY t.id, t.transaction_date, t.total_amount
         HAVING (t.total_amount - COALESCE(SUM(c.amount), 0)) > 0.001
         ORDER BY t.transaction_date ASC, t.id ASC'
    );
    $stmt->execute([':cid' => $customerId]);
    $openTransactions = $stmt->fetchAll(PDO::FETCH_ASSOC);

    if (empty($openTransactions)) {
        sendJson(['success' => false, 'message' => 'Bu musterisin odenecek acik islemi bulunmuyor.'], 422);
    }

    $remaining = $amount;
    $details = [];
    $closedCount = 0;
    $partialTx = null;
    $today = date('Y-m-d');
    $collectionNote = $note !== '' ? $note : 'Genel ozet tahsilati';

    $pdo->beginTransaction();

    foreach ($openTransactions as $tx) {
        if ($remaining <= 0.001) break;

        $txId        = (int) $tx['id'];
        $txTotal     = (float) $tx['total_amount'];
        $txCollected = (float) $tx['collected_total'];
        $txDebt      = $txTotal - $txCollected;

        if ($txDebt <= 0.001) continue;

        $toApply = min($remaining, $txDebt);

        $pdo->prepare(
            'INSERT INTO collections (transaction_id, collection_date, amount, note)
             VALUES (:txid, :date, :amount, :note)'
        )->execute([
            ':txid'   => $txId,
            ':date'   => $today,
            ':amount' => number_format($toApply, 2, '.', ''),
            ':note'   => $collectionNote,
        ]);

        if ($remaining >= $txDebt - 0.001) {
            $details[] = $tx['transaction_date'] . ' tarihli ' . number_format($txTotal, 2) . ' TL tutarindaki islem KAPANDI';
            $remaining -= $txDebt;
            $closedCount++;
        } else {
            $details[] = $tx['transaction_date'] . ' tarihli ' . number_format($txTotal, 2) . ' TL tutarindaki islemden ' . number_format($toApply, 2) . ' TL kesildi (kalan: ' . number_format($txDebt - $toApply, 2) . ' TL)';
            $partialTx = $tx;
            $remaining = 0;
        }
    }

    $pdo->commit();

    $summaryParts = [];
    if ($closedCount > 0) {
        $summaryParts[] = $closedCount . ' islem tamamen kapandi';
    }
    if ($partialTx !== null) {
        $summaryParts[] = '1 islemden kismi kesinti yapildi';
    }
    if ($remaining > 0.001) {
        $summaryParts[] = number_format($remaining, 2) . ' TL fazla odeme alindi (yeni islem yok)';
    }

    $summaryText = number_format($amount, 2) . ' TL tahsil edildi. ' . implode(', ', $summaryParts) . '.';
    if (!empty($details)) {
        $summaryText .= "\n\nDetay:\n" . implode("\n", $details);
    }
    if ($note !== '') {
        $summaryText .= "\n\nNot: " . $note;
    }

    sendJson([
        'success'      => true,
        'message'      => 'Tahsilat basariyla kaydedildi.',
        'summary'      => $summaryText,
        'amount'       => $amount,
        'closed_count' => $closedCount,
        'details'      => $details,
        'timestamp'    => date('c'),
    ]);

} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    sendJson([
        'success' => false,
        'message' => 'Tahsilat islemi sirasinda hata olustu.',
        'error'   => $e->getMessage(),
    ], 500);
}
