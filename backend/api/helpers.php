<?php

function sendJson(array $payload, int $statusCode = 200): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');

    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function getJsonInput(): array
{
    $rawBody = file_get_contents('php://input');

    if ($rawBody === false || trim($rawBody) === '') {
        return [];
    }

    $decoded = json_decode($rawBody, true);

    if (!is_array($decoded)) {
        sendJson([
            'success' => false,
            'message' => 'Gecersiz JSON verisi gonderildi.',
            'timestamp' => date('c'),
        ], 400);
    }

    return $decoded;
}

function getRequestData(): array
{
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        return $_GET;
    }

    if (!empty($_POST)) {
        return $_POST;
    }

    return getJsonInput();
}

function requireMethod(array $allowedMethods): void
{
    $requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $normalizedAllowedMethods = array_map('strtoupper', $allowedMethods);

    if (!in_array($requestMethod, $normalizedAllowedMethods, true)) {
        header('Allow: ' . implode(', ', $normalizedAllowedMethods));

        sendJson([
            'success' => false,
            'message' => 'Bu endpoint icin method desteklenmiyor.',
            'allowed_methods' => $normalizedAllowedMethods,
            'timestamp' => date('c'),
        ], 405);
    }
}

function normalizeText(?string $value): string
{
    return trim((string) $value);
}

function parseNullableDecimal(mixed $value): ?string
{
    if ($value === null) {
        return null;
    }

    $normalized = str_replace(',', '.', trim((string) $value));

    if ($normalized === '') {
        return null;
    }

    if (!is_numeric($normalized)) {
        sendJson([
            'success' => false,
            'message' => 'Gecersiz fiyat veya tutar bilgisi gonderildi.',
            'timestamp' => date('c'),
        ], 422);
    }

    return number_format((float) $normalized, 2, '.', '');
}

function parseRequiredDate(mixed $value, string $fieldLabel = 'Tarih'): string
{
    $normalized = trim((string) $value);

    if ($normalized === '') {
        sendJson([
            'success' => false,
            'message' => $fieldLabel . ' bos birakilamaz.',
            'timestamp' => date('c'),
        ], 422);
    }

    $date = date_create($normalized);

    if (!$date) {
        sendJson([
            'success' => false,
            'message' => $fieldLabel . ' gecersiz formatta gonderildi.',
            'timestamp' => date('c'),
        ], 422);
    }

    return $date->format('Y-m-d');
}

function normalizeOptionalDate(mixed $value): ?string
{
    $normalized = trim((string) ($value ?? ''));

    if ($normalized === '') {
        return null;
    }

    $date = date_create($normalized);

    if (!$date) {
        sendJson([
            'success' => false,
            'message' => 'Tarih alani gecersiz formatta gonderildi.',
            'timestamp' => date('c'),
        ], 422);
    }

    return $date->format('Y-m-d');
}
