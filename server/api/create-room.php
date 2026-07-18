<?php

declare(strict_types=1);

require __DIR__ . '/../lib/http.php';
require __DIR__ . '/../lib/RoomStore.php';

send_cors_headers();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Method not allowed', 405);
}

$body = read_json_body();
$hostName = require_string($body, 'hostName', 24);

try {
    $created = RoomStore::createRoom($hostName);
} catch (Throwable $e) {
    json_error('Failed to create room', 500);
}

json_response([
    'roomCode' => $created['code'],
    'peerId' => $created['room']['hostPeerId'],
]);
