<?php

require_once dirname(__DIR__) . '/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/auth_helpers.php';

$requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
requireAuthenticatedUser();

try {
    if ($requestMethod === 'GET') {
        handleListProducts();
    }

    if ($requestMethod === 'POST') {
        handleCreateProduct();
    }

    if ($requestMethod === 'PUT') {
        handleUpdateProduct();
    }

    if ($requestMethod === 'DELETE') {
        handleDeleteProduct();
    }

    requireMethod(['GET', 'POST', 'PUT', 'DELETE']);
} catch (Throwable $exception) {
    sendJson([
        'success' => false,
        'message' => 'Urun islemi sirasinda bir hata olustu.',
        'error' => $exception->getMessage(),
        'timestamp' => date('c'),
    ], 500);
}

function handleListProducts(): void
{
    $pdo = getDbConnection();
    $includeInactive = (string) ($_GET['include_inactive'] ?? '0') === '1';
    $brandId = (int) ($_GET['brand_id'] ?? 0);

    $sql = 'SELECT
            p.id,
            p.brand_id,
            b.name AS brand_name,
            p.name,
            p.default_unit_price,
            p.is_active,
            p.created_at,
            p.updated_at
        FROM catalog_products p
        INNER JOIN catalog_brands b ON b.id = p.brand_id';

    $conditions = [];
    $params = [];

    if (!$includeInactive) {
        $conditions[] = 'p.is_active = 1';
        $conditions[] = 'b.is_active = 1';
    }

    if ($brandId > 0) {
        $conditions[] = 'p.brand_id = :brand_id';
        $params['brand_id'] = $brandId;
    }

    if ($conditions !== []) {
        $sql .= ' WHERE ' . implode(' AND ', $conditions);
    }

    $sql .= ' ORDER BY b.name ASC, p.name ASC';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $products = $statement->fetchAll();

    sendJson([
        'success' => true,
        'message' => 'Urunler listelendi.',
        'count' => count($products),
        'products' => $products,
        'timestamp' => date('c'),
    ]);
}

