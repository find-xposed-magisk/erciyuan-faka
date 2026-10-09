!function () {
    const $form = $('.form-data').first();
    const $field = (name) => $form.find('[name="' + name + '"]');
    const $qr = $('.wx_qrcode');
    const $qrTemp = $('.wx_qrcode_temp');
    const qrTempHtml = $qrTemp.html();
    const qrImage = (url) => $('<img>', {
        class: "wechat-img",
        src: url,
        style: "width: 100px;cursor: pointer;",
        "data-acg-proxy": ".wechat-input"
    });

    //收款码预览：已绑定画二维码，刚上传的显示图片，都没有就留空（有的主题 .wx_qrcode 一直都在，以前会画出一张空内容的假二维码）
    const showQr = (preview) => {
        $qr.empty();
        $qrTemp.html(qrTempHtml);
        if (preview.url) {
            $qr.append(qrImage(preview.url));
            $qrTemp.empty().append(qrImage(preview.url));
        } else if (preview.text) {
            $qr.qrcode({render: "canvas", width: 150, height: 150, text: preview.text});
        }
    };

    //收款账号最后一次保存的值：修改收款账号要先验证身份，用户取消验证时把表单还原回去，别留着没存进去的新值
    const payoutFields = ["alipay", "wallet_address", "wechat"];
    let preview = getVar('_user_wechat') ? {text: getVar('_user_wechat')} : {};
    let saved = {preview: preview};
    payoutFields.forEach((name) => saved[name] = $field(name).val());
    showQr(preview);


    util.bindButtonUpload(".avatar-input", "/user/api/upload/send?mime=image", result => {
        $('input[name=avatar]').val(result.url);
        $('.avatar-img').attr("src", result.url);
    });

    util.bindButtonUpload(".wechat-input", "/user/api/upload/send?mime=image", result => {
        $field("wechat").val(result.url);
        preview = {url: result.url};
        showQr(preview);
        message.success("上传完成，需要保存才会生效哦");
    });


    $('.save-data').click(function () {
        util.post({
            url: "/user/api/security/personal",
            data: util.getFormData('.form-data'),
            done: () => {
                //收款码已识别入库：清掉图片路径，之后只改别的资料时不会又被当成换收款码
                $field("wechat").val("");
                saved = {preview: preview};
                payoutFields.forEach((name) => saved[name] = $field(name).val());
                message.success("已生效");
            },
            cancel: () => {
                payoutFields.forEach((name) => $field(name).val(saved[name]).trigger("input"));
                preview = saved.preview;
                showQr(preview);
                message.info("已取消，收款账号未修改");
            }
        });
    });

    //安全导航里「个人资料 / 修改个人信息」= 同页两个面板,拦截为即时切换(不整页刷新);
    //在其它安全页(密码/邮箱/手机)这两个链接照常跳转到本页,由下方 URL 参数决定落在哪个面板
    const $info = $('.uc-subtab a[data-ptab="info"]');
    const $edit = $('.uc-subtab a[data-ptab="edit"]');
    function showTab(which) {
        const isEdit = which === "edit";
        $('.uc-tabpanel[data-panel="security"]').toggleClass("active", !isEdit);
        $('.uc-tabpanel[data-panel="profile"]').toggleClass("active", isEdit);
        $info.toggleClass("active", !isEdit);
        $edit.toggleClass("active", isEdit);
        if (window.history && history.replaceState) {
            history.replaceState(null, "", isEdit ? "/user/security/personal?tab=edit" : "/user/security/personal");
        }
    }
    $info.on("click", function (e) { e.preventDefault(); showTab("info"); });
    $edit.on("click", function (e) { e.preventDefault(); showTab("edit"); });
    //初始:从其它页带 ?tab=edit 进来则直接落在「修改个人信息」
    if (util.getParam("tab") === "edit") {
        showTab("edit");
    }

    //账户与安全 tab:重置商户密钥
    $('.reset-key').click(function () {
        message.ask("是否要重置您的密钥？", () => {
            util.post('/user/api/security/resetKey', res => {
                $('.app-key').html(res.data.app_key);
                message.success("密钥已重置");
            });
        });
    });
}();