<?php
declare(strict_types=1);

namespace App\Util\CardFile;

use App\Model\CardFile;
use App\Util\Date;
use Kernel\Exception\NotFoundException;

/**
 * Sends a stored file-card archive: full body, one byte range (resumable downloads) or HEAD.
 *
 * Every response decision lives in plan() / parseRange() / disposition(), which have no side
 * effects, so they can be verified without a web server.
 */
final class Stream
{
    private const CHUNK = 1048576;

    /**
     * Streams the archive and exits. A missing or unreadable archive is the generic 404.
     *
     * @throws NotFoundException
     */
    public static function send(CardFile $file, bool $countDownload = true): void
    {
        $path = self::locate($file);
        clearstatcache(true, $path);
        $size = @filesize($path);
        $mtime = @filemtime($path);
        if ($size === false) {
            throw new NotFoundException("404 Not Found");
        }

        $plan = self::plan(
            (string)($_SERVER['REQUEST_METHOD'] ?? 'GET'),
            isset($_SERVER['HTTP_RANGE']) ? (string)$_SERVER['HTTP_RANGE'] : null,
            isset($_SERVER['HTTP_IF_RANGE']) ? (string)$_SERVER['HTTP_IF_RANGE'] : null,
            (int)$size,
            $mtime === false ? time() : (int)$mtime,
            (string)$file->hash,
            (string)$file->name,
            $countDownload
        );

        $handle = null;
        if ($plan['body']) {
            $handle = @fopen($path, 'rb');
            if ($handle === false || ($plan['start'] > 0 && fseek($handle, $plan['start']) !== 0)) {
                throw new NotFoundException("404 Not Found");
            }
        }

        self::release();
        if (headers_sent()) {
            exit;
        }

        if ($plan['count']) {
            self::count($file);
        }

        header_remove('Pragma');
        header_remove('Expires');
        http_response_code($plan['status']);
        foreach ($plan['headers'] as $name => $value) {
            header($name . ': ' . $value);
        }

        if ($handle !== null) {
            self::pipe($handle, $plan['length']);
            fclose($handle);
        }
        exit;
    }

    /**
     * Status, headers and byte window of one request.
     *
     * @return array{status: int, headers: array<string, string>, start: int, length: int, body: bool, count: bool}
     */
    public static function plan(string $method, ?string $range, ?string $ifRange, int $size, int $mtime, string $hash, string $name, bool $countDownload): array
    {
        $head = strtoupper(trim($method)) === 'HEAD';
        $etag = preg_match('~^[a-f0-9]{64}$~D', $hash) === 1 ? '"' . $hash . '"' : null;
        $lastModified = gmdate('D, d M Y H:i:s', max(0, $mtime)) . ' GMT';

        $ifRange = $ifRange === null ? '' : trim($ifRange);
        if ($ifRange !== '' && !self::ifRangeMatches($ifRange, $etag, $mtime)) {
            $range = null;
        }
        $window = self::parseRange($range, $size);

        $headers = [
            'X-Content-Type-Options' => 'nosniff',
            'X-Robots-Tag' => 'noindex, nofollow',
            'Cache-Control' => 'private, no-transform',
            'Accept-Ranges' => 'bytes',
            'Last-Modified' => $lastModified,
        ];
        if ($etag !== null) {
            $headers['ETag'] = $etag;
        }

        if ($window['status'] === 416) {
            $headers['Content-Type'] = 'text/plain; charset=utf-8';
            $headers['Content-Range'] = 'bytes */' . $size;
            $headers['Content-Length'] = '0';
            return ['status' => 416, 'headers' => $headers, 'start' => 0, 'length' => 0, 'body' => false, 'count' => false];
        }

        $length = $window['end'] - $window['start'] + 1;
        $headers['Content-Type'] = 'application/octet-stream';
        $headers['Content-Disposition'] = self::disposition($name);
        $headers['Content-Length'] = (string)$length;
        if ($window['status'] === 206) {
            $headers['Content-Range'] = 'bytes ' . $window['start'] . '-' . $window['end'] . '/' . $size;
        }

        return [
            'status' => $window['status'],
            'headers' => $headers,
            'start' => $window['start'],
            'length' => $length,
            'body' => !$head && $length > 0,
            'count' => $countDownload && !$head && $window['start'] === 0,
        ];
    }

