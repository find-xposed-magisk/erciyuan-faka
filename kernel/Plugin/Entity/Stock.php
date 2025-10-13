<?php
declare (strict_types=1);

namespace Kernel\Plugin\Entity;

class Stock
{
    /**
     * @var string
     */
    private string $stock;


    public function __construct(string|int $stock)
    {
        $this->stock = (string)$stock;
    }


    /**
     * @param string|int $stock
     */
    public function setStock(string|int $stock): void
    {
        $this->stock = (string)$stock;
    }


    /**
     * @return string
     */
    public function getStock(): string
    {
        return $this->stock;
    }
}