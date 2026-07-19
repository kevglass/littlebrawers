<?php

declare(strict_types=1);

require __DIR__ . '/../lib/http.php';
require __DIR__ . '/../lib/RoomStore.php';
require __DIR__ . '/../lib/UserStore.php';

send_cors_headers();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Method not allowed', 405);

$body       = read_json_body();
$playerName = require_string($body, 'playerName', 20);
$authToken  = is_string($body['authToken'] ?? null) ? $body['authToken'] : null;

$characterModel = $body['characterModel'] ?? null;
if (!in_array($characterModel, ['mina', 'shelly', 'el-primo'], true)) {
    $characterModel = 'mina';
}

if ($authToken !== null) {
    // Authenticated: use the registered username regardless of what playerName was sent
    $session = UserStore::verifyToken($authToken);
    if ($session === null) json_error('Invalid or expired session — please log in again', 401);
    $playerName = $session['username'];
} else {
    // Guest: reject if the requested name is already registered
    if (!UserStore::isValidUsername($playerName)) {
        json_error('Name must be 3–20 characters: letters, numbers, underscores only', 400);
    }
    if (UserStore::isUsernameTaken($playerName)) {
        json_error('That name is registered. Log in to use it, or choose a different name.', 409);
    }
}

try {
    $result = RoomStore::findOrCreateMatchRoom($playerName, $characterModel);
} catch (Throwable $e) {
    json_error('Matchmaking failed: ' . $e->getMessage(), 500);
}

json_response($result);
