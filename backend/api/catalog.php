<?php

require_once dirname(__DIR__) . '/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/auth_helpers.php';

try {
    requireAuthenticatedUser();
    requireMethod(['GET']);

    $pdo = getDbConnection();
    $includeInactive = (string) ($_GET['include_inactive'] ?? '0') === '1';

    $brandSql = 'SELECT id, name, is_active, created_at, updated_at FROM catalog_brands';
    if (!$includeInactive) {
        $brandSql .= ' WHERE is_active = 1';
    }
    $brandSql .= ' ORDER BY name ASC';

    $productSql = 'SELECT id, brand_id, name, default_unit_price, is_active, created_at, updated_at
        FROM catalog_products';
    if (!$includeInactive) {
        $productSql .= ' WHERE is_active = 1';
    }
    $productSql .= ' ORDER BY name ASC';

    $brands = $pdo->query($brandSql)->fetchAll();
    $products = $pdo->query($productSql)->fetchAll();

    $productsByBrand = [];
    foreach ($products as $product) {
        $brandId = (int) $product['brand_id'];
        if (!isset($productsByBrand[$brandId])) {
            $productsByBrand[$brandId] = [];
        }

        $productsByBrand[$brandId][] = $product;
    }

    $catalog = array_map(
        static function (array $brand) use ($productsByBrand): array {
            $brand['products'] = $productsByBrand[(int) $brand['id']] ?? [];
            return $brand;
        },
        $brands
    );

    sendJson([
        'success' => true,
        'message' => 'Katalog listelendi.',
        'count' => count($catalog),
        'brands' => $catalog,
        'timestamp' => date('c'),
    ]);
} catch (Throwable $exception) {
    sendJson([
        'success' => false,
        'message' => 'Katalog listelenirken bir hata olustu.',
        'error' => $exception->getMessage(),
        'timestamp' => date('c'),
    ], 500);
}
