<?php

require_once dirname(__DIR__) . '/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/auth_helpers.php';
require_once __DIR__ . '/rollover_helpers.php';

$requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
requireAuthenticatedUser();

try {
    if ($requestMethod === 'GET') {
        handleListRolloverCollections();
    }

    if ($requestMethod === 'POST') {
        handleCreateRolloverCollection();
    }

    if ($requestMethod === 'PUT') {
        handleUpdateRolloverCollection();
    }

    if ($requestMethod === 'DELETE') {
        handleDeleteRolloverCollection();
    }

    requireMethod(['GET', 'POST', 'PUT', 'DELETE']);
} catch (Throwable $exception) {
    sendJson([
        'success' => false,
        'message' => 'Devir tahsilati sirasinda bir hata olustu.',
        'error' => $exception->getMessage(),
        'timestamp' => date('c'),
    ], 500);
}

function handleListRolloverCollections(): void
{
    $pdo = getDbConnection();
    $rolloverId = (int) ($_GET['rollover_id'] ?? 0);
    $customerId = (int) ($_GET['customer_id'] ?? 0);

    $sql = 'SELECT
            rc.id,
            rc.rollover_id,
            rc.collection_date,
            rc.amount,
            rc.note,
            rc.created_at,
            r.customer_id,
            c.name AS customer_name,
            r.source_year,
            r.target_year,
            r.amount AS rollover_amount
        FROM rollover_collections rc
        INNER JOIN rollovers r ON r.id = rc.rollover_id
        INNER JOIN customers c ON c.id = r.customer_id';

    $conditions = [];
    $params = [];

    if ($rolloverId > 0) {
        $conditions[] = 'rc.rollover_id = :rollover_id';
        $params['rollover_id'] = $rolloverId;
    }

    if ($customerId > 0) {
        $conditions[] = 'r.customer_id = :customer_id';
        $params['customer_id'] = $customerId;
    }

    if ($conditions !== []) {
        $sql .= ' WHERE ' . implode(' AND ', $conditions);
    }

    $sql .= ' ORDER BY rc.collection_date DESC, rc.id DESC';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $collections = $statement->fetchAll();

    sendJson([
        'success' => true,
        'message' => 'Devir tahsilatlari listelendi.',
        'count' => count($collections),
        'collections' => $collections,
        'timestamp' => date('c'),
    ]);
}

function handleCreateRolloverCollection(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $rolloverId = (int) ($requestData['rollover_id'] ?? 0);
    $amount = parseNullableDecimal($requestData['amount'] ?? null);
    $collectionDate = parseRequiredDate($requestData['collection_date'] ?? date('Y-m-d'), 'Tahsilat tarihi');
    $note = normalizeText($requestData['note'] ?? '');

    if ($rolloverId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Devir tahsilati icin devir secilmesi gerekli.',
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

    $rollover = fetchRolloverById($pdo, $rolloverId);

    if (!$rollover) {
        sendJson([
            'success' => false,
            'message' => 'Tahsilat eklenecek devir kaydi bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $remaining = (float) $rollover['remaining_amount'];

    if ((float) $amount > $remaining) {
        sendJson([
            'success' => false,
            'message' => 'Tahsilat kalan devir borcundan buyuk olamaz.',
            'remaining' => number_format(max($remaining, 0), 2, '.', ''),
            'timestamp' => date('c'),
        ], 422);
    }

    $statement = $pdo->prepare(
        'INSERT INTO rollover_collections (rollover_id, collection_date, amount, note)
        VALUES (:rollover_id, :collection_date, :amount, :note)'
    );
    $statement->execute([
        'rollover_id' => $rolloverId,
        'collection_date' => $collectionDate,
        'amount' => $amount,
        'note' => $note !== '' ? $note : null,
    ]);

    $collectionId = (int) $pdo->lastInsertId();

    sendJson([
        'success' => true,
        'message' => 'Devir tahsilati basariyla eklendi.',
        'collection' => findRolloverCollectionById($pdo, $collectionId),
        'rollover_summary' => buildRolloverSummary($pdo, $rolloverId),
        'timestamp' => date('c'),
    ], 201);
}

function handleUpdateRolloverCollection(): void
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
            'message' => 'Guncellenecek devir tahsilati icin id gerekli.',
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

    $existing = findRolloverCollectionById($pdo, $collectionId);

    if (!$existing) {
        sendJson([
            'success' => false,
            'message' => 'Guncellenecek devir tahsilati bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $rollover = fetchRolloverById($pdo, (int) $existing['rollover_id']);

    if (!$rollover) {
        sendJson([
            'success' => false,
            'message' => 'Bagli devir kaydi bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $otherCollected = getRolloverCollectedTotal($pdo, (int) $existing['rollover_id'], $collectionId);
    $remainingAllowance = (float) $rollover['amount'] - $otherCollected;

    if ((float) $amount > $remainingAllowance) {
        sendJson([
            'success' => false,
            'message' => 'Tahsilat tutari devir toplamindan buyuk olamaz.',
            'remaining' => number_format(max($remainingAllowance, 0), 2, '.', ''),
            'timestamp' => date('c'),
        ], 422);
    }

    $statement = $pdo->prepare(
        'UPDATE rollover_collections
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
        'message' => 'Devir tahsilati basariyla guncellendi.',
        'collection' => findRolloverCollectionById($pdo, $collectionId),
        'rollover_summary' => buildRolloverSummary($pdo, (int) $existing['rollover_id']),
        'timestamp' => date('c'),
    ]);
}

function handleDeleteRolloverCollection(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $collectionId = (int) ($requestData['id'] ?? ($_GET['id'] ?? 0));

    if ($collectionId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek devir tahsilati icin id gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    $existing = findRolloverCollectionById($pdo, $collectionId);

    if (!$existing) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek devir tahsilati bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $rolloverId = (int) $existing['rollover_id'];

    $statement = $pdo->prepare('DELETE FROM rollover_collections WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $collectionId]);

    sendJson([
        'success' => true,
        'message' => 'Devir tahsilati silindi.',
        'collection_id' => $collectionId,
        'rollover_summary' => buildRolloverSummary($pdo, $rolloverId),
        'timestamp' => date('c'),
    ]);
}

function findRolloverCollectionById(PDO $pdo, int $collectionId): array|false
{
    $statement = $pdo->prepare(
        'SELECT
            rc.id,
            rc.rollover_id,
            rc.collection_date,
            rc.amount,
            rc.note,
            rc.created_at,
            r.customer_id,
            c.name AS customer_name,
            r.source_year,
            r.target_year,
            r.amount AS rollover_amount
        FROM rollover_collections rc
        INNER JOIN rollovers r ON r.id = rc.rollover_id
        INNER JOIN customers c ON c.id = r.customer_id
        WHERE rc.id = :id
        LIMIT 1'
    );
    $statement->execute(['id' => $collectionId]);

    return $statement->fetch();
}

function buildRolloverSummary(PDO $pdo, int $rolloverId): array
{
    $rollover = fetchRolloverById($pdo, $rolloverId);

    if (!$rollover) {
        return [];
    }

    return [
        'rollover_id' => $rolloverId,
        'amount' => number_format((float) $rollover['amount'], 2, '.', ''),
        'collected_total' => $rollover['collected_total'],
        'remaining_amount' => $rollover['remaining_amount'],
        'is_closed' => $rollover['is_closed'],
    ];
}
