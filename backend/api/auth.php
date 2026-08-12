<?php

require_once dirname(__DIR__) . '/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/auth_helpers.php';

$requestMethod = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$action = strtolower(trim((string) ($_GET['action'] ?? $_POST['action'] ?? 'session')));

try {
    $pdo = getDbConnection();
    ensureAuthTables($pdo);
    seedDefaultUsers($pdo);

    if ($requestMethod === 'GET' && $action === 'session') {
        handleSession($pdo);
    }

    if ($requestMethod === 'POST' && $action === 'login') {
        handleLogin($pdo);
    }

    if ($requestMethod === 'POST' && $action === 'logout') {
        handleLogout($pdo);
    }

    requireMethod(['GET', 'POST']);
    sendJson([
        'success' => false,
        'message' => 'Gecersiz auth istegi.',
        'timestamp' => date('c'),
    ], 400);
} catch (Throwable $exception) {
    sendJson([
        'success' => false,
        'message' => 'Giris islemi sirasinda bir hata olustu.',
        'error' => $exception->getMessage(),
        'timestamp' => date('c'),
    ], 500);
}

function handleSession(PDO $pdo): void
{
    $user = authenticateByToken($pdo, getBearerToken());

    if (!$user) {
        sendJson([
            'success' => false,
            'message' => 'Aktif oturum bulunamadi.',
            'timestamp' => date('c'),
        ], 401);
    }

    sendJson([
        'success' => true,
        'message' => 'Aktif oturum dogrulandi.',
        'user' => [
            'id' => (int) $user['id'],
            'full_name' => $user['full_name'],
            'username' => $user['username'],
            'role' => $user['role'],
        ],
        'timestamp' => date('c'),
    ]);
}

function handleLogin(PDO $pdo): void
{
    $requestData = getRequestData();
    $username = trim((string) ($requestData['username'] ?? ''));
    $password = (string) ($requestData['password'] ?? '');

    if ($username === '' || $password === '') {
        sendJson([
            'success' => false,
            'message' => 'Kullanici adi ve sifre zorunlu.',
            'timestamp' => date('c'),
        ], 422);
    }

    $user = findUserByUsername($pdo, $username);
    if (!$user || (int) $user['is_active'] !== 1 || !password_verify($password, $user['password_hash'])) {
        sendJson([
            'success' => false,
            'message' => 'Kullanici adi veya sifre hatali.',
            'timestamp' => date('c'),
        ], 401);
    }

    $token = issueUserToken($pdo, (int) $user['id']);

    sendJson([
        'success' => true,
        'message' => 'Giris basarili.',
        'token' => $token,
        'user' => [
            'id' => (int) $user['id'],
            'full_name' => $user['full_name'],
            'username' => $user['username'],
            'role' => $user['role'],
        ],
        'timestamp' => date('c'),
    ]);
}

function handleLogout(PDO $pdo): void
{
    revokeUserToken($pdo, getBearerToken());

    sendJson([
        'success' => true,
        'message' => 'Oturum kapatildi.',
        'timestamp' => date('c'),
    ]);
}
