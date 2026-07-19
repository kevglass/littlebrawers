<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/UserStore.php';

send_cors_headers();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Method not allowed', 405);

$body  = read_json_body();
$token = require_string($body, 'token', 128);

$session = UserStore::verifyToken($token);
if ($session === null) json_error('Invalid or expired token', 401);

json_response(['username' => $session['username']]);
