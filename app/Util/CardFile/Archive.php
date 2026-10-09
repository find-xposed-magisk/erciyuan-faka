<?php
declare(strict_types=1);

namespace App\Util\CardFile;

/**
 * Archive formats accepted as file cards, recognised by extension and verified by magic bytes.
 *
 * Production PHP has no fileinfo extension, so the content check reads the leading bytes itself.
 * A file is accepted only when its content belongs to the signature family of its extension.
 */
final class Archive
{
    /** extension => signature family */
    private const FAMILIES = [
        'zip' => 'zip',
        'rar' => 'rar',
        '7z' => '7z',
        'tar' => 'tar',
        'gz' => 'gzip',
        'tgz' => 'gzip',
        'bz2' => 'bzip2',
        'tbz' => 'bzip2',
        'tbz2' => 'bzip2',
        'xz' => 'xz',
        'txz' => 'xz',
        'zst' => 'zstd',
        'tzst' => 'zstd',
        'lz' => 'lzip',
        'tlz' => 'lzip',
        'lzma' => 'lzma',
        'z' => 'compress',
        'cab' => 'cab',
        'arj' => 'arj',
        'lzh' => 'lha',
        'lha' => 'lha',
    ];

    /** Compressors that wrap a tarball, so ".tar.<ext>" is kept whole when a name is shortened. */
    private const TAR_WRAPPERS = ['gz', 'bz2', 'xz', 'zst', 'lz', 'lzma', 'z'];

    private const HEAD_BYTES = 512;

    public const NAME_MAX = 200;

    /** @return string[] */
    public static function extensions(): array
    {
        return array_keys(self::FAMILIES);
    }

    /** Value for an <input type="file" accept="…"> attribute. */
    public static function accept(): string
    {
        return implode(',', array_map(static fn(string $extension): string => '.' . $extension, self::extensions()));
    }

    /** Lower-case archive extension of a file name, or null when it is not an accepted archive. */
    public static function extension(string $name): ?string
    {
        $dot = strrpos($name, '.');
        if ($dot === false) {
            return null;
        }
        $extension = strtolower(substr($name, $dot + 1));
        return isset(self::FAMILIES[$extension]) ? $extension : null;
    }

    /** Whether the file at $path starts with a signature of $extension's family. */
    public static function matches(string $path, string $extension): bool
    {
        $family = self::FAMILIES[strtolower($extension)] ?? null;
        if ($family === null) {
            return false;
        }
        $handle = @fopen($path, 'rb');
        if ($handle === false) {
            return false;
        }
        try {
            $head = fread($handle, self::HEAD_BYTES);
        } finally {
            fclose($handle);
        }
        return is_string($head) && self::headMatches($family, $head);
    }

    public static function headMatches(string $family, string $head): bool
    {
        return match ($family) {
            'zip' => in_array(substr($head, 0, 4), ["PK\x03\x04", "PK\x05\x06", "PK\x07\x08"], true),
            'rar' => str_starts_with($head, "Rar!\x1A\x07\x00") || str_starts_with($head, "Rar!\x1A\x07\x01\x00"),
            '7z' => str_starts_with($head, "7z\xBC\xAF\x27\x1C"),
            'tar' => substr($head, 257, 5) === 'ustar',
            'gzip' => str_starts_with($head, "\x1F\x8B"),
            'bzip2' => preg_match('/^BZh[1-9]/', $head) === 1,
            'xz' => str_starts_with($head, "\xFD7zXZ\x00"),
            'zstd' => str_starts_with($head, "\x28\xB5\x2F\xFD"),
            'lzip' => str_starts_with($head, 'LZIP'),
            'lzma' => str_starts_with($head, "\x5D\x00\x00"),
            'compress' => str_starts_with($head, "\x1F\x9D") || str_starts_with($head, "\x1F\xA0"),
            'cab' => str_starts_with($head, "MSCF\x00\x00\x00\x00"),
            'arj' => str_starts_with($head, "\x60\xEA"),
            'lha' => preg_match('/^-l[hz][0-9a-z]-$/', substr($head, 2, 5)) === 1,
            default => false,
        };
    }

    /**
     * Display / download name derived from a client-supplied file name. Never empty, at most
     * NAME_MAX characters, extension preserved. It is never used to build a filesystem path.
     */
    public static function sanitizeName(string $name): string
    {
        if (!mb_check_encoding($name, 'UTF-8')) {
            $substitute = mb_substitute_character();
            mb_substitute_character('none');
            $name = (string)mb_convert_encoding($name, 'UTF-8', 'UTF-8');
            mb_substitute_character($substitute);
        }

        $segments = preg_split('~[/\\\\]~', $name) ?: [];
        $name = (string)end($segments);

        // Control and invisible formatting characters (incl. bidi overrides that could disguise
        // the extension), then the characters Windows forbids in file names.
        $name = (string)preg_replace(
            '~[\p{Cc}\x{00AD}\x{061C}\x{180E}\x{200B}\x{200E}\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2064}\x{2066}-\x{206F}\x{FEFF}\x{FFF9}-\x{FFFB}<>:"|?*]~u',
            '',
            $name
        );
        $name = (string)preg_replace('~[\s\p{Z}]+~u', ' ', $name);

        $extension = self::extension($name);
        $name = trim($name, ' .');
        if ($name === '') {
            return 'file.' . ($extension ?? 'zip');
        }
        if ($extension !== null && self::extension($name) === null) {
            // The whole name was the extension (".zip").
            return 'file.' . $extension;
        }

        if (mb_strlen($name, 'UTF-8') > self::NAME_MAX) {
            $suffix = self::suffix($name);
            $stem = mb_substr($name, 0, mb_strlen($name, 'UTF-8') - mb_strlen($suffix, 'UTF-8'), 'UTF-8');
            $stem = rtrim(mb_substr($stem, 0, self::NAME_MAX - mb_strlen($suffix, 'UTF-8'), 'UTF-8'), ' .');
            $name = ($stem === '' ? 'file' : $stem) . $suffix;
        }
        return $name;
    }

    /** ".tar.gz", ".zip" … as written in the name; "" when the name is not an accepted archive. */
    private static function suffix(string $name): string
    {
        $extension = self::extension($name);
        if ($extension === null) {
            return '';
        }
        $length = strlen($extension) + 1;
        if (in_array($extension, self::TAR_WRAPPERS, true)
            && strcasecmp(substr($name, -($length + 4), 4), '.tar') === 0) {
            $length += 4;
        }
        return substr($name, -$length);
    }
}
