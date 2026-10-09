<?php
declare(strict_types=1);

namespace App\Util\CardFile;

use App\Model\CardFile;
use App\Util\Date;
use Kernel\Exception\JSONException;

/**
 * Resumable chunked uploads of file-card archives.
 *
 * A session is "<upload_id>.part" (bytes received so far) plus "<upload_id>.json" (who uploads
 * what) in Storage::uploadDir(). Every operation on a session holds an exclusive lock on its
 * .json, so appends are strictly sequential: a chunk is written only when its offset equals the
 * bytes already received, otherwise the client is told where to resume. finish() verifies size and
 * signature, then moves the bytes to a fresh random storage name and records a staged card_file.
 */
final class Upload
{
    public const TTL = 86400;
    public const MAX_SESSIONS = 50;
    public const DISK_RESERVE = 67108864;

    private const ID_PATTERN = '~^[a-f0-9]{32}$~';
    private const ENTRY_PATTERN = '~^([a-f0-9]{32})\.(json|part)$~';

    private const INVALID = '上传会话无效或已过期，请重新上传';

    public static function isUploadId(string $value): bool
    {
        return preg_match(self::ID_PATTERN, $value) === 1;
    }

    /**
     * @return array{upload_id: string, name: string, size: int, chunk_size: int, received: int}
     * @throws JSONException
     */
    public static function begin(int $manageId, string $name, int $size): array
    {
        if ($manageId <= 0) {
            throw new JSONException(self::INVALID);
        }
        $name = Archive::sanitizeName($name);
        $extension = Archive::extension($name);
        if ($extension === null) {
            throw new JSONException('只能上传压缩包（zip、rar、7z、tar、gz、bz2、xz、zst 等格式）');
        }
        if ($size <= 0) {
            throw new JSONException('不能上传空文件');
        }
        if ($size > Policy::maxBytes()) {
            throw new JSONException('文件超过大小上限，可在「网站设置」中调整');
        }

        $dir = Storage::uploadDir();
        $now = time();
        [$mine, $pending] = self::openSessions($dir, $manageId, $now);
        if ($mine >= self::MAX_SESSIONS) {
            throw new JSONException('未完成的上传过多，请先完成或取消部分上传');
        }
        $free = Storage::freeSpace();
        if ($free !== null && $free < $size + $pending + self::DISK_RESERVE) {
            throw new JSONException('服务器磁盘空间不足，无法上传该文件');
        }

        $uploadId = '';
        $part = '';
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $uploadId = bin2hex(random_bytes(16));
            $part = $dir . '/' . $uploadId . '.part';
            $handle = @fopen($part, 'xb');
            if ($handle !== false) {
                fclose($handle);
                break;
            }
            $uploadId = '';
        }
        if ($uploadId === '') {
            throw new JSONException('文件存储目录不可用，请检查 runtime 目录的写入权限');
        }

        $meta = json_encode([
            'manage' => $manageId,
            'name' => $name,
            'size' => $size,
            'created' => $now,
            'ext' => $extension,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($meta) || @file_put_contents($dir . '/' . $uploadId . '.json', $meta, LOCK_EX) !== strlen($meta)) {
            @unlink($part);
            @unlink($dir . '/' . $uploadId . '.json');
            throw new JSONException('文件存储目录不可用，请检查 runtime 目录的写入权限');
        }

        return [
            'upload_id' => $uploadId,
            'name' => $name,
            'size' => $size,
            'chunk_size' => Policy::chunkBytes(),
            'received' => 0,
        ];
    }

