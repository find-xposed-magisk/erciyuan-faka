<?php
declare(strict_types=1);

namespace App\Service;

use App\Model\Commodity;
use App\Model\User;
use App\Model\UserGroup;
use Kernel\Annotation\Bind;

#[Bind(class: \App\Service\Bind\Shop::class)]
interface Shop
{

    /**
     * @param UserGroup|null $group
     * @return array
     */
    public function getCategory(?UserGroup $group): array;

    /**
     * @param int|string $commodityId
     * @param User|null $user
     * @param UserGroup|null $group
     * @return array
     */
    public function getItem(int|string $commodityId, ?User $user = null, ?UserGroup $group = null): array;

    /**
     * @param int|Commodity $commodity
     * @param string|null $race
     * @param array|null $sku
     * @return string|null
     */
    public function getSharedStock(int|Commodity $commodity, ?string $race = null, ?array $sku = []): string|null;

    /**
     * @param int|Commodity $commodity
     * @param string|null $race
     * @param array|null $sku
     * @return void
     */
    public function updateSharedStock(int|Commodity $commodity, ?string $race = null, ?array $sku = []): void;

    /**
     * @param int $id
     * @param string|null $race
     * @param array|null $sku
     * @return string
     */
    public function getSharedStockHash(int $id, ?string $race = null, ?array $sku = []): string;

    /**
     * @param int|Commodity|string $commodity
     * @param string|null $race
     * @param array|null $sku
     * @return string
     */
    public function getItemStock(int|Commodity|string $commodity, ?string $race = null, ?array $sku = []): string;

    /**
     * @param int|string|null $stock
     * @return string
     */
    public function getHideStock(int|string|null $stock): string;

    /**
     * @param int|string|null $stock
     * @return int
     */
    public function getStockState(int|string|null $stock): int;

    /**
     * 预选卡的溢价与成本；传入本单所选的种类与规格时，同时确认这张卡正是该规格（不符抛异常）。
     * @param int|Commodity|string $commodity
     * @param int $cardId
     * @param string|null $race
     * @param array|null $sku
     * @return array
     */
    public function getDraft(int|Commodity|string $commodity, int $cardId, ?string $race = null, ?array $sku = null): array;


    /**
     * @param Commodity $commodity
     * @return void
     */
    public function substationPriceIncrease(Commodity &$commodity): void;


    /**
     * @param Commodity|int $commodity
     * @param int|string|float $amount
     * @return string
     */
    public function getSubstationPrice(Commodity|int $commodity, int|string|float $amount): string;
}