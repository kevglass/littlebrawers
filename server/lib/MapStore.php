<?php

declare(strict_types=1);

/**
 * Flat-file storage for level-editor maps. Each map is one JSON file at
 * data/maps/{id}.json, keyed by the MapData.id (a uuid) generated client-side.
 */
final class MapStore
{
    public static function dataDir(): string
    {
        return __DIR__ . '/../data/maps';
    }

    private static function pathFor(string $id): string
    {
        $safe = preg_replace('/[^A-Za-z0-9-]/', '', $id) ?? '';
        if ($safe === '') {
            throw new InvalidArgumentException('Invalid map id');
        }
        return self::dataDir() . '/' . $safe . '.json';
    }

    /** @return array<int, array{id:string, name:string, width:int, height:int, updatedAt:int}> */
    public static function list(): array
    {
        $dir = self::dataDir();
        if (!is_dir($dir)) {
            return [];
        }

        $summaries = [];
        foreach (glob($dir . '/*.json') ?: [] as $file) {
            $raw = file_get_contents($file);
            $data = $raw !== false ? json_decode($raw, true) : null;
            if (!is_array($data)) {
                continue;
            }
            $summaries[] = [
                'id' => $data['id'] ?? basename($file, '.json'),
                'name' => $data['name'] ?? 'Untitled',
                'width' => $data['width'] ?? 0,
                'height' => $data['height'] ?? 0,
                'updatedAt' => filemtime($file) ?: 0,
            ];
        }

        usort($summaries, fn($a, $b) => $b['updatedAt'] <=> $a['updatedAt']);
        return $summaries;
    }

    /** @return array<string,mixed>|null */
    public static function get(string $id): ?array
    {
        $path = self::pathFor($id);
        if (!file_exists($path)) {
            return null;
        }
        $raw = file_get_contents($path);
        $data = $raw !== false ? json_decode($raw, true) : null;
        return is_array($data) ? $data : null;
    }

    /** @param array<string,mixed> $mapData */
    public static function save(array $mapData): void
    {
        if (!is_dir(self::dataDir())) {
            mkdir(self::dataDir(), 0775, true);
        }
        $id = $mapData['id'] ?? null;
        if (!is_string($id) || $id === '') {
            throw new InvalidArgumentException('Map data missing id');
        }
        file_put_contents(self::pathFor($id), json_encode($mapData, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    }

    public static function delete(string $id): void
    {
        @unlink(self::pathFor($id));
    }
}