    /**
     * Append one chunk. A chunk whose offset is not the current size is ignored and the real size
     * returned (accepted = false), which lets the client resume after a lost response.
     *
     * @return array{received: int, accepted: bool}
     * @throws JSONException
     */
    public static function append(int $manageId, string $uploadId, int $offset, string $chunkPath): array
    {
        if ($offset < 0) {
            throw new JSONException('分片位置不正确');
        }
        return self::withSession($manageId, $uploadId, static function (array $meta, string $part) use ($offset, $chunkPath): array {
            $handle = @fopen($part, 'r+b');
            if ($handle === false) {
                throw new JSONException(self::INVALID);
            }
            try {
                $stat = fstat($handle);
                $current = is_array($stat) ? (int)$stat['size'] : -1;
                if ($current < 0) {
                    throw new JSONException('分片写入失败，请重试');
                }
                if ($offset !== $current) {
                    return ['received' => $current, 'accepted' => false];
                }

                clearstatcache(true, $chunkPath);
                $length = @filesize($chunkPath);
                if ($length === false || $length <= 0) {
                    throw new JSONException('分片为空，请重试');
                }
                if ($current + $length > $meta['size']) {
                    throw new JSONException('分片超出了文件的实际大小，请重新上传');
                }

                $source = @fopen($chunkPath, 'rb');
                if ($source === false) {
                    throw new JSONException('分片数据无效，请重试');
                }
                try {
                    fseek($handle, 0, SEEK_END);
                    $copied = stream_copy_to_stream($source, $handle);
                    fflush($handle);
                } finally {
                    fclose($source);
                }
                if ($copied !== $length) {
                    ftruncate($handle, $current);
                    throw new JSONException('分片写入失败，请检查服务器磁盘空间后重试');
                }
                return ['received' => $current + $length, 'accepted' => true];
            } finally {
                fclose($handle);
            }
        });
    }

    /**
     * Validate the assembled archive and store it as a staged card_file (card_id NULL).
     * @throws JSONException
     */
    public static function finish(int $manageId, string $uploadId): CardFile
    {
        $discard = false;
        try {
            $file = self::withSession($manageId, $uploadId, static function (array $meta, string $part) use (&$discard): CardFile {
                clearstatcache(true, $part);
                $size = @filesize($part);
                if ($size === false || $size !== $meta['size']) {
                    throw new JSONException('文件还没有上传完整，请继续上传');
                }
                if (!Archive::matches($part, $meta['ext'])) {
                    $discard = true;
                    throw new JSONException('文件内容与扩展名不符，不是有效的压缩包');
                }
                $hash = @hash_file('sha256', $part);
                if (!is_string($hash) || strlen($hash) !== 64) {
                    throw new JSONException('文件读取失败，请重试');
                }

                $relative = Storage::newPath();
                $target = Storage::absolute($relative);
                if (!@rename($part, $target)) {
                    throw new JSONException('文件保存失败，请检查 runtime 目录的写入权限');
                }
                // rename() keeps the mtime of the last chunk; the orphan sweep keys off mtime.
                @touch($target);

                try {
                    $file = new CardFile();
                    $file->card_id = null;
                    $file->order_id = null;
                    $file->owner = 0;
                    $file->token = Link::newToken();
                    $file->path = $relative;
                    $file->name = $meta['name'];
                    $file->size = $size;
                    $file->hash = $hash;
                    $file->downloads = 0;
                    $file->create_time = Date::current();
                    $file->save();
                } catch (\Throwable $e) {
                    // Put the bytes back so the same session can be finished again.
                    if (!@rename($target, $part)) {
                        Storage::delete($relative);
                    }
                    throw new JSONException('文件记录保存失败，请重试');
                }
                return $file;
            });
        } catch (JSONException $e) {
            if ($discard) {
                self::remove($uploadId);
            }
            throw $e;
        }
        self::remove($uploadId);
        return $file;
    }

    /**
     * Abort a session of this administrator. Unknown or foreign sessions are left alone.
     */
    public static function cancel(int $manageId, string $uploadId): bool
    {
        try {
            self::withSession($manageId, $uploadId, static fn(): bool => true);
        } catch (JSONException $e) {
            return false;
        }
        self::remove($uploadId);
        return true;
    }

    /**
     * Delete sessions older than TTL, plus stray halves of sessions. Sessions busy in another
     * request are skipped. Returns the number of sessions removed.
     */
    public static function purgeExpired(?int $now = null): int
    {
        $now = $now ?? time();
        $dir = Storage::root() . '/upload';
        if (!is_dir($dir)) {
            return 0;
        }
        $ids = [];
        foreach (@scandir($dir) ?: [] as $entry) {
            if (preg_match(self::ENTRY_PATTERN, $entry, $match)) {
                $ids[$match[1]] = true;
            }
        }
        $removed = 0;
        foreach (array_keys($ids) as $uploadId) {
            if (self::expiredOnDisk($dir, (string)$uploadId, $now) && self::remove((string)$uploadId, true)) {
                $removed++;
            }
        }
        return $removed;
    }

