<?php

require_once dirname(__DIR__) . '/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/auth_helpers.php';

$requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
requireAuthenticatedUser();

try {
    if ($requestMethod === 'GET') {
        handleListCustomers();
    }

    if ($requestMethod === 'POST') {
        handleCreateCustomer();
    }

    if ($requestMethod === 'PUT') {
        handleUpdateCustomer();
    }

    if ($requestMethod === 'DELETE') {
        handleDeleteCustomer();
    }

    requireMethod(['GET', 'POST', 'PUT', 'DELETE']);
} catch (Throwable $exception) {
    sendJson([
        'success' => false,
        'message' => 'Musteri islemi sirasinda bir hata olustu.',
        'error' => $exception->getMessage(),
        'timestamp' => date('c'),
    ], 500);
}

function handleListCustomers(): void
{
    $pdo = getDbConnection();
    $search = normalizeText($_GET['search'] ?? '');
    $limit = (int) ($_GET['limit'] ?? 200);
    $includeInactive = (string) ($_GET['include_inactive'] ?? '0') === '1';

    if ($limit < 1) {
        $limit = 1;
    }

    if ($limit > 500) {
        $limit = 500;
    }

    $sql = 'SELECT id, name, contact_person, phone, tax_number, address, note, is_active, created_at, updated_at
        FROM customers';
    $params = [];

    $conditions = [];

    if (!$includeInactive) {
        $conditions[] = 'is_active = 1';
    }

    if ($search !== '') {
        $conditions[] = 'name LIKE :search';
        $params['search'] = '%' . $search . '%';
    }

    if ($conditions !== []) {
        $sql .= ' WHERE ' . implode(' AND ', $conditions);
    }

    $sql .= ' ORDER BY name ASC LIMIT ' . $limit;

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $customers = $statement->fetchAll();

    sendJson([
        'success' => true,
        'message' => 'Musteriler listelendi.',
        'count' => count($customers),
        'customers' => $customers,
        'timestamp' => date('c'),
    ]);
}

function handleCreateCustomer(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();

    $name = normalizeText($requestData['name'] ?? '');
    $contactPerson = normalizeText($requestData['contact_person'] ?? ($requestData['contactPerson'] ?? ''));
    $phone = normalizeText($requestData['phone'] ?? '');
    $taxNumber = normalizeText($requestData['tax_number'] ?? ($requestData['taxNumber'] ?? ''));
    $address = normalizeText($requestData['address'] ?? '');
    $note = normalizeText($requestData['note'] ?? '');

    if ($name === '') {
        sendJson([
            'success' => false,
            'message' => 'Musteri adi bos birakilamaz.',
            'timestamp' => date('c'),
        ], 422);
    }

    $existingCustomerStatement = $pdo->prepare(
        'SELECT id, name FROM customers WHERE LOWER(name) = LOWER(:name) LIMIT 1'
    );
    $existingCustomerStatement->execute(['name' => $name]);
    $existingCustomer = $existingCustomerStatement->fetch();

    if ($existingCustomer) {
        sendJson([
            'success' => false,
            'message' => 'Bu isimle bir musteri zaten mevcut.',
            'customer' => $existingCustomer,
            'timestamp' => date('c'),
        ], 409);
    }

    $insertStatement = $pdo->prepare(
        'INSERT INTO customers (name, contact_person, phone, tax_number, address, note)
        VALUES (:name, :contact_person, :phone, :tax_number, :address, :note)'
    );
    $insertStatement->execute([
        'name' => $name,
        'contact_person' => $contactPerson !== '' ? $contactPerson : null,
        'phone' => $phone !== '' ? $phone : null,
        'tax_number' => $taxNumber !== '' ? $taxNumber : null,
        'address' => $address !== '' ? $address : null,
        'note' => $note !== '' ? $note : null,
    ]);

    $customerId = (int) $pdo->lastInsertId();

    $customerStatement = $pdo->prepare(
        'SELECT id, name, contact_person, phone, tax_number, address, note, is_active, created_at, updated_at
        FROM customers
        WHERE id = :id
        LIMIT 1'
    );
    $customerStatement->execute(['id' => $customerId]);
    $customer = $customerStatement->fetch();

    sendJson([
        'success' => true,
        'message' => 'Musteri basariyla eklendi.',
        'customer' => $customer,
        'timestamp' => date('c'),
    ], 201);
}

