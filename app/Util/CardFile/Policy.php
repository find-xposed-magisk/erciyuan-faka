<?php
declare(strict_types=1);

namespace App\Util\CardFile;

use App\Model\Config;

/**
 * Size limits of file-card uploads.
 *
 * The archive limit is a site setting (网站设置 → card_file_max_size, in MB). Archives travel in
 * chunks, so PHP's upload_max_filesize / post_max_size only bound the chunk size, never the archive.
 */
final class Policy
{
    public const SETTING_KEY = 'card_file_max_size';
    public const DEFAULT_MB = 100;
    public const MIN_MB = 1;
    public const MAX_MB = 1024;

    public const MIN_CHUNK = 262144;
    public const MAX_CHUNK = 8388608;

    private const MEGABYTE = 1048576;

    public static function maxMegabytes(): int
    {
        try {
            $raw = Config::cached(self::SETTING_KEY);
        } catch (\Throwable $e) {
            $raw = null;
        }
        return self::normalizeMegabytes($raw);
    }

    public static function maxBytes(): int
    {
        return self::maxMegabytes() * self::MEGABYTE;
    }

    /** Missing or malformed values fall back to the default; numbers are clamped into range. */
    public static function normalizeMegabytes(mixed $raw): int
    {
        if (is_int($raw)) {
            $value = $raw;
        } elseif (is_string($raw) && preg_match('/^\s*[+-]?\d{1,12}\s*$/D', $raw)) {
            $value = (int)trim($raw);
        } else {
            return self::DEFAULT_MB;
        }
        return max(self::MIN_MB, min(self::MAX_MB, $value));
    }

    /** Chunk size the browser should send, derived from this server's PHP upload limits. */
    public static function chunkBytes(): int
    {
        return self::chunkBytesFor(
            self::iniBytes((string)ini_get('upload_max_filesize')),
            self::iniBytes((string)ini_get('post_max_size'))
        );
    }

    /**
     * clamp(min(8 MiB, 80% of the tighter limit), 256 KiB, 8 MiB); null = unlimited.
     * The 20% headroom leaves room for the multipart envelope and the other form fields.
     */
    public static function chunkBytesFor(?int $uploadMaxBytes, ?int $postMaxBytes): int
    {
        $limits = array_filter([$uploadMaxBytes, $postMaxBytes], static fn(?int $limit): bool => $limit !== null);
        $chunk = self::MAX_CHUNK;
        if ($limits !== []) {
            $chunk = min($chunk, (int)floor(min($limits) * 0.8));
        }
        return max(self::MIN_CHUNK, min(self::MAX_CHUNK, $chunk));
    }

    /**
     * Parse a php.ini size ("50M", "1G", "512k", "1048576"). Returns null for "0", "-1",
     * empty or unparsable values, which PHP treats as "no limit".
     */
    public static function iniBytes(string $value): ?int
    {
        $value = trim($value);
        if (!preg_match('/^([+-]?\d+)/', $value, $match)) {
            return null;
        }
        $number = (int)$match[1];
        if ($number <= 0) {
            return null;
        }
        $multiplier = match (strtolower(substr($value, -1))) {
            'k' => 1024,
            'm' => self::MEGABYTE,
            'g' => 1073741824,
            default => 1,
        };
        if ($number > intdiv(PHP_INT_MAX, $multiplier)) {
            return PHP_INT_MAX;
        }
        return $number * $multiplier;
    }
}
