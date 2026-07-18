<?php

declare(strict_types=1);

/**
 * Flat-file backed room storage for WebRTC signaling.
 *
 * Each room is a single JSON file under data/rooms/{CODE}.json. All reads
 * that precede a write take an exclusive flock on that file so concurrent
 * requests (join + signal + poll happening at once from different players)
 * don't clobber each other.
 */
final class RoomStore
{
    private const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
    private const ROOM_CODE_LENGTH = 6;
    private const ROOM_TTL_SECONDS = 2 * 60 * 60;
    private const MAX_PLAYERS = 10;
    private const MAX_INBOX_SIZE = 500;

    public static function dataDir(): string
    {
        return __DIR__ . '/../data/rooms';
    }

    private static function pathFor(string $code): string
    {
        $safe = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code) ?? '');
        return self::dataDir() . '/' . $safe . '.json';
    }

    public static function generatePeerId(): string
    {
        return bin2hex(random_bytes(12));
    }

    private static function generateRoomCode(): string
    {
        $alphabetLength = strlen(self::ROOM_CODE_ALPHABET);
        $code = '';
        for ($i = 0; $i < self::ROOM_CODE_LENGTH; $i++) {
            $code .= self::ROOM_CODE_ALPHABET[random_int(0, $alphabetLength - 1)];
        }
        return $code;
    }

    /**
     * Opens (creating if needed) the room file, takes an exclusive lock,
     * hands the decoded room array to $mutator, writes back whatever it
     * returns, then releases the lock. Returning null aborts the write
     * (the file is left untouched) and this method returns null.
     *
     * @param callable(array<string,mixed>|null): (array<string,mixed>|null) $mutator
     * @return array<string,mixed>|null
     */
    public static function withRoom(string $code, callable $mutator): ?array
    {
        $path = self::pathFor($code);
        $handle = fopen($path, 'c+');
        if ($handle === false) {
            throw new RuntimeException('Could not open room file');
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                throw new RuntimeException('Could not lock room file');
            }

            $raw = stream_get_contents($handle);
            $room = ($raw === false || $raw === '') ? null : json_decode($raw, true);
            if (!is_array($room)) {
                $room = null;
            }

            $result = $mutator($room);

            if ($result !== null) {
                ftruncate($handle, 0);
                rewind($handle);
                fwrite($handle, json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
                fflush($handle);
            }

            return $result;
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    /** @return array{code:string, room:array<string,mixed>} */
    public static function createRoom(string $hostName): array
    {
        self::garbageCollect();

        if (!is_dir(self::dataDir())) {
            mkdir(self::dataDir(), 0775, true);
        }

        $hostPeerId = self::generatePeerId();
        $now = time();

        for ($attempt = 0; $attempt < 20; $attempt++) {
            $code = self::generateRoomCode();
            $path = self::pathFor($code);
            if (file_exists($path)) {
                continue;
            }

            $room = self::withRoom($code, function ($existing) use ($code, $hostPeerId, $hostName, $now) {
                if ($existing !== null) {
                    return null; // race: someone else created it first, retry with new code
                }
                return [
                    'code' => $code,
                    'hostPeerId' => $hostPeerId,
                    'createdAt' => $now,
                    'nextSeq' => 1,
                    'players' => [
                        $hostPeerId => [
                            'name' => $hostName,
                            'isHost' => true,
                            'joinedAt' => $now,
                        ],
                    ],
                    'inboxes' => [$hostPeerId => []],
                ];
            });

            if ($room !== null) {
                return ['code' => $code, 'room' => $room];
            }
        }

        throw new RuntimeException('Failed to allocate a room code');
    }

    /** @return array{peerId:string, hostPeerId:string}|null */
    public static function joinRoom(string $code, string $playerName): ?array
    {
        $peerId = self::generatePeerId();
        $now = time();
        $hostPeerId = null;

        $room = self::withRoom($code, function ($room) use ($peerId, $playerName, $now, &$hostPeerId) {
            if ($room === null) {
                return null;
            }
            if (count($room['players']) >= self::MAX_PLAYERS) {
                return null;
            }
            $hostPeerId = $room['hostPeerId'];
            $room['players'][$peerId] = [
                'name' => $playerName,
                'isHost' => false,
                'joinedAt' => $now,
            ];
            $room['inboxes'][$peerId] = [];
            return $room;
        });

        if ($room === null || $hostPeerId === null) {
            return null;
        }

        return ['peerId' => $peerId, 'hostPeerId' => $hostPeerId];
    }

    public static function sendSignal(string $code, string $from, string $to, string $type, mixed $payload): bool
    {
        $ok = self::withRoom($code, function ($room) use ($from, $to, $type, $payload) {
            if ($room === null || !isset($room['players'][$to])) {
                return null;
            }
            $seq = $room['nextSeq'];
            $room['nextSeq'] = $seq + 1;

            $room['inboxes'][$to] ??= [];
            $room['inboxes'][$to][] = [
                'seq' => $seq,
                'from' => $from,
                'to' => $to,
                'type' => $type,
                'payload' => $payload,
                'ts' => time(),
            ];
            if (count($room['inboxes'][$to]) > self::MAX_INBOX_SIZE) {
                $room['inboxes'][$to] = array_slice($room['inboxes'][$to], -self::MAX_INBOX_SIZE);
            }
            return $room;
        });

        return $ok !== null;
    }

    /** @return array{envelopes: array<int, array<string,mixed>>, roster: array<int, array<string,mixed>>}|null */
    public static function poll(string $code, string $peerId, int $since): ?array
    {
        $room = self::withRoom($code, fn($room) => $room); // read-only, no mutation
        if ($room === null || !isset($room['players'][$peerId])) {
            return null;
        }

        $inbox = $room['inboxes'][$peerId] ?? [];
        $envelopes = array_values(array_filter($inbox, fn($e) => $e['seq'] > $since));

        $roster = [];
        foreach ($room['players'] as $id => $info) {
            $roster[] = [
                'peerId' => $id,
                'name' => $info['name'],
                'isHost' => $info['isHost'],
                'joinedAt' => $info['joinedAt'],
            ];
        }

        return ['envelopes' => $envelopes, 'roster' => $roster];
    }

    public static function leaveRoom(string $code, string $peerId): void
    {
        self::withRoom($code, function ($room) use ($peerId) {
            if ($room === null) {
                return null;
            }
            unset($room['players'][$peerId]);
            unset($room['inboxes'][$peerId]);
            return $room;
        });
    }

    private static function garbageCollect(): void
    {
        $dir = self::dataDir();
        if (!is_dir($dir)) {
            return;
        }
        $now = time();
        foreach (glob($dir . '/*.json') ?: [] as $file) {
            if ($now - filemtime($file) > self::ROOM_TTL_SECONDS) {
                @unlink($file);
            }
        }
    }
}
