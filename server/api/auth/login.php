<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/UserStore.php';

send_cors_headers();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Method not allowed', 405);

$body           = read_json_body();
$usernameOrEmail = require_string($body, 'usernameOrEmail', 254);
$password       = require_string($body, 'password', 128);

try {
    $token = UserStore::login($usernameOrEmail, $password);
} catch (RuntimeException $e) {
    json_error($e->getMessage(), 401);
}

// Return the canonical username (resolves case / email → username)
$session = UserStore::verifyToken($token);
json_response(['token' => $token, 'username' => $session['username']]);