    /**
     * Run $callback(meta, partPath) while holding the session lock.
     * @throws JSONException
     */
    private static function withSession(int $manageId, string $uploadId, callable $callback): mixed
    {
        if (!self::isUploadId($uploadId)) {
            throw new JSONException(self::INVALID);
        }
        $dir = Storage::uploadDir();
        $handle = @fopen($dir . '/' . $uploadId . '.json', 'rb');
        if ($handle === false) {
            throw new JSONException(self::INVALID);
        }
        $expired = false;
        try {
            if (!flock($handle, LOCK_EX)) {
                throw new JSONException('上传会话正忙，请稍后重试');
            }
            $meta = self::decodeMeta((string)stream_get_contents($handle));
            if ($meta === null || $meta['manage'] !== $manageId) {
                throw new JSONException(self::INVALID);
            }
            $part = $dir . '/' . $uploadId . '.part';
            if ($meta['created'] + self::TTL <= time()) {
                $expired = true;
            } elseif (!is_file($part)) {
                throw new JSONException(self::INVALID);
            } else {
                return $callback($meta, $part);
            }
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
        if ($expired) {
            self::remove($uploadId);
        }
        throw new JSONException('上传会话已过期，请重新上传');
    }

    /**
     * @return array{manage: int, name: string, size: int, created: int, ext: string}|null
     */
    private static function decodeMeta(string $contents): ?array
    {
        $meta = json_decode($contents, true);
        if (!is_array($meta)
            || !is_int($meta['manage'] ?? null)
            || !is_string($meta['name'] ?? null) || $meta['name'] === ''
            || !is_int($meta['size'] ?? null) || $meta['size'] <= 0
            || !is_int($meta['created'] ?? null)
            || !is_string($meta['ext'] ?? null) || Archive::extension('.' . $meta['ext']) !== $meta['ext']) {
            return null;
        }
        return [
            'manage' => $meta['manage'],
            'name' => $meta['name'],
            'size' => $meta['size'],
            'created' => $meta['created'],
            'ext' => $meta['ext'],
        ];
    }

    /**
     * Sessions of $manageId still open, and bytes every open session may still write.
     * @return array{0: int, 1: int}
     */
    private static function openSessions(string $dir, int $manageId, int $now): array
    {
        $mine = 0;
        $pending = 0;
        foreach (@scandir($dir) ?: [] as $entry) {
            if (!preg_match(self::ENTRY_PATTERN, $entry, $match) || $match[2] !== 'json') {
                continue;
            }
            $meta = self::decodeMeta((string)@file_get_contents($dir . '/' . $entry));
            if ($meta === null || $meta['created'] + self::TTL <= $now) {
                continue;
            }
            if ($meta['manage'] === $manageId) {
                $mine++;
            }
            $received = @filesize($dir . '/' . $match[1] . '.part');
            $pending += max(0, $meta['size'] - ($received === false ? 0 : $received));
        }
        return [$mine, $pending];
    }

    private static function expiredOnDisk(string $dir, string $uploadId, int $now): bool
    {
        $metaPath = $dir . '/' . $uploadId . '.json';
        if (is_file($metaPath)) {
            $meta = self::decodeMeta((string)@file_get_contents($metaPath));
            if ($meta !== null) {
                return $meta['created'] + self::TTL <= $now;
            }
            $mtime = @filemtime($metaPath);
            return $mtime !== false && $mtime + self::TTL <= $now;
        }
        $mtime = @filemtime($dir . '/' . $uploadId . '.part');
        return $mtime !== false && $mtime + self::TTL <= $now;
    }

    /** Delete both halves of a session; with $ifIdle, leave sessions another request holds. */
    private static function remove(string $uploadId, bool $ifIdle = false): bool
    {
        if (!self::isUploadId($uploadId)) {
            return false;
        }
        $dir = Storage::root() . '/upload';
        $metaPath = $dir . '/' . $uploadId . '.json';
        if ($ifIdle && is_file($metaPath)) {
            $handle = @fopen($metaPath, 'rb');
            if ($handle !== false) {
                $idle = flock($handle, LOCK_EX | LOCK_NB);
                if ($idle) {
                    flock($handle, LOCK_UN);
                }
                fclose($handle);
                if (!$idle) {
                    return false;
                }
            }
        }
        $part = $dir . '/' . $uploadId . '.part';
        $ok = !is_file($part) || @unlink($part);
        return (!is_file($metaPath) || @unlink($metaPath)) && $ok;
    }
}
