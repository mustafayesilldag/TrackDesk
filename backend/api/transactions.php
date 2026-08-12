<?php

require_once dirname(__DIR__) . '/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/auth_helpers.php';

$requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
requireAuthenticatedUser();

try {
    if ($requestMethod === 'GET') {
        handleListTransactions();
    }

    if ($requestMethod === 'POST') {
        handleCreateTransaction();
    }

    if ($requestMethod === 'PUT') {
        handleUpdateTransaction();
    }

    if ($requestMethod === 'DELETE') {
        handleDeleteTransaction();
    }

    requireMethod(['GET', 'POST', 'PUT', 'DELETE']);
} catch (Throwable $exception) {
    sendJson([
        'success' => false,
        'message' => 'Islem sirasinda bir hata olustu.',
        'error' => $exception->getMessage(),
        'timestamp' => date('c'),
    ], 500);
}

function handleListTransactions(): void
{
    $pdo = getDbConnection();
    $customerId = (int) ($_GET['customer_id'] ?? 0);
    $dateFrom = normalizeOptionalDate($_GET['date_from'] ?? null);
    $dateTo = normalizeOptionalDate($_GET['date_to'] ?? null);
    $limit = (int) ($_GET['limit'] ?? 200);

    if ($limit < 1) {
        $limit = 1;
    }

    if ($limit > 500) {
        $limit = 500;
    }

    $sql = 'SELECT
            t.id,
            t.customer_id,
            c.name AS customer_name,
            t.transaction_date,
            t.stage,
            t.total_amount,
            t.payment_due_date,
            t.note,
            t.created_at,
            t.updated_at
        FROM transactions t
        INNER JOIN customers c ON c.id = t.customer_id';

    $conditions = [];
    $params = [];

    if ($customerId > 0) {
        $conditions[] = 't.customer_id = :customer_id';
        $params['customer_id'] = $customerId;
    }

    if ($dateFrom !== null) {
        $conditions[] = 't.transaction_date >= :date_from';
        $params['date_from'] = $dateFrom;
    }

    if ($dateTo !== null) {
        $conditions[] = 't.transaction_date <= :date_to';
        $params['date_to'] = $dateTo;
    }

    if ($conditions !== []) {
        $sql .= ' WHERE ' . implode(' AND ', $conditions);
    }

    $sql .= ' ORDER BY t.transaction_date DESC, t.id DESC LIMIT ' . $limit;

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $transactions = $statement->fetchAll();

    if ($transactions === []) {
        sendJson([
            'success' => true,
            'message' => 'Islemler listelendi.',
            'count' => 0,
            'transactions' => [],
            'timestamp' => date('c'),
        ]);
    }

    $transactionIds = array_map(
        static fn (array $transaction): int => (int) $transaction['id'],
        $transactions
    );

    $itemsByTransaction = fetchTransactionItems($pdo, $transactionIds);
    $collectionsByTransaction = fetchTransactionCollections($pdo, $transactionIds);

    $payload = array_map(
        static function (array $transaction) use ($itemsByTransaction, $collectionsByTransaction): array {
            $transactionId = (int) $transaction['id'];
            $transaction['items'] = $itemsByTransaction[$transactionId] ?? [];
            $transaction['collections'] = $collectionsByTransaction[$transactionId] ?? [];
            $transaction['collected_total'] = number_format(
                array_reduce(
                    $transaction['collections'],
                    static fn (float $sum, array $collection): float => $sum + (float) $collection['amount'],
                    0.0
                ),
                2,
                '.',
                ''
            );

            return $transaction;
        },
        $transactions
    );

    sendJson([
        'success' => true,
        'message' => 'Islemler listelendi.',
        'count' => count($payload),
        'transactions' => $payload,
        'timestamp' => date('c'),
    ]);
}

function handleCreateTransaction(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $transactionInput = validateTransactionPayload($pdo, $requestData);

    $pdo->beginTransaction();

    try {
        $insertTransaction = $pdo->prepare(
            'INSERT INTO transactions (
                customer_id,
                transaction_date,
                stage,
                total_amount,
                payment_due_date,
                note
            ) VALUES (
                :customer_id,
                :transaction_date,
                :stage,
                :total_amount,
                :payment_due_date,
                :note
            )'
        );

        $insertTransaction->execute([
            'customer_id' => $transactionInput['customer_id'],
            'transaction_date' => $transactionInput['transaction_date'],
            'stage' => $transactionInput['stage'],
            'total_amount' => $transactionInput['total_amount'],
            'payment_due_date' => $transactionInput['payment_due_date'],
            'note' => $transactionInput['note'],
        ]);

        $transactionId = (int) $pdo->lastInsertId();

        insertTransactionItems($pdo, $transactionId, $transactionInput['items']);
        insertTransactionCollections($pdo, $transactionId, $transactionInput['collections']);

        $pdo->commit();

        sendJson([
            'success' => true,
            'message' => 'Islem basariyla olusturuldu.',
            'transaction' => fetchTransactionById($pdo, $transactionId),
            'timestamp' => date('c'),
        ], 201);
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }
}

