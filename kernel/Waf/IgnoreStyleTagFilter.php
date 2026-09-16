<?php
declare (strict_types=1);

namespace Kernel\Waf;

use Kernel\Component\Make;

class IgnoreStyleTagFilter extends \HTMLPurifier_Filter
{
    use Make;

    public $name = 'IgnoreStyleTagFilter';

    /**
     * 本次进程随机的占位符盐。<style> 只在 preFilter→postFilter 一个 purify 周期内被临时
     * 替换成占位符，盐把「我们自己藏起来的 <style>」和「用户正文里凭空写的占位符文本」区分开：
     * 盐从不出现在任何输出里（postFilter 会把它消费掉），攻击者无从猜测，因此正文里手写
     * `[STYLE-TAG]…[/STYLE-TAG]` 不会被还原成真 <style>（旧实现的「纯文本即载荷」二阶还原漏洞）。
     */
    private ?string $salt = null;

    private function salt(): string
    {
        return $this->salt ??= bin2hex(random_bytes(8));
    }

    public function preFilter($html, $config, $context): array|string|null
    {
        $salt = $this->salt();
        return preg_replace('/<style\b[^>]*>(.*?)<\/style>/is', "[STYLE-TAG:{$salt}]$1[/STYLE-TAG:{$salt}]", (string)$html);
    }

    public function postFilter($html, $config, $context): array|string|null
    {
        //把占位符还原成 <style> 时顺手净化 CSS：本过滤器让 <style> 绕过了 HTMLPurifier，
        //若原样放回，攻击者可在不可信富文本里注入会「执行脚本 / 外连信标」的 CSS。可信内容
        //（sanitize 的 $trusted 分支）根本不走本过滤器，所以这里一律按不可信处理。
        //只还原带本进程盐的占位符——正文里手写的无盐占位符保持纯文本，杜绝二阶还原。
        $salt = preg_quote($this->salt(), '/');
        return preg_replace_callback("/\[STYLE-TAG:{$salt}\](.*?)\[\/STYLE-TAG:{$salt}\]/is", static function (array $m): string {
            return '<style>' . self::sanitizeCss($m[1]) . '</style>';
        }, (string)$html);
    }

    /**
     * 只保留基础排版样式，剔除会执行脚本或外连的 CSS 构造（这些在用户富文本里没有正当用途）。
     * 公开静态，供渲染层（如 RichHtml::present）复用同一套 CSS 净化，避免各处策略不一致。
     *
     * 正则黑名单拦不住 CSS 转义（`@\69 mport`、`url(https\3a //…)` 会原样逃逸），所以先把 CSS
     * 转义解码成一份「探测副本」，在解码后的文本上判定是否含有会执行脚本 / 外连资源的构造，命中
     * 即整块丢弃（fail-closed）。只用解码副本做**判定**，返回的仍是原始 $css —— CSS 转义由浏览器
     * 的 CSS 解析器处理，不会突破 <style> 边界，保留原文可避免解码时凭空引入 `</style>` 突破。
     */
    public static function sanitizeCss(string $css): string
    {
        if (trim($css) === '') {
            return '';
        }
        return self::cssHasActiveContent(self::decodeCssEscapes($css)) ? '' : $css;
    }

    /**
     * 解码 CSS 转义（`\XX` 十六进制、`\c` 字面）——仅用于危险构造探测。
     */
    private static function decodeCssEscapes(string $css): string
    {
        return (string)preg_replace_callback(
            '/\\\\([0-9A-Fa-f]{1,6})[ \t\r\n\f]?|\\\\([^0-9A-Fa-f\r\n\f])/s',
            static function (array $m): string {
                if (($m[1] ?? '') !== '') {
                    $cp = hexdec($m[1]);
                    if ($cp <= 0 || $cp > 0x10FFFF || ($cp >= 0xD800 && $cp <= 0xDFFF)) {
                        return "\u{FFFD}";
                    }
                    $chr = mb_chr($cp, 'UTF-8');
                    return $chr === false ? "\u{FFFD}" : $chr;
                }
                return $m[2] ?? '';
            },
            $css
        );
    }

    /**
     * 解码后的 CSS 是否含有「执行脚本 / 外连资源」构造。
     */
    private static function cssHasActiveContent(string $css): bool
    {
        //先剥 CSS 注释，避免 `@im/**/port` 之类分词混淆（注释在净化语境下无安全价值）
        $css = (string)preg_replace('#/\*.*?\*/#s', '', $css);

        if (preg_match('/@\s*import\b/i', $css)) return true;               // @import 拉外部样式表
        if (preg_match('/\bexpression\s*\(/i', $css)) return true;          // IE expression() 执行 JS
        if (preg_match('/\bbehavior\s*:/i', $css)) return true;             // IE behavior(.htc)
        if (preg_match('/-moz-binding\b/i', $css)) return true;             // XBL binding
        if (preg_match('/(?:javascript|vbscript)\s*:/i', $css)) return true;// 伪协议

        //url(...)：只放行 data:image、站内相对/根路径；外链(http/https/协议相对/非图片 data)一律视为危险
        if (preg_match_all('/url\(\s*(["\']?)(.*?)\1\s*\)/is', $css, $mm, PREG_SET_ORDER)) {
            foreach ($mm as $u) {
                $ref = trim($u[2]);
                if ($ref === '') {
                    continue;
                }
                $safe = $ref[0] === '/'
                    || stripos($ref, 'data:image/') === 0
                    || (!preg_match('#^[a-z][a-z0-9+.\-]*:#i', $ref) && !str_starts_with($ref, '//'));
                if (!$safe) {
                    return true;
                }
            }
        }
        return false;
    }
}
