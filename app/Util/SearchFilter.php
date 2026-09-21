<?php
declare(strict_types=1);

namespace App\Util;

/**
 * 后台表格搜索栏提交上来的筛选条件。
 *
 * search.js 的 getData() 用 util.paramsToJSONObject($(form).serialize()) 取值：只按 & 和 = 切开、
 * 不解码，所以筛选值（以及 SKU 这类可能带中文的键名）到服务端时还多带一层 URL 编码——
 * 空格是 +、冒号是 %3A、中文是 %E6…。列表接口靠 Query::get 再 urldecode 一次还原。
 *
 * 导出接口自己逐项校验筛选条件，必须先解掉这一层：否则时间筛选一律报「筛选不正确」，
 * 带空格、中文、@ 的条件永远匹配不上。解码口径也必须和列表一致，导出的才是列表里看到的。
 */
final class SearchFilter
{
    private const FILTER_KEY = '/^(?:equal|search|betweenStart|betweenEnd)-/';

    /**
     * 解掉筛选字段多出的那层编码，其余字段原样返回。
     *
     * 只处理 equal-/search-/betweenStart-/betweenEnd- 开头的键和 $extraKeys 点名的键；
     * 导出数量、导出备注这类弹窗表单字段是正常编码提交的，再解一次会把备注里的 + 变成空格。
     *
     * @param array $raw
     * @param string[] $extraKeys
     * @return array
     */
    public static function decode(array $raw, array $extraKeys = []): array
    {
        $decoded = [];
        foreach ($raw as $key => $value) {
            $key = (string)$key;
            if (!preg_match(self::FILTER_KEY, $key) && !in_array($key, $extraKeys, true)) {
                $decoded[$key] = $value;
                continue;
            }
            $decoded[urldecode($key)] = is_scalar($value) ? urldecode((string)$value) : $value;
        }
        return $decoded;
    }
}
