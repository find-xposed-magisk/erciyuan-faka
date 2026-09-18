<?php
declare(strict_types=1);

namespace Kernel\Waf;

use Kernel\Waf\Css\Gradient;
use Kernel\Waf\Css\GridTracks;
use Kernel\Waf\Css\Shadow;

/**
 * 给 HTMLPurifier 补上常用的纯视觉 CSS（#952）。
 *
 * HTMLPurifier 4.18 的默认 CSS 定义停在 CSS2：圆角、阴影、渐变、flex/grid 布局、透明度整条删掉，
 * 富文本商品介绍一保存，「卡片」排版就没了（直接写库的能显示，是因为绕过了净化器）。这里：
 *   - 打开官方的 CSS.Proprietary（border-radius 及四个角）和 CSS.AllowTricky（display/visibility/overflow/opacity）；
 *   - CSS 定义建好后补上阴影、渐变、flex/grid、gap、object-fit 等，值全部逐个 token 校验后重新拼出。
 * position / top / left / z-index 仍然不放（CSS.Trusted 不开）：它们能把内容做成盖住整页的覆盖层来钓鱼。
 *
 * 用法：createDefault() 之后、任何 getDefinition() / maybeGetRaw*() 之前调 configure()（配置一旦定稿就改不了），
 * new HTMLPurifier 之后调 install()。定义对象有磁盘缓存，这里的补充项不进缓存，每个进程都会重新补上。
 */
final class ModernCss
{
    public static function configure(\HTMLPurifier_Config $config): void
    {
        $config->set('CSS.Proprietary', true);
        $config->set('CSS.AllowTricky', true);
    }

    public static function install(\HTMLPurifier_Config $config): void
    {
        $definition = $config->getCSSDefinition();
        if (!$definition instanceof \HTMLPurifier_CSSDefinition) {
            return;
        }

        $important = (bool)$config->get('CSS.AllowImportant');
        $wrap = static fn(\HTMLPurifier_AttrDef $def): \HTMLPurifier_AttrDef => new \HTMLPurifier_AttrDef_CSS_ImportantDecorator($def, $important);
        $enum = static fn(array $values): \HTMLPurifier_AttrDef => $wrap(new \HTMLPurifier_AttrDef_Enum($values));
        $size = static fn(): \HTMLPurifier_AttrDef => new \HTMLPurifier_AttrDef_CSS_Composite([
            new \HTMLPurifier_AttrDef_CSS_Length('0'),
            new \HTMLPurifier_AttrDef_CSS_Percentage(true),
        ]);

        $info = &$definition->info;

        $info['display'] = $enum([
            'none', 'inline', 'block', 'inline-block', 'list-item', 'flex', 'inline-flex', 'grid', 'inline-grid',
            'table', 'inline-table', 'table-row-group', 'table-header-group', 'table-footer-group',
            'table-row', 'table-column-group', 'table-column', 'table-cell', 'table-caption',
        ]);

        $info['flex-direction'] = $enum(['row', 'row-reverse', 'column', 'column-reverse']);
        $info['flex-wrap'] = $enum(['nowrap', 'wrap', 'wrap-reverse']);
        $info['justify-content'] = $enum(['normal', 'flex-start', 'flex-end', 'start', 'end', 'left', 'right', 'center', 'space-between', 'space-around', 'space-evenly', 'stretch']);
        $info['align-items'] = $enum(['normal', 'stretch', 'flex-start', 'flex-end', 'start', 'end', 'center', 'baseline']);
        $info['align-self'] = $enum(['auto', 'normal', 'stretch', 'flex-start', 'flex-end', 'start', 'end', 'center', 'baseline']);
        $info['align-content'] = $enum(['normal', 'stretch', 'flex-start', 'flex-end', 'start', 'end', 'center', 'space-between', 'space-around', 'space-evenly']);
        $info['flex-grow'] = $info['flex-shrink'] = $wrap(new \HTMLPurifier_AttrDef_CSS_Number(true));
        $info['flex-basis'] = $wrap(new \HTMLPurifier_AttrDef_CSS_Composite([$size(), new \HTMLPurifier_AttrDef_Enum(['auto', 'content'])]));
        $info['flex'] = $wrap(new \HTMLPurifier_AttrDef_CSS_Multiple(new \HTMLPurifier_AttrDef_CSS_Composite([
            new \HTMLPurifier_AttrDef_Enum(['auto', 'none', 'initial']),
            new \HTMLPurifier_AttrDef_CSS_Number(true),
            $size(),
        ]), 3));
        $info['gap'] = $wrap(new \HTMLPurifier_AttrDef_CSS_Multiple($size(), 2));
        $info['row-gap'] = $info['column-gap'] = $wrap($size());
        $info['grid-template-columns'] = $info['grid-template-rows'] = $wrap(new GridTracks());

        $info['box-shadow'] = $wrap(new Shadow(true));
        $info['text-shadow'] = $wrap(new Shadow(false));
        $info['background'] = $wrap(new Gradient($info['background'] ?? null));
        $info['background-image'] = $wrap(new Gradient($info['background-image'] ?? null));

        $info['overflow-x'] = $info['overflow-y'] = $enum(['visible', 'hidden', 'clip', 'auto', 'scroll']);
        $info['object-fit'] = $enum(['fill', 'contain', 'cover', 'none', 'scale-down']);
        $info['word-break'] = $enum(['normal', 'break-all', 'keep-all', 'break-word']);
        $info['overflow-wrap'] = $enum(['normal', 'break-word', 'anywhere']);
    }
}
