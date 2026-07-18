<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/MapStore.php';

send_cors_headers();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_error('Method not allowed', 405);
}

$body = read_json_body();
$id = require_string($body, 'id', 64);

MapStore::delete($id);

json_response(['ok' => true]);
