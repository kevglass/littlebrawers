<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/UserStore.php';

send_cors_headers();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Method not allowed', 405);

$body = read_json_body();
$username = require_string($body, 'username', 20);
$email    = require_string($body, 'email', 254);
$password = require_string($body, 'password', 128);

try {
    $user  = UserStore::register($username, $email, $password);
    $token = UserStore::login($username, $password);
} catch (InvalidArgumentException $e) {
    json_error($e->getMessage(), 400);
} catch (RuntimeException $e) {
    json_error($e->getMessage(), 409);
}

json_response(['token' => $token, 'username' => $user['username']]);
