<?php
declare(strict_types=1);

namespace App\Util\CardFile;

use App\Model\Card;
use App\Model\CardFile;
use App\Model\Order;
use App\Util\Schema;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * Lifecycle of stored archives.
 *
 * - unsold card deleted          → archive deleted
 * - delivered card deleted       → archive kept for the buyer, detached from the card (card_id NULL)
 *                                  so a recycled card id can never pick it up again
 * - order deleted, card gone too → archive deleted
 * - staged upload never stocked  → deleted after STAGED_TTL
 *
 * Nothing here throws: callers run it after their own work has already committed.
 */
final class Purge
{
    public const STAGED_TTL = 86400;
    public const INTERVAL = 3600;

    private const BATCH = 500;
    private const SCAN_LIMIT = 2000;
    private const MARKER = '.gc';

    /**
     * Call after cards were deleted.
     * @param int[] $cardIds
     * @return int archives deleted
     */
    public static function forCards(array $cardIds): int
    {
        try {
            $ids = self::ids($cardIds);
            if ($ids === [] || !Schema::tableExists('card_file')) {
                return 0;
            }
            $removed = 0;
            foreach (array_chunk($ids, self::BATCH) as $chunk) {
                $alive = self::existing(Card::query(), $chunk);
                $gone = array_values(array_diff($chunk, $alive));
                if ($gone === []) {
                    continue;
                }
                $rows = CardFile::query()->whereIn('card_id', $gone)->get(['id', 'card_id', 'order_id', 'path']);
                $orderIds = [];
                foreach ($rows as $row) {
                    if ($row->order_id !== null) {
                        $orderIds[] = (int)$row->order_id;
                    }
                }
                $liveOrders = array_flip(self::existing(Order::query(), $orderIds));
                foreach ($rows as $row) {
                    if ($row->order_id !== null && isset($liveOrders[(int)$row->order_id])) {
                        CardFile::query()->whereKey($row->id)->where('card_id', $row->card_id)->update(['card_id' => null]);
                        continue;
                    }
                    if (self::deleteRow($row)) {
                        $removed++;
                    }
                }
            }
            return $removed;
        } catch (\Throwable $e) {
            return 0;
        }
    }

    /**
     * Call after orders were deleted. Archives whose card is gone as well are deleted; an archive
     * whose card is still listed stays with that card.
     * @param int[] $orderIds
     * @return int archives deleted
     */
    public static function forOrders(array $orderIds): int
    {
        try {
            $ids = self::ids($orderIds);
            if ($ids === [] || !Schema::tableExists('card_file')) {
                return 0;
            }
            $removed = 0;
            foreach (array_chunk($ids, self::BATCH) as $chunk) {
                $alive = self::existing(Order::query(), $chunk);
                $gone = array_values(array_diff($chunk, $alive));
                if ($gone === []) {
                    continue;
                }
                $rows = CardFile::query()->whereIn('order_id', $gone)->get(['id', 'card_id', 'order_id', 'path']);
                $cardIds = [];
                foreach ($rows as $row) {
                    if ($row->card_id !== null) {
                        $cardIds[] = (int)$row->card_id;
                    }
                }
                $liveCards = array_flip(self::existing(Card::query(), $cardIds));
                foreach ($rows as $row) {
                    if ($row->card_id !== null && isset($liveCards[(int)$row->card_id])) {
                        continue;
                    }
                    if (self::deleteRow($row)) {
                        $removed++;
                    }
                }
            }
            return $removed;
        } catch (\Throwable $e) {
            return 0;
        }
    }

    /**
     * Delete staged (uploaded, never stocked) system archives.
     * @param int[] $fileIds
     * @return int archives deleted
     */
    public static function staged(array $fileIds): int
    {
        try {
            $ids = self::ids($fileIds);
            if ($ids === [] || !Schema::tableExists('card_file')) {
                return 0;
            }
            $removed = 0;
            foreach (array_chunk($ids, self::BATCH) as $chunk) {
                $rows = CardFile::query()
                    ->whereIn('id', $chunk)
                    ->where('owner', 0)
                    ->whereNull('card_id')
                    ->whereNull('order_id')
                    ->get(['id', 'card_id', 'order_id', 'path']);
                foreach ($rows as $row) {
                    if (self::deleteRow($row, static function (Builder $query): void {
                        $query->where('owner', 0);
                    })) {
                        $removed++;
                    }
                }
            }
            return $removed;
        } catch (\Throwable $e) {
            return 0;
        }
    }

