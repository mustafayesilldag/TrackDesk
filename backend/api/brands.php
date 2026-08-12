<?php

require_once dirname(__DIR__) . '/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/auth_helpers.php';

$requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
requireAuthenticatedUser();

try {
    if ($requestMethod === 'GET') {
        handleListBrands();
    }

    if ($requestMethod === 'POST') {
        handleCreateBrand();
    }

    if ($requestMethod === 'PUT') {
        handleUpdateBrand();
    }

    if ($requestMethod === 'DELETE') {
        handleDeleteBrand();
    }

    requireMethod(['GET', 'POST', 'PUT', 'DELETE']);
} catch (Throwable $exception) {
    sendJson([
        'success' => false,
        'message' => 'Marka islemi sirasinda bir hata olustu.',
        'error' => $exception->getMessage(),
        'timestamp' => date('c'),
    ], 500);
}

function handleListBrands(): void
{
    $pdo = getDbConnection();
    $includeInactive = (string) ($_GET['include_inactive'] ?? '0') === '1';

    $sql = 'SELECT id, name, is_active, created_at, updated_at FROM catalog_brands';

    if (!$includeInactive) {
        $sql .= ' WHERE is_active = 1';
    }

    $sql .= ' ORDER BY name ASC';

    $statement = $pdo->query($sql);
    $brands = $statement->fetchAll();

    sendJson([
        'success' => true,
        'message' => 'Markalar listelendi.',
        'count' => count($brands),
        'brands' => $brands,
        'timestamp' => date('c'),
    ]);
}

function handleCreateBrand(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $name = normalizeText($requestData['name'] ?? '');

    if ($name === '') {
        sendJson([
            'success' => false,
            'message' => 'Marka adi bos birakilamaz.',
            'timestamp' => date('c'),
        ], 422);
    }

    $existingStatement = $pdo->prepare(
        'SELECT id, name FROM catalog_brands WHERE LOWER(name) = LOWER(:name) LIMIT 1'
    );
    $existingStatement->execute(['name' => $name]);
    $existingBrand = $existingStatement->fetch();

    if ($existingBrand) {
        sendJson([
            'success' => false,
            'message' => 'Bu marka zaten mevcut.',
            'brand' => $existingBrand,
            'timestamp' => date('c'),
        ], 409);
    }

    $insertStatement = $pdo->prepare(
        'INSERT INTO catalog_brands (name) VALUES (:name)'
    );
    $insertStatement->execute(['name' => $name]);

    $brandId = (int) $pdo->lastInsertId();

    sendJson([
        'success' => true,
        'message' => 'Marka basariyla eklendi.',
        'brand' => findBrandById($pdo, $brandId),
        'timestamp' => date('c'),
    ], 201);
}

function handleUpdateBrand(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $brandId = (int) ($requestData['id'] ?? 0);
    $name = normalizeText($requestData['name'] ?? '');

    if ($brandId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Guncellenecek marka id bilgisi gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    if ($name === '') {
        sendJson([
            'success' => false,
            'message' => 'Marka adi bos birakilamaz.',
            'timestamp' => date('c'),
        ], 422);
    }

    $brand = findBrandById($pdo, $brandId);

    if (!$brand) {
        sendJson([
            'success' => false,
            'message' => 'Marka bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $duplicateStatement = $pdo->prepare(
        'SELECT id, name FROM catalog_brands WHERE LOWER(name) = LOWER(:name) AND id <> :id LIMIT 1'
    );
    $duplicateStatement->execute([
        'name' => $name,
        'id' => $brandId,
    ]);

    if ($duplicateStatement->fetch()) {
        sendJson([
            'success' => false,
            'message' => 'Bu isimle baska bir marka zaten mevcut.',
            'timestamp' => date('c'),
        ], 409);
    }

    $updateStatement = $pdo->prepare(
        'UPDATE catalog_brands SET name = :name WHERE id = :id LIMIT 1'
    );
    $updateStatement->execute([
        'name' => $name,
        'id' => $brandId,
    ]);

    sendJson([
        'success' => true,
        'message' => 'Marka basariyla guncellendi.',
        'brand' => findBrandById($pdo, $brandId),
        'timestamp' => date('c'),
    ]);
}

function handleDeleteBrand(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $brandId = (int) ($requestData['id'] ?? ($_GET['id'] ?? 0));

    if ($brandId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek marka icin id bilgisi gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    $brand = findBrandById($pdo, $brandId);

    if (!$brand) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek marka bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $statement = $pdo->prepare(
        'UPDATE catalog_brands SET is_active = 0 WHERE id = :id LIMIT 1'
    );
    $statement->execute(['id' => $brandId]);

    sendJson([
        'success' => true,
        'message' => 'Marka pasife alindi.',
        'brand' => findBrandById($pdo, $brandId),
        'timestamp' => date('c'),
    ]);
}

function findBrandById(PDO $pdo, int $brandId): array|false
{
    $statement = $pdo->prepare(
        'SELECT id, name, is_active, created_at, updated_at
        FROM catalog_brands
        WHERE id = :id
        LIMIT 1'
    );
    $statement->execute(['id' => $brandId]);

    return $statement->fetch();
}
