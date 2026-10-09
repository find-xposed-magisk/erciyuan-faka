<?php
declare(strict_types=1);

namespace App\Util;

use App\Model\User;

/**
 * 会话内步进验证（sudo 模式）：修改收款账号这类「会话被盗就能把钱转走」的操作，先确认是账号本人。
 *
 * 开了两步验证用验证器动态码，没开用登录密码（校验与限流在 User/Api/Security::stepVerify）。
 * 通过后与资金操作二次验证共用 FundGuard 的 5 分钟窗口，窗口内不再重复验证。
 * 接口要求验证时返回 CODE，data.method 告诉前端要动态码还是密码；核心 util.post 弹框验证后重放原请求。
 */
class StepUp
{
    public const CODE = 42003;

    public const METHOD_TOTP = 'totp';

    public const METHOD_PASSWORD = 'password';

    public static function method(User $user): string
    {
        Schema::ensureUserTotp();
        return empty($user->totp_secret) ? self::METHOD_PASSWORD : self::METHOD_TOTP;
    }

    public static function verified(User $user): bool
    {
        return FundGuard::verified((int)$user->id);
    }

    public static function markVerified(User $user): void
    {
        FundGuard::markVerified((int)$user->id);
    }
}
