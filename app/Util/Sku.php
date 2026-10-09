<?php
declare(strict_types=1);

namespace App\Util;

use App\Model\Card;
use App\Model\Commodity;
use Illuminate\Database\Eloquent\Builder;
use Kernel\Exception\JSONException;

/**
 * SKU 键名校验。
 *
 * SKU 名（如「机身颜色」「套餐-月付」「カラー」）由站长在商品里自定义，可以是任意文案。
 * 旧实现用「枚举允许字符」的白名单正则（只放行 A-Za-z0-9_ 和基本区汉字），
 * 结果连字符、括号、日文假名等常见写法全被判为非法，导致卡密/优惠券按 SKU 筛选
 * 时直接导不出（issue #797）。
 *
 * 这里改为「排除注入字符」：键名会被拼进 Eloquent 的 JSON 路径（sku->键名），
 * 只需挡住能改变路径语义或闭合引号的字符，其余正常文案一律放行。
 */
class Sku
{
    /** 键名最大长度（字符） */
    public const MAX_KEY_LENGTH = 32;

    /** 预选卡密不是本单所选的种类 / 规格时给买家的提示（不带卡号与规格值） */
    public const DRAFT_MISMATCH = '预选卡密与当前所选的种类或规格不一致，请重新选择';

    /**
     * 键名是否可安全用于 `sku->{$key}` 的 JSON 路径查询。
     *
     * 拒绝：空串、超长、控制字符、引号/反引号/反斜杠（闭合与转义）、
     * `->`（Eloquent 的 JSON 路径分隔符，会造成意料外的嵌套）、
     * `[` `]`（数组下标语法）。
     *
     * @param string $key
     * @return bool
     */
    public static function isValidKey(string $key): bool
    {
        if ($key === '' || mb_strlen($key) > self::MAX_KEY_LENGTH) {
            return false;
        }

        if (str_contains($key, '->')) {
            return false;
        }

        return preg_match('/[\x00-\x1F\x7F"\'`\\\\\[\]]/u', $key) !== 1;
    }

    /**
     * 把商品 config（Ini 字符串或已解析数组）统一成数组。
     *
     * @param mixed $config
     * @return array
     */
    public static function configArray(mixed $config): array
    {
        if (is_array($config)) {
            return $config;
        }
        if (is_string($config) && $config !== '') {
            try {
                return Ini::toArray($config);
            } catch (\Throwable) {
                return [];
            }
        }
        return [];
    }

    /**
     * 把 sku 值（JSON 字符串或数组）统一成数组。
     *
     * @param mixed $sku
     * @return array
     */
    public static function toArray(mixed $sku): array
    {
        if (is_array($sku)) {
            return $sku;
        }
        if (is_string($sku) && $sku !== '') {
            $decoded = json_decode($sku, true);
            return is_array($decoded) ? $decoded : [];
        }
        return [];
    }

