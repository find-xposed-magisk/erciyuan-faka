<?php
declare(strict_types=1);

namespace Kernel\Waf\Css;

/**
 * box-shadow / text-shadow：每层 = [inset] 2~4 个长度 [颜色]，最多 4 层。
 * 逐个 token 用 HTMLPurifier 自己的 Length / Color 校验后重新拼出，不认识的 token 整条丢弃。
 */
final class Shadow extends \HTMLPurifier_AttrDef
{
    private const MAX_LAYERS = 4;

    public function __construct(private bool $allowInset)
    {
    }

    public function validate($string, $config, $context)
    {
        $value = trim($this->parseCDATA((string)$string));
        if ($value === '') {
            return false;
        }
        if (strtolower($value) === 'none') {
            return 'none';
        }

        $layers = Tokens::split($value, ',', self::MAX_LAYERS);
        if ($layers === null) {
            return false;
        }

        $out = [];
        foreach ($layers as $layer) {
            $normalized = $this->layer($layer, $config, $context);
            if ($normalized === null) {
                return false;
            }
            $out[] = $normalized;
        }

        return implode(', ', $out);
    }

    private function layer(string $layer, $config, $context): ?string
    {
        $tokens = Tokens::split($layer, ' ', 6);
        if ($tokens === null) {
            return null;
        }

        $lengthDef = new \HTMLPurifier_AttrDef_CSS_Length();
        $colorDef = new \HTMLPurifier_AttrDef_CSS_Color();
        $inset = false;
        $color = null;
        $lengths = [];
        //长度必须连在一起（CSS 语法）：0 = 还没出现，1 = 正在连续出现，2 = 已结束
        $run = 0;

        foreach ($tokens as $token) {
            if ($this->allowInset && !$inset && strtolower($token) === 'inset') {
                $inset = true;
                $run = $run === 1 ? 2 : $run;
                continue;
            }

            $length = $lengthDef->validate($token, $config, $context);
            if ($length !== false) {
                if ($run === 2) {
                    return null;
                }
                $run = 1;
                $lengths[] = $length;
                continue;
            }

            $parsed = $color === null ? $colorDef->validate($token, $config, $context) : false;
            if ($parsed === false) {
                return null;
            }
            $color = $parsed;
            $run = $run === 1 ? 2 : $run;
        }

        $max = $this->allowInset ? 4 : 3;
        if (count($lengths) < 2 || count($lengths) > $max) {
            return null;
        }

        return trim(($inset ? 'inset ' : '') . implode(' ', $lengths) . ($color !== null ? ' ' . $color : ''));
    }
}
