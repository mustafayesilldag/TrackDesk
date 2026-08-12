<?php

require_once dirname(__DIR__) . '/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/auth_helpers.php';

$requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
requireAuthenticatedUser();

try {
    if ($requestMethod === 'GET') {
        handleListCollections();
    }

    if ($requestMethod === 'POST') {
        handleCreateCollection();
    }

    if ($requestMethod === 'PUT') {
        handleUpdateCollection();
    }

    if ($requestMethod === 'DELETE') {
        handleDeleteCollection();
    }

    requireMethod(['GET', 'POST', 'PUT', 'DELETE']);
} catch (Throwable $exception) {
    sendJson([
        'success' => false,
        'message' => 'Tahsilat islemi sirasinda bir hata olustu.',
        'error' => $exception->getMessage(),
        'timestamp' => date('c'),
    ], 500);
}

function handleListCollections(): void
{
    $pdo = getDbConnection();
    $transactionId = (int) ($_GET['transaction_id'] ?? 0);
    $customerId = (int) ($_GET['customer_id'] ?? 0);
    $dateFrom = normalizeOptionalDate($_GET['date_from'] ?? null);
    $dateTo = normalizeOptionalDate($_GET['date_to'] ?? null);
    $limit = (int) ($_GET['limit'] ?? 300);

    if ($limit < 1) {
        $limit = 1;
    }

    if ($limit > 1000) {
        $limit = 1000;
    }

    $sql = 'SELECT
            col.id,
            col.transaction_id,
            col.collection_date,
            col.amount,
            col.note,
            col.created_at,
            t.customer_id,
            c.name AS customer_name,
            t.transaction_date,
            t.total_amount,
            t.stage
        FROM collections col
        INNER JOIN transactions t ON t.id = col.transaction_id
        INNER JOIN customers c ON c.id = t.customer_id';

    $conditions = [];
    $params = [];

    if ($transactionId > 0) {
        $conditions[] = 'col.transaction_id = :transaction_id';
        $params['transaction_id'] = $transactionId;
    }

    if ($customerId > 0) {
        $conditions[] = 't.customer_id = :customer_id';
        $params['customer_id'] = $customerId;
    }

    if ($dateFrom !== null) {
        $conditions[] = 'col.collection_date >= :date_from';
        $params['date_from'] = $dateFrom;
    }

    if ($dateTo !== null) {
        $conditions[] = 'col.collection_date <= :date_to';
        $params['date_to'] = $dateTo;
    }

    if ($conditions !== []) {
        $sql .= ' WHERE ' . implode(' AND ', $conditions);
    }

    $sql .= ' ORDER BY col.collection_date DESC, col.id DESC LIMIT ' . $limit;

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $collections = $statement->fetchAll();

    sendJson([
        'success' => true,
        'message' => 'Tahsilatlar listelendi.',
        'count' => count($collections),
        'collections' => $collections,
        'timestamp' => date('c'),
    ]);
}

