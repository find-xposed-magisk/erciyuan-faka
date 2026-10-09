window._data_var = {};

const __cspNonce = document.currentScript ? (document.currentScript.nonce || '') : '';

function documentReady(callback) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
        callback();
    } else {
        document.addEventListener("DOMContentLoaded", callback, false);
    }
}

const readyLoaderState = window.__adminReadyLoader ??= {
    queue: [],
    timer: null,
    batch: 0,
    lifecycleBound: false,
    generation: 0,
    activeLoads: new Map()
};
readyLoaderState.generation ??= 0;
readyLoaderState.activeLoads = readyLoaderState.activeLoads instanceof Map
    ? readyLoaderState.activeLoads
    : new Map();

function removeReadyControllerScripts() {
    document.querySelectorAll('script[ready], script[data-ready-controller]').forEach(script => script.remove());
}

function cancelReadyControllerLoads() {
    readyLoaderState.activeLoads.forEach(load => {
        load.cancelled = true;
        load.controllers.forEach(controller => {
            try {
                controller.abort();
            } catch (error) {
                // An already completed request needs no further cleanup.
            }
        });
        load.controllers.clear();
    });
    readyLoaderState.activeLoads.clear();
}

function bindReadyLifecycle() {
    if (readyLoaderState.lifecycleBound || typeof window.jQuery !== 'function') {
        return;
    }
    readyLoaderState.lifecycleBound = true;
    $(document).on('pjax:beforeReplace.adminReady', function (event) {
        readyLoaderState.generation++;
        if (readyLoaderState.timer !== null) {
            clearTimeout(readyLoaderState.timer);
            readyLoaderState.timer = null;
        }
        readyLoaderState.queue = [];
        cancelReadyControllerLoads();

        if (typeof Table !== 'undefined' && typeof Table.destroyAll === 'function') {
            Table.destroyAll(event.target);
        }
        $(document).trigger('admin:page:destroy', [{container: event.target}]);
        removeReadyControllerScripts();
    });
}

// Plugin templates may initialise directly through documentReady() without
// ever calling ready(). Bind the shared PJAX cleanup on every full page load so
// their Table instances are destroyed before #pjax-container is replaced too.
documentReady(bindReadyLifecycle);

function flushReadyQueue() {
    readyLoaderState.timer = null;
    const generation = readyLoaderState.generation;
    const calls = readyLoaderState.queue.splice(0)
        .filter(entry => {
            // Keep compatibility with a queue populated by the previous loader
            // if this source file is replaced during local development.
            return !entry || !Object.prototype.hasOwnProperty.call(entry, 'generation') || entry.generation === generation;
        })
        .map(entry => entry && Object.prototype.hasOwnProperty.call(entry, 'call') ? entry.call : entry);
    if (calls.length === 0) {
        return;
    }

    const execute = () => {
        if (generation !== readyLoaderState.generation) {
            return;
        }
        bindReadyLifecycle();
        removeReadyControllerScripts();
        const batch = ++readyLoaderState.batch;
        const sources = new Set();

        calls.forEach(call => {
            if (typeof call === 'function') {
                call();
                return;
            }
            if (typeof call !== 'string' || call === '' || sources.has(call)) {
                return;
            }
            sources.add(call);
            util.debug(`RELOAD -> ${call}`, "#10d18f");
        });

        if (generation !== readyLoaderState.generation) {
            return;
        }
        const sourceList = Array.from(sources);
        if (sourceList.length === 0) {
            $(document).trigger('admin:controllers:ready', [{
                batch: batch,
                generation: generation,
                sources: []
            }]);
            return;
        }

        // A removed <script src> may still execute after its network request
        // completes. Fetch first, then inject only while this PJAX generation is
        // current, so a late controller can never initialise the next page.
        const load = {generation: generation, cancelled: false, controllers: new Set()};
        readyLoaderState.activeLoads.set(batch, load);
        const requests = sourceList.map(source => {
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            if (controller) load.controllers.add(controller);
            return fetch(source, {
                credentials: 'same-origin',
                signal: controller ? controller.signal : undefined
            }).then(response => {
                if (!response.ok) {
                    throw new Error('Controller request failed with HTTP ' + response.status);
                }
                return response.text();
            }).then(code => ({source: source, code: code}), error => ({source: source, error: error}));
        });

        Promise.all(requests).then(results => {
            if (load.cancelled || generation !== readyLoaderState.generation) {
                return;
            }
            for (const result of results) {
                if (load.cancelled || generation !== readyLoaderState.generation) {
                    return;
                }
                if (result.error) {
                    if (result.error.name !== 'AbortError') {
                        $(document).trigger('admin:controller:error', [{
                            src: result.source,
                            batch: batch,
                            error: result.error
                        }]);
                    }
                    continue;
                }
                const script = document.createElement('script');
                if (__cspNonce) script.nonce = __cspNonce;
                script.setAttribute('ready', 'true');
                script.setAttribute('data-ready-controller', 'true');
                script.setAttribute('data-ready-src', result.source);
                script.setAttribute('data-ready-batch', String(batch));
                script.setAttribute('data-ready-generation', String(generation));
                const sourceUrl = new URL(result.source, window.location.href).href.replace(/[\r\n]/g, '');
                script.textContent = result.code + '\n//# sourceURL=' + sourceUrl;
                document.body.appendChild(script);
            }
            if (!load.cancelled && generation === readyLoaderState.generation) {
                $(document).trigger('admin:controllers:ready', [{
                    batch: batch,
                    generation: generation,
                    sources: sourceList
                }]);
            }
        }).finally(() => {
            load.controllers.clear();
            if (readyLoaderState.activeLoads.get(batch) === load) {
                readyLoaderState.activeLoads.delete(batch);
            }
        });
    };

    if (window.layui?.use) {
        layui.use('form', execute);
    } else {
        execute();
    }
}