    /**
     * Interprets one "Range: bytes=..." header against a body of $size bytes (RFC 7233).
     * Anything but a single well-formed byte range (absent, other units, multiple ranges,
     * last < first) is ignored and yields the full body; a well-formed range that starts past
     * the end, or an empty suffix, is unsatisfiable (416).
     *
     * @return array{status: int, start: int, end: int} end is inclusive
     */
    public static function parseRange(?string $header, int $size): array
    {
        $full = ['status' => 200, 'start' => 0, 'end' => $size - 1];
        $unsatisfiable = ['status' => 416, 'start' => 0, 'end' => -1];
        if ($header === null || preg_match('~^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$~iD', $header, $match) !== 1) {
            return $full;
        }
        [, $first, $last] = $match;

        if ($first === '' && $last === '') {
            return $full;
        }
        if ($first === '') {
            $suffix = self::toInt($last);
            if ($suffix === 0 || $size <= 0) {
                return $unsatisfiable;
            }
            return ['status' => 206, 'start' => $suffix >= $size ? 0 : $size - $suffix, 'end' => $size - 1];
        }

        $start = self::toInt($first);
        $end = $last === '' ? PHP_INT_MAX : self::toInt($last);
        if ($end < $start) {
            return $full;
        }
        if ($start >= $size) {
            return $unsatisfiable;
        }
        return ['status' => 206, 'start' => $start, 'end' => min($end, $size - 1)];
    }

    /** attachment; ASCII fallback for old clients plus the exact UTF-8 name (RFC 6266 / 5987). */
    public static function disposition(string $name): string
    {
        $name = self::cleanName($name);
        return 'attachment; filename="' . self::asciiName($name) . '"; filename*=UTF-8\'\'' . rawurlencode($name);
    }

    /**
     * @throws NotFoundException
     */
    private static function locate(CardFile $file): string
    {
        try {
            $path = Storage::absolute((string)$file->path);
        } catch (\Throwable $e) {
            $path = null;
        }
        if ($path === null || !is_file($path) || !is_readable($path)) {
            try {
                \Kernel\Util\Log::inst()->error("文件卡密[#" . (int)$file->id . "]的存储文件缺失或不可读，下载返回 404");
            } catch (\Throwable $e) {
            }
            throw new NotFoundException("404 Not Found");
        }
        return $path;
    }

    private static function ifRangeMatches(string $ifRange, ?string $etag, int $mtime): bool
    {
        if (str_starts_with($ifRange, '"') || str_starts_with($ifRange, 'W/')) {
            return $etag !== null && $ifRange === $etag;
        }
        $time = strtotime($ifRange);
        return $time !== false && $time === $mtime;
    }

    private static function toInt(string $digits): int
    {
        $digits = ltrim($digits, '0');
        if ($digits === '') {
            return 0;
        }
        return strlen($digits) > 18 ? PHP_INT_MAX : (int)$digits;
    }

    private static function cleanName(string $name): string
    {
        if (!mb_check_encoding($name, 'UTF-8')) {
            $name = (string)mb_convert_encoding($name, 'UTF-8', 'UTF-8');
        }
        $name = trim((string)preg_replace('~[\p{Cc}\p{Cf}/\\\\]+~u', '_', $name), " .\t");
        if ($name === '') {
            return 'download';
        }
        if (mb_strlen($name) > 180) {
            $extension = preg_match('~(\.[\p{L}\p{N}]{1,16})$~u', $name, $match) === 1 ? $match[1] : '';
            $name = rtrim(mb_substr($name, 0, 180 - mb_strlen($extension)), ' .') . $extension;
        }
        return $name;
    }

    private static function asciiName(string $name): string
    {
        $ascii = (string)preg_replace('~[^\x20-\x7e]+~u', '_', $name);
        $ascii = strtr($ascii, ['"' => '_', '\\' => '_', '%' => '_']);
        $extension = preg_match('~\.([A-Za-z0-9]{1,16})$~D', $ascii, $match) === 1 ? '.' . $match[1] : '';
        $base = substr($ascii, 0, strlen($ascii) - strlen($extension));
        if (preg_match('~[A-Za-z0-9]~', $base) !== 1) {
            return 'download' . $extension;
        }
        return $ascii;
    }

    /** Frees the session lock and every output layer before a long transfer. */
    private static function release(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        if (function_exists('apache_setenv')) {
            @apache_setenv('no-gzip', '1');
        }
        @ini_set('zlib.output_compression', '0');
        while (ob_get_level() > 0 && @ob_end_clean()) {
        }
        @set_time_limit(0);
        ignore_user_abort(false);
    }

    private static function count(CardFile $file): void
    {
        try {
            CardFile::query()
                ->whereKey((int)$file->id)
                ->increment('downloads', 1, ['last_download_time' => Date::current()]);
        } catch (\Throwable $e) {
            // A failed counter must never cost the buyer the download.
        }
    }

    /**
     * @param resource $handle positioned at the first byte to send
     */
    private static function pipe($handle, int $length): void
    {
        $remaining = $length;
        while ($remaining > 0 && !connection_aborted()) {
            $chunk = fread($handle, min(self::CHUNK, $remaining));
            if ($chunk === false || $chunk === '') {
                break;
            }
            echo $chunk;
            $remaining -= strlen($chunk);
            flush();
        }
    }
}