function handleUpdateCustomer(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $customerId = (int) ($requestData['id'] ?? 0);
    $name = normalizeText($requestData['name'] ?? '');
    $contactPerson = normalizeText($requestData['contact_person'] ?? ($requestData['contactPerson'] ?? ''));
    $phone = normalizeText($requestData['phone'] ?? '');
    $taxNumber = normalizeText($requestData['tax_number'] ?? ($requestData['taxNumber'] ?? ''));
    $address = normalizeText($requestData['address'] ?? '');
    $note = normalizeText($requestData['note'] ?? '');

    if ($customerId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Guncellenecek musteri id bilgisi gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    if ($name === '') {
        sendJson([
            'success' => false,
            'message' => 'Musteri adi bos birakilamaz.',
            'timestamp' => date('c'),
        ], 422);
    }

    $existingCustomer = findCustomerById($pdo, $customerId);

    if (!$existingCustomer) {
        sendJson([
            'success' => false,
            'message' => 'Guncellenecek musteri bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $duplicateStatement = $pdo->prepare(
        'SELECT id, name FROM customers WHERE LOWER(name) = LOWER(:name) AND id <> :id LIMIT 1'
    );
    $duplicateStatement->execute([
        'name' => $name,
        'id' => $customerId,
    ]);
    $duplicateCustomer = $duplicateStatement->fetch();

    if ($duplicateCustomer) {
        sendJson([
            'success' => false,
            'message' => 'Bu isimle baska bir musteri zaten mevcut.',
            'customer' => $duplicateCustomer,
            'timestamp' => date('c'),
        ], 409);
    }

    $updateStatement = $pdo->prepare(
        'UPDATE customers
        SET name = :name,
            contact_person = :contact_person,
            phone = :phone,
            tax_number = :tax_number,
            address = :address,
            note = :note
        WHERE id = :id
        LIMIT 1'
    );
    $updateStatement->execute([
        'name' => $name,
        'contact_person' => $contactPerson !== '' ? $contactPerson : null,
        'phone' => $phone !== '' ? $phone : null,
        'tax_number' => $taxNumber !== '' ? $taxNumber : null,
        'address' => $address !== '' ? $address : null,
        'note' => $note !== '' ? $note : null,
        'id' => $customerId,
    ]);

    sendJson([
        'success' => true,
        'message' => 'Musteri basariyla guncellendi.',
        'customer' => findCustomerById($pdo, $customerId),
        'timestamp' => date('c'),
    ]);
}

function handleDeleteCustomer(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $customerId = (int) ($requestData['id'] ?? ($_GET['id'] ?? 0));

    if ($customerId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek musteri icin id bilgisi gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    $existingCustomer = findCustomerById($pdo, $customerId);

    if (!$existingCustomer) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek musteri bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $deactivateStatement = $pdo->prepare(
        'UPDATE customers
        SET is_active = 0
        WHERE id = :id
        LIMIT 1'
    );
    $deactivateStatement->execute(['id' => $customerId]);

    sendJson([
        'success' => true,
        'message' => 'Musteri pasife alindi.',
        'customer' => findCustomerById($pdo, $customerId),
        'timestamp' => date('c'),
    ]);
}

function findCustomerById(PDO $pdo, int $customerId): array|false
{
    $statement = $pdo->prepare(
        'SELECT id, name, contact_person, phone, tax_number, address, note, is_active, created_at, updated_at
        FROM customers
        WHERE id = :id
        LIMIT 1'
    );
    $statement->execute(['id' => $customerId]);

    return $statement->fetch();
}
