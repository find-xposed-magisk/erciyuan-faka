!function () {


    $(`.send-captcha`).click(function () {
        message.prompt({
            title: '人机验证',
            width: 420,
            html: `<img src="/user/captcha/image?action=phoneBindNew" data-acg-refresh="/user/captcha/image?action=phoneBindNew" class="prompt-image-code" alt="${i18n('更换验证码')}">`,
            inputAttributes: {
                onpaste: 'return false',
                oncopy: 'return false'
            },
            confirmButtonText: `${i18n('继续操作')}`,
            inputValidator: function (value) {
                return (!value && i18n("请输入验证码"));
            }
        }).then(res => {
            if (res.isConfirmed === true) {
                util.post("/user/api/security/phoneBindNew", {
                    captcha: res.value,
                    phone: $('input[name=phone]').val()
                }, res => {
                    util.countDown(this, 60);
                    message.success("验证码发送成功");
                });
            }
        });
    });


    $('.save-data').click(function () {
        //改绑需登录密码二次验证（后端强制校验，F-33）：仅凭会话不足以改绑，防会话被窃后被改到攻击者手机。
        message.prompt({
            title: i18n('身份验证'),
            input: 'password',
            html: `<span style="font-size:14px;">${i18n('为保证账号安全，请输入登录密码以确认修改')}</span>`,
            inputAttributes: {
                autocomplete: 'current-password',
                onpaste: 'return false'
            },
            confirmButtonText: `${i18n('确认修改')}`,
            inputValidator: function (value) {
                return (!value && i18n("请输入登录密码"));
            }
        }).then(res => {
            if (res.isConfirmed === true) {
                const data = util.getFormData('.form-data');
                data.password = res.value;
                util.post("/user/api/security/phone", data, res => {
                    message.success("绑定成功");
                    setTimeout(() => {
                        window.location.reload();
                    }, 1500);
                });
            }
        });
    });
}();