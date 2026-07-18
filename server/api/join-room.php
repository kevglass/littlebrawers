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
$playerName = require_string($body, 'playerName', 24);

$result = RoomStore::joinRoom($roomCode, $playerName);
if ($result === null) {
    json_error('Room not found or full', 404);
}

json_response([
    'roomCode' => strtoupper($roomCode),
    'peerId' => $result['peerId'],
    'hostPeerId' => $result['hostPeerId'],
]);
