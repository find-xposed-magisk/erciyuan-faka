<?php
declare(strict_types=1);

namespace App\Controller;

use App\Util\Client;
use App\Util\Csp as CspUtil;
use App\Util\Throttle;

class Csp
{
    public function report(): string
    {
        http_response_code(204);

        if (!CspUtil::enabled() || strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? '')) !== 'POST') {
            return '';
        }

        //本端点免鉴权（浏览器直接上报），必须限流：否则可匿名灌入伪造违规记录，
        //既能把真实违规从 MAX_GROUPS 上限里挤出（看板投毒），又能刷高某个攻击者域名的
        //命中次数，诱导站长在「按频次排序」的候选里把恶意域名加进 CSP 白名单。
        //超限即静默丢弃（仍回 204），不改变对外行为、不泄露拦截。正常浏览器远达不到该阈值。
        if (Throttle::tooMany("csp:report:" . Client::getAddress(), 60, 300)) {
            return '';
        }

        $raw = (string)file_get_contents('php://input', false, null, 0, CspUtil::maxBodyBytes() + 1);
        if ($raw === '' || strlen($raw) > CspUtil::maxBodyBytes()) {
            return '';
        }

        $payload = json_decode($raw, true);
        if (!is_array($payload)) {
            return '';
        }

        foreach (self::extract($payload) as $report) {
            CspUtil::record($report);
        }

        return '';
    }

    private static function extract(array $payload): array
    {
        if (isset($payload['csp-report']) && is_array($payload['csp-report'])) {
            return [$payload['csp-report']];
        }

        $out = [];
        foreach ($payload as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            if (isset($entry['body']) && is_array($entry['body'])) {
                $out[] = $entry['body'];
            } elseif (isset($entry['blocked-uri']) || isset($entry['effective-directive'])) {
                $out[] = $entry;
            }
            if (count($out) >= 20) {
                break;
            }
        }

        if ($out === [] && (isset($payload['blocked-uri']) || isset($payload['effective-directive']))) {
            $out[] = $payload;
        }

        return $out;
    }
}
