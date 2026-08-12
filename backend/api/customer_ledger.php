<?php

require_once dirname(__DIR__) . '/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/auth_helpers.php';

$requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
requireAuthenticatedUser();

try {
    $pdo = getDbConnection();
    ensureCustomerLedgerTable($pdo);

    if ($requestMethod === 'GET') {
        handleListLedgerEntries($pdo);
    }

    if ($requestMethod === 'POST') {
        handleCreateLedgerEntry($pdo);
    }

    if ($requestMethod === 'PUT') {
        handleUpdateLedgerEntry($pdo);
    }

    if ($requestMethod === 'DELETE') {
        handleDeleteLedgerEntry($pdo);
    }

    requireMethod(['GET', 'POST', 'PUT', 'DELETE']);
} catch (Throwable $exception) {
    sendJson([
        'success' => false,
        'message' => 'Cari hareket islemi sirasinda bir hata olustu.',
        'error' => $exception->getMessage(),
        'timestamp' => date('c'),
    ], 500);
}

function ensureCustomerLedgerTable(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS customer_ledger_entries (
            id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            customer_id INT UNSIGNED NOT NULL,
            entry_type  ENUM('payment','debt') NOT NULL,
            amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
            entry_date  DATE NOT NULL,
            note        TEXT NULL,
            created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_ledger_customer (customer_id),
            INDEX idx_ledger_date (entry_date),
            CONSTRAINT fk_ledger_customer FOREIGN KEY (customer_id)
                REFERENCES customers(id) ON DELETE CASCADE
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    );
}

function normalizeEntryType(mixed $value): string
{
    $type = strtolower(trim((string) $value));
    if (!in_array($type, ['payment', 'debt'], true)) {
        sendJson([
            'success' => false,
            'message' => 'Gecersiz hareket turu. payment veya debt olmali.',
            'timestamp' => date('c'),
        ], 422);
    }
    return $type;
}

function findLedgerEntryById(PDO $pdo, int $id): array|false
{
    $statement = $pdo->prepare(
        'SELECT id, customer_id, entry_type, amount, entry_date, note, created_at
        FROM customer_ledger_entries WHERE id = :id LIMIT 1'
    );
    $statement->execute(['id' => $id]);
    return $statement->fetch();
}

function handleListLedgerEntries(PDO $pdo): void
{
    $customerId = (int) ($_GET['customer_id'] ?? 0);
    $limit = (int) ($_GET['limit'] ?? 1000);
    if ($limit < 1) {
        $limit = 1;
    }
    if ($limit > 5000) {
        $limit = 5000;
    }

    $sql = 'SELECT id, customer_id, entry_type, amount, entry_date, note, created_at
        FROM customer_ledger_entries';
    $params = [];
    if ($customerId > 0) {
        $sql .= ' WHERE customer_id = :customer_id';
        $params['customer_id'] = $customerId;
    }
    $sql .= ' ORDER BY entry_date DESC, id DESC LIMIT ' . $limit;

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $entries = $statement->fetchAll();

    sendJson([
        'success' => true,
        'message' => 'Cari hareketler listelendi.',
        'count' => count($entries),
        'entries' => $entries,
        'timestamp' => date('c'),
    ]);
}

function handleCreateLedgerEntry(PDO $pdo): void
{
    $requestData = getRequestData();
    $customerId = (int) ($requestData['customer_id'] ?? 0);
    $entryType = normalizeEntryType($requestData['entry_type'] ?? '');
    $amount = parseNullableDecimal($requestData['amount'] ?? null);
    $entryDate = parseRequiredDate($requestData['entry_date'] ?? date('Y-m-d'), 'Hareket tarihi');
    $note = normalizeText($requestData['note'] ?? '');

    if ($customerId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Hareket icin musteri secilmesi gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    if ($amount === null || (float) $amount <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Tutar 0\'dan buyuk olmali.',
            'timestamp' => date('c'),
        ], 422);
    }

    $customerStatement = $pdo->prepare('SELECT id FROM customers WHERE id = :id LIMIT 1');
    $customerStatement->execute(['id' => $customerId]);
    if (!$customerStatement->fetch()) {
        sendJson([
            'success' => false,
            'message' => 'Hareket eklenecek musteri bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $statement = $pdo->prepare(
        'INSERT INTO customer_ledger_entries (customer_id, entry_type, amount, entry_date, note)
        VALUES (:customer_id, :entry_type, :amount, :entry_date, :note)'
    );
    $statement->execute([
        'customer_id' => $customerId,
        'entry_type' => $entryType,
        'amount' => $amount,
        'entry_date' => $entryDate,
        'note' => $note !== '' ? $note : null,
    ]);

    sendJson([
        'success' => true,
        'message' => 'Cari hareket eklendi.',
        'entry' => findLedgerEntryById($pdo, (int) $pdo->lastInsertId()),
        'timestamp' => date('c'),
    ], 201);
}

function handleUpdateLedgerEntry(PDO $pdo): void
{
    $requestData = getRequestData();
    $id = (int) ($requestData['id'] ?? 0);
    $amount = parseNullableDecimal($requestData['amount'] ?? null);
    $entryDate = parseRequiredDate($requestData['entry_date'] ?? null, 'Hareket tarihi');
    $note = normalizeText($requestData['note'] ?? '');

    if ($id <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Guncellenecek hareket icin id gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    if ($amount === null || (float) $amount <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Tutar 0\'dan buyuk olmali.',
            'timestamp' => date('c'),
        ], 422);
    }

    $existing = findLedgerEntryById($pdo, $id);
    if (!$existing) {
        sendJson([
            'success' => false,
            'message' => 'Guncellenecek hareket bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $statement = $pdo->prepare(
        'UPDATE customer_ledger_entries
        SET amount = :amount, entry_date = :entry_date, note = :note
        WHERE id = :id LIMIT 1'
    );
    $statement->execute([
        'amount' => $amount,
        'entry_date' => $entryDate,
        'note' => $note !== '' ? $note : null,
        'id' => $id,
    ]);

    sendJson([
        'success' => true,
        'message' => 'Cari hareket guncellendi.',
        'entry' => findLedgerEntryById($pdo, $id),
        'timestamp' => date('c'),
    ]);
}

function handleDeleteLedgerEntry(PDO $pdo): void
{
    $requestData = getRequestData();
    $id = (int) ($requestData['id'] ?? ($_GET['id'] ?? 0));

    if ($id <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek hareket icin id gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    if (!findLedgerEntryById($pdo, $id)) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek hareket bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $statement = $pdo->prepare('DELETE FROM customer_ledger_entries WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $id]);

    sendJson([
        'success' => true,
        'message' => 'Cari hareket silindi.',
        'id' => $id,
        'timestamp' => date('c'),
    ]);
}
