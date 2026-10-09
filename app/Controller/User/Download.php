<?php
declare(strict_types=1);

namespace App\Controller\User;

use App\Interceptor\Waf;
use App\Model\CardFile;
use App\Model\Order;
use App\Util\CardFile\Stream;
use App\Util\Client;
use App\Util\Schema;
use App\Util\Throttle;
use Kernel\Annotation\Interceptor;
use Kernel\Exception\NotFoundException;

/**
 * Public download of delivered file cards, reached through the "/download/<token>" alias in
 * kernel/Kernel.php. The token is the only credential: every refusal is the same 404, the token
 * never appears in a response, and nothing here opens a session.
 */
#[Interceptor(Waf::class)]
class Download
{
    private const WINDOW = 600;

    /** Unknown or unservable tokens per IP; once reached, that IP gets nothing until the window ends. */
    private const FAIL_LIMIT = 30;

    /** Served requests per IP and token; download managers split one file into many range requests. */
    private const SERVE_LIMIT = 600;

    /**
     * @throws NotFoundException
     */
    public function file(): void
    {
        $ip = Client::getAddress();
        $file = $this->authorize($_GET['token'] ?? null, $ip);

        if ($this->overServeLimit((string)$file->token, $ip)) {
            http_response_code(429);
            header('Retry-After: ' . self::WINDOW);
            header('Cache-Control: no-store');
            header('Content-Type: text/plain; charset=utf-8');
            exit(lang('请求过于频繁，请稍后再试'));
        }

        Stream::send($file, true);
    }

    /**
     * @throws NotFoundException
     */
    private function authorize(mixed $token, string $ip): CardFile
    {
        $failKey = 'download:fail:' . $ip;
        if (Throttle::reached($failKey, self::FAIL_LIMIT)) {
            throw new NotFoundException("404 Not Found");
        }

        $file = is_string($token) ? $this->servable($token) : null;
        if ($file === null) {
            Throttle::tooMany($failKey, self::FAIL_LIMIT, self::WINDOW);
            throw new NotFoundException("404 Not Found");
        }
        return $file;
    }

    /** The archive behind a token, only while the order that delivered it exists and is paid. */
    private function servable(string $token): ?CardFile
    {
        if (preg_match('~^[a-f0-9]{48}$~D', $token) !== 1) {
            return null;
        }
        try {
            if (!Schema::tableExists('card_file')) {
                return null;
            }
            /** @var CardFile|null $file */
            $file = CardFile::query()->where('token', $token)->first();
            if (!$file || (int)$file->order_id <= 0) {
                return null;
            }
            $paid = Order::query()->whereKey((int)$file->order_id)->where('status', 1)->exists();
        } catch (\Throwable $e) {
            // Query errors carry the bound token in their message: fail closed, log nothing.
            return null;
        }
        return $paid ? $file : null;
    }

    private function overServeLimit(string $token, string $ip): bool
    {
        return Throttle::tooMany('download:serve:' . $ip . ':' . hash('sha256', $token), self::SERVE_LIMIT, self::WINDOW);
    }
}
