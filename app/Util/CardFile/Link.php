<?php
declare(strict_types=1);

namespace App\Util\CardFile;

use App\Model\CardFile;
use App\Model\Config;
use App\Util\Client;
use Kernel\Consts\Base;
use Kernel\Util\Context;

/**
 * Download links of file cards inside delivered content (order.secret).
 *
 * Every delivered file is one line: "https://<host>/download/<token>#<name>". A complete URL keeps
 * every plain-text consumer usable (old themes, e-mails, bots, downstream shops); the fragment never
 * reaches the server and only carries the display name. Browsers parse the same grammar through
 * acgDelivery in assets/common/js/ready.js.
 */
final class Link
{
    public const TOKEN_PATTERN = '[a-f0-9]{48}';

    private const LINE_PATTERN = '~^(https?://[^\s/?#]+)?/download/([a-f0-9]{48})(#\S*)?$~iD';

    private const HOST_PATTERN = '~^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)(?::\d{1,5})?$~iD';

    public static function newToken(): string
    {
        do {
            $token = bin2hex(random_bytes(24));
        } while (CardFile::query()->where('token', $token)->exists());
        return $token;
    }

    public static function isToken(string $value): bool
    {
        return preg_match('~^' . self::TOKEN_PATTERN . '$~D', $value) === 1;
    }

    /** The delivered line for one stocked file. */
    public static function line(CardFile $file, ?string $base = null): string
    {
        return self::url((string)$file->token, $base) . '#' . self::encodeName((string)$file->name);
    }

    public static function url(string $token, ?string $base = null): string
    {
        return rtrim($base ?? self::deliveryBase(), '/') . '/download/' . $token;
    }

    /** Percent-encode only what would break a URL or a line; CJK names stay readable. */
    public static function encodeName(string $name): string
    {
        return (string)preg_replace_callback(
            '~[\s"#%<>\\\\^`{|}\x00-\x1f\x7f]~u',
            static fn(array $match): string => rawurlencode($match[0]),
            $name
        );
    }

    /**
     * @return array{origin: ?string, token: string, name: string, fragment: string}|null
     */
    public static function parseLine(string $line): ?array
    {
        if (!preg_match(self::LINE_PATTERN, trim($line), $match)) {
            return null;
        }
        $fragment = (string)($match[3] ?? '');
        return [
            'origin' => ($match[1] ?? '') !== '' ? $match[1] : null,
            'token' => strtolower($match[2]),
            'name' => $fragment === '' ? '' : rawurldecode(substr($fragment, 1)),
            'fragment' => $fragment,
        ];
    }

    /** @return string[] distinct download tokens found in delivered content */
    public static function tokens(?string $secret): array
    {
        if ($secret === null || stripos($secret, '/download/') === false) {
            return [];
        }
        $tokens = [];
        foreach (preg_split('/\r\n|\n|\r/', $secret) ?: [] as $line) {
            $parsed = self::parseLine($line);
            if ($parsed !== null) {
                $tokens[$parsed['token']] = true;
            }
        }
        return array_keys($tokens);
    }

    /**
     * Name and size of this site's own files among the given tokens.
     *
     * @param string[] $tokens
     * @return array<string, array{name: string, size: int}>
     */
    public static function lookup(array $tokens): array
    {
        $tokens = array_values(array_unique(array_filter(
            array_map(static fn($token): string => strtolower((string)$token), $tokens),
            static fn(string $token): bool => self::isToken($token)
        )));
        if ($tokens === []) {
            return [];
        }
        $result = [];
        try {
            foreach (array_chunk($tokens, 500) as $chunk) {
                foreach (CardFile::query()->whereIn('token', $chunk)->get(['token', 'name', 'size']) as $file) {
                    $result[(string)$file->token] = ['name' => (string)$file->name, 'size' => (int)$file->size];
                }
            }
        } catch (\Throwable $e) {
            // Table missing on a half-upgraded site: show the content as it is.
            return [];
        }
        return $result;
    }

    /**
     * Point this site's own download links at the origin the visitor is using right now
     * (substations, domain moves, deliveries made on the callback domain). Unknown or foreign
     * tokens are left untouched.
     *
     * @param array<string, mixed> $local token-keyed result of lookup()
     * @param string|null $base origin to use; defaults to the current request's
     */
    public static function present(string $secret, array $local, ?string $base = null): string
    {
        $base = $base ?? self::currentBase();
        if ($local === [] || $base === null) {
            return $secret;
        }
        $parts = preg_split('/(\r\n|\n|\r)/', $secret, -1, PREG_SPLIT_DELIM_CAPTURE) ?: [];
        foreach ($parts as $index => $part) {
            if ($index % 2 === 1) {
                continue;
            }
            $parsed = self::parseLine($part);
            if ($parsed === null || !isset($local[$parsed['token']])) {
                continue;
            }
            $parts[$index] = $base . '/download/' . $parsed['token'] . $parsed['fragment'];
        }
        return implode('', $parts);
    }

