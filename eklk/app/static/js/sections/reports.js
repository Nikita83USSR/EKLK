/**
 * EKLK Reports — модуль.
 * amount уже в рублях (бэкенд делит копейки на 100).
 * Доход за период / наличные / по типам оплаты; фильтр по магазину.
 */
(() => {
  const $ = (s) => document.querySelector(s);

  let lastReport = null;
  let lastInvoiceReport = null; // { items, total_sum, since, until }
  let invBusy = false;
  let knownStores = []; // [{storeId, storeName}]
  const charts = {};

  const DONE_STATUSES = new Set([
    "done", "completed", "complete", "success", "ok", "ready", "printed",
  ]);

  const PT_LABELS = {
    CASH: "Наличные",
    CREDIT_CARD: "Безналичные",
    PRE_PAID: "Предоплата / зачёт аванса",
    POST_PAID: "Постоплата (кредит)",
    COUNTER_OFFER: "Встречное предоставление",
  };

  const COLORS = [
    "#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
    "#06b6d4", "#84cc16", "#f97316", "#ec4899", "#64748b",
  ];

  function api(path, opts) {
    if (window.EKLK && typeof window.EKLK.api === "function") return window.EKLK.api(path, opts);
    throw new Error("EKLK core not ready");
  }
  function alert(msg, type) {
    if (window.EKLK && window.EKLK.showAlert) window.EKLK.showAlert(msg, type);
    else window.alert(msg);
  }

  function money(n) {
    const v = Number(n);
    if (Number.isNaN(v)) return "—";
    return v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function syncFilterVisibility() {
    const type = $("#rpt_type")?.value || "monthly";
    const showDate = type === "daily" || type === "weekly";
    const showYear = type === "monthly" || type === "quarterly" || type === "annual";
    $("#rpt_date_wrap")?.classList.toggle("hidden", !showDate);
    $("#rpt_year_wrap")?.classList.toggle("hidden", !showYear);
    $("#rpt_month_wrap")?.classList.toggle("hidden", type !== "monthly");
    $("#rpt_quarter_wrap")?.classList.toggle("hidden", type !== "quarterly");
  }

  function destroyCharts() {
    Object.keys(charts).forEach((k) => {
      try { charts[k].destroy(); } catch (_) {}
      delete charts[k];
    });
  }

  function updateStoreSelect(stores, keepValue) {
    const sel = $("#rpt_store");
    if (!sel) return;
    const prev = keepValue !== undefined ? keepValue : sel.value;
    // merge known
    const map = new Map();
    knownStores.forEach((s) => {
      if (s && s.storeId != null) map.set(String(s.storeId), s);
    });
    (stores || []).forEach((s) => {
      if (s && s.storeId != null) map.set(String(s.storeId), s);
    });
    knownStores = Array.from(map.values()).sort((a, b) =>
      String(a.storeName || "").localeCompare(String(b.storeName || ""), "ru")
    );
    sel.innerHTML =
      `<option value="">Все магазины</option>` +
      knownStores
        .map(
          (s) =>
            `<option value="${escapeHtml(String(s.storeId))}">${escapeHtml(
              s.storeName || String(s.storeId)
            )}</option>`
        )
        .join("");
    if (prev && map.has(String(prev))) sel.value = String(prev);
  }

  function renderCharts(data) {
    destroyCharts();
    if (typeof Chart === "undefined") return;
    const s = data.summary || {};
    const ch = s.charts || {};

    const pay = ch.payment || {};
    const ctx1 = $("#rpt_chart_pay");
    if (ctx1 && pay.labels?.length) {
      charts.pay = new Chart(ctx1, {
        type: "bar",
        data: {
          labels: pay.labels,
          datasets: [{
            label: "Сумма, ₽",
            data: pay.values,
            backgroundColor: pay.values.map((_, i) => COLORS[i % COLORS.length]),
          }],
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: { y: { ticks: { callback: (v) => money(v) } } },
        },
      });
    }

    const tm = ch.time || {};
    const ctx4 = $("#rpt_chart_time");
    if (ctx4 && tm.labels?.length) {
      const datasets = [{
        label: "Общая сумма чеков",
        data: tm.total || [],
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,0.15)",
        fill: true,
        tension: 0.2,
      }];
      const byPay = tm.by_payment || {};
      Object.keys(byPay).forEach((pt, i) => {
        datasets.push({
          label: PT_LABELS[pt] || pt,
          data: byPay[pt],
          borderColor: COLORS[(i + 1) % COLORS.length],
          backgroundColor: "transparent",
          tension: 0.2,
          borderDash: [4, 3],
        });
      });
      charts.time = new Chart(ctx4, {
        type: "line",
        data: { labels: tm.labels, datasets },
        options: {
          responsive: true,
          plugins: { legend: { position: "bottom" } },
          scales: { y: { ticks: { callback: (v) => money(v) } } },
        },
      });
    }
  }

  function renderSummary(data) {
    const el = $("#rpt_summary");
    if (!el) return;
    const s = data.summary || {};
    const period = s.period_label || `${data.startDate || "—"} — ${data.endDate || "—"}`;
    const totalChecks = s.total_checks ?? s.total_signed;
    const income = s.income ?? s.balance;
    const cash = s.cash_balance ?? data.cash_drawer;
    const prepaid = s.prepaid_total ?? 0;
    const byPt = s.by_payment_type || data.by_payment_type || {};
    const byStore = s.by_store || {};

    const payRows = Object.entries(byPt)
      .map(
        ([k, v]) =>
          `<div class="kv"><span class="k">${escapeHtml(PT_LABELS[k] || k)}</span><span class="v">${money(v)} ₽</span></div>`
      )
      .join("");

    const storeRows = Object.entries(byStore)
      .map(
        ([k, v]) =>
          `<div class="kv"><span class="k">${escapeHtml(k)}</span><span class="v">${money(v)} ₽</span></div>`
      )
      .join("");

    el.innerHTML = `
      <div class="kv"><span class="k">Тип отчёта</span><span class="v">${escapeHtml(data.reportType || "—")}</span></div>
      <div class="kv"><span class="k">Фирма</span><span class="v">${escapeHtml(data.firmName || "—")}</span></div>
      <div class="kv"><span class="k">Период</span><span class="v">${escapeHtml(period)}</span></div>
      <div class="kv"><span class="k">Общая сумма чеков</span><span class="v"><strong>${money(totalChecks)} ₽</strong></span></div>
      <div class="kv"><span class="k">Баланс наличных (CASH)</span><span class="v"><strong>${money(cash)} ₽</strong></span></div>
      <div class="section-title" style="margin-top:12px;font-size:0.9rem">Баланс по типам оплаты</div>
      ${payRows || '<p class="hint">Нет данных</p>'}
      <div class="kv" style="margin-top:14px;padding-top:10px;border-top:1px solid var(--border,#e5e7eb)">
        <span class="k"><strong>Доход за выбранный период (${escapeHtml(period)})</strong></span>
        <span class="v"><strong>${money(income)} ₽</strong></span>
      </div>
      <p class="hint" style="margin-top:4px">Зачёт аванса (PRE_PAID) ${money(prepaid)} ₽ в доход не входит.</p>
      <div class="section-title" style="margin-top:12px;font-size:0.9rem">По магазинам</div>
      ${storeRows || '<p class="hint">Нет данных</p>'}
      <ul class="hint" style="margin-top:12px;padding-left:18px">
        ${(s.notes || []).map((n) => `<li>${escapeHtml(n)}</li>`).join("")}
      </ul>
    `;
  }

  function renderPoints(data) {
    const tbody = $("#rpt_tbody");
    if (!tbody) return;
    const points = data.points || [];
    if (!points.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="hint">Нет точек данных за период</td></tr>`;
      return;
    }
    tbody.innerHTML = points
      .map((p) => {
        const amt = Number(p.amount) || 0;
        return `<tr>
          <td>${escapeHtml(p.time || "—")}</td>
          <td>${escapeHtml(p.cashier || "—")}</td>
          <td>${escapeHtml(p.storeName || p.storeId || "—")}</td>
          <td>${escapeHtml(PT_LABELS[p.paymentType] || p.paymentType || "—")}</td>
          <td style="text-align:right">${money(amt)}</td>
        </tr>`;
      })
      .join("");
  }

  async function loadHistory() {
    const box = $("#rpt_history");
    if (!box) return;
    try {
      const items = await api("/reports/history");
      if (!items?.length) {
        box.innerHTML = `<p class="hint">Пока пусто</p>`;
        return;
      }
      box.innerHTML = items
        .map((h) => {
          const s = h.summary || {};
          const income = s.income ?? s.balance;
          const total = s.total_checks ?? s.total_signed;
          const period = s.period_label || "";
          return `<div class="tpl-card" style="padding:8px 10px;margin-bottom:6px">
            <div><strong>${escapeHtml(h.reportType)}</strong> · ${escapeHtml((h.fetchedAt || "").slice(0, 19))}</div>
            <div class="hint">Чеки: ${money(total)} · доход${period ? " (" + escapeHtml(period) + ")" : ""}: ${money(income)} ₽ · точек: ${s.points ?? "—"}</div>
          </div>`;
        })
        .join("");
    } catch {
      box.innerHTML = `<p class="hint">История недоступна</p>`;
    }
  }

  async function loadReport() {
    const type = $("#rpt_type")?.value || "monthly";
    const ot = $("#rpt_order_types")?.value || "";
    const storeId = $("#rpt_store")?.value || "";
    // период не позже текущей даты — только ошибка, без автозамены
    const today = todayISO();
    const yNow = new Date().getFullYear();
    const mNow = new Date().getMonth() + 1;
    const qNow = Math.floor((mNow - 1) / 3) + 1;
    const futureMsg = "Нельзя выбрать период позже текущей даты. Исправьте параметры отчёта.";
    if ((type === "daily" || type === "weekly") && $("#rpt_date")?.value && $("#rpt_date").value > today) {
      return alert(futureMsg, "error");
    }
    if ($("#rpt_year") && Number($("#rpt_year").value) > yNow) {
      return alert(futureMsg, "error");
    }
    if (type === "monthly" && Number($("#rpt_year")?.value) === yNow && Number($("#rpt_month")?.value) > mNow) {
      return alert(futureMsg, "error");
    }
    if (type === "quarterly" && Number($("#rpt_year")?.value) === yNow && Number($("#rpt_quarter")?.value) > qNow) {
      return alert(futureMsg, "error");
    }
    let path = "";
    const qs = new URLSearchParams();
    if (ot) qs.set("order_types", ot);
    if (storeId) qs.set("store_id", storeId);

    if (type === "daily") {
      const d = $("#rpt_date")?.value;
      if (!d) return alert("Укажите дату", "error");
      qs.set("date", d);
      path = "/reports/daily?" + qs.toString();
    } else if (type === "weekly") {
      const d = $("#rpt_date")?.value;
      if (!d) return alert("Укажите дату", "error");
      qs.set("date", d);
      path = "/reports/weekly?" + qs.toString();
    } else if (type === "monthly") {
      qs.set("year", $("#rpt_year")?.value || new Date().getFullYear());
      qs.set("month", $("#rpt_month")?.value || new Date().getMonth() + 1);
      path = "/reports/monthly?" + qs.toString();
    } else if (type === "quarterly") {
      qs.set("year", $("#rpt_year")?.value || new Date().getFullYear());
      qs.set("quarter", $("#rpt_quarter")?.value || 1);
      path = "/reports/quarterly?" + qs.toString();
    } else {
      qs.set("year", $("#rpt_year")?.value || new Date().getFullYear());
      path = "/reports/annual?" + qs.toString();
    }

    try {
      const data = await api(path);
      lastReport = data;
      const stores = (data.summary && data.summary.stores) || [];
      updateStoreSelect(stores, storeId);
      renderSummary(data);
      renderPoints(data);
      renderCharts(data);
      if ($("#rpt_xls")) $("#rpt_xls").disabled = !(data.points && data.points.length);
      await loadHistory();
      alert("Отчёт загружен", "success");
    } catch (e) {
      alert(e.message || String(e), "error");
    }
  }

  function downloadXls() {
    if (!lastReport || typeof XLSX === "undefined") {
      alert("Нет данных или библиотека XLSX не загружена", "error");
      return;
    }
    const s = lastReport.summary || {};
    const byPt = s.by_payment_type || lastReport.by_payment_type || {};
    const byStore = s.by_store || {};
    const period = s.period_label || `${lastReport.startDate} — ${lastReport.endDate}`;
    const income = s.income ?? s.balance;
    const totalChecks = s.total_checks ?? s.total_signed;
    const summaryRows = [
      ["Тип отчёта", lastReport.reportType],
      ["Период", period],
      ["Фирма", lastReport.firmName],
      ["Общая сумма чеков, ₽", totalChecks],
      ["Баланс наличных (CASH), ₽", s.cash_balance],
      [],
      ["Тип оплаты", "Сумма, ₽"],
      ...Object.keys(byPt).map((k) => [PT_LABELS[k] || k, byPt[k]]),
      [],
      [`Доход за выбранный период (${period}), ₽`, income],
      ["Зачёт аванса (PRE_PAID), не в доходе, ₽", s.prepaid_total ?? 0],
      [],
      ["Магазин", "Сумма, ₽"],
      ...Object.entries(byStore).map(([k, v]) => [k, v]),
      [],
      ["Примечания"],
      ...(s.notes || []).map((n) => [n]),
    ];
    const detailRows = [
      ["Период", "Кассир", "Точка", "storeId", "Тип оплаты", "Сумма, ₽"],
      ...(lastReport.points || []).map((p) => [
        p.time,
        p.cashier,
        p.storeName,
        p.storeId,
        PT_LABELS[p.paymentType] || p.paymentType,
        p.amount,
      ]),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Сводка");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailRows), "Детализация");
    XLSX.writeFile(
      wb,
      `eklk-report-${lastReport.reportType || "x"}-${lastReport.startDate || "x"}.xlsx`
    );
  }

  // ─── Invoice payments report ───────────────────────────────────────────

  function toIsoLocal(val) {
    if (!val) return null;
    // datetime-local: 2026-10-23T12:00 → ISO with Z approximation
    const s = String(val).trim();
    if (!s) return null;
    if (s.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(s)) return s;
    // treat as local wall time → append :00 if needed, keep as-is for backend parse
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s + ":00";
    return s;
  }

  function defaultInvPeriod() {
    const until = new Date();
    const since = new Date(until.getTime() - 30 * 24 * 3600 * 1000);
    const fmt = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const h = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      return `${y}-${m}-${day}T${h}:${mi}`;
    };
    return { since: fmt(since), until: fmt(until) };
  }

  function updateInvStoreSelect(stores, keepValue) {
    const sel = $("#rpt_inv_store");
    if (!sel) return;
    const prev = keepValue !== undefined ? keepValue : sel.value;
    const map = new Map();
    knownStores.forEach((s) => {
      if (s && s.storeId != null) map.set(String(s.storeId), s);
    });
    (stores || []).forEach((s) => {
      if (s && s.storeId != null) map.set(String(s.storeId), s);
    });
    knownStores = Array.from(map.values()).sort((a, b) =>
      String(a.storeName || "").localeCompare(String(b.storeName || ""), "ru")
    );
    sel.innerHTML =
      `<option value="">Все магазины</option>` +
      knownStores
        .map(
          (s) =>
            `<option value="${escapeHtml(String(s.storeId))}">${escapeHtml(
              s.storeName || String(s.storeId)
            )}</option>`
        )
        .join("");
    if (prev && map.has(String(prev))) sel.value = String(prev);
  }

  async function loadInvStoresFromFirm() {
    try {
      const firm = await api("/auth/firm");
      const stores = (firm && firm.stores) || [];
      updateInvStoreSelect(
        stores.map((s) => ({
          storeId: s.storeId ?? s.store_id,
          storeName: s.storeName ?? s.store_name ?? s.name,
        }))
      );
    } catch (_) {
      /* ignore — store list optional */
    }
  }

  function setInvProgress(show, pct, label) {
    const box = $("#rpt_inv_progress");
    const fill = $("#rpt_inv_progress_fill");
    const lab = $("#rpt_inv_progress_label");
    if (!box) return;
    box.classList.toggle("hidden", !show);
    if (fill) {
      const v = Math.max(0, Math.min(100, Number(pct) || 0));
      fill.style.width = v + "%";
      fill.classList.toggle("is-indeterminate", show && v <= 0);
    }
    if (lab) lab.textContent = label || "";
  }

  function clientNameFromDetail(data) {
    if (!data || typeof data !== "object") return "—";
    const atol = data.atol5 || {};
    let doc = atol;
    if (atol.payload && typeof atol.payload === "object" && !atol.receipt && !atol.items) {
      doc = atol.payload;
    }
    const receipt = doc.receipt || doc.correction || doc;
    const client = (receipt && receipt.client) || {};
    const name = (client.name || "").trim();
    if (name) return name;
    const email = (client.email || "").trim();
    if (email) return email;
    return "—";
  }

  function formatInvDate(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return d.toLocaleString("ru-RU", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return String(iso);
    }
  }

  function renderInvoiceTable(items) {
    const tbody = $("#rpt_inv_tbody");
    const tfoot = $("#rpt_inv_tfoot");
    const totalEl = $("#rpt_inv_total");
    if (!tbody) return;
    if (!items || !items.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="hint">Нет завершённых платежей за период</td></tr>`;
      tfoot?.classList.add("hidden");
      if ($("#rpt_inv_xls")) $("#rpt_inv_xls").disabled = true;
      return;
    }
    tbody.innerHTML = items
      .map(
        (it) => `<tr>
          <td>${escapeHtml(String(it.uuid || it.order_id || "—"))}</td>
          <td>${escapeHtml(formatInvDate(it.date))}</td>
          <td>${escapeHtml(it.client_name || "—")}</td>
          <td style="text-align:right">${money(it.total)}</td>
        </tr>`
      )
      .join("");
    const sum = items.reduce((a, it) => a + (Number(it.total) || 0), 0);
    if (totalEl) totalEl.textContent = money(sum);
    tfoot?.classList.remove("hidden");
    if ($("#rpt_inv_xls")) $("#rpt_inv_xls").disabled = false;
  }

  async function loadInvoiceReport() {
    if (invBusy) return;
    const sinceRaw = $("#rpt_inv_since")?.value;
    const untilRaw = $("#rpt_inv_until")?.value;
    if (!sinceRaw || !untilRaw) {
      return alert("Укажите период «С» и «По»", "error");
    }
    const since = toIsoLocal(sinceRaw);
    const until = toIsoLocal(untilRaw);
    const storeId = $("#rpt_inv_store")?.value || "";

    // client-side 1 year guard (backend also checks)
    try {
      const ds = new Date(since);
      const du = new Date(until);
      if (du < ds) return alert("«По» не может быть раньше «С»", "error");
      const days = (du - ds) / (24 * 3600 * 1000);
      if (days > 366) return alert("Период не более 1 года", "error");
    } catch (_) {
      /* backend validates */
    }

    invBusy = true;
    if ($("#rpt_inv_load")) $("#rpt_inv_load").disabled = true;
    if ($("#rpt_inv_xls")) $("#rpt_inv_xls").disabled = true;
    setInvProgress(true, 0, "Поиск платежей…");
    renderInvoiceTable([]);

    try {
      const qs = new URLSearchParams();
      qs.set("since", since);
      qs.set("until", until);
      if (storeId) qs.set("store_id", storeId);

      const data = await api("/reports/invoices?" + qs.toString());
      let items = Array.isArray(data.items) ? data.items.slice() : [];
      // safety: only done (backend already filters)
      items = items.filter((it) => DONE_STATUSES.has(String(it.status || "").toLowerCase()));

      const total = items.length;
      if (!total) {
        lastInvoiceReport = {
          items: [],
          total_sum: 0,
          since: data.since,
          until: data.until,
        };
        setInvProgress(false, 0, "");
        renderInvoiceTable([]);
        alert("Завершённых платежей за период нет", "success");
        return;
      }

      setInvProgress(true, 2, `Найдено ${total}. Загрузка ФИО…`);

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const oid = it.order_id || it.uuid;
        try {
          const detail = await api("/orders/" + encodeURIComponent(oid));
          it.client_name = clientNameFromDetail(detail);
        } catch (_) {
          it.client_name = "—";
        }
        const pct = Math.round(((i + 1) / total) * 100);
        setInvProgress(true, pct, `ФИО ${i + 1} из ${total}`);
        // partial render every 5 rows or last
        if ((i + 1) % 5 === 0 || i === total - 1) {
          renderInvoiceTable(items);
        }
      }

      const sum = items.reduce((a, it) => a + (Number(it.total) || 0), 0);
      lastInvoiceReport = {
        items,
        total_sum: Math.round(sum * 100) / 100,
        since: data.since,
        until: data.until,
        store_id: data.store_id,
      };
      renderInvoiceTable(items);
      setInvProgress(true, 100, `Готово: ${total} платежей`);
      setTimeout(() => setInvProgress(false, 0, ""), 1200);
      alert(`Отчёт готов: ${total} платежей`, "success");
    } catch (e) {
      setInvProgress(false, 0, "");
      alert(e.message || String(e), "error");
    } finally {
      invBusy = false;
      if ($("#rpt_inv_load")) $("#rpt_inv_load").disabled = false;
    }
  }

  function downloadInvoiceXls() {
    if (!lastInvoiceReport || !lastInvoiceReport.items || !lastInvoiceReport.items.length) {
      alert("Нет данных для выгрузки", "error");
      return;
    }
    if (typeof XLSX === "undefined") {
      alert("Библиотека XLSX не загружена", "error");
      return;
    }
    const items = lastInvoiceReport.items;
    const rows = [
      ["UUID", "Дата", "ФИО покупателя", "Сумма, ₽"],
      ...items.map((it) => [
        String(it.uuid || it.order_id || ""),
        formatInvDate(it.date),
        it.client_name || "—",
        Number(it.total) || 0,
      ]),
      [],
      ["Итого", "", "", lastInvoiceReport.total_sum],
      ["Период с", lastInvoiceReport.since || ""],
      ["Период по", lastInvoiceReport.until || ""],
      ["Записей", items.length],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Платежи");
    const tag = (lastInvoiceReport.since || "x").slice(0, 10);
    XLSX.writeFile(wb, `eklk-invoice-payments-${tag}.xlsx`);
  }

  function bind() {
    const now = new Date();
    const yNow = now.getFullYear();
    const mNow = now.getMonth() + 1;
    if ($("#rpt_date")) {
      $("#rpt_date").max = todayISO();
      if (!$("#rpt_date").value) $("#rpt_date").value = todayISO();
    }
    if ($("#rpt_year")) {
      $("#rpt_year").max = yNow;
      if (!$("#rpt_year").value) $("#rpt_year").value = yNow;
    }
    if ($("#rpt_month")) $("#rpt_month").value = String(mNow);
    syncFilterVisibility();
    $("#rpt_type")?.addEventListener("change", syncFilterVisibility);
    $("#rpt_load")?.addEventListener("click", loadReport);
    $("#rpt_xls")?.addEventListener("click", downloadXls);
    $("#rpt_hist_clear")?.addEventListener("click", async () => {
      try {
        await api("/reports/history", { method: "DELETE" });
        await loadHistory();
      } catch (e) {
        alert(e.message || String(e), "error");
      }
    });

    // invoice block
    const period = defaultInvPeriod();
    if ($("#rpt_inv_since") && !$("#rpt_inv_since").value) $("#rpt_inv_since").value = period.since;
    if ($("#rpt_inv_until") && !$("#rpt_inv_until").value) $("#rpt_inv_until").value = period.until;
    $("#rpt_inv_load")?.addEventListener("click", loadInvoiceReport);
    $("#rpt_inv_xls")?.addEventListener("click", downloadInvoiceXls);
    loadInvStoresFromFirm();
  }

  let bound = false;
  window.EKLK_REPORTS = {
    onShow() {
      if (!bound) {
        bind();
        bound = true;
      }
      loadHistory();
      loadInvStoresFromFirm();
    },
  };
})();