function ready(call) {
    documentReady(() => {
        if (!call) return;
        bindReadyLifecycle();
        readyLoaderState.queue.push({call: call, generation: readyLoaderState.generation});
        if (readyLoaderState.timer === null) {
            readyLoaderState.timer = setTimeout(flushReadyQueue, 0);
        }
    });
}

function setVar(name, data) {
    window._data_var[name] = data;
}

function getVar(name) {
    return window._data_var[name];
}

function i18n(text) {
    //表格 formatter 等调用方可能传入数字/对象，非字符串一律原样返回
    if (typeof text !== "string" || text === "") {
        return text;
    }
    const _lang = getVar("LANG");
    if (!_lang || _lang === "zh-cn") {
        return text;
    }
    const _dict = getVar("I18N");
    if (_dict && Object.prototype.hasOwnProperty.call(_dict, text)) {
        return _dict[text];
    }
    //兼容首尾空格：词条以去空格形式入库，命中后按原样保留两侧空白
    if (_dict) {
        const _trimmed = text.trim();
        if (_trimmed !== text && _trimmed !== "" && Object.prototype.hasOwnProperty.call(_dict, _trimmed)) {
            return text.replace(_trimmed, _dict[_trimmed]);
        }
    }
    //带标签的文案（后台常把图标写进配置值，如 <i class="…"></i> 推荐）：整串查不到时，
    //先看文本片段是不是已有现成译文，能全部命中就直接复用，省掉一次翻译调用
    if (text.indexOf("<") !== -1) {
        const _markup = _i18nMarkup(text, _dict);
        if (_markup !== null) {
            return _markup;
        }
    }
    _i18nMiss(text);
    return text;
}

//复用已有词条翻译 HTML 片段里的文本节点；只读字典不上报，
//有任一片段没译出来就返回 null，交回上层整串上报（富文本整段翻更有上下文）
function _i18nMarkup(text, dict) {
    const parts = text.split(/(<[^>]*>)/);
    if (parts.length < 2) {
        return null;
    }
    let hit = false, pending = false;
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part || part.charAt(0) === "<") {
            continue;
        }
        const seg = part.trim();
        if (!seg || !/[一-鿿]/.test(seg)) {
            continue;
        }
        if (dict && Object.prototype.hasOwnProperty.call(dict, seg)) {
            parts[i] = part.replace(seg, dict[seg]);
            hit = true;
            continue;
        }
        pending = true;
    }
    return (hit && !pending) ? parts.join("") : null;
}

//miss 收集：去重攒批，3秒 debounce 上报到 /user/api/lang/report(服务端复用同一 miss 队列与 LANG_MISS 钩子)
const _i18nMissState = {set: new Set(), timer: null, reported: new Set()};

