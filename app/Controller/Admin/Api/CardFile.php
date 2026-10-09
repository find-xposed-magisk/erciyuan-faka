<?php
declare(strict_types=1);

namespace App\Controller\Admin\Api;

use App\Controller\Base\API\Manage;
use App\Interceptor\ManageSession;
use App\Interceptor\Owner;
use App\Model\CardFile as CardFileModel;
use App\Model\ManageLog;
use App\Util\CardFile\Archive;
use App\Util\CardFile\Policy;
use App\Util\CardFile\Purge;
use App\Util\CardFile\Stream;
use App\Util\CardFile\Upload;
use App\Util\Schema;
use Illuminate\Database\Eloquent\Builder;
use Kernel\Annotation\Interceptor;
use Kernel\Exception\JSONException;

/**
 * File cards: chunked archive upload for the admin card import, staging and preview download.
 * Stocking the staged archives happens in Card::save() with card_type 2.
 */
#[Interceptor(ManageSession::class, Interceptor::TYPE_API)]
class CardFile extends Manage
{
    /** Error code telling the uploader to retry the chunk with a smaller chunk size. */
    public const CODE_CHUNK_TOO_LARGE = 413;

    private const MAX_IDS = 500;
    private const CHUNK_TOO_LARGE = '分片超过了服务器单次上传的大小限制，请减小分片后重试';

    public function config(): array
    {
        return $this->json(data: [
            'max_size' => Policy::maxBytes(),
            'max_size_mb' => Policy::maxMegabytes(),
            'chunk_size' => Policy::chunkBytes(),
            'extensions' => Archive::extensions(),
            'accept' => Archive::accept(),
        ]);
    }

    /**
     * @throws JSONException
     */
    public function begin(): array
    {
        $this->requirePost();
        $this->requireTable();
        Purge::collect();

        $name = $this->input('name');
        if (!is_string($name) || trim($name) === '') {
            throw new JSONException('请选择要上传的压缩包');
        }
        $size = $this->integer($this->input('size'), '文件大小不正确');
        $session = Upload::begin($this->manageId(), $name, $size);

        return $this->json(data: [
            'upload_id' => $session['upload_id'],
            'name' => $session['name'],
            'size' => $session['size'],
            'chunk_size' => $session['chunk_size'],
            'received' => 0,
        ]);
    }

    /**
     * multipart: upload_id, offset, chunk (binary)
     * @throws JSONException
     */
    public function chunk(): array
    {
        $this->requirePost();

        $chunk = $_FILES['chunk'] ?? null;
        if (!is_array($chunk)) {
            if ($this->bodyExceedsPostLimit()) {
                throw new JSONException(self::CHUNK_TOO_LARGE, self::CODE_CHUNK_TOO_LARGE);
            }
            throw new JSONException('没有收到分片数据，请重试');
        }
        $error = $chunk['error'] ?? UPLOAD_ERR_NO_FILE;
        if (!is_int($error) && !(is_string($error) && ctype_digit($error))) {
            throw new JSONException('分片数据格式不正确');
        }
        $error = (int)$error;
        if ($error === UPLOAD_ERR_INI_SIZE || $error === UPLOAD_ERR_FORM_SIZE) {
            throw new JSONException(self::CHUNK_TOO_LARGE, self::CODE_CHUNK_TOO_LARGE);
        }
        if ($error !== UPLOAD_ERR_OK) {
            throw new JSONException(self::uploadErrorMessage($error));
        }
        $tmp = $chunk['tmp_name'] ?? '';
        if (!is_string($tmp) || $tmp === '' || !is_uploaded_file($tmp)) {
            throw new JSONException('分片数据无效，请重试');
        }

        $uploadId = $this->uploadId();
        $offset = $this->integer($this->input('offset'), '分片位置不正确');
        $result = Upload::append($this->manageId(), $uploadId, $offset, $tmp);

        return $this->json(data: [
            'received' => $result['received'],
            'accepted' => $result['accepted'],
        ]);
    }

    /**
     * @throws JSONException
     */
    public function finish(): array
    {
        $this->requirePost();
        $this->requireTable();

        $file = Upload::finish($this->manageId(), $this->uploadId());
        $duplicate = CardFileModel::query()
            ->where('owner', 0)
            ->where('hash', $file->hash)
            ->whereKeyNot($file->id)
            ->whereNotNull('card_id')
            ->whereHas('card', static function (Builder $query): void {
                $query->where('owner', 0);
            })
            ->exists();

        ManageLog::log(
            $this->getManage(),
            '[上传文件卡密]' . self::logName((string)$file->name) . '（' . self::formatBytes((int)$file->size) . '）'
        );
        return $this->json(data: [
            'id' => (int)$file->id,
            'name' => (string)$file->name,
            'size' => (int)$file->size,
            'hash' => (string)$file->hash,
            'duplicate' => $duplicate,
        ]);
    }

    /**
     * @throws JSONException
     */
    public function cancel(): array
    {
        $this->requirePost();
        Upload::cancel($this->manageId(), $this->uploadId());
        return $this->json(200, '已取消上传');
    }

