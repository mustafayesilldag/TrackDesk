<?php

function fetchRolloverById(PDO $pdo, int $rolloverId): array|false
{
    $statement = $pdo->prepare(
        'SELECT
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
        INNER JOIN customers c ON c.id = r.customer_id
        WHERE r.id = :id
        LIMIT 1'
    );
    $statement->execute(['id' => $rolloverId]);
    $rollover = $statement->fetch();

    if (!$rollover) {
        return false;
    }

    $rollover['collections'] = fetchRolloverCollections($pdo, [$rolloverId])[$rolloverId] ?? [];
    $collectedTotal = getRolloverCollectedTotal($pdo, $rolloverId);
    $rollover['collected_total'] = number_format($collectedTotal, 2, '.', '');
    $rollover['remaining_amount'] = number_format(max((float) $rollover['amount'] - $collectedTotal, 0), 2, '.', '');
    $rollover['is_closed'] = $collectedTotal >= (float) $rollover['amount'];

    return $rollover;
}

function fetchRolloverCollections(PDO $pdo, array $rolloverIds): array
{
    if ($rolloverIds === []) {
        return [];
    }

    $placeholders = implode(', ', array_fill(0, count($rolloverIds), '?'));
    $statement = $pdo->prepare(
        "SELECT
            id,
            rollover_id,
            collection_date,
            amount,
            note,
            created_at
        FROM rollover_collections
        WHERE rollover_id IN ($placeholders)
        ORDER BY collection_date ASC, id ASC"
    );
    $statement->execute($rolloverIds);
    $collections = $statement->fetchAll();

    $grouped = [];
    foreach ($collections as $collection) {
        $grouped[(int) $collection['rollover_id']][] = $collection;
    }

    return $grouped;
}

function getRolloverCollectedTotal(PDO $pdo, int $rolloverId, ?int $excludeCollectionId = null): float
{
    $sql = 'SELECT COALESCE(SUM(amount), 0) FROM rollover_collections WHERE rollover_id = :rollover_id';
    $params = ['rollover_id' => $rolloverId];

    if ($excludeCollectionId !== null) {
        $sql .= ' AND id <> :exclude_id';
        $params['exclude_id'] = $excludeCollectionId;
    }

    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return (float) $statement->fetchColumn();
}

function findRolloverCustomer(PDO $pdo, int $customerId): array|false
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
