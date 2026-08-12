<?php

require_once dirname(__DIR__) . '/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/auth_helpers.php';

$requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
requireAuthenticatedUser();

try {
    if ($requestMethod === 'GET') {
        handleExportBackup();
    }

    if ($requestMethod === 'POST') {
        handleImportBackup();
    }

    requireMethod(['GET', 'POST']);
} catch (Throwable $exception) {
    sendJson([
        'success' => false,
        'message' => 'Yedek islemi sirasinda bir hata olustu.',
        'error' => $exception->getMessage(),
        'timestamp' => date('c'),
    ], 500);
}

function handleExportBackup(): void
{
    $pdo = getDbConnection();

    $brands = $pdo->query('SELECT id, name, is_active, created_at, updated_at FROM catalog_brands ORDER BY name ASC')->fetchAll();
    $products = $pdo->query('SELECT id, brand_id, name, default_unit_price, is_active, created_at, updated_at FROM catalog_products ORDER BY name ASC')->fetchAll();
    $customers = $pdo->query('SELECT id, name, contact_person, phone, tax_number, address, note, is_active, created_at, updated_at FROM customers ORDER BY name ASC')->fetchAll();
    $transactions = $pdo->query('SELECT id, customer_id, transaction_date, stage, total_amount, payment_due_date, note, created_at, updated_at FROM transactions ORDER BY transaction_date DESC, id DESC')->fetchAll();
    $transactionItems = $pdo->query('SELECT id, transaction_id, product_id, product_label, quantity, unit_price, line_total, created_at FROM transaction_items ORDER BY id ASC')->fetchAll();
    $collections = $pdo->query('SELECT id, transaction_id, collection_date, amount, note, created_at FROM collections ORDER BY collection_date DESC, id DESC')->fetchAll();
    $rollovers = $pdo->query('SELECT id, customer_id, source_year, target_year, amount, note, created_at, updated_at FROM rollovers ORDER BY target_year DESC, source_year DESC, id DESC')->fetchAll();
    $rolloverCollections = $pdo->query('SELECT id, rollover_id, collection_date, amount, note, created_at FROM rollover_collections ORDER BY collection_date DESC, id DESC')->fetchAll();

    $pdo->exec("CREATE TABLE IF NOT EXISTS customer_ledger_entries (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        customer_id INT UNSIGNED NOT NULL,
        entry_type ENUM('payment','debt') NOT NULL,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        entry_date DATE NOT NULL,
        note TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ledger_customer (customer_id),
        CONSTRAINT fk_ledger_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $ledgerEntries = $pdo->query('SELECT id, customer_id, entry_type, amount, entry_date, note, created_at FROM customer_ledger_entries ORDER BY entry_date DESC, id DESC')->fetchAll();

    $ledgerByCustomer = [];
    foreach ($ledgerEntries as $entry) {
        $customerId = (int) $entry['customer_id'];
        $ledgerByCustomer[$customerId] ??= [];
        $ledgerByCustomer[$customerId][] = [
            'id' => (int) $entry['id'],
            'type' => $entry['entry_type'],
            'amount' => (float) $entry['amount'],
            'date' => $entry['entry_date'],
            'note' => $entry['note'] ?? '',
        ];
    }

    $productsByBrand = [];
    foreach ($products as $product) {
        $brandId = (int) $product['brand_id'];
        $productsByBrand[$brandId] ??= [];
        $productsByBrand[$brandId][] = $product;
    }

    $transactionItemsByTransaction = [];
    foreach ($transactionItems as $item) {
        $transactionId = (int) $item['transaction_id'];
        $transactionItemsByTransaction[$transactionId] ??= [];
        $transactionItemsByTransaction[$transactionId][] = $item;
    }

    $collectionsByTransaction = [];
    foreach ($collections as $collection) {
        $transactionId = (int) $collection['transaction_id'];
        $collectionsByTransaction[$transactionId] ??= [];
        $collectionsByTransaction[$transactionId][] = $collection;
    }

    $rolloverCollectionsByRollover = [];
    foreach ($rolloverCollections as $collection) {
        $rolloverId = (int) $collection['rollover_id'];
        $rolloverCollectionsByRollover[$rolloverId] ??= [];
        $rolloverCollectionsByRollover[$rolloverId][] = $collection;
    }

    $transactionsByCustomer = [];
    foreach ($transactions as $transaction) {
        $transactionId = (int) $transaction['id'];
        $customerId = (int) $transaction['customer_id'];
        $transactionsByCustomer[$customerId] ??= [];
        $transactionsByCustomer[$customerId][] = [
            'id' => $transactionId,
            'date' => $transaction['transaction_date'],
            'amount' => (float) $transaction['total_amount'],
            'stage' => $transaction['stage'],
            'paymentDueDate' => $transaction['payment_due_date'],
            'note' => $transaction['note'] ?? '',
            'items' => array_map(
                static fn (array $item): array => [
                    'id' => (int) $item['id'],
                    'productId' => $item['product_id'] !== null ? (int) $item['product_id'] : null,
                    'product' => $item['product_label'],
                    'quantity' => (int) $item['quantity'],
                    'unitPrice' => (float) $item['unit_price'],
                    'lineTotal' => (float) $item['line_total'],
                ],
                $transactionItemsByTransaction[$transactionId] ?? []
            ),
            'collections' => array_map(
                static fn (array $collection): array => [
                    'id' => (int) $collection['id'],
                    'date' => $collection['collection_date'],
                    'amount' => (float) $collection['amount'],
                    'note' => $collection['note'] ?? '',
                ],
                $collectionsByTransaction[$transactionId] ?? []
            ),
        ];
    }

    $rolloversByCustomer = [];
    foreach ($rollovers as $rollover) {
        $rolloverId = (int) $rollover['id'];
        $customerId = (int) $rollover['customer_id'];
        $rolloversByCustomer[$customerId] ??= [];
        $rolloversByCustomer[$customerId][] = [
            'id' => $rolloverId,
            'sourceYear' => (string) $rollover['source_year'],
            'targetYear' => (string) $rollover['target_year'],
            'amount' => (float) $rollover['amount'],
            'note' => $rollover['note'] ?? '',
            'createdAt' => $rollover['created_at'],
            'collectionMovements' => array_map(
                static fn (array $collection): array => [
                    'id' => (int) $collection['id'],
                    'date' => $collection['collection_date'],
                    'amount' => (float) $collection['amount'],
                    'note' => $collection['note'] ?? '',
                ],
                $rolloverCollectionsByRollover[$rolloverId] ?? []
            ),
        ];
    }

    $payload = [
        'version' => 2,
        'exportedAt' => date('c'),
        'source' => 'database',
        'data' => [
            'catalog' => array_map(
                static function (array $brand) use ($productsByBrand): array {
                    return [
                        'id' => (int) $brand['id'],
                        'brand' => $brand['name'],
                        'products' => array_map(
                            static fn (array $product): array => [
                                'id' => (int) $product['id'],
                                'name' => $product['name'],
                                'defaultUnitPrice' => $product['default_unit_price'] !== null ? (float) $product['default_unit_price'] : null,
                            ],
                            $productsByBrand[(int) $brand['id']] ?? []
                        ),
                    ];
                },
                $brands
            ),
            'customers' => array_map(
                static function (array $customer) use ($transactionsByCustomer, $rolloversByCustomer, $ledgerByCustomer): array {
                    $customerId = (int) $customer['id'];
                    return [
                        'id' => (string) $customerId,
                        'name' => $customer['name'],
                        'contactPerson' => $customer['contact_person'] ?? '',
                        'phone' => $customer['phone'] ?? '',
                        'taxNumber' => $customer['tax_number'] ?? '',
                        'address' => $customer['address'] ?? '',
                        'note' => $customer['note'] ?? '',
                        'transactions' => $transactionsByCustomer[$customerId] ?? [],
                        'rollovers' => $rolloversByCustomer[$customerId] ?? [],
                        'ledgerEntries' => $ledgerByCustomer[$customerId] ?? [],
                    ];
                },
                array_values(array_filter(
                    $customers,
                    static fn (array $customer): bool => (int) $customer['is_active'] === 1
                ))
            ),
        ],
    ];

    sendJson([
        'success' => true,
        'message' => 'Veritabani yedegi hazirlandi.',
        'backup' => $payload,
        'timestamp' => date('c'),
    ]);
}

function handleImportBackup(): void
{
    $pdo = getDbConnection();
    $requestData = getRequestData();
    $backup = $requestData['data'] ?? $requestData;

    $catalog = normalizeBackupCatalog($backup['catalog'] ?? []);
    $customers = normalizeBackupCustomers($backup['customers'] ?? []);

    $pdo->beginTransaction();

    try {
        $pdo->exec('DELETE FROM rollover_collections');
        $pdo->exec('DELETE FROM rollovers');
        $pdo->exec('DELETE FROM collections');
        $pdo->exec('DELETE FROM transaction_items');
        $pdo->exec('DELETE FROM transactions');
        $pdo->exec('DELETE FROM catalog_products');
        $pdo->exec('DELETE FROM catalog_brands');
        $pdo->exec('DELETE FROM customers');

        $brandInsert = $pdo->prepare('INSERT INTO catalog_brands (name) VALUES (:name)');
        $productInsert = $pdo->prepare('INSERT INTO catalog_products (brand_id, name, default_unit_price) VALUES (:brand_id, :name, :default_unit_price)');
        $customerInsert = $pdo->prepare('
            INSERT INTO customers (name, contact_person, phone, tax_number, address, note)
            VALUES (:name, :contact_person, :phone, :tax_number, :address, :note)
        ');
        $transactionInsert = $pdo->prepare('INSERT INTO transactions (customer_id, transaction_date, stage, total_amount, payment_due_date, note) VALUES (:customer_id, :transaction_date, :stage, :total_amount, :payment_due_date, :note)');
        $itemInsert = $pdo->prepare('INSERT INTO transaction_items (transaction_id, product_id, product_label, quantity, unit_price, line_total) VALUES (:transaction_id, :product_id, :product_label, :quantity, :unit_price, :line_total)');
        $collectionInsert = $pdo->prepare('INSERT INTO collections (transaction_id, collection_date, amount, note) VALUES (:transaction_id, :collection_date, :amount, :note)');
        $rolloverInsert = $pdo->prepare('INSERT INTO rollovers (customer_id, source_year, target_year, amount, note) VALUES (:customer_id, :source_year, :target_year, :amount, :note)');
        $rolloverCollectionInsert = $pdo->prepare('INSERT INTO rollover_collections (rollover_id, collection_date, amount, note) VALUES (:rollover_id, :collection_date, :amount, :note)');

        $productLookup = [];

        foreach ($catalog as $brand) {
            $brandInsert->execute(['name' => $brand['brand']]);
            $brandId = (int) $pdo->lastInsertId();

            foreach ($brand['products'] as $product) {
                $productInsert->execute([
                    'brand_id' => $brandId,
                    'name' => $product['name'],
                    'default_unit_price' => $product['defaultUnitPrice'],
                ]);

                $productId = (int) $pdo->lastInsertId();
                $productLookup[$brand['brand'] . ' - ' . $product['name']] = $productId;
            }
        }

        foreach ($customers as $customer) {
            $customerInsert->execute([
                'name' => $customer['name'],
                'contact_person' => $customer['contactPerson'] !== '' ? $customer['contactPerson'] : null,
                'phone' => $customer['phone'] !== '' ? $customer['phone'] : null,
                'tax_number' => $customer['taxNumber'] !== '' ? $customer['taxNumber'] : null,
                'address' => $customer['address'] !== '' ? $customer['address'] : null,
                'note' => $customer['note'] !== '' ? $customer['note'] : null,
            ]);
            $customerId = (int) $pdo->lastInsertId();

            foreach ($customer['transactions'] as $transaction) {
                $transactionInsert->execute([
                    'customer_id' => $customerId,
                    'transaction_date' => $transaction['date'],
                    'stage' => $transaction['stage'],
                    'total_amount' => number_format((float) $transaction['amount'], 2, '.', ''),
                    'payment_due_date' => $transaction['paymentDueDate'] ?: null,
                    'note' => $transaction['note'] !== '' ? $transaction['note'] : null,
                ]);
                $transactionId = (int) $pdo->lastInsertId();

                foreach ($transaction['items'] as $item) {
                    $itemInsert->execute([
                        'transaction_id' => $transactionId,
                        'product_id' => $productLookup[$item['product']] ?? null,
                        'product_label' => $item['product'],
                        'quantity' => (int) $item['quantity'],
                        'unit_price' => number_format((float) $item['unitPrice'], 2, '.', ''),
                        'line_total' => number_format(((float) $item['unitPrice']) * ((int) $item['quantity']), 2, '.', ''),
                    ]);
                }

                foreach ($transaction['collections'] as $collection) {
                    $collectionInsert->execute([
                        'transaction_id' => $transactionId,
                        'collection_date' => $collection['date'],
                        'amount' => number_format((float) $collection['amount'], 2, '.', ''),
                        'note' => $collection['note'] !== '' ? $collection['note'] : null,
                    ]);
                }
            }

            foreach ($customer['rollovers'] as $rollover) {
                $rolloverInsert->execute([
                    'customer_id' => $customerId,
                    'source_year' => (int) $rollover['sourceYear'],
                    'target_year' => (int) $rollover['targetYear'],
                    'amount' => number_format((float) $rollover['amount'], 2, '.', ''),
                    'note' => $rollover['note'] !== '' ? $rollover['note'] : null,
                ]);
                $rolloverId = (int) $pdo->lastInsertId();

                foreach ($rollover['collectionMovements'] as $collection) {
                    $rolloverCollectionInsert->execute([
                        'rollover_id' => $rolloverId,
                        'collection_date' => $collection['date'],
                        'amount' => number_format((float) $collection['amount'], 2, '.', ''),
                        'note' => $collection['note'] !== '' ? $collection['note'] : null,
                    ]);
                }
            }
        }

        $pdo->commit();

        sendJson([
            'success' => true,
            'message' => 'Yedek veritabani uzerine basariyla geri yuklendi.',
            'customer_count' => count($customers),
            'brand_count' => count($catalog),
            'timestamp' => date('c'),
        ]);
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }
}

function normalizeBackupCatalog(mixed $catalogInput): array
{
    if (!is_array($catalogInput)) {
        return [];
    }

    $catalog = [];

    foreach ($catalogInput as $brandInput) {
        if (!is_array($brandInput)) {
            continue;
        }

        $brandName = normalizeText($brandInput['brand'] ?? $brandInput['name'] ?? '');
        if ($brandName === '') {
            continue;
        }

        $productsInput = $brandInput['products'] ?? [];
        $products = [];

        if (is_array($productsInput)) {
            foreach ($productsInput as $productInput) {
                if (is_string($productInput)) {
                    $productName = normalizeText($productInput);
                    if ($productName === '') {
                        continue;
                    }

                    $products[] = [
                        'name' => $productName,
                        'defaultUnitPrice' => null,
                    ];
                    continue;
                }

                if (!is_array($productInput)) {
                    continue;
                }

                $productName = normalizeText($productInput['name'] ?? $productInput['product'] ?? '');
                if ($productName === '') {
                    continue;
                }

                $products[] = [
                    'name' => $productName,
                    'defaultUnitPrice' => parseNullableDecimal($productInput['defaultUnitPrice'] ?? $productInput['default_unit_price'] ?? null),
                ];
            }
        }

        $catalog[] = [
            'brand' => $brandName,
            'products' => $products,
        ];
    }

    return $catalog;
}

function normalizeBackupCustomers(mixed $customersInput): array
{
    if (!is_array($customersInput)) {
        return [];
    }

    $customers = [];

    foreach ($customersInput as $customerInput) {
        if (!is_array($customerInput)) {
            continue;
        }

        $name = normalizeText($customerInput['name'] ?? '');
        if ($name === '') {
            continue;
        }

        $transactions = [];
        foreach (($customerInput['transactions'] ?? []) as $transactionInput) {
            if (!is_array($transactionInput)) {
                continue;
            }

            $transactionDate = normalizeOptionalDate($transactionInput['date'] ?? null) ?? date('Y-m-d');
            $stage = normalizeText($transactionInput['stage'] ?? 'created');
            $items = [];

            foreach (($transactionInput['items'] ?? []) as $itemInput) {
                if (!is_array($itemInput)) {
                    continue;
                }

                $product = normalizeText($itemInput['product'] ?? '');
                $quantity = (int) ($itemInput['quantity'] ?? 0);
                $unitPrice = (float) ($itemInput['unitPrice'] ?? $itemInput['unit_price'] ?? 0);

                if ($product === '' || $quantity <= 0) {
                    continue;
                }

                $items[] = [
                    'product' => $product,
                    'quantity' => $quantity,
                    'unitPrice' => $unitPrice,
                ];
            }

            $collections = [];
            foreach (($transactionInput['collections'] ?? []) as $collectionInput) {
                if (!is_array($collectionInput)) {
                    continue;
                }

                $amount = (float) ($collectionInput['amount'] ?? 0);
                if ($amount <= 0) {
                    continue;
                }

                $collections[] = [
                    'date' => normalizeOptionalDate($collectionInput['date'] ?? $collectionInput['collection_date'] ?? null) ?? $transactionDate,
                    'amount' => $amount,
                    'note' => normalizeText($collectionInput['note'] ?? ''),
                ];
            }

            $transactions[] = [
                'date' => $transactionDate,
                'stage' => $stage !== '' ? $stage : 'created',
                'amount' => (float) ($transactionInput['amount'] ?? 0),
                'paymentDueDate' => normalizeOptionalDate($transactionInput['paymentDueDate'] ?? $transactionInput['payment_due_date'] ?? null),
                'note' => normalizeText($transactionInput['note'] ?? ''),
                'items' => $items,
                'collections' => $collections,
            ];
        }

        $rollovers = [];
        foreach (($customerInput['rollovers'] ?? []) as $rolloverInput) {
            if (!is_array($rolloverInput)) {
                continue;
            }

            $sourceYear = (string) ($rolloverInput['sourceYear'] ?? $rolloverInput['source_year'] ?? '');
            $targetYear = (string) ($rolloverInput['targetYear'] ?? $rolloverInput['target_year'] ?? '');
            $amount = (float) ($rolloverInput['amount'] ?? 0);

            if ($sourceYear === '' || $targetYear === '' || $amount <= 0) {
                continue;
            }

            $collectionMovements = [];
            foreach (($rolloverInput['collectionMovements'] ?? $rolloverInput['collections'] ?? []) as $collectionInput) {
                if (!is_array($collectionInput)) {
                    continue;
                }

                $amountValue = (float) ($collectionInput['amount'] ?? 0);
                if ($amountValue <= 0) {
                    continue;
                }

                $collectionMovements[] = [
                    'date' => normalizeOptionalDate($collectionInput['date'] ?? $collectionInput['collection_date'] ?? null) ?? date('Y-m-d'),
                    'amount' => $amountValue,
                    'note' => normalizeText($collectionInput['note'] ?? ''),
                ];
            }

            $rollovers[] = [
                'sourceYear' => $sourceYear,
                'targetYear' => $targetYear,
                'amount' => $amount,
                'note' => normalizeText($rolloverInput['note'] ?? ''),
                'collectionMovements' => $collectionMovements,
            ];
        }

        $customers[] = [
            'name' => $name,
            'contactPerson' => normalizeText($customerInput['contactPerson'] ?? $customerInput['contact_person'] ?? ''),
            'phone' => normalizeText($customerInput['phone'] ?? ''),
            'taxNumber' => normalizeText($customerInput['taxNumber'] ?? $customerInput['tax_number'] ?? ''),
            'address' => normalizeText($customerInput['address'] ?? ''),
            'note' => normalizeText($customerInput['note'] ?? ''),
            'transactions' => $transactions,
            'rollovers' => $rollovers,
        ];
    }

    return $customers;
}
