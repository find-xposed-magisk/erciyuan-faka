<?php
declare(strict_types=1);

namespace App\Util\CardFile;

use Kernel\Exception\JSONException;

/**
 * On-disk layout of file-card archives.
 *
 * Everything lives under runtime/, which every shipped web-server rule (.htaccess, nginx, Docker)
 * refuses to serve. Stored archives are renamed to 256-bit random names without an extension,
 * unrelated to the original name and to the download token, so a path can neither be derived
 * nor guessed even on a misconfigured server.
 */
final class Storage
{
    private const STORE_PATTERN = '~^store/[a-f0-9]{2}/[a-f0-9]{64}$~';

    public static function root(): string
    {
        return rtrim(BASE_PATH, '/\\') . '/runtime/card-file';
    }

    /** Working directory for chunked uploads in progress. */
    public static function uploadDir(): string
    {
        $dir = self::root() . '/upload';
        self::ensureDir($dir);
        return $dir;
    }

    /**
     * Reserve a fresh storage path (relative to root) for a new archive.
     * @throws JSONException
     */
    public static function newPath(): string
    {
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $name = bin2hex(random_bytes(32));
            $relative = 'store/' . substr($name, 0, 2) . '/' . $name;
            $absolute = self::root() . '/' . $relative;
            self::ensureDir(dirname($absolute));
            if (!file_exists($absolute)) {
                return $relative;
            }
        }
        throw new JSONException('文件存储目录不可用，请检查 runtime 目录的写入权限');
    }

    public static function isValidPath(string $relative): bool
    {
        return preg_match(self::STORE_PATTERN, $relative) === 1;
    }

    /**
     * Absolute path of a stored archive; rejects anything that is not a storage name we issued.
     * @throws JSONException
     */
    public static function absolute(string $relative): string
    {
        if (!self::isValidPath($relative)) {
            throw new JSONException('文件存储路径无效');
        }
        return self::root() . '/' . $relative;
    }

    public static function exists(string $relative): bool
    {
        return self::isValidPath($relative) && is_file(self::root() . '/' . $relative);
    }

    public static function delete(string $relative): bool
    {
        if (!self::isValidPath($relative)) {
            return false;
        }
        $absolute = self::root() . '/' . $relative;
        return !is_file($absolute) || @unlink($absolute);
    }

    /** Free bytes on the storage volume, or null when the host does not expose it. */
    public static function freeSpace(): ?int
    {
        self::ensureDir(self::root());
        if (!function_exists('disk_free_space')) {
            return null;
        }
        $free = @disk_free_space(self::root());
        return $free === false ? null : (int)$free;
    }

    /**
     * Create a directory and drop the deny files into the storage root once.
     * @throws JSONException
     */
    private static function ensureDir(string $dir): void
    {
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new JSONException('文件存储目录不可用，请检查 runtime 目录的写入权限');
        }
        $root = self::root();
        if (!is_file($root . '/index.html')) {
            @file_put_contents($root . '/index.html', '');
        }
        if (!is_file($root . '/.htaccess')) {
            @file_put_contents($root . '/.htaccess', "<IfModule mod_authz_core.c>\n Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n Deny from all\n</IfModule>\n");
        }
    }
}
