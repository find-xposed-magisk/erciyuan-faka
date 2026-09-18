<?php
declare(strict_types=1);

namespace Kernel\Waf\Css;

/**
 * background / background-image 的渐变：(repeating-)linear-gradient / radial-gradient，最多 4 层。
 * 方向、形状、色标逐个校验后重新拼出；不是渐变的值原样交给 HTMLPurifier 自带的定义（$fallback），
 * url() 等仍走它原来的校验。看着像渐变但写得不对，整条丢弃。
 */
final class Gradient extends \HTMLPurifier_AttrDef
{
    private const SIDES = ['left', 'right', 'top', 'bottom'];
    private const RADIAL_WORDS = ['circle', 'ellipse', 'closest-side', 'closest-corner', 'farthest-side', 'farthest-corner'];
    private const POSITION_WORDS = ['left', 'right', 'top', 'bottom', 'center'];

    public function __construct(private ?\HTMLPurifier_AttrDef $fallback = null)
    {
    }

    public function validate($string, $config, $context)
    {
        $value = trim($this->parseCDATA((string)$string));
        if (!preg_match('/^(?:repeating-)?(?:linear|radial)-gradient\s*\(/i', $value)) {
            return $this->fallback ? $this->fallback->validate($string, $config, $context) : false;
        }

        $layers = Tokens::split($value, ',', 4);
        if ($layers === null) {
            return false;
        }

        $out = [];
        foreach ($layers as $layer) {
            $gradient = $this->gradient($layer, $config, $context);
            if ($gradient === null) {
                return false;
            }
            $out[] = $gradient;
        }

        return implode(', ', $out);
    }

    private function gradient(string $layer, $config, $context): ?string
    {
        if (!preg_match('/^((?:repeating-)?(linear|radial)-gradient)\s*\((.*)\)$/is', $layer, $m)) {
            return null;
        }
        $function = strtolower($m[1]);
        $kind = strtolower($m[2]);

        $args = Tokens::split($m[3], ',', 12);
        if ($args === null || count($args) < 2) {
            return null;
        }

        $out = [];
        $prelude = $kind === 'linear' ? $this->direction($args[0]) : $this->shape($args[0], $config, $context);
        if ($prelude !== null) {
            $out[] = $prelude;
            array_shift($args);
        }
        if (count($args) < 2) {
            return null;
        }

        foreach ($args as $stop) {
            $normalized = $this->stop($stop, $config, $context);
            if ($normalized === null) {
                return null;
            }
            $out[] = $normalized;
        }

        return $function . '(' . implode(', ', $out) . ')';
    }

    /** 线性渐变方向：角度（90deg / .25turn）或 to right / to top left */
    private function direction(string $arg): ?string
    {
        $arg = strtolower(trim($arg));
        if (preg_match('/^-?(?:\d{1,4}(?:\.\d+)?|\.\d+)(?:deg|grad|rad|turn)$/', $arg)) {
            return $arg;
        }
        $words = preg_split('/\s+/', $arg);
        if ($words[0] !== 'to' || count($words) < 2 || count($words) > 3) {
            return null;
        }
        $sides = array_slice($words, 1);
        foreach ($sides as $side) {
            if (!in_array($side, self::SIDES, true)) {
                return null;
            }
        }
        return 'to ' . implode(' ', array_unique($sides));
    }

    /** 径向渐变的形状/大小/圆心：circle、ellipse farthest-corner、circle at 50% 30%、at top left */
    private function shape(string $arg, $config, $context): ?string
    {
        $tokens = Tokens::split(strtolower(trim($arg)), ' ', 6);
        if ($tokens === null) {
            return null;
        }

        $out = [];
        $atPosition = false;
        $positionCount = 0;
        foreach ($tokens as $token) {
            if ($token === 'at' && !$atPosition) {
                $atPosition = true;
                $out[] = 'at';
                continue;
            }
            if (!$atPosition) {
                if (!in_array($token, self::RADIAL_WORDS, true)) {
                    return null;
                }
                $out[] = $token;
                continue;
            }
            $position = in_array($token, self::POSITION_WORDS, true) ? $token : $this->lengthOrPercent($token, $config, $context);
            if ($position === null || ++$positionCount > 2) {
                return null;
            }
            $out[] = $position;
        }

        if ($out === [] || ($atPosition && $positionCount === 0)) {
            return null;
        }
        return implode(' ', $out);
    }

    /** 色标：颜色 + 最多两个位置 */
    private function stop(string $stop, $config, $context): ?string
    {
        $tokens = Tokens::split(trim($stop), ' ', 3);
        if ($tokens === null) {
            return null;
        }

        $color = (new \HTMLPurifier_AttrDef_CSS_Color())->validate($tokens[0], $config, $context);
        if ($color === false) {
            return null;
        }

        $out = [$color];
        foreach (array_slice($tokens, 1) as $token) {
            $position = $this->lengthOrPercent($token, $config, $context);
            if ($position === null) {
                return null;
            }
            $out[] = $position;
        }
        return implode(' ', $out);
    }

    private function lengthOrPercent(string $token, $config, $context): ?string
    {
        $percent = (new \HTMLPurifier_AttrDef_CSS_Percentage())->validate($token, $config, $context);
        if ($percent !== false) {
            return $percent;
        }
        $length = (new \HTMLPurifier_AttrDef_CSS_Length())->validate($token, $config, $context);
        return $length === false ? null : $length;
    }
}
