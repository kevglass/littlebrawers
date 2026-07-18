<?php

declare(strict_types=1);

require __DIR__ . '/../../lib/http.php';
require __DIR__ . '/../../lib/MapStore.php';

send_cors_headers();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_error('Method not allowed', 405);
}

$id = (string) ($_GET['id'] ?? '');
if ($id === '') {
    json_error('Missing id');
}

$map = MapStore::get($id);
if ($map === null) {
    json_error('Map not found', 404);
}

json_response($map);
