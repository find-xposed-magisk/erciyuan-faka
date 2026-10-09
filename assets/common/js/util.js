const util = new class Util {
    icon(icon) {
        if (this.isImagePath(icon)) {
            return `<img class="image-icon" src="${icon}"  alt="icon"/>`
        }
        return `<i class="${icon}"></i>`;
    }

    isImagePath(str) {
        return /^\/[A-Za-z0-9_\/\-.]+\.(?:png|webp|jpg|jpeg|gif)$/i.test(str);
    }

    replaceDotWithHyphen(str) {
        return str.replace(/\./g, '-');
    }

    parseStringObject(obj, str) {
        try {
            // 去除字符串两端的空格
            str = str.trim();
            // 拆分字符串为属性路径数组
            let props = str.split('-');
            // 逐级访问属性
            let value = obj;
            for (let i = 0; i < props.length; i++) {
                let prop = props[i];
                value = value[prop];
            }
            return value;
        } catch (error) {
            return undefined;
        }
    }

    isEmptyOrNotJson(val) {
        if (val === null || val === undefined) return true;

        if (typeof val === 'object') {
            if (Array.isArray(val) || Object.prototype.toString.call(val) === '[object Object]') {
                return Object.keys(val).length === 0;
            }
        }

        // 不是对象类型，统统算 true
        return true;
    }

    checkPropertyExistence(obj, str) {
        try {
            str = str.trim();
            let props = str.split('-');
            let value = obj;
            for (let i = 0; i < props.length; i++) {
                let prop = props[i];
                if (value.hasOwnProperty(prop)) {
                    value = value[prop];
                } else {
                    return false;
                }
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    parseNestedKeysFromJSON(jsonData) {
        const parsedObject = {};

        for (const key in jsonData) {
            if (jsonData.hasOwnProperty(key)) {
                const nestedKeys = key.split('-');

                let currentObj = parsedObject;
                for (let i = 0; i < nestedKeys.length; i++) {
                    const nestedKey = nestedKeys[i];

                    if (i === nestedKeys.length - 1) {
                        currentObj[nestedKey] = jsonData[key];
                    } else {
                        currentObj[nestedKey] = currentObj[nestedKey] || {};
                        currentObj = currentObj[nestedKey];
                    }
                }
            }
        }

        return parsedObject;
    }


    getCookie(name) {
        return document.cookie.match(`[;\s+]?${name}=([^;]*)`)?.pop();
    }

    getParam(variable) {
        let query = window.location.search.substring(1);
        let vars = query.split("&");
        for (let i = 0; i < vars.length; i++) {
            let pair = vars[i].split("=");
            if (pair[0] === variable) {
                return pair[1];
            }
        }
        return null;
    }

    /**
     * Create a detached, redacted snapshot for request debugging. The original
     * value is never changed or passed to the console.
     */
    redactDebugValue(value, context = "", direction = "request") {
        const redacted = "[REDACTED]", circular = "[Circular]", unreadable = "[Unreadable]";
        const active = new WeakSet();
        const requestContext = String(context || "").toLowerCase();

        const keyWords = key => String(key || "")
            .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean);

        const isSensitiveKey = (key, path = "") => {
            const words = keyWords(key), compact = words.join("");
            if (/(?:password|passwd|secret|token|authorization|private|credential)/.test(compact)) {
                return true;
            }
            if (words.some(word => ["key", "auth", "authentication", "oauth", "otp", "totp", "captcha"].includes(word))) {
                return true;
            }
            if (/(?:api|app|access|client|public|private|merchant|mch|sign|encrypt|decrypt|auth)key(?:id|secret|token|value)?$/.test(compact)) {
                return true;
            }
            if (!words.includes("code") && !compact.endsWith("code")) {
                return false;
            }

            // Keep ordinary business fields such as commodity.code visible.
            if (words.some(word => ["verify", "verification", "captcha", "otp", "totp", "auth", "authentication", "security", "sms", "email", "phone", "mobile", "google", "twofactor", "2fa", "onetime"].includes(word))
                || /(?:verify|verification|captcha|otp|totp|auth|authentication|security|sms|email|phone|mobile|google|twofactor|2fa|onetime)code$/.test(compact)) {
                return true;
            }
            if (direction === "response" && path === "" && words.length === 1) {
                return false; // Standard API response status: {code: 200, ...}
            }
            return /(?:captcha|verif(?:y|ication)|otp|totp|google(?:bind|unbind|secret)|two[-_]?factor|2fa|one[-_]?time|authentication|login|register|forget|reset[-_]?password|security)/.test(requestContext + " " + path.toLowerCase());
        };

        const defineValue = (target, key, item) => {
            Object.defineProperty(target, key, {
                value: item,
                enumerable: true,
                configurable: true,
                writable: true
            });
        };

        const clone = (item, path = "") => {
            if (item === null || (typeof item !== "object" && typeof item !== "function")) {
                return item;
            }
            if (active.has(item)) {
                return circular;
            }
            active.add(item);

            try {
                if (typeof FormData !== "undefined" && item instanceof FormData) {
                    const copy = new FormData();
                    item.forEach((entry, key) => {
                        const nextPath = path ? path + "." + key : String(key);
                        const safeEntry = isSensitiveKey(key, path) ? redacted : clone(entry, nextPath);
                        if (typeof File !== "undefined" && safeEntry instanceof File) {
                            copy.append(key, safeEntry, safeEntry.name);
                        } else {
                            copy.append(key, safeEntry);
                        }
                    });
                    return copy;
                }

                if (typeof URLSearchParams !== "undefined" && item instanceof URLSearchParams) {
                    const copy = new URLSearchParams();
                    item.forEach((entry, key) => {
                        copy.append(key, isSensitiveKey(key, path) ? redacted : entry);
                    });
                    return copy;
                }

                if (typeof File !== "undefined" && item instanceof File) {
                    return new File([item], item.name, {type: item.type, lastModified: item.lastModified});
                }
                if (typeof Blob !== "undefined" && item instanceof Blob) {
                    return item.slice(0, item.size, item.type);
                }
                if (item instanceof Date) {
                    return new Date(item.getTime());
                }
                if (item instanceof RegExp) {
                    return new RegExp(item.source, item.flags);
                }

                const copy = Array.isArray(item) ? new Array(item.length) : {};
                let formFieldName = null;
                const nameDescriptor = Object.getOwnPropertyDescriptor(item, "name");
                if (nameDescriptor && "value" in nameDescriptor && typeof nameDescriptor.value === "string") {
                    formFieldName = nameDescriptor.value;
                }

                Object.keys(item).forEach(key => {
                    const nextPath = path ? path + "." + key : key;
                    const descriptor = Object.getOwnPropertyDescriptor(item, key);
                    if (!descriptor || !("value" in descriptor)) {
                        defineValue(copy, key, unreadable);
                        return;
                    }
                    const hideFormValue = key === "value" && formFieldName && isSensitiveKey(formFieldName, path);
                    defineValue(copy, key, isSensitiveKey(key, path) || hideFormValue
                        ? redacted
                        : clone(descriptor.value, nextPath));
                });
                return copy;
            } catch (error) {
                return unreadable;
            } finally {
                active.delete(item);
            }
        };

        return clone(value);
    }

    /**
     * POST
     * @param url
     * @param data
     * @param done
     * @param error
     * @param fail
     * 对象写法另可传 cancel：用户关掉资金验证 / 身份验证弹窗时回调；不传则身份验证取消按 error 处理
     */
    post(url, data, done, error = null, fail = null) {
        let loader = {
            enable: true,
            autoClose: true
        };
        //资金操作二次验证 / 身份验证：重放原请求时带上标记，避免验证后仍 42002 / 42003 造成弹框死循环
        let fundRetried = false;
        let stepRetried = false;
        let cancel = null;
        if (typeof url == "object") {
            data = url.hasOwnProperty("data") ? url.data : {};
            done = url.hasOwnProperty("done") ? url.done : null;
            error = url.hasOwnProperty("error") ? url.error : null;
            fail = url.hasOwnProperty("fail") ? url.fail : null;
            loader = url.hasOwnProperty("loader") ? (url.loader !== false ? Object.assign({}, loader, url.loader) : {
                enable: false,
                autoClose: false
            }) : loader;
            fundRetried = url._fundRetried === true;
            stepRetried = url._stepRetried === true;
            cancel = typeof url.cancel === "function" ? url.cancel : null;
            url = url.hasOwnProperty("url") ? url.url : {};
        } else if (typeof data === "function") {
            done = data;
        }
        const replay = (flags) => util.post(Object.assign({
            url: url, data: data, done: done, error: error, fail: fail, cancel: cancel, loader: loader,
            _fundRetried: fundRetried, _stepRetried: stepRetried
        }, flags));
        const reject = (res) => {
            if (typeof error === 'function') {
                error(res);
            } else if (error !== false) {
                message.error(res.msg);
            }
        };

        loader.enable ? Loading.show() : 0;
        util.debugRedacted("POST(↑):" + url, "#ff4f33", data, url, "request");
        $.ajax({
            type: 'post',
            url: url,
            data: data,
            success: (res, status, xhr) => {
                Loading.hide();
                try {
                    util.debugRedacted("POST(↓):" + url, "#0bbf4a", res, url, "response");
                    //资金操作需二次验证：弹码→/fundVerify→通过后自动重放原请求一次（覆盖所有资金接口/主题）
                    if (res && res.code === 42002 && !fundRetried) {
                        util.fundVerify(() => replay({_fundRetried: true}), cancel ? () => cancel(res) : null);
                        return;
                    }
                    //修改收款账号等敏感操作需先确认本人：弹框（动态码或登录密码）→/stepVerify→通过后重放；
                    //取消时交还调用方（cancel，没传就按失败走 error），主题好恢复按钮与表单
                    if (res && res.code === 42003 && !stepRetried) {
                        util.stepVerify(res, () => replay({_stepRetried: true}), () => (cancel ? cancel(res) : reject(res)));
                        return;
                    }
                    if (res.code !== 200) {
                        reject(res);
                        return;
                    }
                    typeof done === 'function' && done(res);
                } catch (e) {
                    console.log(e)
                    if (typeof error === 'function') {
                        error(res);
                    } else if (error !== false) {
                        util.stdout(`POST(${i18n('致命异常')}): ${url} | ${i18n('请将下面信息截图反馈给维护人员')}:\n`, "red", util.redactDebugValue(res, url, "response"));
                        message.error("服务器数据返回错误，可通过F12查看浏览器错误并且反馈给维护人员");
                    }
                }
            },
            error: (xhr, status, error) => {
                Loading.hide();
                typeof fail === 'function' && fail(xhr, status, error);
            }
        });
    }

    /**
     * 资金操作二次验证：输入动态码 → /user/api/security/fundVerify，成功后回调 retry 重放原请求。
     * @param retry
     * @param cancel 可选：关掉弹窗时回调
     */
    fundVerify(retry, cancel = null) {
        util._verifyDialog({title: "资金操作验证", url: "/user/api/security/fundVerify", done: retry, cancel: cancel});
    }

    /**
     * 身份验证（42003）：修改收款账号等敏感操作前确认本人。开了两步验证输入动态码，没开输入登录密码，
     * 通过后回调 retry 重放原请求；关掉弹窗回调 cancel。说明文字用服务端返回的 msg（已翻译，说明要做什么）。
     * @param res 42003 响应，data.method = totp | password
     * @param retry
     * @param cancel
     */
    stepVerify(res, retry, cancel) {
        util._verifyDialog({
            title: "身份验证",
            desc: res && res.msg ? res.msg : "",
            url: "/user/api/security/stepVerify",
            password: !!(res && res.data && res.data.method === "password"),
            done: retry,
            cancel: cancel
        });
    }

    /**
     * 资金验证与身份验证共用的弹窗（统一的 macOS 液态玻璃样式，自适应白天/黑夜）。
     * 自带 DOM 与样式，不依赖 message/SweetAlert，前台任意主题下观感一致。
     * 动态码模式只收数字、输满 6 位自动提交；密码模式按回车或「验证」提交。
     * @param o {title, desc?, url, password?, done, cancel?}
     */
    _verifyDialog(o) {
        const T = (s) => (typeof i18n === "function" ? i18n(s) : s);
        if (document.getElementById("fv-mask")) {
            //已有一个验证框（多个请求同时撞上）：资金验证照旧只弹一个，身份验证按取消交还调用方
            typeof o.cancel === "function" && o.cancel();
            return;
        }
        util._fundVerifyStyle();

        const password = o.password === true;
        const hint = password ? T("请输入登录密码") : T("请输入验证器上的 6 位动态码");
        const opener = document.activeElement;
        const mask = document.createElement("div");
        mask.id = "fv-mask";
        mask.className = "fv-mask";
        mask.setAttribute("role", "dialog");
        mask.setAttribute("aria-modal", "true");
        mask.setAttribute("aria-label", T(o.title));
        mask.innerHTML =
            '<div class="fv-card" role="document">'
            + '<div class="fv-title"></div>'
            + (o.desc ? '<p class="fv-desc" id="fv-desc"></p>' : '')
            + (password
                ? '<input class="fv-input" type="password" autocomplete="current-password" maxlength="128">'
                : '<input class="fv-input" type="text" inputmode="numeric" autocomplete="one-time-code" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="6">')
            + '<div class="fv-err" aria-live="polite"></div>'
            + '<div class="fv-acts">'
            + '<button type="button" class="fv-btn fv-btn--ghost fv-cancel"></button>'
            + '<button type="button" class="fv-btn fv-btn--primary fv-ok"></button>'
            + '</div>'
            + '</div>';
        document.body.appendChild(mask);

        const card = mask.querySelector(".fv-card");
        const input = mask.querySelector(".fv-input");
        const errEl = mask.querySelector(".fv-err");
        const okBtn = mask.querySelector(".fv-ok");
        const cancelBtn = mask.querySelector(".fv-cancel");
        mask.querySelector(".fv-title").textContent = T(o.title);
        if (o.desc) {
            mask.querySelector(".fv-desc").textContent = o.desc;
            mask.setAttribute("aria-describedby", "fv-desc");
        }
        input.placeholder = hint;
        input.setAttribute("aria-label", hint);
        okBtn.textContent = T("验证");
        cancelBtn.textContent = T("取消");

        //主题色在深色模式下常是浅色：主按钮文字按主题色重新挑，弹窗开着时切换深浅色也跟着重算
        const fit = () => util._fitVerifyAccent(card, okBtn);
        const scheme = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
        const watcher = window.MutationObserver ? new MutationObserver(fit) : null;
        fit();
        scheme && scheme.addEventListener && scheme.addEventListener("change", fit);
        watcher && watcher.observe(document.documentElement, {attributes: true, attributeFilter: ["class", "data-theme", "style"]});

        let busy = false;
        let closed = false;

        const close = (passed) => {
            if (closed) {
                return;
            }
            closed = true;
            mask.classList.add("fv-out");
            document.removeEventListener("keydown", onKey, true);
            scheme && scheme.removeEventListener && scheme.removeEventListener("change", fit);
            watcher && watcher.disconnect();
            setTimeout(() => {
                mask.remove();
                opener && typeof opener.focus === "function" && opener.focus();
                if (passed) {
                    typeof o.done === "function" && o.done();
                } else {
                    typeof o.cancel === "function" && o.cancel();
                }
            }, 180);
        };

        const showErr = (msg) => {
            errEl.textContent = msg || "";
            errEl.classList.toggle("is-show", !!msg);
            card.classList.remove("fv-shake");
            void card.offsetWidth; //重启抖动动画
            card.classList.add("fv-shake");
        };

        const settle = () => {
            busy = false;
            okBtn.classList.remove("is-loading");
            okBtn.disabled = cancelBtn.disabled = input.disabled = false;
        };

        const submit = () => {
            if (busy) {
                return;
            }
            const value = password ? (input.value || "") : (input.value || "").replace(/\D/g, "");
            if (value.length === 0) {
                showErr(hint);
                input.focus();
                return;
            }
            busy = true;
            okBtn.classList.add("is-loading");
            okBtn.disabled = cancelBtn.disabled = input.disabled = true;
            util.post({
                url: o.url,
                data: password ? {password: value} : {code: value},
                loader: false,
                done: () => close(true),
                error: (res) => {
                    settle();
                    showErr((res && res.msg) ? res.msg : (password ? T("登录密码不正确") : T("动态码不正确")));
                    input.value = "";
                    input.focus();
                },
                fail: () => {
                    settle();
                    showErr(T("网络异常，请稍后重试"));
                }
            });
        };

        function onKey(e) {
            if (e.key === "Escape") {
                e.preventDefault();
                close(false);
            } else if (e.key === "Enter") {
                e.preventDefault();
                submit();
            }
        }

        input.addEventListener("input", () => {
            if (!password) {
                input.value = input.value.replace(/\D/g, "").slice(0, 6);
            }
            if (errEl.classList.contains("is-show")) {
                showErr("");
            }
            if (!password && input.value.length === 6) {
                submit(); //输满 6 位自动提交
            }
        });
        okBtn.addEventListener("click", submit);
        cancelBtn.addEventListener("click", () => close(false));
        mask.addEventListener("mousedown", (e) => {
            if (e.target === mask) {
                close(false);
            }
        });
        document.addEventListener("keydown", onKey, true);
        requestAnimationFrame(() => {
            mask.classList.add("fv-in");
            input.focus();
        });
    }

    /**
     * 主按钮文字颜色：先用主题的 --md-on-primary，它和主题色对比不到 4.5:1 时，改用黑、白里对比更高的那个
     * （任何颜色配黑或白至少有一边 ≥ 4.58:1）。悬停时背景朝远离文字的方向变化，对比只升不降。
     * @param card
     * @param button
     */
    _fitVerifyAccent(card, button) {
        const style = getComputedStyle(card);
        const accent = util._rgb(style.getPropertyValue("--fv-accent")) || util._rgb(getComputedStyle(button).backgroundColor);
        if (!accent) {
            return;
        }
        const lum = (c) => {
            const f = (v) => (v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
        };
        const base = lum(accent);
        const ratio = (c) => {
            const l = lum(c);
            return (Math.max(l, base) + 0.05) / (Math.min(l, base) + 0.05);
        };
        const themed = util._rgb(style.getPropertyValue("--md-on-primary"), accent);
        const text = themed && ratio(themed) >= 4.5
            ? themed
            : (ratio([0, 0, 0]) >= ratio([255, 255, 255]) ? [0, 0, 0] : [255, 255, 255]);
        const color = "rgb(" + text.join(",") + ")";
        button.style.color = color;
        card.style.setProperty("--fv-on-accent", color);
        card.setAttribute("data-on-accent", lum(text) < base ? "dark" : "light");
    }

    /**
     * 任意 CSS 颜色转 sRGB [r, g, b]，半透明时叠在 under（默认白）上；解析不了返回 null。
     * @param color
     * @param under
     * @returns {number[]|null}
     */
    _rgb(color, under = null) {
        color = String(color || "").trim();
        if (color === "") {
            return null;
        }
        if (!util._rgbContext) {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            util._rgbContext = canvas.getContext("2d", {willReadFrequently: true});
        }
        const ctx = util._rgbContext;
        ctx.fillStyle = "#010203";
        ctx.fillStyle = color;
        if (ctx.fillStyle === "#010203" && color.toLowerCase() !== "#010203") {
            return null;
        }
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        const a = d[3] / 255;
        const back = under || [255, 255, 255];
        return [0, 1, 2].map((i) => Math.round(d[i] * a + back[i] * (1 - a)));
    }

    /**
     * 注入资金验证弹窗样式（只注一次）。放 JS 里是为了不依赖任何主题 CSS，任意前台主题下样式一致。
     * style-src 允许 'unsafe-inline'，故可直接注入 <style>。
     */
    _fundVerifyStyle() {
        if (document.getElementById("fv-style")) {
            return;
        }
        const css =
            '.fv-mask{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;'
            + 'background:rgba(16,14,30,.32);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);opacity:0;transition:opacity .22s cubic-bezier(.22,1,.36,1);'
            + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif}'
            + '.fv-mask.fv-in{opacity:1}.fv-mask.fv-out{opacity:0}'
            + '.fv-card{--fv-accent:var(--uc-primary,var(--md-primary,#6a5cff));--fv-tint:rgba(255,255,255,.62);--fv-fg:#14121f;--fv-fg-soft:rgba(20,18,31,.62);--fv-fg-muted:rgba(20,18,31,.74);--fv-danger:#941a14;'
            + '--fv-field:rgba(255,255,255,.5);--fv-field-line:rgba(20,18,31,.14);--fv-ghost:rgba(20,18,31,.06);--fv-rim:rgba(255,255,255,.9);'
            + 'position:relative;width:min(380px,100%);box-sizing:border-box;padding:26px 24px 22px;border-radius:26px;isolation:isolate;'
            + 'background:linear-gradient(180deg,rgba(255,255,255,.28),rgba(255,255,255,0) 52%),var(--fv-tint);'
            + '-webkit-backdrop-filter:blur(34px) saturate(180%);backdrop-filter:blur(34px) saturate(180%);color:var(--fv-fg);'
            + 'box-shadow:0 30px 70px -24px rgba(16,14,40,.55),inset 0 1px 0 rgba(255,255,255,.6);'
            + 'transform:translateY(10px) scale(.96);opacity:0;transition:transform .32s cubic-bezier(.34,1.36,.64,1),opacity .22s cubic-bezier(.22,1,.36,1)}'
            + '.fv-in .fv-card{transform:none;opacity:1}.fv-out .fv-card{transform:translateY(8px) scale(.98);opacity:0}'
            + '.fv-card::before{content:"";position:absolute;inset:0;z-index:2;padding:1px;border-radius:inherit;pointer-events:none;'
            + 'background:linear-gradient(150deg,var(--fv-rim),rgba(255,255,255,0) 44%,rgba(255,255,255,0) 60%,var(--fv-rim));'
            + '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);opacity:.7}'
            + '.fv-title{text-align:center;font-size:19px;font-weight:700;letter-spacing:.02em;margin:0 0 18px}'
            + '.fv-desc{margin:-10px 0 16px;text-align:center;font-size:13.5px;line-height:1.55;color:var(--fv-fg-muted)}'
            + '.fv-input{display:block;width:100%;box-sizing:border-box;height:52px;padding:0 16px;margin:0;border:0;border-radius:15px;outline:none;'
            + 'background:var(--fv-field);box-shadow:inset 0 0 0 1px var(--fv-field-line);color:var(--fv-fg);font-size:18px;letter-spacing:.32em;text-align:center;'
            + '-webkit-appearance:none;appearance:none;transition:box-shadow .2s ease,background-color .2s ease}'
            + '.fv-input::placeholder{color:var(--fv-fg-soft);letter-spacing:normal;font-size:15px}'
            + '.fv-input:focus{background:rgba(255,255,255,.66);box-shadow:inset 0 0 0 1px var(--fv-field-line),0 0 0 3.5px color-mix(in srgb,var(--fv-accent) 32%,transparent)}'
            + '.fv-err{max-height:0;overflow:hidden;opacity:0;color:var(--fv-danger);font-size:13px;text-align:center;transition:max-height .2s ease,opacity .2s ease,margin .2s ease}'
            + '.fv-err.is-show{max-height:40px;opacity:1;margin-top:10px}'
            + '.fv-acts{display:flex;gap:12px;margin-top:20px}'
            + '.fv-btn{flex:1;height:46px;border:0;border-radius:14px;font-size:15px;font-weight:600;cursor:pointer;transition:transform .15s ease,filter .2s ease,background-color .2s ease;font-family:inherit}'
            + '.fv-btn:active{transform:scale(.97)}.fv-btn:focus-visible{outline:2px solid var(--fv-accent);outline-offset:2px}'
            + '.fv-btn--ghost{background:var(--fv-ghost);color:var(--fv-fg)}.fv-btn--ghost:hover{background:color-mix(in srgb,var(--fv-fg) 12%,transparent)}'
            + '.fv-btn--primary{position:relative;background:var(--fv-accent);color:var(--fv-on-accent,#fff);box-shadow:0 10px 22px -10px var(--fv-accent)}.fv-btn--primary:hover{filter:brightness(.94)}'
            + '.fv-card[data-on-accent="dark"] .fv-btn--primary:hover{filter:brightness(1.06)}'
            + '.fv-btn--primary.is-loading{color:transparent;pointer-events:none}'
            + '.fv-btn--primary.is-loading::after{content:"";position:absolute;top:50%;left:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border:2px solid color-mix(in srgb,var(--fv-on-accent,#fff) 40%,transparent);border-top-color:var(--fv-on-accent,#fff);border-radius:50%;animation:fv-spin .7s linear infinite}'
            + '@keyframes fv-spin{to{transform:rotate(360deg)}}'
            + '@keyframes fv-shake{10%,90%{transform:translateX(-1px)}30%,70%{transform:translateX(-4px)}50%{transform:translateX(4px)}}'
            + '.fv-card.fv-shake{animation:fv-shake .4s cubic-bezier(.36,.07,.19,.97)}'
            + '@supports (corner-shape:squircle){.fv-card,.fv-card::before{corner-shape:squircle;border-radius:34px}.fv-input{corner-shape:squircle;border-radius:19px}.fv-btn{corner-shape:squircle;border-radius:18px}}'
            + '@media (prefers-reduced-motion:reduce){.fv-mask,.fv-card,.fv-card.fv-shake{transition:none;animation:none}}';
        // 暗色：跟随系统，或站点在 <html> 上显式标注的主题（Cartoon 用 data-theme；显式 light 时不转暗）。
        const dark =
            '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .fv-card{--fv-tint:rgba(30,30,38,.58);--fv-fg:#f5f5f7;--fv-fg-soft:rgba(235,235,245,.6);--fv-fg-muted:rgba(235,235,245,.74);--fv-danger:#ff6961;--fv-field:rgba(255,255,255,.08);--fv-field-line:rgba(255,255,255,.14);--fv-ghost:rgba(255,255,255,.1);--fv-rim:rgba(255,255,255,.3);'
            + 'background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,0) 52%),var(--fv-tint);box-shadow:0 30px 70px -24px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.16)}'
            + ':root:not([data-theme="light"]) .fv-input:focus{background:rgba(255,255,255,.12)}}'
            + 'html[data-theme="dark"] .fv-card{--fv-tint:rgba(30,30,38,.58);--fv-fg:#f5f5f7;--fv-fg-soft:rgba(235,235,245,.6);--fv-fg-muted:rgba(235,235,245,.74);--fv-danger:#ff6961;--fv-field:rgba(255,255,255,.08);--fv-field-line:rgba(255,255,255,.14);--fv-ghost:rgba(255,255,255,.1);--fv-rim:rgba(255,255,255,.3);'
            + 'background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,0) 52%),var(--fv-tint);box-shadow:0 30px 70px -24px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.16)}'
            + 'html[data-theme="dark"] .fv-input:focus{background:rgba(255,255,255,.12)}';
        const style = document.createElement("style");
        style.id = "fv-style";
        style.textContent = css + dark;
        document.head.appendChild(style);
    }

    /**
     * GET
     * @param url
     * @param done
     * @param error
     */
    get(url, done = null, error = null) {
        Loading.show();
        util.debug("GET(↑):" + url, "#ff4f33");
        $.get({
            url: url,
            success: res => {
                util.debug("GET(↓):" + url, "#0bbf4a", res);
                Loading.hide();
                if (res.code !== 200) {
                    if (typeof error === 'function') {
                        typeof error === 'function' && error(res);
                    } else {
                        message.error(res.msg);
                    }
                    return;
                }
                typeof done === 'function' && done(res.data);
            }
        });
    }

    /**
     *
     * @param data
     * @param secret
     * @returns {string}
     */
    encrypt(data, secret) {
        let key = CryptoJS.enc.Utf8.parse(secret);
        let secretData = CryptoJS.enc.Utf8.parse(data);
        let encrypted = CryptoJS.AES.encrypt(secretData, key, {
            iv: CryptoJS.enc.Utf8.parse(secret), mode: CryptoJS.mode.CBC
        });
        return encrypted.toString();
    }

    /**
     *
     * @param data
     * @param secret
     * @returns {string}
     */
    decrypt(data, secret) {
        let key = CryptoJS.enc.Utf8.parse(secret);
        let decrypt = CryptoJS.AES.decrypt(data, key, {
            iv: CryptoJS.enc.Utf8.parse(secret), mode: CryptoJS.mode.CBC
        });
        return CryptoJS.enc.Utf8.stringify(decrypt).toString();
    }

    /**
     * @param serializeArray
     * @returns {{}}
     */
    arrayToObject(serializeArray, literalFields = []) {
        let paramsToJSONObject = {};
        const literalFieldSet = literalFields instanceof Set
            ? literalFields
            : new Set(Array.isArray(literalFields) ? literalFields : []);
        serializeArray.forEach(item => {
            if (item.name.match(RegExp(/\[\]/))) {
                let name = item.name.replace("[]", "");
                if (!paramsToJSONObject.hasOwnProperty(name)) {
                    paramsToJSONObject[name] = [];
                }
                paramsToJSONObject[name].push(item.value);
            } else {
                //不再预编码 + 和 &（#852）：那是给旧清洗管线（≤3.5.8 会对已解码输入再
                //urldecode 一次、把裸 & 实体化）的补偿。#833 修正管线后服务端只解一层，
                //预编码会原样落库成 %2B/%26（商品标题就是这么脏的）。jQuery 表单序列化
                //本身就会正确转义传输层，字面值直接交给它即可；数组字段（xx[]）从来
                //没做过预编码、一直入库正常，就是单层解码健康的现成证据。
                //literalFields 豁免钩子保留（preserveLiteral 字段配置无害），行为上已与
                //普通字段一致。
                paramsToJSONObject[item.name] = String(item.value ?? '');
            }
        });
        return paramsToJSONObject;
    }

    idObjToList(array = []) {
        let list = [];
        array.forEach(item => {
            list.push(item.id);
        });
        return list;
    }

    /**
     *
     * @param url
     * @returns {{}}
     */
    paramsToJSONObject(url) {
        let hash;
        let json = {};
        let hashes = url.slice(url.indexOf('?') + 1).split('&');
        for (let i = 0; i < hashes.length; i++) {
            hash = hashes[i].split('=');
            if (hash[0].indexOf("[]") !== -1) {
                if (!json.hasOwnProperty(hash[0])) {
                    json[hash[0]] = [];
                }
                json[hash[0]].push(hash[1]);
            } else {
                json[hash[0]] = hash[1];
            }

        }
        return json;
    }

    /**
     * @param length
     * @returns {string}
     */
    generateRandStr(length = 32) {
        let _charStr = 'abacdefghjklmnopqrstuvwxyzABCDEFGHJKLMNOPQRSTUVWXYZ0123456789',
            min = 0,
            max = _charStr.length - 1,
            _str = '';
        for (let i = 0, index; i < length; i++) {
            index = (function (randomIndexFunc, i) {
                return randomIndexFunc(min, max, i, randomIndexFunc);
            })(function (min, max, i, _self) {
                let indexTemp = Math.floor(Math.random() * (max - min + 1) + min),
                    numStart = _charStr.length - 10;
                if (i === 0 && indexTemp >= numStart) {
                    indexTemp = _self(min, max, i, _self);
                }
                return indexTemp;
            }, i);
            _str += _charStr[index];
        }
        return _str;
    }

    /**
     * @param obj
     * @returns {{}}
     */
    ksort(obj) {
        let sortObj = {}, keys = Object.keys(obj);
        keys.sort();
        keys.forEach((key) => {
            sortObj[key] = obj[key];
        });
        return sortObj;
    }

    /**
     * @param data
     * @param secret
     * @returns {*}
     */
    generateSignature(data, secret) {
        delete data.sign;
        data = this.ksort(data);
        let url = "";
        for (const key in data) {
            if (data[key] !== "" && data[key] !== undefined && typeof data[key] != "object" && !Number.isNaN(data[key])) {

                url += key + "=" + data[key] + "&";
            }
        }
        url = url.slice(0, -1);

        return CryptoJS.MD5(url + "&key=" + secret).toString();
    }

    md5(text) {
        return CryptoJS.MD5(text).toString();
    }

    isPc() {
        let userAgentInfo = navigator.userAgent;
        let Agents = ["Android", "iPhone", "SymbianOS", "Windows Phone", "iPad", "iPod"];
        let flag = true;
        for (let v = 0; v < Agents.length; v++) {
            if (userAgentInfo.indexOf(Agents[v]) > 0) {
                flag = false;
                break;
            }
        }
        return flag;
    }

    isIphone() {
        let ua = navigator.userAgent;
        let ipad = ua.match(/(iPad).*OS\s([\d_]+)/i), ipod = ua.match(/(iPod).*OS\s([\d_]+)/i);
        let result = !ipod && !ipad && ua.match(/(iPhone\sOS)\s([\d_]+)/i);
        return Boolean(result);
    }

    isIpad() {
        let ua = navigator.userAgent;
        let ipad = ua.match(/(iPad).*OS\s([\d_]+)/i);
        return Boolean(ipad);
    }

    isAndroid() {
        let ua = navigator.userAgent;
        let android = ua.match(/(Android)\s+([\d.]+)/i);
        return Boolean(android);
    }

    isMobile() {
        return this.isAndroid() || this.isIphone();
    }

    isAlipay() {
        let ua = navigator.userAgent;
        let alipay = ua.match(/(AlipayClient)/i);
        return Boolean(alipay);
    }

    isWx() {
        let ua = navigator.userAgent;
        let wx = ua.match(/(MicroMessenger)/i);
        return Boolean(wx);
    }

    getDate() {
        let date = new Date();
        return date.getFullYear() + "-" + date.getMonth() + "-" + date.getDay() + " " + date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds();
    }

    debug(message, color, ...val) {
        if (!(typeof getVar("DEBUG") == "boolean" && getVar("DEBUG") == true)) {
            return;
        }
        this.stdout(message, color, ...val);
    }

    debugRedacted(message, color, value, context = "", direction = "request") {
        if (!(typeof getVar("DEBUG") == "boolean" && getVar("DEBUG") == true)) {
            return;
        }
        this.stdout(message, color, this.redactDebugValue(value, context, direction));
    }


    stdout(message, color, ...val) {
        const date = new Date();
        const d = date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds();
        console.log('%c[' + d + ']-> %c' + message, 'color: #519dfb;font-weight: bold;', 'color: ' + color + '; font-weight: bold;', ...val);
    }

    isObjectEmpty(obj) {
        return Object.keys(obj).length === 0;
    }

    countDown(element, second, successMessage = "重新发送", message = "{$second}秒后重试") {
        let instance = $(element), interval;
        instance.html(message.replace("{$second}", second));
        instance.attr("disabled", true);
        interval = setInterval(() => {
            second--;
            instance.html(message.replace("{$second}", second));
            if (second <= 0) {
                instance.html(successMessage);
                instance.attr("disabled", false);
                clearInterval(interval);
            }
        }, 1000);
    }

    bytesToSize(bytes) {
        let sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 Byte';
        let i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
        return Math.round(bytes / Math.pow(1024, i), 2) + sizes[i];
    }

    formatTime(milliseconds) {
        let seconds = Math.floor(milliseconds / 1000);
        let minutes = Math.floor(seconds / 60);
        let hours = Math.floor(minutes / 60);

        let formattedTime = '';
        if (hours > 0) {
            formattedTime += hours + '小时';
        }
        if (minutes > 0) {
            formattedTime += (minutes % 60) + '分钟';
        }
        if (seconds >= 0) {
            formattedTime += (seconds % 60) + '秒';
        }

        return formattedTime.trim();
    }


    getAbstractTimeout(timeout) {
        let timestamp = new Date(timeout).getTime() / 1000;
        let now_timestamp = parseInt(new Date().getTime() / 1000);
        let expire = parseInt(timestamp) - now_timestamp;
        let day = Math.floor(expire / (24 * 3600)); // Math.floor()向下取整
        let hour = Math.floor((expire - day * 24 * 3600) / 3600);
        let minute = Math.floor((expire - day * 24 * 3600 - hour * 3600) / 60);
        let second = expire - day * 24 * 3600 - hour * 3600 - minute * 60;
        return {
            expire: expire,
            day: day,
            hour: hour,
            minute: minute,
            second: second
        }
    }

    getUploadProgress(fileSize, startTime, percent) {
        let currentTime = new Date().getTime();
        let milliseconds = (currentTime - startTime); // 已经过的时间（单位：秒）
        let uploadedBytes = percent * fileSize; // 已上传的字节数
        let uploadedSize = this.bytesToSize(uploadedBytes); // 已上传的文件大小（格式化后）
        let speedBytes = uploadedBytes / (milliseconds / 1000); // 上传速度（字节/秒）

        return {
            speed: this.bytesToSize(speedBytes) + '/s',
            speedBytes: speedBytes,
            size: uploadedSize + "/" + this.bytesToSize(fileSize),
            bytes: uploadedBytes,
            milliseconds: milliseconds,
            time: this.formatTime(milliseconds)
        };
    }

    updateProgress(element, percentage) {
        element.attr('data-percentage', percentage);
        element.css('background', `linear-gradient(to right,  #68ff73 ${percentage}%, #f3f3f3 ${percentage}%)`);
    }

    objectToQueryString(obj) {
        return Object.keys(obj)
            .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(obj[key]))
            .join('&');
    }

    require(scripts, callback, path = "/assets/common/js/component/") {
        if (typeof scripts === 'string') {
            scripts = [scripts];
        }
        let totalScripts = scripts.length;
        let loadedScriptsCount = 0;


        for (let i = 0; i < totalScripts; i++) {
            scripts[i] = path + scripts[i] + '.js';
        }


        scripts.forEach((scriptPath) => {
            let script = document.createElement('script');
            script.src = scriptPath;
            script.onload = () => {
                loadedScriptsCount++;
                if (loadedScriptsCount === totalScripts) {
                    callback();
                }
            };
            script.onerror = (err) => {
                console.error(`Script load error: ${err}`);
            };
            document.body.appendChild(script);
        });
    }

    loadSound(url, done = null) {
        const req = new XMLHttpRequest();
        req.open('GET', url, true);
        req.responseType = 'arraybuffer';
        req.onload = function () {
            let ac = new AudioContext();
            ac.decodeAudioData(req.response, function (buffer) {
                const source = ac.createBufferSource();
                source.buffer = buffer;
                source.connect(ac.destination);
                source.start(0);
                typeof done == "function" && done();
            }, function (e) {
                console.info('错误');
            });
        }
        req.send();
    }

    appendParamToUrl(url, paramString) {
        if (url.includes('?')) {
            return url + '&' + paramString;
        } else {
            return url + '?' + paramString;
        }
    }

    plainText(text) {
        if (typeof text !== 'string') {
            return text;
        }
        // 去除HTML标签
        const noHtml = text.replace(/<[^>]*>/g, '');
        // 去除前后空格和换行
        return noHtml.trim();
    }

    setCookie(key, value) {
        let expires = new Date();
        expires.setTime(expires.getTime() + (20 * 365 * 24 * 60 * 60 * 1000)); //20年
        document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/`;
    }

    deleteNodeById(data, id) {
        if (!id) {
            return data;
        }
        for (let i = 0; i < data.length; i++) {
            const node = data[i];
            // 检查当前节点是否是要删除的节点
            if (node.id === id) {
                data.splice(i, 1); // 从数组中移除该节点
                return data; // 返回更新后的数据
            }
            // 如果当前节点有子节点，递归搜索子节点
            if (node.children && node.children.length > 0) {
                node.children = this.deleteNodeById(node.children, id);
            }
        }
        return data; // 返回更新后的数据，无论是否进行了删除
    }

    copyTextToClipboard(text, success = null, error = null) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(function () {
                typeof success === "function" && success();
            }).catch(function (err) {
                typeof error === "function" && error();
            });
        } else {
            var $temp = $("<textarea>");
            $("body").append($temp);
            $temp.val(text).select();
            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    typeof success === "function" && success();
                } else {
                    typeof error === "function" && error();
                }
            } catch (err) {
                typeof error === "function" && error();
            }
            $temp.remove();
        }
    }

    /**
     * 动态加载一个或多个 JS 脚本，并在所有脚本加载完成后执行回调函数。
     * @param {string|string[]} urls - 一个或多个要加载的 JS 文件的 URL。
     * @param {Function} callback - 所有脚本加载完成后要执行的回调函数。
     */
    loadScripts(urls, callback = null) {
        if (typeof urls === 'string') {
            urls = [urls];
        }
        let promises = urls.map(url => {
            return new Promise((resolve, reject) => {
                let script = document.createElement('script');
                script.type = 'text/javascript';

                script.onload = () => resolve(url);
                script.onerror = () => reject(`Script load error: ${url}`);

                script.src = url;
                document.getElementsByTagName('body')[0].appendChild(script);
            });
        });
        Promise.all(promises).then(() => {
            typeof callback === 'function' && callback();
        }).catch(error => {
            console.error(error);
        });
    }


    bindButtonUpload(obj, url, done) {
        $(obj).change(function () {
            let formdata = new FormData();
            formdata.append("file", $(obj)[0].files[0]);
            Loading.show();
            $.ajax({
                type: "POST",
                url: url,
                data: formdata,
                contentType: false,
                processData: false,
                dataType: "json",
                success: function (res) {
                    Loading.hide();
                    if (res.code == 200) {
                        typeof done === 'function' && done(res.data);
                    } else {
                        layer.msg(res.msg);
                    }
                },
                error: function (data) {
                    Loading.hide();
                    layer.msg(i18n('网络错误'));
                }
            });
        });
    }


    /**
     *
     * @param call
     * @param millisecond
     * @param immediately
     * @returns {Promise<void>}
     */
    async timer(call, millisecond, immediately = false) {
        if (immediately) {
            const state = await call();
            if (!state) {
                return;
            }
        }
        setTimeout(async () => {
            const state = await call();
            if (state) {
                await this.timer(call, millisecond, false);
            }
        }, millisecond);
    }

    getDomHeight(dom) {
        if (!dom[0]) {
            return "";
        }
        let styleAttr = dom[0].getAttribute("style");
        let heightMatch = styleAttr && styleAttr.match(/height\s*:\s*([^;]+)(;|$)/);
        if (heightMatch) {
            return heightMatch[1].trim();
        } else {
            return "";
        }
    }

    openCheckoutWindowUrl(url) {
        if (getVar("PAY_CONFIG_CHECKOUT_COUNTER") != 1) {
            window.location.href = url;
            return;
        }

        layer.open({
            type: 2,
            title: util.icon("icon-shouyintai-copy") + " 收银台",
            shadeClose: false,
            maxmin: util.isPc(),
            area: util.isPc() ? ['80%', '80%'] : ['100%', '100%'],
            content: url
        });
    }

    onScrollToBottom(callback) {
        // PC端滚动事件
        window.addEventListener('scroll', function () {
            if (document.documentElement.scrollTop + window.innerHeight >= document.documentElement.scrollHeight) {
                callback();  // 到底部时触发回调
            }
        });

        // 手机端触摸事件
        let lastTouchY = 0;
        window.addEventListener('touchstart', function (event) {
            lastTouchY = event.touches[0].pageY;
        });

        window.addEventListener('touchmove', function (event) {
            if (lastTouchY < event.touches[0].pageY) {
                if (document.documentElement.scrollTop + window.innerHeight >= document.documentElement.scrollHeight) {
                    callback();  // 到底部时触发回调
                }
            }
        });
    }


    syncOrder(url, tradeNo) {
        util.timer(() => {
            return new Promise(resolve => {
                util.post({
                    url: url,
                    loader: false,
                    data: {trade_no: tradeNo},
                    done: res => {
                        if (res.data.status === 2) {
                            if (new Date() > new Date(res.data.timeout)) {
                                //超时
                                message.error("订单支付超时");
                                window.location.reload();
                                resolve(false);
                                return;
                            }
                            message.alert("支付已完成，已经授权成功！", "success");
                            //支付成功
                            window.location.reload();
                            resolve(false);
                        } else if (res.data.status === 3) {
                            window.location.reload();
                            resolve(false);
                            return;
                        }
                        resolve(true);
                    },
                    error: () => {
                        window.location.reload();
                        resolve(false);
                    },
                    fail: () => {
                        window.location.reload();
                        resolve(false);
                    }
                });
            });
        }, 2000);
    }


    getFormData(element) {
        const formData = new FormData(
            element instanceof HTMLFormElement ? element : document.querySelector(element)
        );
        return Object.fromEntries(formData.entries());
    }
}