function handleCreateCollection(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $transactionId = (int) ($requestData['transaction_id'] ?? 0);
    $amount = parseNullableDecimal($requestData['amount'] ?? null);
    $collectionDate = parseRequiredDate($requestData['collection_date'] ?? date('Y-m-d'), 'Tahsilat tarihi');
    $note = normalizeText($requestData['note'] ?? '');

    if ($transactionId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Tahsilat icin islem secilmesi gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    if ($amount === null || (float) $amount <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Tahsilat tutari 0\'dan buyuk olmali.',
            'timestamp' => date('c'),
        ], 422);
    }

    $transaction = findTransactionForCollection($pdo, $transactionId);

    if (!$transaction) {
        sendJson([
            'success' => false,
            'message' => 'Tahsilat eklenecek islem bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $currentCollectedTotal = getTransactionCollectedTotal($pdo, $transactionId);
    $remaining = (float) $transaction['total_amount'] - $currentCollectedTotal;

    if ((float) $amount > $remaining) {
        sendJson([
            'success' => false,
            'message' => 'Tahsilat kalan borctan buyuk olamaz.',
            'remaining' => number_format(max($remaining, 0), 2, '.', ''),
            'timestamp' => date('c'),
        ], 422);
    }

    $statement = $pdo->prepare(
        'INSERT INTO collections (transaction_id, collection_date, amount, note)
        VALUES (:transaction_id, :collection_date, :amount, :note)'
    );
    $statement->execute([
        'transaction_id' => $transactionId,
        'collection_date' => $collectionDate,
        'amount' => $amount,
        'note' => $note !== '' ? $note : null,
    ]);

    $collectionId = (int) $pdo->lastInsertId();

    sendJson([
        'success' => true,
        'message' => 'Tahsilat basariyla eklendi.',
        'collection' => findCollectionById($pdo, $collectionId),
        'transaction_summary' => buildTransactionCollectionSummary($pdo, $transactionId),
        'timestamp' => date('c'),
    ], 201);
}

function handleUpdateCollection(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $collectionId = (int) ($requestData['id'] ?? 0);
    $amount = parseNullableDecimal($requestData['amount'] ?? null);
    $collectionDate = parseRequiredDate($requestData['collection_date'] ?? null, 'Tahsilat tarihi');
    $note = normalizeText($requestData['note'] ?? '');

    if ($collectionId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Guncellenecek tahsilat icin id gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    if ($amount === null || (float) $amount <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Tahsilat tutari 0\'dan buyuk olmali.',
            'timestamp' => date('c'),
        ], 422);
    }

    $existingCollection = findCollectionById($pdo, $collectionId);

    if (!$existingCollection) {
        sendJson([
            'success' => false,
            'message' => 'Guncellenecek tahsilat bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $transaction = findTransactionForCollection($pdo, (int) $existingCollection['transaction_id']);

    if (!$transaction) {
        sendJson([
            'success' => false,
            'message' => 'Tahsilatin bagli oldugu islem bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $otherCollectionsTotal = getTransactionCollectedTotal($pdo, (int) $existingCollection['transaction_id'], $collectionId);
    $remainingAllowance = (float) $transaction['total_amount'] - $otherCollectionsTotal;

    if ((float) $amount > $remainingAllowance) {
        sendJson([
            'success' => false,
            'message' => 'Tahsilat tutari islem toplamindan buyuk olamaz.',
            'remaining' => number_format(max($remainingAllowance, 0), 2, '.', ''),
            'timestamp' => date('c'),
        ], 422);
    }

    $statement = $pdo->prepare(
        'UPDATE collections
        SET collection_date = :collection_date, amount = :amount, note = :note
        WHERE id = :id
        LIMIT 1'
    );
    $statement->execute([
        'collection_date' => $collectionDate,
        'amount' => $amount,
        'note' => $note !== '' ? $note : null,
        'id' => $collectionId,
    ]);

    sendJson([
        'success' => true,
        'message' => 'Tahsilat basariyla guncellendi.',
        'collection' => findCollectionById($pdo, $collectionId),
        'transaction_summary' => buildTransactionCollectionSummary($pdo, (int) $existingCollection['transaction_id']),
        'timestamp' => date('c'),
    ]);
}

function handleDeleteCollection(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $collectionId = (int) ($requestData['id'] ?? ($_GET['id'] ?? 0));

    if ($collectionId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek tahsilat icin id gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    $existingCollection = findCollectionById($pdo, $collectionId);

    if (!$existingCollection) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek tahsilat bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $transactionId = (int) $existingCollection['transaction_id'];

    $statement = $pdo->prepare('DELETE FROM collections WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $collectionId]);

    sendJson([
        'success' => true,
        'message' => 'Tahsilat silindi.',
        'collection_id' => $collectionId,
        'transaction_summary' => buildTransactionCollectionSummary($pdo, $transactionId),
        'timestamp' => date('c'),
    ]);
}

function findCollectionById(PDO $pdo, int $collectionId): array|false
{
    $statement = $pdo->prepare(
        'SELECT
            col.id,
            col.transaction_id,
            col.collection_date,
            col.amount,
            col.note,
            col.created_at,
            t.customer_id,
            c.name AS customer_name,
            t.transaction_date,
            t.total_amount,
            t.stage
        FROM collections col
        INNER JOIN transactions t ON t.id = col.transaction_id
        INNER JOIN customers c ON c.id = t.customer_id
        WHERE col.id = :id
        LIMIT 1'
    );
    $statement->execute(['id' => $collectionId]);

    return $statement->fetch();
}

function findTransactionForCollection(PDO $pdo, int $transactionId): array|false
{
    $statement = $pdo->prepare(
        'SELECT id, customer_id, transaction_date, stage, total_amount, payment_due_date, note
        FROM transactions
        WHERE id = :id
        LIMIT 1'
    );
    $statement->execute(['id' => $transactionId]);

    return $statement->fetch();
}

function getTransactionCollectedTotal(PDO $pdo, int $transactionId, ?int $excludeCollectionId = null): float
{
    $sql = 'SELECT COALESCE(SUM(amount), 0) AS total FROM collections WHERE transaction_id = :transaction_id';
    $params = ['transaction_id' => $transactionId];

    if ($excludeCollectionId !== null) {
        $sql .= ' AND id <> :exclude_id';
        $params['exclude_id'] = $excludeCollectionId;
    }

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return (float) $statement->fetchColumn();
}

function buildTransactionCollectionSummary(PDO $pdo, int $transactionId): array
{
    $transaction = findTransactionForCollection($pdo, $transactionId);

    if (!$transaction) {
        return [];
    }

    $collectedTotal = getTransactionCollectedTotal($pdo, $transactionId);
    $remaining = max((float) $transaction['total_amount'] - $collectedTotal, 0);

    return [
        'transaction_id' => $transactionId,
        'total_amount' => number_format((float) $transaction['total_amount'], 2, '.', ''),
        'collected_total' => number_format($collectedTotal, 2, '.', ''),
        'remaining_amount' => number_format($remaining, 2, '.', ''),
        'is_fully_paid' => $remaining <= 0.00001,
    ];
}
