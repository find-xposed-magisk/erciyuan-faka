/* 购买成功弹窗（默认模板走这里，其它模板走 assets/static/acg.js 里的同款实现）。
   原来是 420x420 死高度 + 裸 textarea：卡密只有一行时下面空一大片，长得还像输入框，
   想复制只能自己拖选；而且从来没显示过发货留言，买家拿到一串码不知道怎么用。
   现在：等宽代码块 + 复制/下载 + 独立「使用说明」区块，高度随内容自适应。
   样式自带（商城页没加载 md-components.css），配色用 currentColor 和中性灰，
   明暗两种模板皮肤下都成立。见 issue #813 / #816 */
const treasure = new class Treasure {

    style() {
        if (document.getElementById('acg-secret-style')) return;
        const st = document.createElement('style');
        st.id = 'acg-secret-style';
        st.textContent =
            '.acg-secret{display:flex;flex-direction:column;gap:14px;padding:18px 20px 20px;box-sizing:border-box;font-size:14px;}' +
            '.acg-secret__code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.75;' +
            'white-space:pre-wrap;word-break:break-all;padding:14px 16px;border-radius:10px;' +
            'background:rgba(127,127,127,.12);border:1px solid rgba(127,127,127,.22);' +
            'max-height:300px;overflow:auto;user-select:text;-webkit-user-select:text;}' +
            '.acg-secret__bar{display:flex;justify-content:flex-end;gap:10px;}' +
            '.acg-secret__btn{display:inline-flex;align-items:center;gap:6px;padding:7px 16px;border-radius:9px;cursor:pointer;' +
            'font-size:13px;line-height:1.4;color:inherit;background:transparent;border:1px solid rgba(127,127,127,.38);' +
            'transition:background .15s ease,border-color .15s ease;}' +
            '.acg-secret__btn:hover{background:rgba(127,127,127,.16);border-color:rgba(127,127,127,.6);}' +
            '.acg-secret__btn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;' +
            'stroke-linecap:round;stroke-linejoin:round;}' +
            '.acg-secret__note{border-radius:10px;padding:12px 14px;background:rgba(127,127,127,.10);' +
            'border-left:3px solid rgba(127,127,127,.45);}' +
            '.acg-secret__note-title{display:flex;align-items:center;gap:6px;font-size:12px;opacity:.7;margin-bottom:6px;}' +
            '.acg-secret__note-title svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;' +
            'stroke-linecap:round;stroke-linejoin:round;}' +
            '.acg-secret__note-body{font-size:13px;line-height:1.75;white-space:pre-line;word-break:break-word;max-height:180px;overflow:auto;}' +
            '.acg-secret__note-body p:last-child{margin-bottom:0;}' +
            // File rows come from acgDelivery (compact layout: the dialog is narrow).
            '.acg-secret .acg-delivery{--acg-delivery-radius:10px;}' +
            '.acg-secret__btn:focus-visible{outline:2px solid currentColor;outline-offset:2px;}';
        document.head.appendChild(st);
    }

    /**
     * @param {string} tradeNo
     * @param {string} secret delivered content
     * @param {string} [leaveMessage] merchant rich text
     * @param {Object} [deliveryFiles] "delivery_files" of the API: token => {name, size}
     */
    show(tradeNo, secret, leaveMessage, deliveryFiles) {
        this.style();
        const text = secret == null ? '' : String(secret);
        const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const iCopy = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
        const iDown = '<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>';
        const iText = '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>';
        const iInfo = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
        const button = (act, icon, label) => '<button type="button" class="acg-secret__btn" data-acg-act="' + act + '">' + icon + '<span>' + i18n(label) + '</span></button>';

        //发货留言是商家富文本，与购买记录页/查询页一致原样渲染；没配就整块不出现
        const note = leaveMessage
            ? '<div class="acg-secret__note"><div class="acg-secret__note-title">' + iInfo + '<span>' +
              i18n('使用说明') + '</span></div><div class="acg-secret__note-body">' + leaveMessage + '</div></div>'
            : '';

        // File cards: one row per file. "Copy all" = text lines + clean links; the .txt is only
        // offered when text lines exist and is labelled so it is not mistaken for the files.
        const delivery = window.acgDelivery && window.acgDelivery.hasFile(text) ? window.acgDelivery : null;
        const view = delivery ? {meta: deliveryFiles, textClass: 'acg-secret__code', layout: 'compact', scroll: true} : null;
        let body = '<div class="acg-secret__code">' + esc + '</div>';
        let bar = button('copy', iCopy, '复制') + button('download', iDown, '下载');
        let plain = text;
        if (delivery) {
            const hasText = delivery.textOf(text).trim() !== '';
            plain = delivery.plain(text);
            // layer sizes the dialog from the markup it opens with; the live rows replace it in success.
            body = delivery.render(text, view).outerHTML;
            bar = (hasText || delivery.files(text).length > 1 ? button('copy', iCopy, '复制全部') : '') +
                (hasText ? button('download', iText, '下载文本') : '');
        }

        layer.open({
            type: 1,
            title: `${util.icon("fa-duotone fa-regular fa-baby-carriage")} ${i18n('您购买的宝贝信息')}:`,
            //高度交给内容自己撑，卡密只有一行时不再留一大片空白
            area: [Math.min((window.innerWidth || 460) - 32, 460) + 'px', 'auto'],
            content: '<div class="acg-secret' + (delivery ? ' acg-secret--files' : '') + '">' + body +
                (bar ? '<div class="acg-secret__bar">' + bar + '</div>' : '') + note + '</div>',
            success: function (layero) {
                if (delivery) {
                    layero.find('.acg-secret > .acg-delivery').replaceWith(delivery.render(text, view));
                }
                layero.find('[data-acg-act="copy"]').on('click', function () {
                    //必须给 error 回调：http 站点下没有 navigator.clipboard，走的是 execCommand，
                    //一旦失败默认是静默的，用户点了没反应还以为已经复制走了
                    util.copyTextToClipboard(plain, function () {
                        message.success(i18n(delivery ? '已复制' : '卡密已复制'));
                    }, function () {
                        message.error(i18n('复制失败，请手动选中上方内容复制'));
                    });
                });
                layero.find('[data-acg-act="download"]').on('click', function () {
                    const blob = new Blob([plain], {type: 'text/plain;charset=utf-8'});
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = (tradeNo || 'card') + '.txt';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
                });
            }
        });
    }
}