    /**
     * Display form of one delivered content.
     *
     * @return array{0: string, 1: array<string, array{name: string, size: int}>} [secret, delivery_files]
     */
    public static function decorate(?string $secret): array
    {
        $secret = (string)$secret;
        $local = self::lookup(self::tokens($secret));
        return [self::present($secret, $local), $local];
    }

    /**
     * Batch variant for list payloads: rewrites $rows[*][$field] and adds "delivery_files"
     * (token => {name, size}) to rows that carry this site's files. One query per page.
     */
    public static function decorateRows(array $rows, string $field = 'secret'): array
    {
        $perRow = [];
        $all = [];
        foreach ($rows as $key => $row) {
            $secret = is_array($row) ? ($row[$field] ?? null) : null;
            if (!is_string($secret)) {
                continue;
            }
            $tokens = self::tokens($secret);
            if ($tokens === []) {
                continue;
            }
            $perRow[$key] = $tokens;
            foreach ($tokens as $token) {
                $all[$token] = true;
            }
        }
        if ($perRow === []) {
            return $rows;
        }
        $local = self::lookup(array_keys($all));
        foreach ($perRow as $key => $tokens) {
            $mine = array_intersect_key($local, array_flip($tokens));
            if ($mine === []) {
                continue;
            }
            $rows[$key][$field] = self::present((string)$rows[$key][$field], $mine);
            $rows[$key]['delivery_files'] = $mine;
        }
        return $rows;
    }

    /**
     * Origin written into new deliveries.
     *
     * Storefront requests use their own host. Admin-triggered deliveries, payment callbacks that
     * arrive on the dedicated callback domain and CLI workers fall back to the configured main
     * domain, then the callback domain. An empty result yields a relative link that display
     * rewrites (present) complete again.
     */
    public static function deliveryBase(): string
    {
        $current = self::currentBase();
        $callback = self::originOf((string)(Config::cached('callback_domain') ?? ''));
        $route = ltrim(strtolower((string)(Context::get(Base::ROUTE) ?? '')), '/');
        $adminRoute = $route === 'admin' || str_starts_with($route, 'admin/');

        if ($current !== null && !$adminRoute
            && ($callback === null || strcasecmp(self::hostOf($current), self::hostOf($callback)) !== 0)) {
            return $current;
        }

        $main = self::mainDomain();
        if ($main !== null) {
            $scheme = 'https';
            if ($current !== null) {
                $scheme = (string)parse_url($current, PHP_URL_SCHEME);
            } elseif ($callback !== null) {
                $scheme = (string)parse_url($callback, PHP_URL_SCHEME);
            }
            return $scheme . '://' . $main;
        }
        return $callback ?? $current ?? '';
    }

    /** scheme://host[:port] of the current web request; null outside a usable HTTP request. */
    public static function currentBase(): ?string
    {
        if (PHP_SAPI === 'cli') {
            return null;
        }
        $host = trim((string)($_SERVER['HTTP_HOST'] ?? ''));
        if ($host === '' || preg_match(self::HOST_PATTERN, $host) !== 1) {
            return null;
        }
        return Client::getRequestScheme() . '://' . strtolower($host);
    }

    private static function mainDomain(): ?string
    {
        foreach (explode(',', (string)(Config::cached('domain') ?? '')) as $domain) {
            $domain = strtolower(trim($domain));
            if ($domain !== '' && preg_match(self::HOST_PATTERN, $domain) === 1) {
                return $domain;
            }
        }
        return null;
    }

    private static function originOf(string $url): ?string
    {
        $url = trim($url);
        if ($url === '') {
            return null;
        }
        $scheme = strtolower((string)parse_url($url, PHP_URL_SCHEME));
        $host = (string)parse_url($url, PHP_URL_HOST);
        $port = parse_url($url, PHP_URL_PORT);
        if (!in_array($scheme, ['http', 'https'], true) || $host === '') {
            return null;
        }
        $authority = strtolower($host) . ($port ? ':' . (int)$port : '');
        if (preg_match(self::HOST_PATTERN, $authority) !== 1) {
            return null;
        }
        return $scheme . '://' . $authority;
    }

    private static function hostOf(string $origin): string
    {
        return strtolower((string)parse_url($origin, PHP_URL_HOST));
    }
}