function handleCreateProduct(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $brandId = (int) ($requestData['brand_id'] ?? 0);
    $name = normalizeText($requestData['name'] ?? '');
    $defaultUnitPrice = parseNullableDecimal($requestData['default_unit_price'] ?? null);

    if ($brandId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Urun icin marka secilmesi gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    if ($name === '') {
        sendJson([
            'success' => false,
            'message' => 'Urun adi bos birakilamaz.',
            'timestamp' => date('c'),
        ], 422);
    }

    if (!findActiveBrandById($pdo, $brandId)) {
        sendJson([
            'success' => false,
            'message' => 'Secilen marka bulunamadi veya pasif durumda.',
            'timestamp' => date('c'),
        ], 404);
    }

    $duplicateStatement = $pdo->prepare(
        'SELECT id, name FROM catalog_products WHERE brand_id = :brand_id AND LOWER(name) = LOWER(:name) LIMIT 1'
    );
    $duplicateStatement->execute([
        'brand_id' => $brandId,
        'name' => $name,
    ]);

    if ($duplicateStatement->fetch()) {
        sendJson([
            'success' => false,
            'message' => 'Bu marka altinda ayni urun zaten mevcut.',
            'timestamp' => date('c'),
        ], 409);
    }

    $insertStatement = $pdo->prepare(
        'INSERT INTO catalog_products (brand_id, name, default_unit_price)
        VALUES (:brand_id, :name, :default_unit_price)'
    );
    $insertStatement->execute([
        'brand_id' => $brandId,
        'name' => $name,
        'default_unit_price' => $defaultUnitPrice,
    ]);

    $productId = (int) $pdo->lastInsertId();

    sendJson([
        'success' => true,
        'message' => 'Urun basariyla eklendi.',
        'product' => findProductById($pdo, $productId),
        'timestamp' => date('c'),
    ], 201);
}

function handleUpdateProduct(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $productId = (int) ($requestData['id'] ?? 0);
    $brandId = (int) ($requestData['brand_id'] ?? 0);
    $name = normalizeText($requestData['name'] ?? '');
    $defaultUnitPrice = parseNullableDecimal($requestData['default_unit_price'] ?? null);

    if ($productId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Guncellenecek urun id bilgisi gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    if ($brandId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Urun icin marka secilmesi gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    if ($name === '') {
        sendJson([
            'success' => false,
            'message' => 'Urun adi bos birakilamaz.',
            'timestamp' => date('c'),
        ], 422);
    }

    if (!findActiveBrandById($pdo, $brandId)) {
        sendJson([
            'success' => false,
            'message' => 'Secilen marka bulunamadi veya pasif durumda.',
            'timestamp' => date('c'),
        ], 404);
    }

    $product = findProductById($pdo, $productId);

    if (!$product) {
        sendJson([
            'success' => false,
            'message' => 'Guncellenecek urun bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $duplicateStatement = $pdo->prepare(
        'SELECT id FROM catalog_products
        WHERE brand_id = :brand_id AND LOWER(name) = LOWER(:name) AND id <> :id
        LIMIT 1'
    );
    $duplicateStatement->execute([
        'brand_id' => $brandId,
        'name' => $name,
        'id' => $productId,
    ]);

    if ($duplicateStatement->fetch()) {
        sendJson([
            'success' => false,
            'message' => 'Bu marka altinda ayni urun zaten mevcut.',
            'timestamp' => date('c'),
        ], 409);
    }

    $updateStatement = $pdo->prepare(
        'UPDATE catalog_products
        SET brand_id = :brand_id, name = :name, default_unit_price = :default_unit_price
        WHERE id = :id
        LIMIT 1'
    );
    $updateStatement->execute([
        'brand_id' => $brandId,
        'name' => $name,
        'default_unit_price' => $defaultUnitPrice,
        'id' => $productId,
    ]);

    sendJson([
        'success' => true,
        'message' => 'Urun basariyla guncellendi.',
        'product' => findProductById($pdo, $productId),
        'timestamp' => date('c'),
    ]);
}

function handleDeleteProduct(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $productId = (int) ($requestData['id'] ?? ($_GET['id'] ?? 0));

    if ($productId <= 0) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek urun icin id bilgisi gerekli.',
            'timestamp' => date('c'),
        ], 422);
    }

    $product = findProductById($pdo, $productId);

    if (!$product) {
        sendJson([
            'success' => false,
            'message' => 'Silinecek urun bulunamadi.',
            'timestamp' => date('c'),
        ], 404);
    }

    $statement = $pdo->prepare(
        'UPDATE catalog_products SET is_active = 0 WHERE id = :id LIMIT 1'
    );
    $statement->execute(['id' => $productId]);

    sendJson([
        'success' => true,
        'message' => 'Urun pasife alindi.',
        'product' => findProductById($pdo, $productId),
        'timestamp' => date('c'),
    ]);
}

function findActiveBrandById(PDO $pdo, int $brandId): array|false
{
    $statement = $pdo->prepare(
        'SELECT id, name, is_active
        FROM catalog_brands
        WHERE id = :id AND is_active = 1
        LIMIT 1'
    );
    $statement->execute(['id' => $brandId]);

    return $statement->fetch();
}

function findProductById(PDO $pdo, int $productId): array|false
{
    $statement = $pdo->prepare(
        'SELECT
            p.id,
            p.brand_id,
            b.name AS brand_name,
            p.name,
            p.default_unit_price,
            p.is_active,
            p.created_at,
            p.updated_at
        FROM catalog_products p
        INNER JOIN catalog_brands b ON b.id = p.brand_id
        WHERE p.id = :id
        LIMIT 1'
    );
    $statement->execute(['id' => $productId]);

    return $statement->fetch();
}
