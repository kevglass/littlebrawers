<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/MapStore.php';

send_cors_headers();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Method not allowed', 405);
}

$body = read_json_body();
if (!isset($body['id'], $body['tiles'], $body['width'], $body['height'])) {
    json_error('Invalid map data');
}

try {
    MapStore::save($body);
} catch (Throwable $e) {
    json_error('Failed to save map', 500);
}

json_response(['ok' => true, 'id' => $body['id']]);
