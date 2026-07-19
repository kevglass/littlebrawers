<?php

declare(strict_types=1);

/**
 * Flat-file user accounts and session tokens.
 *
 * Users are stored at data/users/{lc_username}.json.
 * Sessions (tokens) are stored at data/sessions/{token}.json.
 * Usernames are case-insensitive for lookup but case-preserved for display.
 */
final class UserStore
{
    private const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
    private const USERNAME_PATTERN = '/^[A-Za-z0-9_]{3,20}$/';

    public static function usersDir(): string
    {
        return __DIR__ . '/../data/users';
    }

    public static function sessionsDir(): string
    {
        return __DIR__ . '/../data/sessions';
    }

    private static function userPath(string $username): string
    {
        $safe = preg_replace('/[^a-z0-9_]/', '', strtolower($username)) ?? '';
        return self::usersDir() . '/' . $safe . '.json';
    }

    private static function sessionPath(string $token): string
    {
        $safe = preg_replace('/[^a-f0-9]/', '', $token) ?? '';
        return self::sessionsDir() . '/' . $safe . '.json';
    }

    public static function isValidUsername(string $username): bool
    {
        return (bool) preg_match(self::USERNAME_PATTERN, $username);
    }

    /** Returns true if a registered account exists with this username (case-insensitive). */
    public static function isUsernameTaken(string $username): bool
    {
        return file_exists(self::userPath($username));
    }

    /** @return array<string,mixed>|null */
    public static function findByUsername(string $username): ?array
    {
        $path = self::userPath($username);
        if (!file_exists($path)) return null;
        $data = json_decode(file_get_contents($path) ?: '', true);
        return is_array($data) ? $data : null;
    }

    /** @return array<string,mixed>|null */
    public static function findByEmail(string $email): ?array
    {
        $dir = self::usersDir();
        if (!is_dir($dir)) return null;
        foreach (glob($dir . '/*.json') ?: [] as $file) {
            $data = json_decode(file_get_contents($file) ?: '', true);
            if (is_array($data) && strtolower($data['email'] ?? '') === strtolower($email)) {
                return $data;
            }
        }
        return null;
    }

    /**
     * Register a new user. Returns the created user array on success, or throws on failure.
     * @return array<string,mixed>
     */
    public static function register(string $username, string $email, string $password): array
    {
        if (!self::isValidUsername($username)) {
            throw new InvalidArgumentException('Username must be 3–20 characters: letters, numbers, underscores only');
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException('Invalid email address');
        }
        if (strlen($password) < 8) {
            throw new InvalidArgumentException('Password must be at least 8 characters');
        }
        if (self::isUsernameTaken($username)) {
            throw new RuntimeException('Username already taken');
        }
        if (self::findByEmail($email) !== null) {
            throw new RuntimeException('An account with that email already exists');
        }

        if (!is_dir(self::usersDir())) mkdir(self::usersDir(), 0775, true);

        $user = [
            'userId'       => bin2hex(random_bytes(12)),
            'username'     => $username,
            'email'        => strtolower($email),
            'passwordHash' => password_hash($password, PASSWORD_BCRYPT),
            'createdAt'    => time(),
        ];

        $path = self::userPath($username);
        // Atomic write: create temp file then rename so we never write partial JSON
        $tmp = $path . '.tmp.' . getmypid();
        file_put_contents($tmp, json_encode($user, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        rename($tmp, $path);

        return $user;
    }

    /**
     * Verify credentials (username OR email + password). Returns a session token on success.
     */
    public static function login(string $usernameOrEmail, string $password): string
    {
        $user = filter_var($usernameOrEmail, FILTER_VALIDATE_EMAIL)
            ? self::findByEmail($usernameOrEmail)
            : self::findByUsername($usernameOrEmail);

        if ($user === null || !password_verify($password, $user['passwordHash'])) {
            throw new RuntimeException('Invalid username or password');
        }

        return self::createSession($user['username']);
    }

    private static function createSession(string $username): string
    {
        if (!is_dir(self::sessionsDir())) mkdir(self::sessionsDir(), 0775, true);

        $token = bin2hex(random_bytes(32));
        $now = time();
        $session = [
            'token'     => $token,
            'username'  => $username,
            'createdAt' => $now,
            'expiresAt' => $now + self::SESSION_TTL_SECONDS,
        ];
        file_put_contents(self::sessionPath($token), json_encode($session, JSON_PRETTY_PRINT));
        return $token;
    }

    /**
     * Verify a session token. Returns `['username' => ...]` on success or null if invalid/expired.
     * @return array<string,mixed>|null
     */
    public static function verifyToken(string $token): ?array
    {
        $path = self::sessionPath($token);
        if (!file_exists($path)) return null;
        $session = json_decode(file_get_contents($path) ?: '', true);
        if (!is_array($session)) return null;
        if (($session['expiresAt'] ?? 0) < time()) {
            @unlink($path); // expired
            return null;
        }
        // Touch to keep session alive
        @touch($path);
        return $session;
    }

    public static function logout(string $token): void
    {
        @unlink(self::sessionPath($token));
    }
}