function handleUpdateTransaction(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $transactionId = (int) ($requestData['id'] ?? 0);

    if ($transactionId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Guncellenecek islem icin id bilgisi gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    $existingTransaction = fetchTransactionById($pdo, $transactionId);

    if (!$existingTransaction) {
        sendJson([
            'success' => false,
            'message' => 'Guncellenecek islem bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $transactionInput = validateTransactionPayload($pdo, $requestData);

    $pdo->beginTransaction();

    try {
        $updateTransaction = $pdo->prepare(
            'UPDATE transactions
            SET
                customer_id = :customer_id,
                transaction_date = :transaction_date,
                stage = :stage,
                total_amount = :total_amount,
                payment_due_date = :payment_due_date,
                note = :note
            WHERE id = :id
            LIMIT 1'
        );

        $updateTransaction->execute([
            'customer_id' => $transactionInput['customer_id'],
            'transaction_date' => $transactionInput['transaction_date'],
            'stage' => $transactionInput['stage'],
            'total_amount' => $transactionInput['total_amount'],
            'payment_due_date' => $transactionInput['payment_due_date'],
            'note' => $transactionInput['note'],
            'id' => $transactionId,
        ]);

        $pdo->prepare('DELETE FROM transaction_items WHERE transaction_id = :transaction_id')
            ->execute(['transaction_id' => $transactionId]);
        $pdo->prepare('DELETE FROM collections WHERE transaction_id = :transaction_id')
            ->execute(['transaction_id' => $transactionId]);

        insertTransactionItems($pdo, $transactionId, $transactionInput['items']);
        insertTransactionCollections($pdo, $transactionId, $transactionInput['collections']);

        $pdo->commit();

        sendJson([
            'success' => true,
            'message' => 'Islem basariyla guncellendi.',
            'transaction' => fetchTransactionById($pdo, $transactionId),
            'timestamp' => date('c'),
        ]);
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }
}

function handleDeleteTransaction(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $transactionId = (int) ($requestData['id'] ?? ($_GET['id'] ?? 0));

    if ($transactionId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek islem icin id bilgisi gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    $existingTransaction = fetchTransactionById($pdo, $transactionId);

    if (!$existingTransaction) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek islem bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $deleteStatement = $pdo->prepare('DELETE FROM transactions WHERE id = :id LIMIT 1');
    $deleteStatement->execute(['id' => $transactionId]);

    sendJson([
        'success' => true,
        'message' => 'Islem silindi.',
        'transaction_id' => $transactionId,
        'timestamp' => date('c'),
    ]);
}

function validateTransactionPayload(PDO $pdo, array $requestData): array
{
    $customerId = (int) ($requestData['customer_id'] ?? 0);
    $transactionDate = parseRequiredDate($requestData['transaction_date'] ?? null, 'Islem tarihi');
    $stage = normalizeTransactionStage($requestData['stage'] ?? 'created');
    $paymentDueDate = normalizeOptionalDate($requestData['payment_due_date'] ?? null);
    $note = normalizeText($requestData['note'] ?? '');
    $items = normalizeTransactionItems($pdo, $requestData['items'] ?? []);
    $collections = normalizeTransactionCollections($requestData['collections'] ?? [], $transactionDate);

    if ($customerId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Islem icin musteri secilmesi gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    $customer = findCustomerRecord($pdo, $customerId);

    if (!$customer || (int) $customer['is_active'] !== 1) {
        sendJson([
            'success' => false,
            'message' => 'Secilen musteri bulunamadi veya pasif durumda.',
            'timestamp' => date('c'),
        ], 404);
    }

    $totalAmount = array_reduce(
        $items,
        static fn (float $sum, array $item): float => $sum + (float) $item['line_total'],
        0.0
    );

    $collectedTotal = array_reduce(
        $collections,
        static fn (float $sum, array $collection): float => $sum + (float) $collection['amount'],
        0.0
    );

    if ($collectedTotal > $totalAmount) {
        sendJson([
            'success' => false,
            'message' => 'Tahsilat toplami islem toplamindan buyuk olamaz.',
            'timestamp' => date('c'),
        ], 422);
    }

    if ($paymentDueDate !== null && $paymentDueDate < $transactionDate) {
        sendJson([
            'success' => false,
            'message' => 'Odeme vadesi islem tarihinden once olamaz.',
            'timestamp' => date('c'),
        ], 422);
    }

    return [
        'customer_id' => $customerId,
        'transaction_date' => $transactionDate,
        'stage' => $stage,
        'total_amount' => number_format($totalAmount, 2, '.', ''),
        'payment_due_date' => $paymentDueDate,
        'note' => $note !== '' ? $note : null,
        'items' => $items,
        'collections' => $collections,
    ];
}

function normalizeTransactionItems(PDO $pdo, mixed $itemsInput): array
{
    if (!is_array($itemsInput) || $itemsInput === []) {
        sendJson([
            'success' => false,
            'message' => 'Islem icin en az bir urun satiri gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    $items = [];

    foreach ($itemsInput as $index => $itemInput) {
        if (!is_array($itemInput)) {
            continue;
        }

        $productId = (int) ($itemInput['product_id'] ?? 0);
        $productLabel = normalizeText($itemInput['product_label'] ?? '');
        $quantity = (int) ($itemInput['quantity'] ?? 0);
        $unitPrice = parseNullableDecimal($itemInput['unit_price'] ?? null);

        if ($productId > 0) {
            $product = findProductRecord($pdo, $productId);

            if (!$product || (int) $product['is_active'] !== 1) {
                sendJson([
                    'success' => false,
                    'message' => 'Secilen urun bulunamadi veya pasif durumda.',
                    'satir' => $index + 1,
                    'timestamp' => date('c'),
                ], 404);
            }

            $productLabel = $productLabel !== '' ? $productLabel : trim($product['brand_name'] . ' - ' . $product['name']);
        }

        if ($productLabel === '') {
            sendJson([
                'success' => false,
                'message' => 'Her urun satirinda urun adi veya urun secimi olmali.',
                'satir' => $index + 1,
                'timestamp' => date('c'),
            ], 422);
        }

        if ($quantity <= 0) {
            sendJson([
                'success' => false,
                'message' => 'Urun adedi 0\'dan buyuk olmali.',
                'satir' => $index + 1,
                'timestamp' => date('c'),
            ], 422);
        }

        if ($unitPrice === null) {
            sendJson([
                'success' => false,
                'message' => 'Her urun satiri icin birim fiyat gerekli.',
                'satir' => $index + 1,
                'timestamp' => date('c'),
            ], 422);
        }

        $lineTotal = number_format($quantity * (float) $unitPrice, 2, '.', '');

        $items[] = [
            'product_id' => $productId > 0 ? $productId : null,
            'product_label' => $productLabel,
            'quantity' => $quantity,
            'unit_price' => $unitPrice,
            'line_total' => $lineTotal,
        ];
    }

    if ($items === []) {
        sendJson([
            'success' => false,
            'message' => 'Islem icin gecerli urun satiri bulunamadi.',
            'timestamp' => date('c'),
        ], 422);
    }

    return $items;
}

function normalizeTransactionCollections(mixed $collectionsInput, string $fallbackDate): array
{
    if ($collectionsInput === null || $collectionsInput === '' || $collectionsInput === []) {
        return [];
    }

    if (!is_array($collectionsInput)) {
        sendJson([
            'success' => false,
            'message' => 'Tahsilat verisi gecersiz formatta gonderildi.',
            'timestamp' => date('c'),
        ], 422);
    }

    $collections = [];

    foreach ($collectionsInput as $index => $collectionInput) {
        if (!is_array($collectionInput)) {
            continue;
        }

        $amount = parseNullableDecimal($collectionInput['amount'] ?? null);

        if ($amount === null) {
            continue;
        }

        if ((float) $amount <= 0) {
            sendJson([
                'success' => false,
                'message' => 'Tahsilat tutari 0\'dan buyuk olmali.',
                'satir' => $index + 1,
                'timestamp' => date('c'),
            ], 422);
        }

        $collections[] = [
            'collection_date' => normalizeOptionalDate($collectionInput['collection_date'] ?? null) ?? $fallbackDate,
            'amount' => $amount,
            'note' => normalizeText($collectionInput['note'] ?? '') ?: null,
        ];
    }

    return $collections;
}

function normalizeTransactionStage(mixed $value): string
{
    $stage = strtolower(normalizeText((string) $value));
    $allowedStages = ['created', 'editing', 'delivered'];

    if ($stage === '') {
        return 'created';
    }

    if (!in_array($stage, $allowedStages, true)) {
        sendJson([
            'success' => false,
            'message' => 'Islem durumu gecersiz gonderildi.',
            'allowed_stages' => $allowedStages,
            'timestamp' => date('c'),
        ], 422);
    }

    return $stage;
}

function insertTransactionItems(PDO $pdo, int $transactionId, array $items): void
{
    $statement = $pdo->prepare(
        'INSERT INTO transaction_items (
            transaction_id,
            product_id,
            product_label,
            quantity,
            unit_price,
            line_total
        ) VALUES (
            :transaction_id,
            :product_id,
            :product_label,
            :quantity,
            :unit_price,
            :line_total
        )'
    );

    foreach ($items as $item) {
        $statement->execute([
            'transaction_id' => $transactionId,
            'product_id' => $item['product_id'],
            'product_label' => $item['product_label'],
            'quantity' => $item['quantity'],
            'unit_price' => $item['unit_price'],
            'line_total' => $item['line_total'],
        ]);
    }
}

function insertTransactionCollections(PDO $pdo, int $transactionId, array $collections): void
{
    if ($collections === []) {
        return;
    }

    $statement = $pdo->prepare(
        'INSERT INTO collections (
            transaction_id,
            collection_date,
            amount,
            note
        ) VALUES (
            :transaction_id,
            :collection_date,
            :amount,
            :note
        )'
    );

    foreach ($collections as $collection) {
        $statement->execute([
            'transaction_id' => $transactionId,
            'collection_date' => $collection['collection_date'],
            'amount' => $collection['amount'],
            'note' => $collection['note'],
        ]);
    }
}

function fetchTransactionById(PDO $pdo, int $transactionId): array|false
{
    $statement = $pdo->prepare(
        'SELECT
            t.id,
            t.customer_id,
            c.name AS customer_name,
            t.transaction_date,
            t.stage,
            t.total_amount,
            t.payment_due_date,
            t.note,
            t.created_at,
            t.updated_at
        FROM transactions t
        INNER JOIN customers c ON c.id = t.customer_id
        WHERE t.id = :id
        LIMIT 1'
    );
    $statement->execute(['id' => $transactionId]);
    $transaction = $statement->fetch();

    if (!$transaction) {
        return false;
    }

    $transaction['items'] = fetchTransactionItems($pdo, [$transactionId])[$transactionId] ?? [];
    $transaction['collections'] = fetchTransactionCollections($pdo, [$transactionId])[$transactionId] ?? [];
    $transaction['collected_total'] = number_format(
        array_reduce(
            $transaction['collections'],
            static fn (float $sum, array $collection): float => $sum + (float) $collection['amount'],
            0.0
        ),
        2,
        '.',
        ''
    );

    return $transaction;
}

function fetchTransactionItems(PDO $pdo, array $transactionIds): array
{
    if ($transactionIds === []) {
        return [];
    }

    $placeholders = implode(', ', array_fill(0, count($transactionIds), '?'));
    $statement = $pdo->prepare(
        "SELECT
            id,
            transaction_id,
            product_id,
            product_label,
            quantity,
            unit_price,
            line_total,
            created_at
        FROM transaction_items
        WHERE transaction_id IN ($placeholders)
        ORDER BY id ASC"
    );
    $statement->execute($transactionIds);
    $items = $statement->fetchAll();

    $grouped = [];
    foreach ($items as $item) {
        $grouped[(int) $item['transaction_id']][] = $item;
    }

    return $grouped;
}

function fetchTransactionCollections(PDO $pdo, array $transactionIds): array
{
    if ($transactionIds === []) {
        return [];
    }

    $placeholders = implode(', ', array_fill(0, count($transactionIds), '?'));
    $statement = $pdo->prepare(
        "SELECT
            id,
            transaction_id,
            collection_date,
            amount,
            note,
            created_at
        FROM collections
        WHERE transaction_id IN ($placeholders)
        ORDER BY collection_date ASC, id ASC"
    );
    $statement->execute($transactionIds);
    $collections = $statement->fetchAll();

    $grouped = [];
    foreach ($collections as $collection) {
        $grouped[(int) $collection['transaction_id']][] = $collection;
    }

    return $grouped;
}

function findCustomerRecord(PDO $pdo, int $customerId): array|false
{
    $statement = $pdo->prepare(
        'SELECT id, name, is_active
        FROM customers
        WHERE id = :id
        LIMIT 1'
    );
    $statement->execute(['id' => $customerId]);

    return $statement->fetch();
}

function findProductRecord(PDO $pdo, int $productId): array|false
{
    $statement = $pdo->prepare(
        'SELECT
            p.id,
            p.brand_id,
            b.name AS brand_name,
            p.name,
            p.default_unit_price,
            p.is_active
        FROM catalog_products p
        INNER JOIN catalog_brands b ON b.id = p.brand_id
        WHERE p.id = :id
        LIMIT 1'
    );
    $statement->execute(['id' => $productId]);

    return $statement->fetch();
}
