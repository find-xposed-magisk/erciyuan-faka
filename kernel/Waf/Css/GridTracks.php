<?php
declare(strict_types=1);

namespace Kernel\Waf\Css;

/**
 * grid-template-columns / grid-template-rows：长度、百分比、Nfr、auto、min/max-content、
 * minmax(a, b)、repeat(次数|auto-fill|auto-fit, 轨道…)。repeat 不许嵌套，轨道最多 12 条。
 */
final class GridTracks extends \HTMLPurifier_AttrDef
{
    private const KEYWORDS = ['auto', 'min-content', 'max-content'];

    public function validate($string, $config, $context)
    {
        $value = strtolower(trim($this->parseCDATA((string)$string)));
        if ($value === 'none') {
            return 'none';
        }

        $tracks = Tokens::split($value, ' ', 12);
        if ($tracks === null) {
            return false;
        }

        $out = [];
        foreach ($tracks as $track) {
            $normalized = $this->track($track, true, $config, $context);
            if ($normalized === null) {
                return false;
            }
            $out[] = $normalized;
        }
        return implode(' ', $out);
    }

    private function track(string $track, bool $allowRepeat, $config, $context): ?string
    {
        if (in_array($track, self::KEYWORDS, true)) {
            return $track;
        }
        if (preg_match('/^(?:\d{1,3}(?:\.\d+)?|\.\d+)fr$/', $track)) {
            return $track;
        }

        if (preg_match('/^minmax\((.*)\)$/', $track, $m)) {
            $args = Tokens::split($m[1], ',', 2);
            if ($args === null || count($args) !== 2) {
                return null;
            }
            $min = $this->track($args[0], false, $config, $context);
            $max = $this->track($args[1], false, $config, $context);
            return $min === null || $max === null ? null : "minmax({$min}, {$max})";
        }

        if ($allowRepeat && preg_match('/^repeat\((.*)\)$/', $track, $m)) {
            $args = Tokens::split($m[1], ',', 2);
            if ($args === null || count($args) !== 2) {
                return null;
            }
            $count = trim($args[0]);
            if (!in_array($count, ['auto-fill', 'auto-fit'], true) && !preg_match('/^(?:[1-9]|1\d|2[0-4])$/', $count)) {
                return null;
            }
            $inner = Tokens::split($args[1], ' ', 8);
            if ($inner === null) {
                return null;
            }
            $tracks = [];
            foreach ($inner as $item) {
                $normalized = $this->track($item, false, $config, $context);
                if ($normalized === null) {
                    return null;
                }
                $tracks[] = $normalized;
            }
            return "repeat({$count}, " . implode(' ', $tracks) . ')';
        }

        $percent = (new \HTMLPurifier_AttrDef_CSS_Percentage(true))->validate($track, $config, $context);
        if ($percent !== false) {
            return $percent;
        }
        $length = (new \HTMLPurifier_AttrDef_CSS_Length('0'))->validate($track, $config, $context);
        return $length === false ? null : $length;
    }
}
