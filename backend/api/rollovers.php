<?php

require_once dirname(__DIR__) . '/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/auth_helpers.php';
require_once __DIR__ . '/rollover_helpers.php';

$requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
requireAuthenticatedUser();

try {
    if ($requestMethod === 'GET') {
        handleListRollovers();
    }

    if ($requestMethod === 'POST') {
        handleCreateRollover();
    }

    if ($requestMethod === 'PUT') {
        handleUpdateRollover();
    }

    if ($requestMethod === 'DELETE') {
        handleDeleteRollover();
    }

    requireMethod(['GET', 'POST', 'PUT', 'DELETE']);
} catch (Throwable $exception) {
    sendJson([
        'success' => false,
        'message' => 'Devir islemi sirasinda bir hata olustu.',
        'error' => $exception->getMessage(),
        'timestamp' => date('c'),
    ], 500);
}

function handleListRollovers(): void
{
    $pdo = getDbConnection();
    $customerId = (int) ($_GET['customer_id'] ?? 0);
    $sourceYear = (int) ($_GET['source_year'] ?? 0);
    $targetYear = (int) ($_GET['target_year'] ?? 0);

    $sql = 'SELECT
            r.id,
            r.customer_id,
            c.name AS customer_name,
            r.source_year,
            r.target_year,
            r.amount,
            r.note,
            r.created_at,
            r.updated_at
        FROM rollovers r
        INNER JOIN customers c ON c.id = r.customer_id';

    $conditions = [];
    $params = [];

    if ($customerId > 0) {
        $conditions[] = 'r.customer_id = :customer_id';
        $params['customer_id'] = $customerId;
    }

    if ($sourceYear > 0) {
        $conditions[] = 'r.source_year = :source_year';
        $params['source_year'] = $sourceYear;
    }

    if ($targetYear > 0) {
        $conditions[] = 'r.target_year = :target_year';
        $params['target_year'] = $targetYear;
    }

    if ($conditions !== []) {
        $sql .= ' WHERE ' . implode(' AND ', $conditions);
    }

    $sql .= ' ORDER BY r.target_year DESC, r.source_year DESC, r.id DESC';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $rollovers = $statement->fetchAll();

    if ($rollovers === []) {
        sendJson([
            'success' => true,
            'message' => 'Devir kayitlari listelendi.',
            'count' => 0,
            'rollovers' => [],
            'timestamp' => date('c'),
        ]);
    }

    $rolloverIds = array_map(static fn (array $rollover): int => (int) $rollover['id'], $rollovers);
    $collectionsByRollover = fetchRolloverCollections($pdo, $rolloverIds);

    $payload = array_map(
        static function (array $rollover) use ($collectionsByRollover): array {
            $rolloverId = (int) $rollover['id'];
            $rollover['collections'] = $collectionsByRollover[$rolloverId] ?? [];

            $collectedTotal = array_reduce(
                $rollover['collections'],
                static fn (float $sum, array $collection): float => $sum + (float) $collection['amount'],
                0.0
            );

            $rollover['collected_total'] = number_format($collectedTotal, 2, '.', '');
            $rollover['remaining_amount'] = number_format(max((float) $rollover['amount'] - $collectedTotal, 0), 2, '.', '');
            $rollover['is_closed'] = $collectedTotal >= (float) $rollover['amount'];

            return $rollover;
        },
        $rollovers
    );

    sendJson([
        'success' => true,
        'message' => 'Devir kayitlari listelendi.',
        'count' => count($payload),
        'rollovers' => $payload,
        'timestamp' => date('c'),
    ]);
}

function handleCreateRollover(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $input = validateRolloverPayload($pdo, $requestData);

    $statement = $pdo->prepare(
        'INSERT INTO rollovers (customer_id, source_year, target_year, amount, note)
        VALUES (:customer_id, :source_year, :target_year, :amount, :note)'
    );
    $statement->execute([
        'customer_id' => $input['customer_id'],
        'source_year' => $input['source_year'],
        'target_year' => $input['target_year'],
        'amount' => $input['amount'],
        'note' => $input['note'],
    ]);

    $rolloverId = (int) $pdo->lastInsertId();

    sendJson([
        'success' => true,
        'message' => 'Devir kaydi basariyla olusturuldu.',
        'rollover' => fetchRolloverById($pdo, $rolloverId),
        'timestamp' => date('c'),
    ], 201);
}

