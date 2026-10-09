<?php
declare(strict_types=1);

namespace App\Util;

use App\Model\Card;
use App\Model\Commodity;

/**
 * Card stock per purchasable race / SKU combination of a commodity's current config.
 * A card group only counts when Sku::comboExists() accepts it (issue #898), so the admin
 * list badge and the SKU stock dialog always agree.
 */
class SkuStock
{
    /** Configs that expand to more combinations than this are not evaluated. */
    public const MAX_COMBOS = 500;

    /** Out-of-stock combinations returned per commodity for the list tooltip. */
    public const SAMPLE_LIMIT = 10;

    /**
     * Out-of-stock combinations for one page of the admin commodity list, using a single grouped query.
     * Only commodities fulfilled from local cards are evaluated.
     *
     * @param array<int, array> $rows commodity rows (id, config, delivery_way, shared_id, card_count)
     * @return array<int, array{combos: int, out: int, sample: array<int, array{race: string, sku: array}>}>
     */
    public static function outages(array $rows): array
    {
        $plans = [];
        $queryIds = [];
        foreach ($rows as $row) {
            $id = (int)($row['id'] ?? 0);
            if ($id <= 0 || isset($plans[$id]) || !self::tracksCards($row)) {
                continue;
            }
            $config = Sku::configArray($row['config'] ?? '');
            $matrix = self::matrix($config);
            if ($matrix === null) {
                continue;
            }
            $plans[$id] = ['config' => $config, 'matrix' => $matrix, 'stocked' => []];
            if (!array_key_exists('card_count', $row) || (int)$row['card_count'] > 0) {
                $queryIds[] = $id;
            }
        }

        if ($queryIds !== []) {
            $groups = Card::query()
                ->whereIn('commodity_id', $queryIds)
                ->where('status', 0)
                ->groupBy(['commodity_id', 'race', 'sku'])
                ->get(['commodity_id', 'race', 'sku']);
            foreach ($groups as $group) {
                $id = (int)$group->commodity_id;
                if (!isset($plans[$id])) {
                    continue;
                }
                $key = self::cardKey($plans[$id]['config'], $group->race, $group->sku);
                if ($key !== null) {
                    $plans[$id]['stocked'][$key] = true;
                }
            }
        }

        $result = [];
        foreach ($plans as $id => $plan) {
            $total = $plan['matrix']['count'];
            $sample = [];
            if (count($plan['stocked']) < $total) {
                foreach (self::combos($plan['matrix']) as $key => $combo) {
                    if (isset($plan['stocked'][$key])) {
                        continue;
                    }
                    $sample[] = $combo;
                    if (count($sample) >= self::SAMPLE_LIMIT) {
                        break;
                    }
                }
            }
            $result[$id] = [
                'combos' => $total,
                'out' => max(0, $total - count($plan['stocked'])),
                'sample' => $sample,
            ];
        }
        return $result;
    }

    /**
     * Unsold / locked / sold / total cards per combination for the SKU stock dialog.
     * For commodities evaluated by outages(), every configured combination is listed in config order,
     * including those without any card.
     *
     * @param Commodity $commodity
     * @return array<int, array{race: ?string, sku: array, unsold: int, locked: int, sold: int, total: int}>
     */
    public static function detail(Commodity $commodity): array
    {
        $config = Sku::configArray($commodity->config);
        $matrix = self::tracksCards($commodity->getAttributes()) ? self::matrix($config) : null;

        $rows = [];
        if ($matrix !== null) {
            foreach (self::combos($matrix) as $key => $combo) {
                $rows[$key] = $combo + ['unsold' => 0, 'locked' => 0, 'sold' => 0, 'total' => 0];
            }
        }

        $groups = Card::query()
            ->where('commodity_id', (int)$commodity->id)
            ->selectRaw('race, sku, SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS unsold, SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS locked, SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS sold, COUNT(*) AS total')
            ->groupBy(['race', 'sku'])
            ->orderBy('race')
            ->get();

        foreach ($groups as $group) {
            $key = self::cardKey($config, $group->race, $group->sku);
            if ($key === null) {
                continue;
            }
            if (!isset($rows[$key])) {
                if ($matrix !== null) {
                    continue;
                }
                $sku = Sku::toArray($group->sku);
                ksort($sku);
                $rows[$key] = ['race' => $group->race, 'sku' => $sku, 'unsold' => 0, 'locked' => 0, 'sold' => 0, 'total' => 0];
            }
            $rows[$key]['unsold'] += (int)$group->unsold;
            $rows[$key]['locked'] += (int)$group->locked;
            $rows[$key]['sold'] += (int)$group->sold;
            $rows[$key]['total'] += (int)$group->total;
        }

        return array_values($rows);
    }

    /**
     * Stock of auto-delivery commodities comes from local cards, unless it is a shared
     * (remote) commodity or docked through the ThirdDockManage plugin (dock_g_id).
     */
    private static function tracksCards(array $row): bool
    {
        return (int)($row['delivery_way'] ?? -1) === 0
            && (int)($row['shared_id'] ?? 0) <= 0
            && (int)($row['dock_g_id'] ?? 0) <= 0;
    }

    /**
     * @return array{races: string[], dims: array<int|string, string[]>, count: int}|null
     *         null when the config has no race / SKU options, or cannot be evaluated
     */
    private static function matrix(array $config): ?array
    {
        $categories = isset($config['category']) && is_array($config['category']) ? $config['category'] : [];
        $skuConfig = isset($config['sku']) && is_array($config['sku']) ? $config['sku'] : [];
        if ($categories === [] && $skuConfig === []) {
            return null;
        }

        $races = $categories === [] ? [''] : array_map('strval', array_keys($categories));
        $count = count($races);
        $dims = [];
        foreach ($skuConfig as $name => $options) {
            // The storefront skips such a dimension while Sku::comboExists() rejects every card for it.
            if (!is_array($options) || $options === []) {
                return null;
            }
            $dims[$name] = array_map('strval', array_keys($options));
            $count *= count($dims[$name]);
            if ($count > self::MAX_COMBOS) {
                return null;
            }
        }

        return $count > self::MAX_COMBOS ? null : ['races' => $races, 'dims' => $dims, 'count' => $count];
    }

    /**
     * @return \Generator<string, array{race: string, sku: array<int|string, string>}>
     */
    private static function combos(array $matrix): \Generator
    {
        $skus = [[]];
        foreach ($matrix['dims'] as $name => $values) {
            $next = [];
            foreach ($skus as $partial) {
                foreach ($values as $value) {
                    $next[] = $partial + [$name => $value];
                }
            }
            $skus = $next;
        }

        foreach ($matrix['races'] as $race) {
            foreach ($skus as $sku) {
                yield self::key($race, $sku) => ['race' => $race, 'sku' => $sku];
            }
        }
    }

    private static function cardKey(array $config, mixed $race, mixed $sku): ?string
    {
        $race = trim((string)($race ?? ''));
        $sku = Sku::toArray($sku);
        foreach ($sku as $value) {
            if ($value !== null && !is_scalar($value)) {
                return null;
            }
        }
        if (!Sku::comboExists($config, $race, $sku)) {
            return null;
        }
        return self::key($race, array_map('strval', $sku));
    }

    private static function key(string $race, array $sku): string
    {
        ksort($sku, SORT_STRING);
        return serialize([$race, $sku]);
    }
}
