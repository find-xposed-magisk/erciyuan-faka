!function () {
    let controllerActive = true;
    const pendingRequests = new Set();
    const generation = {overview: 0, data: 0, trend: 0};
    const teardown = [];
    const locale = document.documentElement.lang || 'zh-CN';

    // ---------------------------------------------------------------------------------------------
    // 请求与失败重试
    // ---------------------------------------------------------------------------------------------
    const trackRequest = request => {
        if (!request || typeof request.always !== 'function') return request;
        pendingRequests.add(request);
        request.always(() => pendingRequests.delete(request));
        return request;
    };
    const feedbackHost = name => document.querySelector(`[data-dash-feedback="${name}"]`);
    const clearRequestState = host => {
        if (!host) return;
        host.replaceChildren();
        host.hidden = true;
    };
    const renderRetryState = (host, text, retry) => {
        if (!host) return;
        const state = document.createElement('div');
        const icon = materialIcon('cloud_off');
        const message = document.createElement('span');
        const button = document.createElement('button');
        state.className = 'dashboard-request-state';
        message.className = 'dashboard-request-state__message';
        message.textContent = String(text || i18n('加载失败，请重试'));
        button.type = 'button';
        button.className = 'btn btn-sm btn-light-primary dashboard-request-state__retry';
        button.textContent = i18n('重新加载');
        button.addEventListener('click', () => {
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            button.textContent = i18n('正在重试…');
            retry();
        }, {once: true});
        state.append(icon, message, button);
        host.replaceChildren(state);
        host.hidden = false;
    };

    // ---------------------------------------------------------------------------------------------
    // 数字格式：金额一律换成「分」做整数运算再格式化，避免浮点尾巴
    // ---------------------------------------------------------------------------------------------
    const toNumber = value => {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    };
    const toCents = value => Math.round(toNumber(value) * 100);
    const formatCount = value => toNumber(value).toLocaleString('en-US');
    const formatMoney = value => {
        const cents = toCents(value);
        const abs = (Math.abs(cents) / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
        return (cents < 0 ? '-' : '') + format.currencySymbol() + abs;
    };
    const compactNumber = (() => {
        try {
            const formatter = new Intl.NumberFormat(locale, {notation: 'compact', maximumFractionDigits: 1});
            return value => formatter.format(value);
        } catch (error) {
            return value => String(value);
        }
    })();
    const dateFormatter = options => {
        try {
            return new Intl.DateTimeFormat(locale, options);
        } catch (error) {
            return new Intl.DateTimeFormat('zh-CN', options);
        }
    };
    const shortDate = dateFormatter({month: 'numeric', day: 'numeric'});
    const fullDate = dateFormatter({month: 'long', day: 'numeric', weekday: 'short'});
    const dayDate = dateFormatter({month: 'long', day: 'numeric'});
    const parseDay = value => {
        const [y, m, d] = String(value).split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
    };

    /** 只放行 http(s) 与站内相对路径；'#'/纯锚点是商店 API 表示「无链接」的占位值，不能被 new URL 解析成 origin/# 而漏过 */
    const safeHttpUrl = value => {
        const url = String(value || '').trim();
        if (!url || url.startsWith('#')) return '';
        try {
            const parsed = new URL(url, window.location.origin);
            return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
        } catch (error) {
            return '';
        }
    };
    const span = (className, text) => {
        const node = document.createElement('span');
        node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const materialIcon = name => {
        const icon = span('material-icons-outlined', name);
        icon.setAttribute('aria-hidden', 'true');
        return icon;
    };
    /** ¥12,500.66 → 货币符号与小数部分弱化，整数部分是视觉重心 */
    const moneyNode = value => {
        const cents = toCents(value);
        const abs = Math.abs(cents);
        const fragment = document.createDocumentFragment();
        if (cents < 0) fragment.append(span('dash-num__sign', '-'));
        fragment.append(
            span('dash-num__sym', format.currencySymbol()),
            document.createTextNode(Math.floor(abs / 100).toLocaleString('en-US')),
            span('dash-num__dec', '.' + String(abs % 100).padStart(2, '0'))
        );
        return fragment;
    };
    /** 把「成交额 {amount} · {count} 单」这类译文填进元素，占位符的值单独包一层；全程不拼 HTML */
    const fillTemplate = (element, template, values) => {
        if (!element) return;
        const parts = String(template).split(/(\{[a-z_]+\})/g).filter(part => part !== '');
        element.replaceChildren(...parts.map(part => {
            const match = /^\{([a-z_]+)\}$/.exec(part);
            if (match && Object.prototype.hasOwnProperty.call(values, match[1])) {
                return span('dash-em', values[match[1]]);
            }
            return document.createTextNode(part);
        }));
    };

    // ---------------------------------------------------------------------------------------------
    // 利润：今日 / 昨日 / 本月
    // 对比基准由后端截到同一时刻：今日比昨日同时段、本月比上月同期，上午不会永远显示下降
    // ---------------------------------------------------------------------------------------------
    const EARN = [
        {key: 'today', baseline: 'yesterday_until_now', label: '较昨日同时段'},
        {key: 'yesterday', baseline: 'day_before', label: '较前日'},
        {key: 'month', baseline: 'last_month_same', label: '较上月同期'}
    ];

    function renderDelta(host, current, baseline, label) {
        if (!host) return;
        const diff = toCents(current) - toCents(baseline);
        const base = toCents(baseline);
        const parts = [span('dash-delta__base', i18n(label))];
        if (diff === 0) {
            parts.push(span('dash-delta dash-delta--flat', i18n('持平')));
        } else {
            const up = diff > 0;
            const chip = span('dash-delta dash-delta--' + (up ? 'up' : 'down'));
            chip.append(materialIcon(up ? 'arrow_upward' : 'arrow_downward'), span('visually-hidden', up ? i18n('上升') : i18n('下降')), document.createTextNode(formatMoney(Math.abs(diff) / 100)));
            parts.push(chip);
            // 基准为 0 或亏损时百分比没有意义；基准很小时会爆成上千个百分点，只报金额差
            if (base > 0) {
                const percent = Math.abs(diff) / base * 100;
                if (percent < 1000) parts.push(span('dash-delta__pct', (percent >= 10 ? Math.round(percent) : percent.toFixed(1)) + '%'));
            }
        }
        host.replaceChildren(...parts);
    }

    function renderEarnings(stats) {
        EARN.forEach(card => {
            const root = document.querySelector(`[data-dash-earn="${card.key}"]`);
            const stat = stats?.[card.key];
            if (!root || !stat) return;
            const value = root.querySelector('[data-dash-value]');
            value.replaceChildren(moneyNode(stat.profit));
            value.classList.toggle('is-loss', toCents(stat.profit) < 0);
            renderDelta(root.querySelector('[data-dash-delta]'), stat.profit, stats?.[card.baseline]?.profit, card.label);
            fillTemplate(root.querySelector('[data-dash-meta]'), i18n('成交额 {amount} · {count} 单'), {
                amount: formatMoney(stat.turnover),
                count: formatCount(stat.orders)
            });
        });

        const aside = document.querySelector('[data-dash-last-month]');
        if (aside && stats?.last_month) {
            fillTemplate(aside, i18n('上月 {amount}'), {amount: formatMoney(stats.last_month.profit)});
            aside.hidden = false;
        }
    }

    function renderTodo(todo, isOwner) {
        const host = document.querySelector('[data-dash-todo]');
        if (!host) return;
        const cashNum = toNumber(todo?.cash_num);
        const items = [
            {
                label: i18n('待审核提现'),
                count: cashNum,
                // 提现页只对站长开放：子管理员只看数量，不给一个点进去就没有权限的链接
                href: isOwner ? '/admin/cash/index' : '',
                sub: cashNum > 0 ? formatMoney(todo.cash_amount) + (isOwner ? '' : ' · ' + i18n('需站长审核')) : ''
            },
            {label: i18n('待发货订单'), count: toNumber(todo?.delivery_num), href: '/admin/order/index', sub: ''},
            {label: i18n('待回复工单'), count: toNumber(todo?.ticket_num), href: '/admin/ticket/index', sub: ''}
        ];

        host.replaceChildren(...items.map(item => {
            const li = document.createElement('li');
            li.className = 'dash-todo__item' + (item.count > 0 ? ' is-pending' : '');
            const row = document.createElement(item.href ? 'a' : 'span');
            row.className = 'dash-todo__row';
            if (item.href) row.href = item.href;

            const text = span('dash-todo__text');
            text.append(span('dash-todo__label', item.label));
            if (item.sub) text.append(span('dash-todo__sub dash-num', item.sub));
            row.append(text, span('dash-todo__count dash-num', formatCount(item.count)));
            if (item.href) row.append(Object.assign(materialIcon('chevron_right'), {className: 'material-icons-outlined dash-todo__chevron'}));
            li.append(row);
            return li;
        }));
        host.setAttribute('aria-busy', 'false');
    }

    function loadOverview() {
        const current = ++generation.overview;
        const grid = document.querySelector('[data-dash-earn-grid]');
        const feedback = feedbackHost('overview');
        grid?.setAttribute('aria-busy', 'true');
        trackRequest($.get('/admin/api/dashboard/overview', res => {
            if (!controllerActive || current !== generation.overview) return;
            grid?.setAttribute('aria-busy', 'false');
            if (res.code != 200 || !res.data) {
                renderRetryState(feedback, res.msg || i18n('数据加载失败，请重试'), loadOverview);
                return;
            }
            clearRequestState(feedback);
            renderEarnings(res.data.stats);
            renderTodo(res.data.todo, res.data.is_owner === true);
        }).fail((xhr, status) => {
            if (!controllerActive || status === 'abort' || current !== generation.overview) return;
            grid?.setAttribute('aria-busy', 'false');
            renderRetryState(feedback, i18n('网络异常，数据加载失败'), loadOverview);
        }));
    }

    // ---------------------------------------------------------------------------------------------
    // 趋势：柱状图 + 指标页签；悬停某一天时，页签里的数字切到当天
    // ---------------------------------------------------------------------------------------------
    const TREND_KIND = {profit: 'money', turnover: 'money', orders: 'count', recharge: 'money'};
    const trend = {days: 7, metric: 'profit', data: null, hover: -1, chart: null, resizeObserver: null, themeObserver: null};

    const trendRoot = () => document.querySelector('.dash-trend');
    const formatTrendValue = (metric, value) => TREND_KIND[metric] === 'count' ? formatCount(value) : formatMoney(value);

    function renderTrendSummary() {
        const root = trendRoot();
        const data = trend.data;
        if (!root || !data) return;
        const day = trend.hover >= 0 ? data.days[trend.hover] : null;
        root.querySelectorAll('[data-trend-value]').forEach(node => {
            const metric = node.dataset.trendValue;
            node.textContent = formatTrendValue(metric, day ? day[metric] : data.total?.[metric]);
        });
        root.classList.toggle('is-inspecting', !!day);

        const caption = root.querySelector('[data-trend-caption]');
        if (!caption) return;
        if (day) {
            caption.textContent = fullDate.format(parseDay(day.date));
        } else if (data.days.length) {
            const first = parseDay(data.days[0].date);
            const last = parseDay(data.days[data.days.length - 1].date);
            caption.textContent = dayDate.format(first) + ' – ' + dayDate.format(last);
        }
    }

    function setHover(index) {
        if (index === trend.hover) return;
        trend.hover = index;
        const chart = trend.chart;
        if (chart && !chart.isDisposed()) {
            chart.dispatchAction({type: 'downplay', seriesIndex: 0});
            if (index >= 0) chart.dispatchAction({type: 'highlight', seriesIndex: 0, dataIndex: index});
        }
        renderTrendSummary();
    }

    function chartPalette(element) {
        const style = getComputedStyle(element);
        const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        return {
            accent: read('--md-primary', '#1976D2'),
            negative: read('--md-error', '#D32F2F'),
            axis: read('--md-on-surface-med', 'rgba(0,0,0,.6)'),
            label: read('--md-on-surface-dis', 'rgba(0,0,0,.38)'),
            grid: dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.07)',
            stub: dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.10)',
            shade: dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.045)',
            font: getComputedStyle(document.body).fontFamily
        };
    }

    function renderChart() {
        const root = trendRoot();
        const element = root?.querySelector('[data-trend-chart]');
        const data = trend.data;
        if (!element || !data || typeof echarts === 'undefined') return;

        if (!trend.chart || trend.chart.isDisposed()) {
            trend.chart = echarts.init(element);
            trend.chart.on('updateAxisPointer', event => {
                const info = event.axesInfo && event.axesInfo[0];
                setHover(info ? Number(info.value) : -1);
            });
            trend.chart.getZr().on('globalout', () => setHover(-1));
        }
        if (!trend.resizeObserver && typeof ResizeObserver === 'function') {
            trend.resizeObserver = new ResizeObserver(() => trend.chart && !trend.chart.isDisposed() && trend.chart.resize());
            trend.resizeObserver.observe(element);
        }

        const c = chartPalette(element);
        const metric = trend.metric;
        const dense = data.days.length > 7;
        const radius = dense ? 3 : 6;
        const lastIndex = data.days.length - 1;
        const values = data.days.map(day => TREND_KIND[metric] === 'count' ? toNumber(day[metric]) : toCents(day[metric]) / 100);
        const empty = values.every(value => value === 0);
        const emptyNote = root.querySelector('[data-trend-empty]');
        if (emptyNote) emptyNote.hidden = !empty;

        trend.chart.setOption({
            animationDuration: 480,
            animationDurationUpdate: 320,
            animationEasing: 'cubicOut',
            animationEasingUpdate: 'cubicOut',
            textStyle: {fontFamily: c.font},
            grid: {left: 2, right: 2, top: 14, bottom: 2, containLabel: true},
            // 不弹浮层：悬停哪天，上方页签里的数字就切到哪天
            tooltip: {trigger: 'axis', showContent: false, triggerOn: 'mousemove|click', axisPointer: {type: 'shadow', shadowStyle: {color: c.shade}}},
            xAxis: {
                type: 'category',
                data: data.days.map((day, index) => index === lastIndex ? i18n('今日') : shortDate.format(parseDay(day.date))),
                axisLine: {show: false},
                axisTick: {show: false},
                axisLabel: {color: c.axis, fontSize: 11, margin: 12, interval: dense ? 'auto' : 0, hideOverlap: true}
            },
            yAxis: {
                type: 'value',
                splitNumber: 3,
                minInterval: TREND_KIND[metric] === 'count' ? 1 : 0,
                max: empty ? 1 : null,
                axisLabel: {color: c.label, fontSize: 11, margin: 10, formatter: value => compactNumber(value)},
                splitLine: {lineStyle: {color: c.grid, type: [3, 4]}}
            },
            series: [{
                type: 'bar',
                barMaxWidth: dense ? 16 : 36,
                barCategoryGap: dense ? '28%' : '45%',
                // 没有数据的日子留一道细短线，让每一天都有落点，不至于像图表坏了
                barMinHeight: 2,
                cursor: 'default',
                data: values.map(value => ({
                    value,
                    itemStyle: {
                        color: value === 0 ? c.stub : (value < 0 ? c.negative : c.accent),
                        borderRadius: value === 0 ? 1 : (value < 0 ? [0, 0, radius, radius] : [radius, radius, 0, 0])
                    }
                })),
                emphasis: {focus: 'self'},
                blur: {itemStyle: {opacity: .35}}
            }]
        }, true);

        if (trend.hover >= 0) trend.chart.dispatchAction({type: 'highlight', seriesIndex: 0, dataIndex: trend.hover});
    }

    function loadTrend() {
        const current = ++generation.trend;
        const root = trendRoot();
        const feedback = feedbackHost('trend');
        root?.setAttribute('aria-busy', 'true');
        trackRequest($.get('/admin/api/dashboard/trend', {days: trend.days}, res => {
            if (!controllerActive || current !== generation.trend) return;
            root?.setAttribute('aria-busy', 'false');
            if (res.code != 200 || !res.data || !Array.isArray(res.data.days)) {
                renderRetryState(feedback, res.msg || i18n('趋势数据加载失败，请重试'), loadTrend);
                return;
            }
            clearRequestState(feedback);
            trend.data = res.data;
            trend.hover = -1;
            renderTrendSummary();
            renderChart();
        }).fail((xhr, status) => {
            if (!controllerActive || status === 'abort' || current !== generation.trend) return;
            root?.setAttribute('aria-busy', 'false');
            renderRetryState(feedback, i18n('网络异常，趋势数据加载失败'), loadTrend);
        }));
    }

    function selectMetric(metric) {
        if (!TREND_KIND[metric]) return;
        trend.metric = metric;
        trendRoot()?.querySelectorAll('[data-trend-metric]').forEach(tab => {
            const active = tab.dataset.trendMetric === metric;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        renderChart();
    }

    function selectDays(days) {
        if (days === trend.days) return;
        trend.days = days;
        trendRoot()?.querySelectorAll('[data-trend-days]').forEach(button => {
            const active = Number(button.dataset.trendDays) === days;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        loadTrend();
    }

    // ---------------------------------------------------------------------------------------------
    // 经营数据：主数 → 利润构成 / 支付通道 → 其余明细（随统计周期切换）
    // ---------------------------------------------------------------------------------------------
    /** 占比：0.75 → 75.0%；≥100% 取整，极小值显示 <0.1%，避免把真实发生的钱显示成 0% */
    const formatPercent = ratio => {
        const value = Number.isFinite(ratio) ? ratio * 100 : 0;
        const abs = Math.abs(value);
        const sign = value < 0 ? '-' : '';
        if (abs === 0) return '0%';
        if (abs < 0.1) return sign + '<0.1%';
        return sign + (abs >= 99.95 ? Math.round(abs) : abs.toFixed(1)) + '%';
    };
    const cnyAmount = value => (toCents(value) / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' CNY';

    function renderRange(range) {
        const caption = document.querySelector('[data-dash-range]');
        if (!caption) return;
        if (!range || !range.start || !range.end) {
            caption.textContent = i18n('全部时间');
            return;
        }
        const start = String(range.start).slice(0, 10);
        const end = String(range.end).slice(0, 10);
        caption.textContent = start === end
            ? fullDate.format(parseDay(start))
            : dayDate.format(parseDay(start)) + ' – ' + dayDate.format(parseDay(end));
    }

    function renderKpis(data) {
        const host = document.querySelector('[data-dash-detail]');
        if (!host) return;
        const value = key => host.querySelector(`[data-kpi="${key}"]`);
        const sub = key => host.querySelector(`[data-kpi-sub="${key}"]`);
        const turnover = toCents(data.turnover);
        const profit = toCents(data.profit);
        const buyers = toNumber(data.buyer_num);

        value('turnover')?.replaceChildren(moneyNode(data.turnover));
        value('profit')?.replaceChildren(moneyNode(data.profit));
        value('profit')?.classList.toggle('is-loss', profit < 0);
        value('orders')?.replaceChildren(document.createTextNode(formatCount(data.order_num)));
        value('avg')?.replaceChildren(moneyNode(data.avg_order));

        fillTemplate(sub('turnover'), i18n('未付款 {count} 单'), {count: formatCount(data.unpaid_order_num)});
        fillTemplate(sub('profit'), i18n('利润率 {rate}'), {rate: turnover > 0 ? formatPercent(profit / turnover) : '—'});
        fillTemplate(sub('orders'), i18n('付款人数 {count}'), {count: formatCount(buyers)});
        fillTemplate(sub('avg'), i18n('人均消费 {amount}'), {amount: buyers > 0 ? formatMoney(turnover / buyers / 100) : '—'});
    }

    /** 利润构成：成交额是整条，扣除项和利润按占成交额的比例伸长 */
    function renderFlow(data) {
        const base = toCents(data.turnover);
        document.querySelectorAll('[data-flow-field]').forEach(row => {
            const kind = row.dataset.flow;
            const cents = toCents(data[row.dataset.flowField]);
            const loss = kind === 'profit' && cents < 0;
            const share = base > 0 ? Math.abs(cents) / base : 0;
            const width = kind === 'whole' ? (base > 0 ? 100 : 0) : (loss ? 0 : Math.min(100, share * 100));

            row.querySelector('[data-flow-amount]').textContent = formatMoney(Math.abs(cents) / 100);
            row.querySelector('[data-flow-fill]').style.width = width + '%';
            row.querySelector('[data-flow-pct]').textContent = base > 0 && cents !== 0 ? formatPercent(share) : '';
            row.classList.toggle('is-zero', cents === 0);

            if (kind === 'profit') {
                row.classList.toggle('is-loss', loss);
                const label = row.querySelector('[data-dash-result-label]');
                if (label) label.textContent = loss ? i18n('亏损') : i18n('利润');
            }
        });

        const note = document.querySelector('[data-dash-commission]');
        if (note) {
            const commission = toCents(data.cost) > 0;
            if (commission) fillTemplate(note, i18n('含商户商品抽成 {amount}'), {amount: formatMoney(data.cost)});
            note.hidden = !commission;
        }
    }

    // 支付通道：订单 + 充值合在一起才是网关里的流水；余额不经过网关，后端已排在最后
    // 外部通道太多时只列前 5 个，其余收起（合计行照样算全部）；展开状态跨时间段保留
    const CHANNEL_LIMIT = 5;
    let channelsExpanded = false;

    function barRow(cells) {
        const tr = document.createElement('tr');
        tr.className = 'dash-bars__row';
        tr.append(...cells);
        return tr;
    }

    function barCell(tag, className, text) {
        const cell = document.createElement(tag);
        cell.className = className;
        if (tag === 'th') cell.scope = 'row';
        if (text !== undefined) cell.textContent = text;
        return cell;
    }

    function barFill(percent) {
        const cell = barCell('td', 'dash-bars__bar');
        cell.setAttribute('aria-hidden', 'true');
        if (percent === null) return cell;
        const track = span('dash-bars__track');
        const fill = span('dash-bars__fill');
        fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
        track.append(fill);
        cell.append(track);
        return cell;
    }

    function channelName(label, iconUrl, blank) {
        const cell = barCell('th', 'dash-bars__name');
        const wrap = span('dash-bars__channel');
        if (iconUrl) {
            const icon = document.createElement('img');
            icon.className = 'dash-bars__icon';
            icon.alt = '';
            icon.loading = 'lazy';
            icon.addEventListener('error', () => icon.replaceWith(span('dash-bars__icon')), {once: true});
            icon.src = iconUrl;
            wrap.append(icon);
        } else {
            wrap.append(span('dash-bars__icon' + (blank ? ' is-blank' : '')));
        }
        wrap.append(span('dash-bars__label', label));
        cell.append(wrap);
        return cell;
    }

    function metaRow(parts) {
        const tr = document.createElement('tr');
        tr.className = 'dash-bars__meta';
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.textContent = parts.join(' · ');
        tr.append(cell);
        return tr;
    }

    function renderChannels(data) {
        const host = document.querySelector('[data-dash-channels]');
        const table = host?.querySelector('[data-dash-channel-table]');
        if (!table) return;
        const rows = Array.isArray(data.channels) ? data.channels : [];
        const gateway = data.gateway_cny === true;
        const totalCents = rows.reduce((sum, row) => sum + toCents(row.total), 0);
        const countOf = row => toNumber(row.order_num) + toNumber(row.recharge_num);

        const externals = rows.filter(row => !row.is_balance);
        // 至少藏两个才收起：只藏一个的话，那行「其余 1 个通道」本身就占一行，不如直接列出来
        const collapsible = externals.length > CHANNEL_LIMIT + 1;

        const groups = rows.map(row => {
            const group = document.createElement('tbody');
            group.className = 'dash-bars__group' + (row.is_balance ? ' is-balance' : '');
            if (collapsible && !row.is_balance && externals.indexOf(row) >= CHANNEL_LIMIT) {
                group.classList.add('is-extra');
            }
            const share = totalCents > 0 ? toCents(row.total) / totalCents : 0;
            group.append(barRow([
                channelName(row.name || i18n('已删除的通道') + ' #' + formatCount(row.pay_id), safeHttpUrl(row.icon)),
                barCell('td', 'dash-bars__count dash-num', i18n('{count} 笔').replace('{count}', formatCount(countOf(row)))),
                barCell('td', 'dash-bars__amount dash-num', formatMoney(row.total)),
                barFill(share * 100),
                barCell('td', 'dash-bars__pct dash-num', totalCents > 0 ? formatPercent(share) : '')
            ]));
            // 充值也走了这个通道时才拆开写；非人民币站点补上网关里记的人民币金额
            const meta = [];
            if (toCents(row.recharge_amount) > 0) {
                meta.push(i18n('订单 {order} · 充值 {recharge}').replace('{order}', () => formatMoney(row.order_amount)).replace('{recharge}', () => formatMoney(row.recharge_amount)));
            }
            if (gateway && !row.is_balance) meta.push(i18n('网关 {amount}').replace('{amount}', () => cnyAmount(row.gateway)));
            if (meta.length) group.append(metaRow(meta));
            return group;
        });

        const parts = [...groups];
        let toggle = null;
        if (collapsible) {
            const more = document.createElement('tbody');
            more.className = 'dash-bars__more';
            const tr = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 5;
            toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'dash-bars__toggle';
            toggle.addEventListener('click', () => {
                channelsExpanded = !channelsExpanded;
                syncToggle();
            });
            cell.append(toggle);
            tr.append(cell);
            more.append(tr);
            // 放在外部通道之后、余额之前
            parts.splice(externals.length, 0, more);
        }
        const syncToggle = () => {
            table.querySelectorAll('.dash-bars__group.is-extra').forEach(group => {
                group.hidden = !channelsExpanded;
            });
            if (!toggle) return;
            const label = channelsExpanded ? i18n('收起') : i18n('其余 {count} 个通道').replace('{count}', formatCount(externals.length - CHANNEL_LIMIT));
            toggle.replaceChildren(materialIcon(channelsExpanded ? 'expand_less' : 'expand_more'), document.createTextNode(label));
            toggle.setAttribute('aria-expanded', String(channelsExpanded));
        };
        if (rows.length > 1) {
            const foot = document.createElement('tfoot');
            foot.append(barRow([
                channelName(i18n('合计'), '', true),
                barCell('td', 'dash-bars__count dash-num', i18n('{count} 笔').replace('{count}', formatCount(rows.reduce((sum, row) => sum + countOf(row), 0)))),
                barCell('td', 'dash-bars__amount dash-num', formatMoney(totalCents / 100)),
                barFill(null),
                barCell('td', 'dash-bars__pct dash-num')
            ]));
            const meta = [];
            const balanceCents = rows.filter(row => row.is_balance).reduce((sum, row) => sum + toCents(row.total), 0);
            if (balanceCents > 0) {
                meta.push(i18n('在线支付 {online} · 余额 {balance}').replace('{online}', () => formatMoney((totalCents - balanceCents) / 100)).replace('{balance}', () => formatMoney(balanceCents / 100)));
            }
            if (gateway) {
                const gatewayCents = rows.filter(row => !row.is_balance).reduce((sum, row) => sum + toCents(row.gateway), 0);
                meta.push(i18n('网关 {amount}').replace('{amount}', () => cnyAmount(gatewayCents / 100)));
            }
            if (meta.length) foot.append(metaRow(meta));
            parts.push(foot);
        }

        table.replaceChildren(...parts);
        syncToggle();
        table.hidden = rows.length === 0;
        host.querySelector('[data-dash-channel-empty]').hidden = rows.length > 0;
    }

    function renderMinis(data) {
        document.querySelectorAll('.dash-minis [data-dash-field]').forEach(element => {
            const field = element.dataset.dashField;
            const count = element.dataset.dashKind === 'count';
            element.textContent = count ? formatCount(data[field]) : formatMoney(data[field]);
            element.closest('.dash-mini')?.classList.toggle('is-zero', count ? toNumber(data[field]) === 0 : toCents(data[field]) === 0);
        });
    }

    function renderDetail(data) {
        renderRange(data.range);
        renderKpis(data);
        renderFlow(data);
        renderChannels(data);
        renderMinis(data);
    }

    function loadDashboardData(type) {
        const current = ++generation.data;
        const detail = document.querySelector('[data-dash-detail]');
        const feedback = feedbackHost('data');
        detail?.setAttribute('aria-busy', 'true');
        trackRequest($.post('/admin/api/dashboard/data', {type: type}, res => {
            if (!controllerActive || current !== generation.data) return;
            detail?.setAttribute('aria-busy', 'false');
            if (res.code == 200 && res.data) {
                clearRequestState(feedback);
                renderDetail(res.data);
                return;
            }
            renderRetryState(feedback, res.msg || i18n('经营数据加载失败，请重试'), () => loadDashboardData(type));
        }).fail((xhr, status) => {
            if (!controllerActive || status === 'abort' || current !== generation.data) return;
            detail?.setAttribute('aria-busy', 'false');
            renderRetryState(feedback, i18n('网络异常，经营数据加载失败'), () => loadDashboardData(type));
        }));
    }

    function selectPeriod(type) {
        document.querySelectorAll('[data-dash-periods] [data-period]').forEach(button => {
            const active = Number(button.dataset.period) === type;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', String(active));
            button.tabIndex = active ? 0 : -1;
        });
        loadDashboardData(type);
    }

    // ---------------------------------------------------------------------------------------------
    // 官方公告
    // ---------------------------------------------------------------------------------------------

    /** 公告标题是外部 HTML：只留少数排版标签和文字颜色，其余属性一律剥掉 */
    const sanitizeAnnouncement = value => {
        const template = document.createElement('template');
        template.innerHTML = String(value ?? '');
        const allowedTags = new Set(['B', 'STRONG', 'SPAN', 'BR', 'EM', 'I', 'U', 'S', 'SMALL', 'MARK', 'CODE', 'FONT']);
        const dangerousTags = new Set([
            'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE',
            'NOSCRIPT', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION',
            'META', 'LINK', 'BASE', 'VIDEO', 'AUDIO', 'CANVAS', 'FRAME', 'FRAMESET', 'IMG'
        ]);
        const normalizeColor = color => {
            const probe = document.createElement('span');
            probe.style.color = String(color ?? '').trim();
            return probe.style.color;
        };
        const walk = node => {
            Array.from(node.childNodes).forEach(child => {
                if (child.nodeType === Node.COMMENT_NODE) {
                    child.remove();
                    return;
                }
                if (child.nodeType !== Node.ELEMENT_NODE) return;
                const tag = String(child.tagName || '').toUpperCase();
                if (!allowedTags.has(tag)) {
                    if (dangerousTags.has(tag)) {
                        child.remove();
                    } else {
                        walk(child);
                        child.replaceWith(...Array.from(child.childNodes));
                    }
                    return;
                }
                const color = normalizeColor(child.style.color || (tag === 'FONT' ? child.getAttribute('color') : ''));
                Array.from(child.attributes).forEach(attribute => child.removeAttribute(attribute.name));
                if (color) child.style.color = color;
                walk(child);
            });
        };
        walk(template.content);
        return template.content;
    };

    function buildNewsItem(item) {
        const url = safeHttpUrl(item?.url);
        const node = document.createElement(url ? 'a' : 'div');
        node.className = 'dash-news__item';
        if (url) {
            node.href = url;
            node.target = '_blank';
            node.rel = 'noopener noreferrer';
        }
        const text = span('dash-news__text');
        const content = sanitizeAnnouncement(item?.title);
        if (content.textContent.trim()) {
            text.append(content);
        } else {
            text.textContent = i18n('公告');
        }
        node.append(text);
        if (url) {
            const go = materialIcon('north_east');
            go.classList.add('dash-news__go');
            node.append(go);
        }
        return node;
    }

    function loadNews() {
        const host = document.querySelector('[data-dash-news]');
        trackRequest($.get('/admin/api/app/ad', res => {
            if (!controllerActive || !host) return;
            if (res.code != 200) {
                renderRetryState(host, res.msg || i18n('公告加载失败，请重试'), loadNews);
                return;
            }
            if (!Array.isArray(res.data) || res.data.length === 0) {
                host.replaceChildren(span('dash-news__empty', i18n('暂无公告')));
                return;
            }
            host.replaceChildren(...res.data.map(buildNewsItem));
        }).fail((xhr, status) => {
            if (!controllerActive || status === 'abort' || !host) return;
            renderRetryState(host, i18n('网络异常，公告加载失败'), loadNews);
        }));
    }

    /** 手机上公告很长：允许收起，记住选择 */
    function initNewsDisclosure() {
        const card = document.querySelector('.dash-news');
        const button = card?.querySelector('.dash-news__toggle');
        const icon = button?.querySelector('.material-icons-outlined');
        if (!card || !button || !icon) return;

        const storageKey = 'admin-dashboard-announcements-collapsed';
        let collapsed = false;
        try {
            collapsed = window.localStorage.getItem(storageKey) === '1';
        } catch (error) {}

        const render = () => {
            card.classList.toggle('is-collapsed', collapsed);
            button.setAttribute('aria-expanded', String(!collapsed));
            button.setAttribute('aria-label', collapsed ? i18n('展开官方公告') : i18n('收起官方公告'));
            icon.textContent = collapsed ? 'expand_more' : 'expand_less';
        };
        button.addEventListener('click', () => {
            collapsed = !collapsed;
            render();
            try {
                window.localStorage.setItem(storageKey, collapsed ? '1' : '0');
            } catch (error) {}
        });
        render();
    }

    // ---------------------------------------------------------------------------------------------
    // 交互绑定
    // ---------------------------------------------------------------------------------------------
    /** role=tablist 的左右方向键切换 */
    const arrowNavigate = (event, selector, activate) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const items = Array.from(event.currentTarget.querySelectorAll(selector));
        const index = items.indexOf(event.target.closest(selector));
        if (index < 0) return;
        const next = items[(index + (event.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
        event.preventDefault();
        next.focus();
        activate(next);
    };

    function bindInteractions() {
        const periods = document.querySelector('[data-dash-periods]');
        periods?.addEventListener('click', event => {
            const button = event.target.closest('[data-period]');
            if (button) selectPeriod(Number(button.dataset.period));
        });
        periods?.addEventListener('keydown', event => arrowNavigate(event, '[data-period]', button => selectPeriod(Number(button.dataset.period))));

        const root = trendRoot();
        root?.addEventListener('click', event => {
            const days = event.target.closest('[data-trend-days]');
            if (days) {
                selectDays(Number(days.dataset.trendDays));
                return;
            }
            const tab = event.target.closest('[data-trend-metric]');
            if (tab) selectMetric(tab.dataset.trendMetric);
        });
        root?.querySelector('[role="tablist"]')?.addEventListener('keydown', event => arrowNavigate(event, '[data-trend-metric]', tab => selectMetric(tab.dataset.trendMetric)));

        // 触屏上点过柱子后，点图表以外的地方恢复合计
        const releaseHover = event => {
            const chart = root?.querySelector('[data-trend-chart]');
            if (trend.hover >= 0 && chart && !chart.contains(event.target)) setHover(-1);
        };
        document.addEventListener('pointerdown', releaseHover, true);
        teardown.push(() => document.removeEventListener('pointerdown', releaseHover, true));

        // 切换明暗主题时重新取色
        trend.themeObserver = new MutationObserver(() => renderChart());
        trend.themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
    }

    function destroyDashboard() {
        if (!controllerActive) return;
        controllerActive = false;
        Object.keys(generation).forEach(key => generation[key]++);
        pendingRequests.forEach(request => {
            try { request.abort(); } catch (error) {}
        });
        pendingRequests.clear();
        teardown.splice(0).forEach(fn => fn());
        trend.themeObserver?.disconnect();
        trend.resizeObserver?.disconnect();
        if (trend.chart && !trend.chart.isDisposed()) trend.chart.dispose();
        trend.chart = null;
        trend.data = null;
    }

    initNewsDisclosure();
    bindInteractions();
    loadOverview();
    loadTrend();
    selectPeriod(0);
    loadNews();

    $(document)
        .off('pjax:beforeReplace.mdDashboard')
        .one('pjax:beforeReplace.mdDashboard', destroyDashboard);
}();