    /**
     * Delete staged archives that were uploaded but not stocked (ids: array or comma list).
     * @throws JSONException
     */
    public function discard(): array
    {
        $this->requirePost();
        $this->requireTable();

        $ids = $this->ids($this->input('ids'));
        if ($ids === []) {
            throw new JSONException('请选择要删除的文件');
        }
        $count = Purge::staged($ids);
        if ($count > 0) {
            ManageLog::log($this->getManage(), "[删除文件卡密]删除未入库的压缩包，共计：{$count}");
        }
        return $this->json(200, '删除成功', ['count' => $count]);
    }

    /**
     * Preview download for the system account only (archives are the goods themselves, like the
     * admin file manager download); does not count as a buyer download.
     * @throws JSONException
     */
    #[Interceptor(Owner::class, Interceptor::TYPE_API)]
    public function download(): void
    {
        $this->requireTable();
        $id = $this->integer($this->request->unsafeGet('id'), '文件不存在');
        $file = $id > 0 ? CardFileModel::query()->find($id) : null;
        if (!$file instanceof CardFileModel) {
            throw new JSONException('文件不存在');
        }
        ManageLog::log($this->getManage(), '[下载文件卡密]' . self::logName((string)$file->name));
        Stream::send($file, false);
    }

    /**
     * @throws JSONException
     */
    private function requirePost(): void
    {
        if (strtoupper($this->request->method()) !== 'POST') {
            throw new JSONException('请求方式不正确');
        }
    }

    /**
     * @throws JSONException
     */
    private function requireTable(): void
    {
        Schema::ensureCardFileTable();
        if (!Schema::tableExists('card_file')) {
            throw new JSONException('缺少文件卡密数据表，请检查数据库账号是否有建表权限');
        }
    }

    /**
     * @throws JSONException
     */
    private function manageId(): int
    {
        $manage = $this->getManage();
        $id = $manage ? (int)$manage->id : 0;
        if ($id <= 0) {
            throw new JSONException('登录会话过期，请重新登录..');
        }
        return $id;
    }

    /**
     * @throws JSONException
     */
    private function uploadId(): string
    {
        $value = $this->input('upload_id');
        if (!is_string($value) || !Upload::isUploadId($value)) {
            throw new JSONException('上传会话无效或已过期，请重新上传');
        }
        return $value;
    }

    /** Raw request value (form body first, then JSON body); every caller validates it. */
    private function input(string $key): mixed
    {
        $value = $this->request->unsafePost($key);
        if ($value === null) {
            $value = $this->request->unsafeJson($key);
        }
        return $value;
    }

    /**
     * Non-negative integer from a request value.
     * @throws JSONException
     */
    private function integer(mixed $value, string $message): int
    {
        if (is_int($value) && $value >= 0) {
            return $value;
        }
        if (is_string($value) && preg_match('/^\d{1,15}$/D', $value)) {
            return (int)$value;
        }
        throw new JSONException($message);
    }

    /**
     * @return int[]
     * @throws JSONException
     */
    private function ids(mixed $value): array
    {
        if (is_string($value)) {
            $value = $value === '' ? [] : explode(',', $value);
        }
        if (!is_array($value)) {
            $value = $value === null ? [] : [$value];
        }
        $ids = [];
        foreach ($value as $candidate) {
            if (is_int($candidate)) {
                $id = $candidate;
            } elseif (is_string($candidate) && preg_match('/^\d{1,10}$/D', trim($candidate))) {
                $id = (int)trim($candidate);
            } else {
                throw new JSONException('文件 ID 必须是正整数');
            }
            if ($id <= 0) {
                throw new JSONException('文件 ID 必须是正整数');
            }
            $ids[$id] = $id;
        }
        if (count($ids) > self::MAX_IDS) {
            throw new JSONException('单次最多操作 ' . self::MAX_IDS . ' 个文件');
        }
        return array_values($ids);
    }

    /** PHP drops $_POST and $_FILES entirely when the body is larger than post_max_size. */
    private function bodyExceedsPostLimit(): bool
    {
        $length = $_SERVER['CONTENT_LENGTH'] ?? '';
        $limit = Policy::iniBytes((string)ini_get('post_max_size'));
        return $limit !== null && is_string($length) && ctype_digit($length) && (int)$length > $limit;
    }

    private static function uploadErrorMessage(int $error): string
    {
        return match ($error) {
            UPLOAD_ERR_PARTIAL => '分片传输中断，请重试',
            UPLOAD_ERR_NO_FILE => '没有收到分片数据，请重试',
            UPLOAD_ERR_NO_TMP_DIR => '服务器缺少上传临时目录，无法接收文件',
            UPLOAD_ERR_CANT_WRITE => '服务器无法写入上传临时文件，请检查磁盘空间',
            UPLOAD_ERR_EXTENSION => '上传被服务器的 PHP 扩展拦截',
            default => '分片上传失败，请重试',
        };
    }

    /** File names go into manage_log.content (varchar 128): keep log lines short. */
    private static function logName(string $name): string
    {
        return mb_strlen($name) > 60 ? mb_substr($name, 0, 59) . '…' : $name;
    }

    private static function formatBytes(int $bytes): string
    {
        if ($bytes >= 1048576) {
            return round($bytes / 1048576, 1) . ' MB';
        }
        if ($bytes >= 1024) {
            return round($bytes / 1024, 1) . ' KB';
        }
        return $bytes . ' B';
    }
}
