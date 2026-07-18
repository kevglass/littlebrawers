<?php

declare(strict_types=1);

require __DIR__ . '/../lib/http.php';
require __DIR__ . '/../lib/RoomStore.php';

send_cors_headers();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_error('Method not allowed', 405);
}

$roomCode = (string) ($_GET['roomCode'] ?? '');
$peerId = (string) ($_GET['peerId'] ?? '');
$since = (int) ($_GET['since'] ?? 0);

if ($roomCode === '' || $peerId === '') {
    json_error('Missing roomCode or peerId');
}

$result = RoomStore::poll($roomCode, $peerId, $since);
if ($result === null) {
    json_error('Room or peer not found', 404);
}

json_response($result);
