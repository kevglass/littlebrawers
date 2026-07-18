<?php

declare(strict_types=1);

require __DIR__ . '/../lib/http.php';
require __DIR__ . '/../lib/RoomStore.php';

send_cors_headers();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Method not allowed', 405);
}

$body = read_json_body();
$roomCode = require_string($body, 'roomCode', 12);
$from = require_string($body, 'from', 64);
$to = require_string($body, 'to', 64);
$type = require_string($body, 'type', 32);

if (!in_array($type, ['offer', 'answer', 'ice-candidate'], true)) {
    json_error('Invalid signal type');
}

$ok = RoomStore::sendSignal($roomCode, $from, $to, $type, $body['payload'] ?? null);
if (!$ok) {
    json_error('Room or peer not found', 404);
}

json_response(['ok' => true]);
