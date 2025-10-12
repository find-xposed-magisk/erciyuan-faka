<?php
declare (strict_types=1);

namespace Kernel\Plugin\Entity;

use Kernel\Component\ToArray;

class Search
{
    use ToArray;

    public string $route;
    public string $code;
    public string $name;
    public string $direction = "after";


    /**
     * @param string $route
     * @param string $code
     * @param string $name
     * @param string $direction
     */
    public function __construct(string $route, string $code, string $name, string $direction = "after")
    {
        $this->code = $code;
        $this->name = $name;
        $this->direction = $direction;
        $this->route = $route;
    }
}