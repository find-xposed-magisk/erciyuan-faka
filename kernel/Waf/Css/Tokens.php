<?php
declare(strict_types=1);

namespace Kernel\Waf\Css;

/**
 * CSS 值的顶层切分：括号里的逗号/空白不切（rgba(0,0,0,.1)、minmax(0, 1fr) 保持完整）。
 * 括号不配对、分段超过上限、逗号两边为空一律返回 null，交给调用方判为非法。
 */
final class Tokens
{
    /**
     * @param string $delimiter ',' 或 ' '（任意空白）
     * @return string[]|null
     */
    public static function split(string $value, string $delimiter, int $max): ?array
    {
        $parts = [];
        $buffer = '';
        $depth = 0;
        $length = strlen($value);

        for ($i = 0; $i < $length; $i++) {
            $char = $value[$i];
            if ($char === '(') {
                $depth++;
            } elseif ($char === ')') {
                if (--$depth < 0) {
                    return null;
                }
            }

            $isDelimiter = $delimiter === ' ' ? ctype_space($char) : $char === $delimiter;
            if ($depth === 0 && $isDelimiter) {
                if (!self::push($parts, $buffer, $delimiter)) {
                    return null;
                }
                $buffer = '';
                if (count($parts) > $max) {
                    return null;
                }
                continue;
            }
            $buffer .= $char;
        }

        if ($depth !== 0 || !self::push($parts, $buffer, $delimiter)) {
            return null;
        }

        return $parts === [] || count($parts) > $max ? null : $parts;
    }

    private static function push(array &$parts, string $buffer, string $delimiter): bool
    {
        $buffer = trim($buffer);
        if ($buffer === '') {
            //空白分隔时连续空白很正常；逗号分隔出现空段（a,,b / 结尾逗号）就是写错了
            return $delimiter === ' ';
        }
        $parts[] = $buffer;
        return true;
    }
}
