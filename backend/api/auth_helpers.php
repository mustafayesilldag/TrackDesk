<?php

require_once dirname(__DIR__) . '/db.php';
require_once __DIR__ . '/helpers.php';

function ensureAuthTables(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS user_tokens (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            token_hash CHAR(64) NOT NULL UNIQUE,
            expires_at DATETIME NOT NULL,
            last_used_at DATETIME NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_user_tokens_user
                FOREIGN KEY (user_id) REFERENCES users(id)
                ON DELETE CASCADE,
            INDEX idx_user_tokens_user (user_id),
            INDEX idx_user_tokens_expires (expires_at)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
}

function getAuthorizationHeader(): string
{
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        return trim((string) $_SERVER['HTTP_AUTHORIZATION']);
    }

    if (!empty($_SERVER['Authorization'])) {
        return trim((string) $_SERVER['Authorization']);
    }

    if (function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach ($headers as $key => $value) {
            if (strtolower((string) $key) === 'authorization') {
                return trim((string) $value);
            }
        }
    }

    return '';
}

function getBearerToken(): ?string
{
    $header = getAuthorizationHeader();
    if (preg_match('/Bearer\s+(.+)/i', $header, $matches)) {
        return trim($matches[1]);
    }

    $fallback = trim((string) ($_GET['token'] ?? $_POST['token'] ?? ''));
    return $fallback !== '' ? $fallback : null;
}

function authenticateByToken(PDO $pdo, ?string $plainToken): array|false
{
    if (!$plainToken) {
        return false;
    }

    ensureAuthTables($pdo);
    purgeExpiredTokens($pdo);

    $tokenHash = hash('sha256', $plainToken);

    $statement = $pdo->prepare(
        'SELECT
            u.id,
            u.full_name,
            u.username,
            u.role,
            t.id AS token_id,
            t.expires_at
        FROM user_tokens t
        INNER JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = :token_hash
          AND t.expires_at > NOW()
          AND u.is_active = 1
        LIMIT 1'
    );
    $statement->execute(['token_hash' => $tokenHash]);
    $user = $statement->fetch();

    if (!$user) {
        return false;
    }

    $pdo->prepare(
        'UPDATE user_tokens SET last_used_at = NOW() WHERE id = :id LIMIT 1'
    )->execute(['id' => $user['token_id']]);

    return $user;
}

function requireAuthenticatedUser(): array
{
    $pdo = getDbConnection();
    $user = authenticateByToken($pdo, getBearerToken());

    if (!$user) {
        sendJson([
            'success' => false,
            'message' => 'Bu islem icin giris yapmaniz gerekiyor.',
            'timestamp' => date('c'),
        ], 401);
    }

    return [
        'id' => (int) $user['id'],
        'full_name' => $user['full_name'],
        'username' => $user['username'],
        'role' => $user['role'],
    ];
}

function issueUserToken(PDO $pdo, int $userId, int $days = 30): string
{
    ensureAuthTables($pdo);
    purgeExpiredTokens($pdo);

    $plainToken = bin2hex(random_bytes(32));
    $tokenHash = hash('sha256', $plainToken);

    $statement = $pdo->prepare(
        'INSERT INTO user_tokens (user_id, token_hash, expires_at, last_used_at)
        VALUES (:user_id, :token_hash, DATE_ADD(NOW(), INTERVAL :days DAY), NOW())'
    );
    $statement->bindValue('user_id', $userId, PDO::PARAM_INT);
    $statement->bindValue('token_hash', $tokenHash, PDO::PARAM_STR);
    $statement->bindValue('days', $days, PDO::PARAM_INT);
    $statement->execute();

    return $plainToken;
}

function revokeUserToken(PDO $pdo, ?string $plainToken): void
{
    if (!$plainToken) {
        return;
    }

    ensureAuthTables($pdo);
    $tokenHash = hash('sha256', $plainToken);

    $pdo->prepare('DELETE FROM user_tokens WHERE token_hash = :token_hash')
        ->execute(['token_hash' => $tokenHash]);
}

function purgeExpiredTokens(PDO $pdo): void
{
    $pdo->exec('DELETE FROM user_tokens WHERE expires_at <= NOW()');
}

function findUserByUsername(PDO $pdo, string $username): array|false
{
    $statement = $pdo->prepare(
        'SELECT id, full_name, username, password_hash, role, is_active
        FROM users
        WHERE LOWER(username) = LOWER(:username)
        LIMIT 1'
    );
    $statement->execute(['username' => trim($username)]);

    return $statement->fetch();
}

function createUser(PDO $pdo, string $fullName, string $username, string $password, string $role = 'admin'): array
{
    $statement = $pdo->prepare(
        'INSERT INTO users (full_name, username, password_hash, role, is_active)
        VALUES (:full_name, :username, :password_hash, :role, 1)'
    );
    $statement->execute([
        'full_name' => trim($fullName),
        'username' => trim($username),
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
        'role' => $role,
    ]);

    return [
        'id' => (int) $pdo->lastInsertId(),
        'full_name' => trim($fullName),
        'username' => trim($username),
        'role' => $role,
    ];
}

function seedDefaultUsers(PDO $pdo): array
{
    $defaults = [
        ['full_name' => 'Yonetici', 'username' => 'admin', 'password' => 'trackdesk2026!'],
    ];

    $created = [];
    foreach ($defaults as $user) {
        if (!findUserByUsername($pdo, $user['username'])) {
            $created[] = createUser($pdo, $user['full_name'], $user['username'], $user['password']);
        }
    }

    return $created;
}