    /**
     * 去重签名：race + 键排序后的 sku。
     * 键序不同但语义相同的组合（如 {"a":1,"b":2} 与 {"b":2,"a":1}）会归并为同一签名，
     * 解决库存统计里同一规格因 JSON 存储顺序不同而出现「重复项」的问题。
     *
     * @param string|null $race
     * @param mixed $sku
     * @return string
     */
    public static function signature(?string $race, mixed $sku): string
    {
        $arr = self::toArray($sku);
        ksort($arr);
        return trim((string)($race ?? '')) . '|' . json_encode($arr, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * 判断 (race, sku) 是否仍是商品「当前」SKU 配置里的合法组合。
     *
     * 卡密表里会沉淀历史用过的 race/sku（规格改名或删除后旧卡仍在），库存统计与
     * 通知中心库存预警若直接按卡密分组，就会把这些早已废弃的规格也展示 / 误报缺货
     * （issue #898）。用本方法按商品当前 config 过滤，只保留仍然有效的组合。
     *
     * 规则：
     *  - 种类(category)：config 里有种类则 race 必须命中其中一个键；config 里没有种类则 race 必须为空。
     *  - 规格(sku)：config 里有规格则 sku 的维度名必须与配置完全一致（多一个/少一个都算历史遗留），
     *    且每个维度取值必须仍是当前配置里的合法选项；config 里没有规格则 sku 必须为空。
     *
     * @param array $config 已解析的商品 config（可用 self::configArray() 得到）
     * @param string|null $race
     * @param mixed $sku
     * @return bool
     */
    public static function comboExists(array $config, ?string $race, mixed $sku): bool
    {
        $race = trim((string)($race ?? ''));

        $categories = (isset($config['category']) && is_array($config['category'])) ? $config['category'] : [];
        if ($categories !== []) {
            if ($race === '' || !array_key_exists($race, $categories)) {
                return false;
            }
        } elseif ($race !== '') {
            return false;
        }

        $skuArr = self::toArray($sku);
        $skuConfig = (isset($config['sku']) && is_array($config['sku'])) ? $config['sku'] : [];

        if ($skuConfig === []) {
            return $skuArr === [];
        }

        $need = array_map('strval', array_keys($skuConfig));
        sort($need);
        $have = array_map('strval', array_keys($skuArr));
        sort($have);
        if ($need !== $have) {
            return false;
        }

        foreach ($skuConfig as $name => $options) {
            if (!is_array($options)) {
                return false;
            }
            if (!array_key_exists((string)($skuArr[$name] ?? ''), $options)) {
                return false;
            }
        }

        return true;
    }

    /**
     * 商品现在有没有「种类」。
     */
    public static function hasCategories(array $config): bool
    {
        return !empty($config['category']) && is_array($config['category']);
    }

    /**
     * 卡密比对用的商品口径：基础 config，再并上各会员组独立定价里的种类——任一处定义了种类，就按种类比对。
     * 已经套过会员组的 config（估价时）直接照用。
     */
    public static function selectionConfig(Commodity $commodity): array
    {
        $config = self::configArray($commodity->config);
        $categories = self::hasCategories($config) ? $config['category'] : [];
        foreach ((array)json_decode((string)$commodity->level_price, true) as $level) {
            $inner = is_array($level) ? self::configArray((string)($level['config'] ?? '')) : [];
            if (self::hasCategories($inner)) {
                $categories += $inner['category'];
            }
        }
        if ($categories !== []) {
            $config['category'] = $categories;
        }
        return $config;
    }

    /**
     * 卡密按「种类 + 已选规格」筛选：自动发货拉卡与预选卡复核共用这一个口径。
     * 种类相等（订单没有种类就只认没有种类的卡），已选的每个规格逐键相等。
     * 传入商品口径（selectionConfig）且商品现在没有种类时，不比种类：卡上残留的旧种类不影响出售。
     *
     * @throws JSONException 规格键名或取值不合法
     */
    public static function whereCardSelection(Builder $query, ?string $race, ?array $sku, ?array $config = null): Builder
    {
        $race = (string)$race;
        $byRace = $config === null || self::hasCategories($config);
        if ($byRace && $race !== '') {
            $query->where('race', $race);
        } elseif ($byRace) {
            $query->where(function ($inner) {
                $inner->whereNull('race')->orWhere('race', '');
            });
        }

        foreach ($sku ?? [] as $key => $value) {
            if (!self::isValidKey((string)$key) || !is_scalar($value)) {
                throw new JSONException('规格参数不正确');
            }
            $query->where("sku->{$key}", (string)$value);
        }

        return $query;
    }

    /**
     * 预选卡是否正是本单所选的种类与规格（估价、下单加锁、发货前复核共用）。
     * 除了与拉卡同口径的筛选，卡上带的、商品当前定义了选项的规格维度也必须都选了：
     * 少传一个维度，估价就会漏掉该维度的加价，把贵规格的卡按便宜价报出来。
     *
     * @param array $config 商品口径（selectionConfig；估价时是套过会员组的 config）
     * @throws JSONException
     */
    public static function cardSelectable(int $cardId, ?string $race, ?array $sku, array $config): bool
    {
        $card = self::whereCardSelection(Card::query()->whereKey($cardId), $race, $sku, $config)->first(['id', 'sku']);
        if (!$card) {
            return false;
        }

        $dimensions = (isset($config['sku']) && is_array($config['sku'])) ? $config['sku'] : [];
        foreach (array_keys(self::toArray($card->sku)) as $key) {
            if (!empty($dimensions[$key]) && !array_key_exists($key, $sku ?? [])) {
                return false;
            }
        }

        return true;
    }
}