function handleUpdateRollover(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $rolloverId = (int) ($requestData['id'] ?? 0);

    if ($rolloverId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Guncellenecek devir icin id gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    $existing = fetchRolloverById($pdo, $rolloverId);

    if (!$existing) {
        sendJson([
            'success' => false,
            'message' => 'Guncellenecek devir kaydi bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $input = validateRolloverPayload($pdo, $requestData, $rolloverId);
    $collectedTotal = getRolloverCollectedTotal($pdo, $rolloverId);

    if ((float) $input['amount'] < $collectedTotal) {
        sendJson([
            'success' => false,
            'message' => 'Devir tutari mevcut tahsilat toplaminin altina dusurulemez.',
            'collected_total' => number_format($collectedTotal, 2, '.', ''),
            'timestamp' => date('c'),
        ], 422);
    }

    $statement = $pdo->prepare(
        'UPDATE rollovers
        SET customer_id = :customer_id,
            source_year = :source_year,
            target_year = :target_year,
            amount = :amount,
            note = :note
        WHERE id = :id
        LIMIT 1'
    );
    $statement->execute([
        'customer_id' => $input['customer_id'],
        'source_year' => $input['source_year'],
        'target_year' => $input['target_year'],
        'amount' => $input['amount'],
        'note' => $input['note'],
        'id' => $rolloverId,
    ]);

    sendJson([
        'success' => true,
        'message' => 'Devir kaydi basariyla guncellendi.',
        'rollover' => fetchRolloverById($pdo, $rolloverId),
        'timestamp' => date('c'),
    ]);
}

function handleDeleteRollover(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $rolloverId = (int) ($requestData['id'] ?? ($_GET['id'] ?? 0));

    if ($rolloverId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek devir icin id gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    $existing = fetchRolloverById($pdo, $rolloverId);

    if (!$existing) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek devir kaydi bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $statement = $pdo->prepare('DELETE FROM rollovers WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $rolloverId]);

    sendJson([
        'success' => true,
        'message' => 'Devir kaydi silindi.',
        'rollover_id' => $rolloverId,
        'timestamp' => date('c'),
    ]);
}

function validateRolloverPayload(PDO $pdo, array $requestData, ?int $excludeRolloverId = null): array
{
    $customerId = (int) ($requestData['customer_id'] ?? 0);
    $sourceYear = (int) ($requestData['source_year'] ?? 0);
    $targetYear = (int) ($requestData['target_year'] ?? 0);
    $amount = parseNullableDecimal($requestData['amount'] ?? null);
    $note = normalizeText($requestData['note'] ?? '');

    if ($customerId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Devir icin musteri secilmesi gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    $customer = findRolloverCustomer($pdo, $customerId);

    if (!$customer || (int) $customer['is_active'] !== 1) {
        sendJson([
            'success' => false,
            'message' => 'Secilen musteri bulunamadi veya pasif durumda.',
            'timestamp' => date('c'),
        ], 404);
    }

    if ($sourceYear < 2000 || $targetYear < 2000) {
        sendJson([
            'success' => false,
            'message' => 'Kaynak ve hedef yil gecersiz.',
            'timestamp' => date('c'),
        ], 422);
    }

    if ($targetYear <= $sourceYear) {
        sendJson([
            'success' => false,
            'message' => 'Hedef yil kaynak yildan buyuk olmali.',
            'timestamp' => date('c'),
        ], 422);
    }

    if ($amount === null || (float) $amount <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Devir tutari 0\'dan buyuk olmali.',
            'timestamp' => date('c'),
        ], 422);
    }

    $sql = 'SELECT id FROM rollovers WHERE customer_id = :customer_id AND source_year = :source_year AND target_year = :target_year';
    $params = [
        'customer_id' => $customerId,
        'source_year' => $sourceYear,
        'target_year' => $targetYear,
    ];

    if ($excludeRolloverId !== null) {
        $sql .= ' AND id <> :exclude_id';
        $params['exclude_id'] = $excludeRolloverId;
    }

    $sql .= ' LIMIT 1';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    if ($statement->fetch()) {
        sendJson([
            'success' => false,
            'message' => 'Bu musteri ve yil araligi icin zaten bir devir kaydi mevcut.',
            'timestamp' => date('c'),
        ], 409);
    }

    return [
        'customer_id' => $customerId,
        'source_year' => $sourceYear,
        'target_year' => $targetYear,
        'amount' => $amount,
        'note' => $note !== '' ? $note : null,
    ];
}