function _i18nMiss(text) {
    if (typeof text !== "string" || text.length > 500 || !/[一-鿿]/.test(text)) {
        return;
    }
    //整段渲染好的（或被二次转义的）HTML 翻不出有意义的结果，只会污染词库，直接丢弃
    if (/<[a-zA-Z\/!]|&(?:amp|quot|lt|gt|#\d+);/.test(text)) {
        return;
    }
    //防翻译回环：接口返回的 msg 已由服务端翻译，前端组件会再调一次 i18n；
    //日文/繁体译文同样含汉字，不拦截就会被当成新的中文原文上报
    const _dict = getVar("I18N");
    if (_dict) {
        if (!window.__i18nReverse || window.__i18nReverseSrc !== _dict) {
            window.__i18nReverseSrc = _dict;
            window.__i18nReverse = new Set(Object.values(_dict));
        }
        if (window.__i18nReverse.has(text)) {
            return;
        }
    }
    if (_i18nMissState.reported.has(text) || _i18nMissState.set.size >= 50) {
        return;
    }
    _i18nMissState.set.add(text);
    if (_i18nMissState.timer === null) {
        _i18nMissState.timer = setTimeout(_i18nFlushMiss, 3000);
    }
}

function _i18nFlushMiss() {
    _i18nMissState.timer = null;
    if (_i18nMissState.set.size === 0) {
        return;
    }
    const list = Array.from(_i18nMissState.set);
    list.forEach(item => _i18nMissState.reported.add(item));
    _i18nMissState.set.clear();
    try {
        fetch("/user/api/lang/report", {
            method: "POST",
            keepalive: true,
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({list: list})
        }).catch(() => {
        });
    } catch (e) {
    }
}

//切换语言：写 cookie 后整页刷新，前后台共用
function setLang(lang) {
    document.cookie = "acg_lang=" + lang + ";max-age=315360000;path=/";
    window.location.reload();
}

//语言切换器：后台(#md-lang-toggle) 与 Cartoon(.uc-lang-btn) 共用一套事件委托
(function () {
    const bind = function () {
        const current = getVar("LANG") || "zh-cn";
        document.querySelectorAll("[data-lang-value]").forEach(function (el) {
            el.classList.toggle("active", el.getAttribute("data-lang-value") === current);
        });
        //切换器按钮上显示当前语言的短码，免得只看一个地球图标不知道现在是哪国语言。
        //短码由服务端的语言注册表下发，站长自己加的语言（韩语、葡语……）一样有角标。
        const langs = getVar("LANGS") || [];
        let shortCode = "";
        for (let i = 0; i < langs.length; i++) {
            if (langs[i] && langs[i].code === current) {
                shortCode = langs[i].short || "";
                break;
            }
        }
        if (shortCode === "") {
            shortCode = {"zh-cn": "简", "zh-tw": "繁", "en": "EN", "ja": "日"}[current] || current.split("-")[0].toUpperCase();
        }
        document.querySelectorAll("[data-lang-label]").forEach(function (el) {
            el.textContent = shortCode;
        });
        if (window.__langSwitchBound) {
            return;
        }
        window.__langSwitchBound = true;
        document.addEventListener("click", function (e) {
            const opt = e.target.closest ? e.target.closest("[data-lang-value]") : null;
            if (opt) {
                e.preventDefault();
                e.stopPropagation();
                setLang(opt.getAttribute("data-lang-value"));
                return;
            }
            //语言二级菜单：点击父项展开/收起（触屏与窄屏没有 hover）
            //选择器同时认 data-lang-parent，各主题不必为此再改公共 JS
            const langParent = e.target.closest ? e.target.closest(".uc-lang-parent, [data-lang-parent]") : null;
            if (langParent) {
                e.preventDefault();
                e.stopPropagation();
                const opened = langParent.classList.toggle("is-open");
                langParent.setAttribute("aria-expanded", opened ? "true" : "false");
                return;
            }
            document.querySelectorAll(".uc-lang-parent.is-open, [data-lang-parent].is-open").forEach(function (el) {
                el.classList.remove("is-open");
                el.setAttribute("aria-expanded", "false");
            });
            const toggle = e.target.closest ? e.target.closest("#md-lang-toggle, .uc-lang-btn") : null;
            const menus = document.querySelectorAll("#md-lang-menu, .uc-lang-menu");
            if (toggle) {
                e.preventDefault();
                e.stopPropagation();
                const box = toggle.parentElement;
                const menu = box ? box.querySelector("#md-lang-menu, .uc-lang-menu") : null;
                menus.forEach(function (m) {
                    if (m !== menu) {
                        m.classList.remove("show", "is-open");
                        m.style.display = "";
                    }
                });
                if (menu) {
                    const opened = menu.style.display === "block";
                    menu.style.display = opened ? "" : "block";
                    menu.classList.toggle("show", !opened);
                }
                return;
            }
            menus.forEach(function (m) {
                m.classList.remove("show", "is-open");
                m.style.display = "";
            });
        });
    };
    if (document.readyState !== "loading") {
        bind();
    } else {
        document.addEventListener("DOMContentLoaded", bind);
    }
    document.addEventListener("pjax:complete", bind);
})();

function evalResults(code) {
    return eval('(' + code + ')');
}

function route(uri) {
    uri = uri.replace(/^\/+|\/+$/g, '');
    const pathname = location.pathname;
    const rt = pathname.trim().split("/").filter(Boolean);
    if (rt[0] !== "plugin") {
        return "";
    }

    if (rt[1] === undefined) {
        return "";
    }

    if (!/^\d+$/.test(rt[1])) {
        //主站

        return `/plugin/${rt[1]}/${uri}`;
    } else {
        //分站
        if (rt[2] === undefined) {
            return "";
        }
        return `/plugin/${rt[1]}/${rt[2]}/${uri}`;
    }
}

/*
 * Delivered content with file cards. A delivered file is one line
 * "https://host/download/<48 hex>#<name>" (see App\Util\CardFile\Link). The parser lives here
 * because ready.js is the one script every theme and the admin load before anything else.
 */
window.acgDelivery = window.acgDelivery || (function () {
    const LINE = /^(https?:\/\/[^\s\/?#]+)?\/download\/([a-f0-9]{48})(#\S*)?$/i;
    const ANY = /^[ \t]*(https?:\/\/[^\s\/?#]+)?\/download\/[a-f0-9]{48}(#\S*)?[ \t]*$/im;
    const ICON_FILE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M10 4.5v1M10 7.5v1M10 10.5v1"/><rect x="8.6" y="13.5" width="2.8" height="4" rx="1"/></svg>';
    const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';
    const ICON_COPY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
    const STYLE = '.acg-delivery{display:flex;flex-direction:column;gap:10px;min-width:0;text-align:left;line-height:1.5;white-space:normal;word-break:normal}'
        + '.acg-delivery__text{margin:0;font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}'
        + '.acg-delivery__files{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}'
        + '.acg-delivery__file{display:flex;align-items:center;gap:12px;min-width:0;margin:0;padding:12px 14px;line-height:1.5;list-style:none;border-radius:var(--acg-delivery-radius,14px);border:1px solid var(--acg-delivery-border,rgba(127,127,127,.22));background:var(--acg-delivery-surface,rgba(127,127,127,.06))}'
        + '.acg-delivery__icon{flex:none;display:grid;place-items:center;width:42px;height:42px;border-radius:11px;color:var(--acg-delivery-accent,#2563eb);background:var(--acg-delivery-accent-soft,rgba(37,99,235,.12))}'
        + '.acg-delivery__info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}'
        + '.acg-delivery__name{font-weight:600;overflow-wrap:anywhere;word-break:break-word}'
        + '.acg-delivery__sub{font-size:12px;opacity:.68}'
        + '.acg-delivery__url{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;opacity:.72;word-break:break-all;-webkit-user-select:all;user-select:all}'
        + '.acg-delivery__actions{flex:none;display:flex;align-items:center;gap:6px}'
        + '.acg-delivery__download,.acg-delivery__copy{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:0 14px;border-radius:999px;font:inherit;font-size:13px;font-weight:600;line-height:1;white-space:nowrap;text-decoration:none;cursor:pointer;transition:filter .15s ease,transform .15s ease,background-color .15s ease}'
        + '.acg-delivery__download{border:0;color:var(--acg-delivery-on-accent,#fff);background:var(--acg-delivery-accent,#2563eb)}'
        + '.acg-delivery__download:hover{filter:brightness(1.08)}'
        + '.acg-delivery a.acg-delivery__download,.acg-delivery a.acg-delivery__download:hover,.acg-delivery a.acg-delivery__download:focus{color:var(--acg-delivery-on-accent,#fff)!important;text-decoration:none!important}'
        + '.acg-delivery__copy{border:1px solid var(--acg-delivery-border,rgba(127,127,127,.28));color:inherit;background:transparent}'
        + '.acg-delivery__copy:hover{background:var(--acg-delivery-surface,rgba(127,127,127,.08))}'
        + '.acg-delivery__download:active,.acg-delivery__copy:active{transform:translateY(1px)}'
        + '.acg-delivery__download:focus-visible,.acg-delivery__copy:focus-visible{outline:2px solid var(--acg-delivery-accent,#2563eb);outline-offset:2px}'
        + '.acg-delivery__copy.is-done{color:var(--acg-delivery-success,#16a34a);border-color:currentColor}'
        + '@media (max-width:520px){.acg-delivery:not(.acg-delivery--compact) .acg-delivery__file{flex-wrap:wrap}.acg-delivery:not(.acg-delivery--compact) .acg-delivery__actions{width:100%}.acg-delivery:not(.acg-delivery--compact) .acg-delivery__download,.acg-delivery:not(.acg-delivery--compact) .acg-delivery__copy{flex:1}}'
        + '.acg-delivery--compact .acg-delivery__file{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;column-gap:12px;row-gap:10px;padding:12px}'
        + '.acg-delivery--compact .acg-delivery__icon{width:40px;height:40px;border-radius:10px}'
        + '.acg-delivery--compact .acg-delivery__name{font-size:14px;line-height:1.45}'
        + '.acg-delivery--compact .acg-delivery__url{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}'
        + '.acg-delivery--compact .acg-delivery__actions{grid-column:2;flex-wrap:wrap}'
        + '.acg-delivery--compact .acg-delivery__download,.acg-delivery--compact .acg-delivery__copy{min-height:34px;padding:0 14px;border-radius:9px}'
        + '@media (pointer:coarse){.acg-delivery--compact .acg-delivery__download,.acg-delivery--compact .acg-delivery__copy{min-height:40px}}'
        + '.acg-delivery--scroll .acg-delivery__files{max-height:min(52vh,420px);overflow:auto;overscroll-behavior:contain}'
        + '@media (prefers-reduced-motion:reduce){.acg-delivery__download,.acg-delivery__copy{transition:none}}';

    function t(text) {
        return typeof i18n === "function" ? i18n(text) : text;
    }

    function decodeName(fragment) {
        const raw = String(fragment || "").replace(/^#/, "");
        try {
            return decodeURIComponent(raw);
        } catch (e) {
            return raw;
        }
    }

    function parseLine(line) {
        const match = LINE.exec(String(line).trim());
        if (!match) {
            return null;
        }
        const origin = match[1] || (window.location ? window.location.origin : "");
        const token = match[2].toLowerCase();
        const url = origin + "/download/" + token;
        let host = "";
        try {
            host = new URL(url).host;
        } catch (e) {
        }
        return {type: "file", token: token, url: url, name: decodeName(match[3]), host: host};
    }

    function parse(text) {
        const segments = [];
        let buffer = [];
        const flush = function () {
            if (buffer.length) {
                const joined = buffer.join("\n");
                if (joined.trim() !== "") {
                    segments.push({type: "text", text: joined.replace(/^\n+|\n+$/g, "")});
                }
                buffer = [];
            }
        };
        String(text == null ? "" : text).split(/\r\n|\n|\r/).forEach(function (line) {
            const file = parseLine(line);
            if (file) {
                flush();
                segments.push(file);
            } else {
                buffer.push(line);
            }
        });
        flush();
        return segments;
    }

    function hasFile(text) {
        return text != null && ANY.test(String(text));
    }

    function files(text) {
        return parse(text).filter(function (segment) {
            return segment.type === "file";
        });
    }

    function textOf(text) {
        return parse(text).filter(function (segment) {
            return segment.type === "text";
        }).map(function (segment) {
            return segment.text;
        }).join("\n");
    }

    function formatSize(bytes) {
        bytes = Number(bytes);
        if (!isFinite(bytes) || bytes < 0) {
            return "";
        }
        const units = ["B", "KB", "MB", "GB", "TB"];
        let unit = 0;
        while (bytes >= 1024 && unit < units.length - 1) {
            bytes /= 1024;
            unit++;
        }
        return (unit === 0 ? bytes : bytes.toFixed(bytes >= 100 ? 0 : 1)) + " " + units[unit];
    }

    function copy(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text).then(function () {
                return true;
            }, function () {
                return legacyCopy(text);
            });
        }
        return Promise.resolve(legacyCopy(text));
    }

    function legacyCopy(text) {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
        document.body.appendChild(area);
        area.select();
        let ok = false;
        try {
            ok = document.execCommand("copy");
        } catch (e) {
        }
        area.remove();
        return ok;
    }

    function ensureStyle() {
        if (document.getElementById("acg-delivery-style")) {
            return;
        }
        const style = document.createElement("style");
        style.id = "acg-delivery-style";
        style.textContent = STYLE;
        (document.head || document.documentElement).prepend(style);
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text != null) {
            node.textContent = text;
        }
        return node;
    }

    function fileItem(file, meta) {
        const info = meta && meta[file.token] ? meta[file.token] : null;
        const name = file.name || (info && info.name) || t("未命名文件");
        const item = element("li", "acg-delivery__file");

        const icon = element("span", "acg-delivery__icon");
        icon.innerHTML = ICON_FILE;
        item.appendChild(icon);

        const body = element("span", "acg-delivery__info");
        body.appendChild(element("span", "acg-delivery__name", name));
        const sub = [];
        if (info && info.size >= 0) {
            sub.push(formatSize(info.size));
        }
        if (file.host) {
            sub.push(file.host);
        }
        if (sub.length) {
            body.appendChild(element("span", "acg-delivery__sub", sub.join(" · ")));
        }
        body.appendChild(element("span", "acg-delivery__url", file.url));
        item.appendChild(body);

        const actions = element("span", "acg-delivery__actions");
        const download = element("a", "acg-delivery__download");
        download.href = file.url;
        download.rel = "noopener noreferrer";
        download.setAttribute("download", name);
        download.setAttribute("aria-label", t("下载") + " " + name);
        download.innerHTML = ICON_DOWNLOAD;
        download.appendChild(element("span", null, t("下载")));
        actions.appendChild(download);

        const copyButton = element("button", "acg-delivery__copy");
        copyButton.type = "button";
        copyButton.setAttribute("aria-label", t("复制链接") + " " + name);
        copyButton.innerHTML = ICON_COPY;
        const copyLabel = element("span", null, t("复制链接"));
        copyLabel.setAttribute("aria-live", "polite");
        copyButton.appendChild(copyLabel);
        let timer = null;
        copyButton.addEventListener("click", function () {
            copy(file.url).then(function (ok) {
                copyLabel.textContent = ok ? t("已复制") : t("复制失败");
                copyButton.classList.toggle("is-done", ok);
                clearTimeout(timer);
                timer = setTimeout(function () {
                    copyLabel.textContent = t("复制链接");
                    copyButton.classList.remove("is-done");
                }, 1600);
            });
        });
        actions.appendChild(copyButton);
        item.appendChild(actions);
        return item;
    }

    /** Text lines plus clean file URLs (no "#name"): for "copy all" and .txt exports. */
    function plain(text) {
        return parse(text).map(function (segment) {
            return segment.type === "file" ? segment.url : segment.text;
        }).join("\n");
    }

    /**
     * Render delivered content: text stays text, file lines become download rows.
     * options.meta: token => {name, size} ("delivery_files" from the API); options.textClass: extra
     * class for text blocks; options.showText: false drops text segments; options.layout: "compact"
     * stacks the actions under the name (narrow dialogs); options.scroll: true caps the list height.
     */
    function render(text, options) {
        options = options || {};
        ensureStyle();
        const root = element("div", "acg-delivery"
            + (options.layout === "compact" ? " acg-delivery--compact" : "")
            + (options.scroll ? " acg-delivery--scroll" : ""));
        let list = null;
        parse(text).forEach(function (segment) {
            if (segment.type === "text") {
                list = null;
                if (options.showText === false) {
                    return;
                }
                root.appendChild(element("pre", "acg-delivery__text" + (options.textClass ? " " + options.textClass : ""), segment.text));
                return;
            }
            if (!list) {
                list = element("ul", "acg-delivery__files");
                list.setAttribute("role", "list");
                root.appendChild(list);
            }
            list.appendChild(fileItem(segment, options.meta));
        });
        return root;
    }

    return {
        parse: parse,
        parseLine: parseLine,
        hasFile: hasFile,
        files: files,
        textOf: textOf,
        plain: plain,
        formatSize: formatSize,
        copy: copy,
        ensureStyle: ensureStyle,
        render: render
    };
})();