    /**
     * Rows whose card and order are both gone (e.g. after a commodity delete cascaded through
     * card and order), and delivered rows still pointing at a deleted card. One bounded batch.
     * @return array{0: int, 1: int} [deleted, detached]
     */
    public static function orphans(): array
    {
        try {
            if (!Schema::tableExists('card_file')) {
                return [0, 0];
            }
            return self::orphanRows();
        } catch (\Throwable $e) {
            return [0, 0];
        }
    }

    /**
     * Drain orphans after a bulk delete (commodity/category cascade) committed; the hourly
     * collect() picks up whatever exceeds $rounds batches.
     */
    public static function sweepOrphans(int $rounds = 40): void
    {
        for ($round = 0; $round < $rounds; $round++) {
            [$deleted, $detached] = self::orphans();
            if ($deleted + $detached < self::BATCH) {
                return;
            }
        }
    }

    /**
     * Garbage collection, at most once per INTERVAL (marker file runtime/card-file/.gc).
     * @return array<string, int>|null what was removed; null when skipped
     */
    public static function collect(bool $force = false): ?array
    {
        try {
            $root = Storage::root();
            if (!is_dir($root) && !@mkdir($root, 0755, true) && !is_dir($root)) {
                return null;
            }
            $handle = @fopen($root . '/' . self::MARKER, 'c+b');
            if ($handle === false) {
                return null;
            }
            try {
                if (!flock($handle, LOCK_EX | LOCK_NB)) {
                    return null;
                }
                $state = json_decode((string)stream_get_contents($handle), true);
                $now = time();
                $last = is_array($state) ? (int)($state['time'] ?? 0) : 0;
                if (!$force && $last <= $now && $now - $last < self::INTERVAL) {
                    return null;
                }
                $cursor = is_array($state) && is_string($state['cursor'] ?? null) ? $state['cursor'] : '';
                if (preg_match('~^[a-f0-9]{2}$~', $cursor) !== 1) {
                    $cursor = '';
                }
                // Stamp first: a run that dies half-way must not be retried on every request.
                self::saveState($handle, $now, $cursor);

                $report = ['sessions' => 0, 'staged' => 0, 'orphans' => 0, 'detached' => 0, 'files' => 0];
                try {
                    $report['sessions'] = Upload::purgeExpired($now);
                } catch (\Throwable $e) {
                }
                if (Schema::tableExists('card_file')) {
                    try {
                        $report['staged'] = self::stale($now);
                    } catch (\Throwable $e) {
                    }
                    try {
                        [$report['orphans'], $report['detached']] = self::orphanRows();
                    } catch (\Throwable $e) {
                    }
                    try {
                        [$report['files'], $cursor] = self::orphanFiles($cursor, $now);
                    } catch (\Throwable $e) {
                    }
                }
                self::saveState($handle, $now, $cursor);
                return $report;
            } finally {
                flock($handle, LOCK_UN);
                fclose($handle);
            }
        } catch (\Throwable $e) {
            return null;
        }
    }

    /** Staged rows older than STAGED_TTL. */
    private static function stale(int $now): int
    {
        $cutoff = date('Y-m-d H:i:s', $now - self::STAGED_TTL);
        $rows = CardFile::query()
            ->whereNull('card_id')
            ->whereNull('order_id')
            ->where('create_time', '<', $cutoff)
            ->orderBy('id')
            ->limit(self::BATCH)
            ->get(['id', 'card_id', 'order_id', 'path']);
        $removed = 0;
        foreach ($rows as $row) {
            if (self::deleteRow($row, static function (Builder $query) use ($cutoff): void {
                $query->where('create_time', '<', $cutoff);
            })) {
                $removed++;
            }
        }
        return $removed;
    }

    /** @return array{0: int, 1: int} [deleted, detached] */
    private static function orphanRows(): array
    {
        $rows = CardFile::query()
            ->where(static function (Builder $query): void {
                $query->where(static function (Builder $query): void {
                    $query->whereNotNull('card_id')->whereNotExists(self::cardOfFile());
                })->orWhere(static function (Builder $query): void {
                    $query->whereNull('card_id')->whereNotNull('order_id');
                });
            })
            ->where(static function (Builder $query): void {
                $query->whereNull('order_id')->orWhereNotExists(self::orderOfFile());
            })
            ->orderBy('id')
            ->limit(self::BATCH)
            ->get(['id', 'card_id', 'order_id', 'path']);
        $removed = 0;
        foreach ($rows as $row) {
            if (self::deleteRow($row)) {
                $removed++;
            }
        }

        $detachIds = CardFile::query()
            ->whereNotNull('card_id')
            ->whereNotNull('order_id')
            ->whereNotExists(self::cardOfFile())
            ->whereExists(self::orderOfFile())
            ->orderBy('id')
            ->limit(self::BATCH)
            ->pluck('id')
            ->all();
        $detached = $detachIds === [] ? 0 : CardFile::query()
            ->whereIn('id', $detachIds)
            ->whereNotNull('card_id')
            ->whereNotExists(self::cardOfFile())
            ->update(['card_id' => null]);

        return [$removed, (int)$detached];
    }

