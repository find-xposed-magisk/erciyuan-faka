<?php
declare(strict_types=1);

namespace App\Model;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * Archive behind a file-type card.
 *
 * Kept apart from the card row on purpose: a sold file must stay downloadable after its card is
 * deleted, so the row lives on until neither the card nor the delivering order exists
 * (see App\Util\CardFile\Purge).
 *
 * @property int $id
 * @property int|null $card_id null = uploaded but not stocked yet
 * @property int|null $order_id order the file was delivered with
 * @property int $owner 0 = system
 * @property string $token public download token (48 hex)
 * @property string $path storage path relative to runtime/card-file
 * @property string $name original file name (display / download name)
 * @property int $size bytes
 * @property string $hash sha256
 * @property int $downloads
 * @property string|null $last_download_time
 * @property string $create_time
 */
class CardFile extends Model
{
    protected $table = "card_file";

    public $timestamps = false;

    protected $casts = [
        'id' => 'integer',
        'card_id' => 'integer',
        'order_id' => 'integer',
        'owner' => 'integer',
        'size' => 'integer',
        'downloads' => 'integer',
    ];

    /** Storage location and bearer token never leave the server through serialization. */
    protected $hidden = ['path', 'token'];

    public function card(): ?HasOne
    {
        return $this->hasOne(Card::class, "id", "card_id");
    }

    public function order(): ?HasOne
    {
        return $this->hasOne(Order::class, "id", "order_id");
    }
}
