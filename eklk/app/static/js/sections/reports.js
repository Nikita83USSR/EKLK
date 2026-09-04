/**
 * EKLK Reports — модуль.
 * amount уже в рублях (бэкенд делит копейки на 100).
 * Доход за период / наличные / по типам оплаты; фильтр по магазину.
 */
(() => {
  const $ = (s) => document.querySelector(s);

  let lastReport = null;
  let knownStores = []; // [{storeId, storeName}]
  const charts = {};

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
  }

  let bound = false;
  window.EKLK_REPORTS = {
    onShow() {
      if (!bound) {
        bind();
        bound = true;
      }
      loadHistory();
    },
  };
})();