    /**
     * Stored files without a row, older than STAGED_TTL. Walks the store directories from $cursor
     * and stops after SCAN_LIMIT entries; returns [deleted, next cursor].
     * @return array{0: int, 1: string}
     */
    private static function orphanFiles(string $cursor, int $now): array
    {
        $store = Storage::root() . '/store';
        if (!is_dir($store)) {
            return [0, ''];
        }
        $dirs = [];
        foreach (@scandir($store) ?: [] as $entry) {
            if (preg_match('~^[a-f0-9]{2}$~', $entry) && is_dir($store . '/' . $entry)) {
                $dirs[] = $entry;
            }
        }
        sort($dirs, SORT_STRING);
        $count = count($dirs);
        if ($count === 0) {
            return [0, ''];
        }
        $start = 0;
        foreach ($dirs as $index => $dir) {
            if (strcmp($dir, $cursor) >= 0) {
                $start = $index;
                break;
            }
        }

        $removed = 0;
        $scanned = 0;
        $next = '';
        for ($step = 0; $step < $count; $step++) {
            $dir = $dirs[($start + $step) % $count];
            if ($scanned >= self::SCAN_LIMIT) {
                $next = $dir;
                break;
            }
            $candidates = [];
            foreach (@scandir($store . '/' . $dir) ?: [] as $entry) {
                if (!preg_match('~^[a-f0-9]{64}$~', $entry) || substr($entry, 0, 2) !== $dir) {
                    continue;
                }
                $scanned++;
                $relative = 'store/' . $dir . '/' . $entry;
                $mtime = @filemtime($store . '/' . $dir . '/' . $entry);
                if ($mtime !== false && $mtime + self::STAGED_TTL <= $now && Storage::isValidPath($relative)) {
                    $candidates[] = $relative;
                }
            }
            foreach (array_chunk($candidates, self::BATCH) as $chunk) {
                $known = array_flip(CardFile::query()->whereIn('path', $chunk)->pluck('path')->all());
                foreach ($chunk as $relative) {
                    if (!isset($known[$relative]) && Storage::delete($relative)) {
                        $removed++;
                    }
                }
            }
        }
        return [$removed, $next];
    }

    /** Delete a row only if it is still in the state it was read in, then its file. */
    private static function deleteRow(CardFile $row, ?callable $constrain = null): bool
    {
        $query = CardFile::query()->whereKey($row->id);
        $row->card_id === null ? $query->whereNull('card_id') : $query->where('card_id', $row->card_id);
        $row->order_id === null ? $query->whereNull('order_id') : $query->where('order_id', $row->order_id);
        if ($constrain !== null) {
            $constrain($query);
        }
        if ($query->delete() < 1) {
            return false;
        }
        Storage::delete((string)$row->path);
        return true;
    }

    private static function cardOfFile(): \Closure
    {
        $card = (new Card())->getTable();
        $file = (new CardFile())->getTable();
        return static function (QueryBuilder $query) use ($card, $file): void {
            $query->selectRaw('1')->from($card)->whereColumn($card . '.id', $file . '.card_id');
        };
    }

    private static function orderOfFile(): \Closure
    {
        $order = (new Order())->getTable();
        $file = (new CardFile())->getTable();
        return static function (QueryBuilder $query) use ($order, $file): void {
            $query->selectRaw('1')->from($order)->whereColumn($order . '.id', $file . '.order_id');
        };
    }

    /**
     * @param int[] $ids
     * @return int[] those of $ids present in the model's table
     */
    private static function existing(Builder $query, array $ids): array
    {
        $ids = self::ids($ids);
        if ($ids === []) {
            return [];
        }
        return $query->whereIn('id', $ids)->pluck('id')->map(static fn($id): int => (int)$id)->all();
    }

    /**
     * @param mixed[] $values
     * @return int[]
     */
    private static function ids(array $values): array
    {
        $ids = [];
        foreach ($values as $value) {
            if (is_int($value) || (is_string($value) && ctype_digit($value))) {
                $id = (int)$value;
                if ($id > 0) {
                    $ids[$id] = $id;
                }
            }
        }
        return array_values($ids);
    }

    /** @param resource $handle */
    private static function saveState($handle, int $time, string $cursor): void
    {
        $state = (string)json_encode(['time' => $time, 'cursor' => $cursor]);
        if (ftruncate($handle, 0) && rewind($handle)) {
            fwrite($handle, $state);
            fflush($handle);
        }
    }
}
