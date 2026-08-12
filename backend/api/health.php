<?php

header('Content-Type: application/json; charset=utf-8');

require_once dirname(__DIR__) . '/db.php';

try {
    $pdo = getDbConnection();
    $dbName = $pdo->query('SELECT DATABASE() AS db_name')->fetch();

    echo json_encode([
        'success' => true,
        'message' => 'Veritabani baglantisi basarili.',
        'database' => $dbName['db_name'] ?? null,
        'timestamp' => date('c'),
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
} catch (Throwable $exception) {
    http_response_code(500);

    echo json_encode([
        'success' => false,
        'message' => 'Veritabani baglantisi basarisiz.',
        'error' => $exception->getMessage(),
        'timestamp' => date('c'),
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}
