<?php

declare(strict_types=1);

require __DIR__ . '/../lib/http.php';
require __DIR__ . '/../lib/RoomStore.php';

send_cors_headers();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_error('Method not allowed', 405);

$body     = read_json_body();
$roomCode = require_string($body, 'roomCode', 6);

RoomStore::markStarted($roomCode);
json_response(['ok' => true]);
