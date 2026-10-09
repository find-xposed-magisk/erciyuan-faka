/**
 * File cards (card_type 2): every uploaded archive becomes one card.
 *
 * Archives go up in chunks (begin → chunk … → finish), so PHP/nginx body limits never apply.
 * A 413 or a "chunk too large" answer halves the chunk (down to 256 KiB) and resends the same offset;
 * accepted:false resumes from the offset the server reports.
 *
 *   complete: (form, dom) => CardFileUploader.mount(dom, {name: 'files'})   // Form custom field; Form cleanup calls destroy()
 *   const kit = CardFileUploader.cardForm({done});                          // card upload popups (card.js / commodity.js)
 *   CardFileUploader.fileChip(row.file);                                     // file cell in the card list
 *
 * Instance API: getFileIds(), isBusy(), hasPendingWork(), failedCount(), markSaved(ids), attention(), clear(), destroy().
 */
window.CardFileUploader = (() => {
    const STYLE_ID = 'md-card-file-style';
    const API = '/admin/api/cardFile/';
    const SAVE_ROUTE = '/admin/api/card/save';
    const FILE_TYPE = 2;
    const CONCURRENCY = 2;
    const MIN_CHUNK = 256 * 1024;
    const MAX_CHUNK = 64 * 1024 * 1024;
    const FALLBACK_CHUNK = 2 * 1024 * 1024;
    const RETRIES = 4;
    const STALL_MS = 60000;
    const RESPONSE_MS = 180000;
    const FOLDER_LIMIT = 2000;
    const TOO_LARGE = /\b413\b|too large|entity|过大|太大/i;
    const T = text => (typeof i18n === 'function' ? i18n(text) : text);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    const icon = name => `<span class="material-icons-outlined" aria-hidden="true">${name}</span>`;
    const isMobileAdmin = () => Boolean(window.AdminMobile && typeof window.AdminMobile.isEnabled === 'function' && window.AdminMobile.isEnabled());
    const isTouch = () => isMobileAdmin() || Boolean(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
    const reduceMotion = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    const STYLE = `
        .md-cfu{position:relative;display:flex;flex-direction:column;gap:12px;min-width:0}
        .md-cfu [hidden]{display:none!important}
        .md-cfu__sr,.md-cfu__input{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;
            clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important;opacity:0}
        .md-cfu__zone{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:156px;padding:22px 20px;
            border:1.5px dashed var(--md-outline,rgba(0,0,0,.23));border-radius:var(--md-radius-lg,12px);background:var(--md-bg,#f4f5f7);text-align:center;cursor:pointer;
            transition:border-color .16s var(--md-ease,ease),background-color .16s var(--md-ease,ease),box-shadow .16s var(--md-ease,ease),min-height .2s var(--md-ease,ease),padding .2s var(--md-ease,ease)}
        .md-cfu__zone:hover,.md-cfu__zone.is-hint{border-color:rgba(var(--md-primary-rgb,25,118,210),.6)}
        .md-cfu__zone.is-over{border-style:solid;border-color:var(--md-primary,#1976d2);background:rgba(var(--md-primary-rgb,25,118,210),.07);
            box-shadow:0 0 0 4px rgba(var(--md-primary-rgb,25,118,210),.12)}
        .md-cfu__zone.is-disabled{cursor:default;border-color:var(--md-divider,rgba(0,0,0,.12))}
        .md-cfu__zone.is-attention{animation:md-cfu-attention .9s var(--md-ease,ease) 1}
        @keyframes md-cfu-attention{0%,100%{box-shadow:0 0 0 0 rgba(var(--md-primary-rgb,25,118,210),0)}
            30%{border-color:var(--md-primary,#1976d2);box-shadow:0 0 0 5px rgba(var(--md-primary-rgb,25,118,210),.18)}}
        .md-cfu__glyph{flex:none;display:grid;place-items:center;width:46px;height:46px;border-radius:13px;color:var(--md-primary,#1976d2);
            background:rgba(var(--md-primary-rgb,25,118,210),.1);transition:transform .2s var(--md-ease,ease),background-color .16s,color .16s}
        .md-cfu__glyph .material-icons-outlined{font-size:25px}
        .md-cfu__zone.is-over .md-cfu__glyph{transform:translateY(-3px);background:var(--md-primary,#1976d2);color:var(--md-on-primary,#fff)}
        .md-cfu__copy{display:flex;flex-direction:column;gap:4px;min-width:0}
        .md-cfu__title{margin:0;font-size:14px;font-weight:500;line-height:1.5;color:var(--md-on-surface,rgba(0,0,0,.87))}
        .md-cfu__pick{display:inline;margin:0;padding:0 2px;border:0;border-radius:4px;background:none;font:inherit;font-weight:600;line-height:inherit;
            color:var(--md-primary,#1976d2);cursor:pointer}
        .md-cfu__pick:hover{text-decoration:underline;text-underline-offset:3px}
        .md-cfu__pick:focus-visible{outline:2px solid var(--md-focus-ring,rgba(25,118,210,.4));outline-offset:2px}
        .md-cfu__pick:disabled{color:var(--md-on-surface-dis,rgba(0,0,0,.38));cursor:default;text-decoration:none}
        .md-cfu__hint{margin:0;font-size:12.5px;line-height:1.6;color:var(--md-on-surface-med,rgba(0,0,0,.6))}
        .md-cfu__hint b{font-weight:600;color:var(--md-on-surface,rgba(0,0,0,.87))}
        .md-cfu__hint abbr{text-decoration:none;border-bottom:1px dotted currentColor;cursor:help}
        .md-cfu__notice{display:flex;align-items:center;justify-content:center;gap:8px;margin:0;font-size:12.5px;color:var(--md-error,#d32f2f)}
        .md-cfu__retry-config{border:0;background:none;padding:0;font:inherit;font-weight:600;color:var(--md-primary,#1976d2);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
        .md-cfu.has-items .md-cfu__zone{flex-direction:row;justify-content:flex-start;gap:14px;min-height:0;padding:14px 16px;text-align:left}
        .md-cfu.has-items .md-cfu__glyph{width:40px;height:40px;border-radius:11px}
        .md-cfu.has-items .md-cfu__glyph .material-icons-outlined{font-size:22px}

        .md-cfu__bar{display:flex;align-items:center;gap:12px;min-height:28px;font-size:12.5px;color:var(--md-on-surface-med,rgba(0,0,0,.6));font-variant-numeric:tabular-nums}
        .md-cfu__stats{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .md-cfu__stats strong{font-weight:600;color:var(--md-on-surface,rgba(0,0,0,.87))}
        .md-cfu__state{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
        .md-cfu__state.is-busy{color:var(--md-primary,#1976d2);font-weight:500}
        .md-cfu__state .is-error{color:var(--md-error,#d32f2f)}
        .md-cfu__state .is-warning{color:var(--md-warning,#ed6c02)}
        .md-cfu__clear{flex:none;margin:0 -6px 0 0;padding:4px 8px;border:0;border-radius:6px;background:none;font:inherit;font-weight:500;
            color:var(--md-on-surface-med,rgba(0,0,0,.6));cursor:pointer;transition:background-color .12s,color .12s}
        .md-cfu__clear:hover{background:rgba(var(--md-error-rgb,211,47,47),.08);color:var(--md-error,#d32f2f)}
        .md-cfu__clear:focus-visible{outline:2px solid var(--md-focus-ring,rgba(25,118,210,.4));outline-offset:1px}

        .md-cfu__list{margin:0;padding:0;list-style:none;border:1px solid var(--md-divider,rgba(0,0,0,.12));border-radius:var(--md-radius-lg,12px);
            background:var(--md-surface,#fff);max-height:340px;overflow:auto;overscroll-behavior:contain}
        .md-cfu__item{display:flex;align-items:center;gap:12px;margin:0;padding:11px 8px 11px 14px;list-style:none;animation:md-cfu-in .18s var(--md-ease-out,ease-out)}
        .md-cfu__item+.md-cfu__item{border-top:1px solid var(--md-divider,rgba(0,0,0,.12))}
        @keyframes md-cfu-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        .md-cfu__ext,.md-cfu-chip__ext{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:9px;
            border:1px solid var(--md-divider,rgba(0,0,0,.12));background:var(--md-hover-overlay,rgba(0,0,0,.04));color:var(--md-on-surface-med,rgba(0,0,0,.6));
            font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.02em}
        .md-cfu__body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:5px}
        .md-cfu__name{display:flex;min-width:0;font-size:13.5px;font-weight:500;line-height:1.35;color:var(--md-on-surface,rgba(0,0,0,.87))}
        .md-cfu__name-start{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .md-cfu__name-end{flex:none;white-space:nowrap}
        .md-cfu__meta{min-width:0;font-size:12px;line-height:1.45;color:var(--md-on-surface-med,rgba(0,0,0,.6));font-variant-numeric:tabular-nums;
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .md-cfu__item.is-failed .md-cfu__meta,.md-cfu__item.is-invalid .md-cfu__meta{color:var(--md-error,#d32f2f);white-space:normal;overflow-wrap:anywhere}
        .md-cfu__item.is-duplicate .md-cfu__meta{white-space:normal}
        .md-cfu__track{position:relative;height:4px;border-radius:2px;overflow:hidden;background:rgba(var(--md-primary-rgb,25,118,210),.14)}
        .md-cfu__track>i{position:absolute;inset:0;border-radius:inherit;background:var(--md-primary,#1976d2);transform-origin:left center;transform:scaleX(0);
            transition:transform .25s linear}
        .md-cfu__item.is-verifying .md-cfu__track>i{right:auto;width:38%;transform:none;transition:none;animation:md-cfu-indeterminate 1.15s var(--md-ease,ease) infinite}
        @keyframes md-cfu-indeterminate{from{transform:translateX(-100%)}to{transform:translateX(265%)}}
        .md-cfu__side{flex:none;display:flex;align-items:center;gap:2px}
        .md-cfu__status{display:inline-flex;align-items:center;gap:4px;padding:0 6px;font-size:12px;font-weight:500;white-space:nowrap;
            color:var(--md-on-surface-dis,rgba(0,0,0,.45))}
        .md-cfu__status .material-icons-outlined{font-size:16px}
        .md-cfu__item.is-uploading .md-cfu__status,.md-cfu__item.is-verifying .md-cfu__status{color:var(--md-primary,#1976d2)}
        .md-cfu__item.is-done .md-cfu__status{color:var(--md-success,#2e7d32)}
        .md-cfu__item.is-duplicate .md-cfu__status{color:var(--md-warning,#ed6c02)}
        .md-cfu__item.is-failed .md-cfu__status,.md-cfu__item.is-invalid .md-cfu__status{color:var(--md-error,#d32f2f)}
        .md-cfu__act{display:inline-grid;place-items:center;width:32px;height:32px;margin:0;padding:0;border:0;border-radius:50%;background:transparent;
            color:var(--md-on-surface-med,rgba(0,0,0,.6));cursor:pointer;transition:background-color .12s,color .12s}
        .md-cfu__act .material-icons-outlined{font-size:19px}
        .md-cfu__act:hover{background:var(--md-hover-overlay,rgba(0,0,0,.05));color:var(--md-on-surface,rgba(0,0,0,.87))}
        .md-cfu__act--remove:hover{background:rgba(var(--md-error-rgb,211,47,47),.08);color:var(--md-error,#d32f2f)}
        .md-cfu__act--retry{color:var(--md-primary,#1976d2)}
        .md-cfu__act:focus-visible{outline:2px solid var(--md-focus-ring,rgba(25,118,210,.4));outline-offset:1px}

        .md-cfu.is-touch .md-cfu__zone{cursor:default}
        .md-cfu.is-touch .md-cfu__pick{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 20px;border-radius:var(--md-radius-pill,999px);
            background:rgba(var(--md-primary-rgb,25,118,210),.12);text-decoration:none}
        .md-cfu.is-touch .md-cfu__pick .material-icons-outlined{font-size:20px}
        .md-cfu.is-touch .md-cfu__list{max-height:none;overflow:visible}
        .md-cfu.is-touch .md-cfu__act{width:44px;height:44px}
        .md-cfu.is-touch .md-cfu__meta{white-space:normal}
        .md-cfu.is-touch .md-cfu__clear{min-height:44px;padding:0 12px}
        .md-cfu.is-touch.has-items .md-cfu__zone{flex-direction:column;align-items:flex-start;gap:8px}
        .md-cfu.is-touch.has-items .md-cfu__glyph{display:none}
        .md-cfu.is-touch .md-cfu__bar{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"stats clear" "state clear";row-gap:2px}
        .md-cfu.is-touch .md-cfu__stats{grid-area:stats}
        .md-cfu.is-touch .md-cfu__state{grid-area:state;text-align:left;white-space:normal}
        .md-cfu.is-touch .md-cfu__clear{grid-area:clear}
        @media (max-width:600px){
            .md-cfu__bar{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"stats clear" "state clear";row-gap:2px}
            .md-cfu__stats{grid-area:stats}
            .md-cfu__state{grid-area:state;text-align:left;white-space:normal}
            .md-cfu__clear{grid-area:clear}
        }

        .md-cfu-chip{display:inline-flex;align-items:center;gap:10px;max-width:min(380px,100%);padding:6px 6px 6px 7px;vertical-align:middle;
            border:1px solid var(--md-divider,rgba(0,0,0,.12));border-radius:var(--md-radius-lg,12px);background:transparent}
        .md-cfu-chip__ext{width:32px;height:32px;border-radius:8px}
        .md-cfu-chip__text{display:flex;flex-direction:column;gap:1px;min-width:0;line-height:1.35;text-align:left}
        .md-cfu-chip__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;color:var(--md-on-surface,rgba(0,0,0,.87))}
        .md-cfu-chip__meta{font-size:11.5px;color:var(--md-on-surface-med,rgba(0,0,0,.6));font-variant-numeric:tabular-nums;white-space:nowrap}
        .md-cfu-chip__dl{flex:none;display:inline-flex;align-items:center;gap:4px;height:30px;padding:0 12px 0 9px;border-radius:var(--md-radius-pill,999px);
            background:rgba(var(--md-primary-rgb,25,118,210),.1);color:var(--md-primary,#1976d2);font-size:12.5px;font-weight:600;text-decoration:none;white-space:nowrap;
            transition:background-color .12s}
        .md-cfu-chip__dl:hover,.md-cfu-chip__dl:focus{background:rgba(var(--md-primary-rgb,25,118,210),.17);color:var(--md-primary,#1976d2);text-decoration:none}
        .md-cfu-chip__dl:focus-visible{outline:2px solid var(--md-focus-ring,rgba(25,118,210,.4));outline-offset:2px}
        .md-cfu-chip__dl .material-icons-outlined{font-size:17px}
        .md-cfu-note{display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-width:0;padding-top:2px}
        .md-cfu-note__text{margin:0;font-size:12.5px;line-height:1.6;color:var(--md-on-surface-med,rgba(0,0,0,.6))}

        @media (prefers-reduced-motion:reduce){
            .md-cfu__zone,.md-cfu__glyph,.md-cfu__item,.md-cfu__track>i,.md-cfu__act,.md-cfu-chip__dl{transition:none;animation:none}
            .md-cfu__item.is-verifying .md-cfu__track>i{animation:none;width:100%;opacity:.45}
        }
    `;

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLE;
        document.head.appendChild(style);
    }

    // ---------- formatting ----------
    function formatSize(bytes) {
        const delivery = window.acgDelivery;
        if (delivery && typeof delivery.formatSize === 'function') return delivery.formatSize(bytes);
        let value = Number(bytes);
        if (!Number.isFinite(value) || value < 0) return '';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let unit = 0;
        while (value >= 1024 && unit < units.length - 1) {
            value /= 1024;
            unit++;
        }
        return (unit === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)) + ' ' + units[unit];
    }

    function formatDuration(seconds) {
        seconds = Math.max(1, Math.round(seconds));
        if (seconds < 60) return `${seconds} ${T('秒')}`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) {
            const rest = seconds % 60;
            return `${minutes} ${T('分钟')}` + (minutes < 10 && rest ? ` ${rest} ${T('秒')}` : '');
        }
        const hours = Math.floor(minutes / 60);
        return `${hours} ${T('小时')}` + (minutes % 60 ? ` ${minutes % 60} ${T('分钟')}` : '');
    }

    const extensionOf = name => {
        const match = /\.([^./\\]+)$/.exec(String(name || ''));
        return match ? match[1].toLowerCase() : '';
    };
    const extensionLabel = name => (extensionOf(name) || '—').slice(0, 4).toUpperCase();

    // Middle truncation keeps the extension visible: start shrinks with an ellipsis, the tail never does.
    function splitName(name) {
        const chars = Array.from(String(name || ''));
        if (chars.length <= 18) return [chars.join(''), ''];
        const suffix = /(\.[a-z0-9]{1,5}){1,2}$/i.exec(name);
        const tail = Math.min(chars.length - 6, (suffix ? Array.from(suffix[0]).length : 0) + 6);
        return [chars.slice(0, chars.length - tail).join(''), chars.slice(chars.length - tail).join('')];
    }

    // ---------- requests ----------
    const failure = (message, extra = {}) => Object.assign(new Error(message), extra);

    function parseResponse(xhr) {
        const status = xhr.status;
        let json = null;
        try {
            json = JSON.parse(xhr.responseText);
        } catch (e) {
            json = null;
        }
        if (status === 413) {
            throw failure(T('分片超过服务器的上传限制'), {tooLarge: true});
        }
        if (json && typeof json === 'object' && Object.prototype.hasOwnProperty.call(json, 'code')) {
            if (Number(json.code) === 200) return json.data && typeof json.data === 'object' ? json.data : {};
            const msg = String(json.msg || '') || T('请求失败');
            throw failure(msg, {
                code: json.code,
                tooLarge: Number(json.code) === 413 || Boolean(json.data && json.data.too_large) || TOO_LARGE.test(msg),
                retryable: status >= 500
            });
        }
        if (status >= 500 || status === 408 || status === 429) {
            throw failure(`${T('服务器暂时不可用')} (HTTP ${status})`, {retryable: true});
        }
        if (status >= 400) throw failure(`${T('请求失败')} (HTTP ${status})`);
        throw failure(T('服务器返回了无法识别的数据'));
    }

    /**
     * POST to /admin/api/cardFile/{action}. control.xhr is set while the request runs so it can be aborted;
     * onProgress (upload bytes) also arms a stall watchdog.
     */
    function request(action, data, control = null, onProgress = null) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            let watchdog = 0;
            const arm = ms => {
                clearTimeout(watchdog);
                watchdog = setTimeout(() => {
                    xhr.stalled = true;
                    xhr.abort();
                }, ms);
            };
            const settle = (callback, value) => {
                clearTimeout(watchdog);
                if (control && control.xhr === xhr) control.xhr = null;
                callback(value);
            };
            xhr.open('POST', API + action, true);
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            let body = data;
            if (!(data instanceof FormData)) {
                const params = new URLSearchParams();
                Object.keys(data || {}).forEach(key => params.append(key, String(data[key])));
                body = params.toString();
                xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
            }
            if (action === 'config' || action === 'begin') xhr.timeout = 60000;
            if (onProgress && xhr.upload) {
                xhr.upload.onprogress = event => {
                    arm(STALL_MS);
                    onProgress(event.loaded);
                };
                xhr.upload.onload = () => arm(RESPONSE_MS);
            }
            xhr.onload = () => {
                let data;
                try {
                    data = parseResponse(xhr);
                } catch (error) {
                    settle(reject, error);
                    return;
                }
                settle(resolve, data);
            };
            xhr.onerror = () => settle(reject, failure(T('网络连接中断'), {retryable: true}));
            xhr.ontimeout = () => settle(reject, failure(T('服务器响应超时'), {retryable: true}));
            xhr.onabort = () => settle(reject, xhr.stalled
                ? failure(T('上传长时间没有进展'), {retryable: true})
                : failure(T('已取消'), {aborted: true}));
            if (control) control.xhr = xhr;
            if (onProgress) arm(STALL_MS);
            xhr.send(body);
        });
    }

    // Fire-and-forget housekeeping (cancel/discard); keepalive lets it outlive a closing page.
    function fire(action, data) {
        const body = new URLSearchParams();
        Object.keys(data).forEach(key => body.append(key, String(data[key])));
        try {
            fetch(API + action, {
                method: 'POST',
                credentials: 'same-origin',
                keepalive: true,
                headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest'},
                body: body.toString()
            }).catch(() => {});
        } catch (e) {
            request(action, data).catch(() => {});
        }
    }

    let configPromise = null;

    function normalizeConfig(data) {
        const maxSize = Number(data.max_size) > 0 ? Number(data.max_size) : 100 * 1024 * 1024;
        const extensions = (Array.isArray(data.extensions) ? data.extensions : [])
            .map(ext => String(ext).toLowerCase().replace(/^\./, '').trim())
            .filter(Boolean);
        const chunk = Number(data.chunk_size) > 0 ? Number(data.chunk_size) : FALLBACK_CHUNK;
        return {
            maxSize: maxSize,
            maxSizeMb: Number(data.max_size_mb) > 0 ? Number(data.max_size_mb) : Math.round(maxSize / 1048576),
            chunkSize: Math.min(MAX_CHUNK, Math.max(MIN_CHUNK, Math.floor(chunk))),
            extensions: extensions,
            accept: String(data.accept || '') || extensions.map(ext => '.' + ext).join(',')
        };
    }

    function loadConfig() {
        if (!configPromise) {
            configPromise = request('config', {}).then(normalizeConfig);
            configPromise.catch(() => {
                configPromise = null;
            });
        }
        return configPromise;
    }

    // ---------- dropped folders ----------
    const readEntries = reader => new Promise(resolve => reader.readEntries(resolve, () => resolve([])));
    const entryFile = entry => new Promise(resolve => entry.file(resolve, () => resolve(null)));

    async function walkFolder(folder, out, depth) {
        if (depth > 16 || out.length >= FOLDER_LIMIT) return;
        const reader = folder.createReader();
        for (;;) {
            const batch = await readEntries(reader);
            if (!batch.length) return;
            for (const entry of batch) {
                if (out.length >= FOLDER_LIMIT) return;
                if (entry.isFile) {
                    const file = await entryFile(entry);
                    file && out.push(file);
                } else if (entry.isDirectory) {
                    await walkFolder(entry, out, depth + 1);
                }
            }
        }
    }

    // DataTransfer items must be read synchronously inside the drop event; folders are walked afterwards.
    function collectDrop(dataTransfer) {
        const direct = [];
        const folders = [];
        const items = dataTransfer && dataTransfer.items ? Array.from(dataTransfer.items) : [];
        if (items.length && typeof items[0].webkitGetAsEntry === 'function') {
            items.forEach(item => {
                if (item.kind !== 'file') return;
                const entry = item.webkitGetAsEntry();
                if (entry && entry.isDirectory) {
                    folders.push(entry);
                    return;
                }
                const file = item.getAsFile();
                file && direct.push(file);
            });
        } else {
            Array.from((dataTransfer && dataTransfer.files) || []).forEach(file => direct.push(file));
        }
        return (async () => {
            const nested = [];
            for (const folder of folders) await walkFolder(folder, nested, 0);
            return {direct: direct, nested: nested};
        })();
    }

    const hasFiles = event => {
        const types = event.dataTransfer && event.dataTransfer.types;
        return Boolean(types) && Array.prototype.indexOf.call(types, 'Files') !== -1;
    };

    // ---------- uploader ----------
    const STATUS = {
        queued: {label: '等待'},
        uploading: {label: '上传中'},
        verifying: {label: '校验中'},
        done: {label: '完成', icon: 'check_circle'},
        duplicate: {label: '重复', icon: 'content_copy'},
        failed: {label: '失败', icon: 'error_outline'},
        invalid: {label: '失败', icon: 'error_outline'},
        cancelled: {label: '已取消'}
    };

    /**
     * options.name: also keep a hidden input with the finished file ids (comma separated), so the
     * owning Form serializes them and change tracking (mobile unsaved guard) sees new uploads.
     */
    function mount(target, options = {}) {
        ensureStyle();
        const host = target && target.jquery ? target[0] : target;
        if (!host) throw new Error('CardFileUploader: mount target missing');

        const touch = isTouch();
        const uid = 'md-cfu-' + Math.random().toString(36).slice(2, 9);
        const items = [];
        const staged = new Set();
        const dirty = new Set();
        let config = null;
        let destroyed = false;
        let frame = 0;
        let sequence = 0;
        let chunkCeiling = Infinity;
        let hintTimer = 0;
        let attentionTimer = 0;
        let lastAnnounced = '';

        host.innerHTML = `<div class="md-cfu${touch ? ' is-touch' : ''}">
            <div class="md-cfu__zone is-disabled" data-zone>
                <span class="md-cfu__glyph">${icon('upload_file')}</span>
                <div class="md-cfu__copy">
                    <p class="md-cfu__title">${touch ? '' : `<span>${esc(T('拖放压缩包到此处，或'))}</span> `}<button type="button" class="md-cfu__pick" data-pick disabled aria-describedby="${uid}-hint">${touch ? icon('folder_open') : ''}${esc(T('选择文件'))}</button></p>
                    <p class="md-cfu__hint" id="${uid}-hint">${esc(T('正在读取上传设置…'))}</p>
                </div>
            </div>
            <input type="file" class="md-cfu__input" multiple tabindex="-1" aria-hidden="true">
            ${options.name ? `<input type="hidden" name="${esc(options.name)}" value="" data-ids>` : ''}
            <div class="md-cfu__bar" hidden>
                <span class="md-cfu__stats"></span>
                <span class="md-cfu__state"></span>
                <button type="button" class="md-cfu__clear" data-clear>${esc(T('清空'))}</button>
            </div>
            <ul class="md-cfu__list" role="list" aria-label="${esc(T('上传队列'))}" hidden></ul>
            <div class="md-cfu__sr" role="status" aria-live="polite"></div>
        </div>`;

        const root = host.firstElementChild;
        const zone = root.querySelector('[data-zone]');
        const pick = root.querySelector('[data-pick]');
        const hint = root.querySelector('.md-cfu__hint');
        const input = root.querySelector('.md-cfu__input');
        const bar = root.querySelector('.md-cfu__bar');
        const stats = root.querySelector('.md-cfu__stats');
        const stateLabel = root.querySelector('.md-cfu__state');
        const clearButton = root.querySelector('[data-clear]');
        const list = root.querySelector('.md-cfu__list');
        const live = root.querySelector('.md-cfu__sr');
        const idsField = root.querySelector('[data-ids]');

        const visible = () => root.getClientRects().length > 0;
        const running = item => Boolean(item.control);
        const announce = text => {
            // Same text twice in a row is not re-read by screen readers; nudge it.
            live.textContent = text === lastAnnounced ? text + '\u00a0' : text;
            lastAnnounced = live.textContent;
        };

        // ----- config -----
        function applyConfig(next) {
            config = next;
            zone.classList.remove('is-disabled');
            pick.disabled = false;
            if (config.accept && !touch) input.setAttribute('accept', config.accept);
            const shown = config.extensions.slice(0, 5).join(', ') + (config.extensions.length > 5 ? ' …' : '');
            hint.innerHTML = `${esc(T('每个文件导入为一张卡密'))} · ${esc(T('单个最大'))} <b>${esc(config.maxSizeMb)} MB</b>`
                + (shown ? ` · <abbr title="${esc(config.extensions.join(', '))}">${esc(T('支持格式'))} ${esc(shown)}</abbr>` : '');
            pump();
        }

        function fetchConfig() {
            zone.classList.add('is-disabled');
            pick.disabled = true;
            hint.textContent = T('正在读取上传设置…');
            loadConfig().then(next => {
                if (!destroyed) applyConfig(next);
            }, error => {
                if (destroyed) return;
                hint.innerHTML = `<span class="md-cfu__notice">${icon('error_outline')}<span>${esc(T('无法读取上传设置'))}${error && error.message ? '：' + esc(error.message) : ''}</span>`
                    + `<button type="button" class="md-cfu__retry-config" data-config-retry>${esc(T('重试'))}</button></span>`;
            });
        }

        // ----- queue -----
        function validate(file) {
            const ext = extensionOf(file.name);
            if (config.extensions.length && config.extensions.indexOf(ext) === -1) {
                return T('不支持的文件格式') + (ext ? `（.${ext}）` : '');
            }
            if (!file.size) return T('文件是空的');
            if (file.size > config.maxSize) return `${T('超过单个文件上限')} ${config.maxSizeMb} MB`;
            return '';
        }

        function addFiles(files, fromFolder = false) {
            if (destroyed || !config) return;
            let added = 0;
            let invalid = 0;
            let ignored = 0;
            let repeated = 0;
            files.forEach(file => {
                const key = [file.name, file.size, file.lastModified].join('\u0000');
                if (items.some(item => item.key === key)) {
                    repeated++;
                    return;
                }
                const reason = validate(file);
                if (reason && fromFolder) {
                    ignored++;
                    return;
                }
                const item = {
                    id: ++sequence, key: key, file: file, name: String(file.name || ''), size: Number(file.size) || 0,
                    state: reason ? 'invalid' : 'queued', error: reason, uploadId: '', offset: 0, sent: 0, chunk: 0,
                    attempts: 0, fileId: 0, duplicate: false, speed: 0, sampleAt: 0, sampleSent: 0, control: null, el: null, refs: null
                };
                build(item);
                items.push(item);
                list.appendChild(item.el);
                added++;
                reason && invalid++;
            });
            const repeatedText = repeated ? `${repeated} ${T('个已在列表中')}` : '';
            const ignoredText = ignored ? `${T('已忽略文件夹中')} ${ignored} ${T('个不支持的文件')}` : '';
            const parts = [
                added ? `${T('已添加')} ${added} ${T('个文件')}` : '',
                invalid ? `${invalid} ${T('个无法上传')}` : '',
                repeatedText,
                ignoredText
            ].filter(Boolean);
            parts.length && announce(parts.join('，'));
            // Toast only what the list itself does not show.
            const toast = [added ? '' : repeatedText, ignoredText].filter(Boolean).join('，');
            toast && typeof message !== 'undefined' && message.info(toast);
            pump();
            sync();
        }

        function pump() {
            if (destroyed || !config) return;
            let active = items.filter(running).length;
            for (const item of items) {
                if (active >= CONCURRENCY) break;
                if (item.state === 'queued' && !running(item)) {
                    active++;
                    upload(item);
                }
            }
            sync();
        }

        function sample(item) {
            const now = performance.now();
            if (!item.sampleAt) {
                item.sampleAt = now;
                item.sampleSent = item.sent;
                return;
            }
            const elapsed = now - item.sampleAt;
            if (elapsed < 400) return;
            const rate = Math.max(0, (item.sent - item.sampleSent) / (elapsed / 1000));
            item.speed = item.speed ? item.speed * 0.7 + rate * 0.3 : rate;
            item.sampleAt = now;
            item.sampleSent = item.sent;
        }

        const pause = (ms, control) => new Promise(resolve => {
            const timer = setTimeout(resolve, ms);
            control.wake = () => {
                clearTimeout(timer);
                resolve();
            };
        });

        const checkCancelled = control => {
            if (control.cancelled) throw failure(T('已取消'), {aborted: true});
        };

        function sendChunk(item, start, end, control) {
            const body = new FormData();
            body.append('upload_id', item.uploadId);
            body.append('offset', String(start));
            body.append('chunk', item.file.slice(start, end), 'chunk');
            return request('chunk', body, control, loaded => {
                item.sent = start + Math.min(loaded, end - start);
                sample(item);
                schedule(item);
            });
        }

        async function upload(item) {
            const control = {cancelled: false, xhr: null, wake: null};
            item.control = control;
            item.state = 'uploading';
            item.error = '';
            item.attempts = 0;
            item.speed = 0;
            item.sampleAt = 0;
            schedule(item);
            try {
                if (!item.uploadId) {
                    let begin;
                    for (;;) {
                        try {
                            begin = await request('begin', {name: item.name, size: item.size}, control);
                            break;
                        } catch (error) {
                            if (control.cancelled || !error.retryable || item.attempts >= RETRIES) throw error;
                            item.attempts++;
                            await pause(1000 * 2 ** (item.attempts - 1), control);
                            checkCancelled(control);
                        }
                    }
                    item.attempts = 0;
                    item.uploadId = String(begin.upload_id || '');
                    checkCancelled(control);
                    if (!item.uploadId) throw failure(T('服务器没有返回上传编号'));
                    const received = Number(begin.received) || 0;
                    item.offset = received > 0 && received <= item.size ? received : 0;
                    item.sent = item.offset;
                    const offered = Number(begin.chunk_size) > 0 ? Number(begin.chunk_size) : config.chunkSize;
                    item.chunk = Math.min(chunkCeiling, MAX_CHUNK, Math.max(MIN_CHUNK, Math.floor(offered)));
                }
                item.chunk = Math.min(item.chunk || config.chunkSize, chunkCeiling);
                let stuck = 0;
                while (item.offset < item.size) {
                    checkCancelled(control);
                    const start = item.offset;
                    const end = Math.min(item.size, start + item.chunk);
                    let result;
                    try {
                        result = await sendChunk(item, start, end, control);
                    } catch (error) {
                        if (control.cancelled) throw error;
                        item.sent = item.offset;
                        if (error.tooLarge && item.chunk > MIN_CHUNK) {
                            item.chunk = Math.max(MIN_CHUNK, Math.floor(item.chunk / 2));
                            chunkCeiling = Math.min(chunkCeiling, item.chunk);
                            continue;
                        }
                        if (error.retryable && item.attempts < RETRIES) {
                            item.attempts++;
                            schedule(item);
                            await pause(1000 * 2 ** (item.attempts - 1), control);
                            continue;
                        }
                        throw error;
                    }
                    item.attempts = 0;
                    const received = Number(result.received);
                    if (!Number.isFinite(received) || received < 0 || received > item.size) {
                        throw failure(T('服务器返回的上传进度无效'));
                    }
                    const accepted = !(result.accepted === false || String(result.accepted) === '0' || String(result.accepted) === 'false');
                    stuck = received <= start ? stuck + 1 : 0;
                    if (stuck >= 3) throw failure(T('服务器没有接收这个分片'));
                    item.offset = accepted ? Math.max(received, start) : received;
                    item.sent = item.offset;
                    schedule(item);
                }
                checkCancelled(control);
                item.state = 'verifying';
                item.speed = 0;
                schedule(item);
                const done = await request('finish', {upload_id: item.uploadId}, control);
                const fileId = Number(done.id);
                if (!(fileId > 0)) throw failure(T('服务器没有返回文件编号'));
                item.uploadId = '';
                item.fileId = fileId;
                item.duplicate = done.duplicate === true || Number(done.duplicate) === 1;
                item.sent = item.size;
                staged.add(fileId);
                if (control.cancelled || destroyed) {
                    // Finished while being cancelled: the staged file is still ours to drop.
                    staged.delete(fileId);
                    fire('discard', {ids: String(fileId)});
                    item.fileId = 0;
                    throw failure(T('已取消'), {aborted: true});
                }
                item.state = item.duplicate ? 'duplicate' : 'done';
                announce(`${item.name} ${T('上传完成')}`);
            } catch (error) {
                if (item.uploadId && (control.cancelled || destroyed)) {
                    fire('cancel', {upload_id: item.uploadId});
                    item.uploadId = '';
                }
                if (control.cancelled || destroyed) {
                    item.state = 'cancelled';
                    item.offset = 0;
                    item.sent = 0;
                } else {
                    // A finish that failed for good leaves nothing to resume; a retry starts over.
                    if (item.state === 'verifying' && !error.retryable) {
                        item.uploadId = '';
                        item.offset = 0;
                        item.sent = 0;
                    }
                    item.state = 'failed';
                    item.error = error && error.message ? error.message : T('上传失败');
                    announce(`${item.name} ${T('上传失败')}：${item.error}`);
                }
            } finally {
                if (item.control === control) item.control = null;
                item.speed = 0;
                if (!destroyed) {
                    schedule(item);
                    pump();
                    if (!items.some(entry => entry.state === 'queued' || running(entry)) && items.some(entry => entry.state === 'done' || entry.state === 'duplicate')) {
                        const failed = items.filter(entry => entry.state === 'failed' || entry.state === 'invalid').length;
                        if (!failed) announce(T('全部文件上传完成'));
                    }
                }
            }
        }

        function cancel(item) {
            const control = item.control;
            if (control) {
                control.cancelled = true;
                control.xhr && control.xhr.abort();
                control.wake && control.wake();
            } else if (item.uploadId) {
                fire('cancel', {upload_id: item.uploadId});
                item.uploadId = '';
            }
        }

        function remove(item, focusNext = false) {
            const index = items.indexOf(item);
            if (index === -1) return;
            cancel(item);
            if (item.fileId && staged.has(item.fileId)) {
                staged.delete(item.fileId);
                fire('discard', {ids: String(item.fileId)});
            }
            items.splice(index, 1);
            dirty.delete(item);
            item.el && item.el.remove();
            if (focusNext) {
                const next = items[index] || items[index - 1];
                const target = next && next.refs ? [next.refs.retry, next.refs.cancel, next.refs.remove].find(button => !button.hidden) : null;
                (target || pick).focus({preventScroll: true});
            }
            pump();
            sync();
        }

        function retry(item) {
            if (item.state !== 'failed' && item.state !== 'cancelled') return;
            item.state = 'queued';
            item.error = '';
            schedule(item);
            pump();
        }

        // ----- rendering -----
        function build(item) {
            const [start, end] = splitName(item.name);
            const li = document.createElement('li');
            li.className = 'md-cfu__item';
            li.dataset.id = String(item.id);
            li.innerHTML = `<span class="md-cfu__ext" aria-hidden="true">${esc(extensionLabel(item.name))}</span>
                <div class="md-cfu__body">
                    <div class="md-cfu__name" title="${esc(item.name)}"><span class="md-cfu__name-start">${esc(start)}</span><span class="md-cfu__name-end">${esc(end)}</span></div>
                    <div class="md-cfu__track" role="progressbar" aria-label="${esc(item.name)}" aria-valuemin="0" aria-valuemax="100" hidden><i></i></div>
                    <div class="md-cfu__meta"></div>
                </div>
                <div class="md-cfu__side">
                    <span class="md-cfu__status"></span>
                    <button type="button" class="md-cfu__act md-cfu__act--retry" data-act="retry" aria-label="${esc(T('重试') + ' ' + item.name)}" title="${esc(T('重试'))}" hidden>${icon('refresh')}</button>
                    <button type="button" class="md-cfu__act" data-act="cancel" aria-label="${esc(T('取消上传') + ' ' + item.name)}" title="${esc(T('取消上传'))}" hidden>${icon('close')}</button>
                    <button type="button" class="md-cfu__act md-cfu__act--remove" data-act="remove" aria-label="${esc(T('移除') + ' ' + item.name)}" title="${esc(T('移除'))}" hidden>${icon('close')}</button>
                </div>`;
            item.el = li;
            item.refs = {
                track: li.querySelector('.md-cfu__track'),
                fill: li.querySelector('.md-cfu__track > i'),
                meta: li.querySelector('.md-cfu__meta'),
                status: li.querySelector('.md-cfu__status'),
                retry: li.querySelector('[data-act="retry"]'),
                cancel: li.querySelector('[data-act="cancel"]'),
                remove: li.querySelector('[data-act="remove"]')
            };
            paint(item);
        }

        function paint(item) {
            const refs = item.refs;
            if (!refs) return;
            const state = item.state;
            item.el.className = 'md-cfu__item is-' + state;
            const status = STATUS[state] || STATUS.queued;
            refs.status.innerHTML = (status.icon ? icon(status.icon) : '') + esc(T(status.label));

            const active = state === 'uploading' || state === 'verifying';
            refs.track.hidden = !active;
            if (state === 'uploading') {
                const ratio = item.size ? Math.min(1, item.sent / item.size) : 0;
                const percent = Math.floor(ratio * 100);
                refs.fill.style.transform = `scaleX(${ratio})`;
                refs.track.setAttribute('aria-valuenow', String(percent));
                let meta = `${percent}% · ${formatSize(item.sent)} / ${formatSize(item.size)}`;
                if (item.attempts > 0) {
                    meta += ` · ${T('网络不稳定，正在重试')}`;
                } else if (item.speed > 0) {
                    meta += ` · ${formatSize(item.speed)}/s`;
                    const remaining = (item.size - item.sent) / item.speed;
                    if (Number.isFinite(remaining) && remaining >= 1) meta += ` · ${T('剩余')} ${formatDuration(remaining)}`;
                }
                refs.meta.textContent = meta;
            } else {
                refs.fill.style.transform = '';
                refs.track.removeAttribute('aria-valuenow');
                if (state === 'failed' || state === 'invalid') {
                    refs.meta.textContent = item.error || T('上传失败');
                } else if (state === 'duplicate') {
                    refs.meta.textContent = `${formatSize(item.size)} · ${T('与已有的卡密文件内容相同，开启“去除重复”时不会导入')}`;
                } else {
                    refs.meta.textContent = formatSize(item.size);
                }
            }
            refs.meta.title = refs.meta.textContent;

            refs.retry.hidden = !(state === 'failed' || state === 'cancelled');
            refs.cancel.hidden = state !== 'uploading';
            refs.remove.hidden = active;
        }

        function schedule(item) {
            if (destroyed) return;
            item && dirty.add(item);
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                dirty.forEach(entry => items.indexOf(entry) !== -1 && paint(entry));
                dirty.clear();
                sync();
            });
        }

        function summary() {
            let bytes = 0;
            let sentBytes = 0;
            let remaining = 0;
            let speed = 0;
            let done = 0;
            let duplicate = 0;
            let failed = 0;
            let uploadable = 0;
            let busy = false;
            items.forEach(item => {
                bytes += item.size;
                if (item.state === 'invalid') {
                    failed++;
                    return;
                }
                uploadable++;
                if (item.state === 'failed') failed++;
                if (item.state === 'done' || item.state === 'duplicate') {
                    done++;
                    item.state === 'duplicate' && duplicate++;
                }
                if (item.state === 'queued' || running(item)) {
                    busy = true;
                    remaining += Math.max(0, item.size - item.sent);
                    speed += item.speed || 0;
                }
                if (item.state !== 'failed' && item.state !== 'cancelled') {
                    sentBytes += item.state === 'done' || item.state === 'duplicate' ? item.size : item.sent;
                }
            });
            const total = items.filter(item => item.state !== 'invalid' && item.state !== 'failed' && item.state !== 'cancelled')
                .reduce((sum, item) => sum + item.size, 0);
            return {
                count: items.length, bytes: bytes, done: done, duplicate: duplicate, failed: failed, uploadable: uploadable, busy: busy,
                percent: total ? Math.floor(Math.min(1, sentBytes / total) * 100) : 0, speed: speed, eta: speed > 0 ? remaining / speed : 0
            };
        }

        function sync() {
            if (destroyed) return;
            if (idsField) idsField.value = getFileIds().join(',');
            const has = items.length > 0;
            root.classList.toggle('has-items', has);
            bar.hidden = !has;
            list.hidden = !has;
            if (!has) return;
            const info = summary();
            stats.innerHTML = `<strong>${info.count}</strong> ${esc(T('个文件'))} · ${esc(formatSize(info.bytes))}`;
            let state;
            if (info.busy) {
                state = `${esc(T('上传中'))} ${info.percent}%`;
                if (info.speed > 0) state += ` · ${esc(formatSize(info.speed))}/s`;
                if (info.eta >= 1) state += ` · ${esc(T('剩余'))} ${esc(formatDuration(info.eta))}`;
            } else {
                state = `${esc(T('已完成'))} ${info.done}/${info.uploadable}`;
            }
            if (info.duplicate) state += ` · <span class="is-warning">${info.duplicate} ${esc(T('个重复'))}</span>`;
            if (info.failed) state += ` · <span class="is-error">${info.failed} ${esc(T('个失败'))}</span>`;
            stateLabel.innerHTML = state;
            stateLabel.classList.toggle('is-busy', info.busy);
        }

        // ----- events -----
        const openPicker = () => {
            if (destroyed || !config) return;
            input.value = '';
            input.click();
        };

        const onZoneClick = event => {
            if (event.target.closest('[data-config-retry]')) {
                fetchConfig();
                return;
            }
            if (touch && !event.target.closest('[data-pick]')) return;
            openPicker();
        };

        const onInputChange = () => {
            const files = Array.from(input.files || []);
            input.value = '';
            files.length && addFiles(files);
        };

        const onZoneDragOver = event => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = config ? 'copy' : 'none';
            if (!config) return;
            zone.classList.add('is-over');
            showHint();
        };

        const onZoneDragLeave = event => {
            if (event.relatedTarget && zone.contains(event.relatedTarget)) return;
            zone.classList.remove('is-over');
        };

        const onDrop = event => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            event.stopPropagation();
            zone.classList.remove('is-over', 'is-hint');
            if (!config || destroyed) return;
            collectDrop(event.dataTransfer).then(({direct, nested}) => {
                if (destroyed) return;
                direct.length && addFiles(direct);
                nested.length && addFiles(nested, true);
                !direct.length && !nested.length && typeof message !== 'undefined' && message.info(T('没有可上传的文件'));
            });
        };

        function showHint() {
            zone.classList.add('is-hint');
            clearTimeout(hintTimer);
            hintTimer = setTimeout(() => zone.classList.remove('is-hint', 'is-over'), 160);
        }

        // While visible, a file dragged anywhere over the page highlights the zone; a drop inside the
        // popup is taken, a drop elsewhere is swallowed so the browser never navigates to the file.
        const popup = () => host.closest('.layui-layer') || root;
        const onWindowDragOver = event => {
            if (destroyed || !hasFiles(event) || !visible()) return;
            event.preventDefault();
            const inside = popup().contains(event.target);
            event.dataTransfer.dropEffect = inside && config ? 'copy' : 'none';
            showHint();
        };
        const onWindowDrop = event => {
            if (destroyed || !hasFiles(event) || !visible()) return;
            if (popup().contains(event.target)) {
                onDrop(event);
                return;
            }
            event.preventDefault();
        };

        const onListClick = event => {
            const button = event.target.closest('[data-act]');
            if (!button) return;
            const li = button.closest('.md-cfu__item');
            const item = items.find(entry => String(entry.id) === li.dataset.id);
            if (!item) return;
            const action = button.dataset.act;
            // The pressed button hides with the new state; keep focus on the row's next action.
            const refocus = () => {
                if (items.indexOf(item) === -1) return;
                paint(item);
                const next = [item.refs.cancel, item.refs.retry, item.refs.remove].find(entry => !entry.hidden);
                next && next.focus({preventScroll: true});
            };
            if (action === 'retry') {
                retry(item);
                refocus();
            } else if (action === 'cancel') {
                cancel(item);
                setTimeout(refocus, 0);
            } else if (action === 'remove') {
                remove(item, true);
            }
        };

        const onClear = () => {
            const run = () => {
                instance.clear();
                pick.focus({preventScroll: true});
            };
            if (hasPendingWork() && typeof message !== 'undefined') {
                message.ask('清空后会取消正在上传的文件，已上传但还没保存的文件也会删除。', run, '清空上传列表', '清空');
                return;
            }
            run();
        };

        const onPageHide = () => {
            items.forEach(cancel);
            const ids = Array.from(staged);
            staged.clear();
            ids.length && fire('discard', {ids: ids.join(',')});
        };

        zone.addEventListener('click', onZoneClick);
        input.addEventListener('change', onInputChange);
        list.addEventListener('click', onListClick);
        clearButton.addEventListener('click', onClear);
        if (!touch) {
            zone.addEventListener('dragenter', onZoneDragOver);
            zone.addEventListener('dragover', onZoneDragOver);
            zone.addEventListener('dragleave', onZoneDragLeave);
            zone.addEventListener('drop', onDrop);
            window.addEventListener('dragover', onWindowDragOver);
            window.addEventListener('drop', onWindowDrop);
        }
        window.addEventListener('pagehide', onPageHide);

        // ----- public -----
        function getFileIds() {
            return items.filter(item => (item.state === 'done' || item.state === 'duplicate') && item.fileId > 0).map(item => item.fileId);
        }

        function isBusy() {
            return items.some(item => item.state === 'queued' || running(item));
        }

        function hasPendingWork() {
            return isBusy() || staged.size > 0;
        }

        function failedCount() {
            return items.filter(item => item.state === 'failed' || item.state === 'invalid' || item.state === 'cancelled').length;
        }

        function markSaved(ids) {
            (ids || getFileIds()).forEach(id => staged.delete(Number(id)));
        }

        function attention() {
            if (destroyed) return;
            zone.classList.remove('is-attention');
            void zone.offsetWidth;
            zone.classList.add('is-attention');
            clearTimeout(attentionTimer);
            attentionTimer = setTimeout(() => zone.classList.remove('is-attention'), 1000);
            zone.scrollIntoView && zone.scrollIntoView({block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth'});
            pick.disabled || touch || pick.focus({preventScroll: true});
        }

        function clear() {
            items.slice().forEach(item => {
                cancel(item);
                item.el && item.el.remove();
            });
            items.length = 0;
            dirty.clear();
            const ids = Array.from(staged);
            staged.clear();
            ids.length && fire('discard', {ids: ids.join(',')});
            sync();
        }

        function destroy() {
            if (destroyed) return;
            items.forEach(cancel);
            const ids = Array.from(staged);
            staged.clear();
            ids.length && fire('discard', {ids: ids.join(',')});
            destroyed = true;
            frame && cancelAnimationFrame(frame);
            clearTimeout(hintTimer);
            clearTimeout(attentionTimer);
            zone.removeEventListener('click', onZoneClick);
            input.removeEventListener('change', onInputChange);
            list.removeEventListener('click', onListClick);
            clearButton.removeEventListener('click', onClear);
            zone.removeEventListener('dragenter', onZoneDragOver);
            zone.removeEventListener('dragover', onZoneDragOver);
            zone.removeEventListener('dragleave', onZoneDragLeave);
            zone.removeEventListener('drop', onDrop);
            window.removeEventListener('dragover', onWindowDragOver);
            window.removeEventListener('drop', onWindowDrop);
            window.removeEventListener('pagehide', onPageHide);
            items.length = 0;
            host.innerHTML = '';
        }

        const instance = {
            element: root,
            getFileIds: getFileIds,
            isBusy: isBusy,
            hasPendingWork: hasPendingWork,
            failedCount: failedCount,
            markSaved: markSaved,
            attention: attention,
            clear: clear,
            destroy: destroy
        };
        fetchConfig();
        return instance;
    }

    // ---------- card upload popup ----------
    /**
     * Adds the 文件 type to a card upload popup (card.js / commodity.js share it):
     *   component.popup({submit: kit.submit, submitRoute: kit.route, renderComplete: kit.renderComplete, ...})
     *   card_type dict gets kit.typeOption, its change() calls kit.switchType(form, value),
     *   kit.field() goes next to the secret textarea.
     */
    function cardForm(options = {}) {
        let uploader = null;
        let saving = false;
        let secretRequired = null;
        const active = () => typeof options.isActive !== 'function' || options.isActive() !== false;

        function switchType(form, value) {
            const file = Number(value) === FILE_TYPE;
            const secret = form && form.form ? form.form.secret : null;
            if (secret) {
                if (secretRequired === null) secretRequired = secret.required === true;
                secret.required = file ? false : secretRequired;
            }
            if (file) {
                form.hide('secret');
                form.show('card_files');
            } else {
                form.hide('card_files');
                form.show('secret');
            }
        }

        function submit(data, index) {
            if (saving || !active()) return;
            const isFile = Number(data.card_type) === FILE_TYPE;
            let ids = [];
            const send = () => {
                if (saving || !active()) return;
                saving = true;
                util.post({
                    url: SAVE_ROUTE,
                    data: data,
                    done: res => {
                        saving = false;
                        uploader && ids.length && uploader.markSaved(ids);
                        layer.close(index);
                        message.alert(!res.msg || res.msg === 'success' ? '您提交的数据已被系统存储(｡•ᴗ-)_' : res.msg, 'success');
                        typeof options.done === 'function' && options.done(res, data);
                    },
                    error: res => {
                        saving = false;
                        message.alert(res && res.msg ? res.msg : '保存失败', 'error');
                    },
                    fail: () => {
                        saving = false;
                        message.alert('网络异常，卡密没有保存', 'error');
                    }
                });
            };
            if (!isFile) {
                delete data.files;
                send();
                return;
            }
            if (!uploader) return;
            if (uploader.isBusy()) {
                message.warning('文件还在上传，请等上传完成后再保存');
                return;
            }
            ids = uploader.getFileIds();
            if (!ids.length) {
                uploader.attention();
                message.warning('请先上传文件');
                return;
            }
            data.files = ids.join(',');
            delete data.secret;
            const failed = uploader.failedCount();
            if (failed > 0) {
                message.ask(
                    `${failed} ${T('个文件没有上传成功，本次只保存已上传的')} ${ids.length} ${T('个文件。')}`,
                    send,
                    '部分文件未上传',
                    '继续保存'
                );
                return;
            }
            send();
        }

        // Desktop close/cancel would silently drop running or unsaved uploads; ask first.
        // (Mobile popups already guard unsaved changes.)
        function renderComplete(unique, index) {
            if (isMobileAdmin()) return;
            const layero = document.getElementById('layui-layer' + index);
            if (!layero) return;
            layero.addEventListener('click', event => {
                const trigger = event.target.closest('.layui-layer-close, .layui-layer-btn1');
                if (!trigger || !layero.contains(trigger) || !uploader || !uploader.hasPendingWork()) return;
                event.preventDefault();
                event.stopPropagation();
                message.ask(
                    '关闭后会取消正在上传的文件，已上传但还没保存的文件也会删除。',
                    () => layer.close(index),
                    '放弃上传的文件？',
                    '关闭'
                );
            }, true);
        }

        return {
            route: SAVE_ROUTE,
            typeOption: {id: FILE_TYPE, name: '文件'},
            switchType: switchType,
            submit: submit,
            renderComplete: renderComplete,
            field: () => ({
                title: false,
                name: 'card_files',
                type: 'custom',
                hide: true,
                complete: (form, dom) => (uploader = mount(dom, {name: 'files'}))
            })
        };
    }

    // ---------- list / edit helpers ----------
    function fileChip(file) {
        ensureStyle();
        const id = Number(file && file.id) || 0;
        const name = String((file && file.name) || T('未命名文件'));
        const downloads = Number(file && file.downloads) || 0;
        const meta = formatSize(file && file.size) + (downloads > 0 ? ` · ${T('已下载')} ${downloads} ${T('次')}` : '');
        // target=_blank keeps the admin PJAX handler (a[target!=_blank]) away from the download.
        const download = id > 0
            ? `<a class="md-cfu-chip__dl" href="${API}download?id=${id}" target="_blank" rel="noopener" download aria-label="${esc(T('下载') + ' ' + name)}">${icon('download')}<span>${esc(T('下载'))}</span></a>`
            : '';
        return `<span class="md-cfu-chip"><span class="md-cfu-chip__ext" aria-hidden="true">${esc(extensionLabel(name))}</span>`
            + `<span class="md-cfu-chip__text"><span class="md-cfu-chip__name" title="${esc(name)}">${esc(name)}</span>`
            + `<span class="md-cfu-chip__meta">${esc(meta)}</span></span>${download}</span>`;
    }

    function fileNote(file) {
        return `<div class="md-cfu-note">${fileChip(file)}<p class="md-cfu-note__text">${esc(T('文件卡密的内容不能修改；需要换文件时，请删除这张卡密后重新上传。'))}</p></div>`;
    }

    return {
        mount: mount,
        cardForm: cardForm,
        fileChip: fileChip,
        fileNote: fileNote,
        formatSize: formatSize,
        FILE_TYPE: FILE_TYPE
    };
})();
