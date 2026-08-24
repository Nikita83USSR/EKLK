/**
 * EKLK Reports section — отдельный модуль.
 * Отчёты через /api/v1/reports; XLS на клиенте (SheetJS).
 * История — только сессия сервера.
 */
(() => {
  const $ = (s) => document.querySelector(s);

  let lastReport = null;

  const PT_LABELS = {
    CASH: "Наличные",
    CREDIT_CARD: "Безналичные",
    PRE_PAID: "Предоплата / зачёт аванса",
    POST_PAID: "Постоплата (кредит)",
    COUNTER_OFFER: "Встречное предоставление",
  };

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
    return d.toISOString().slice(0, 10);
  }

  function syncFilterVisibility() {
    const type = $("#rpt_type")?.value || "monthly";
    const showDate = type === "daily" || type === "weekly";
    const showYear = type === "monthly" || type === "quarterly" || type === "annual";
    const showMonth = type === "monthly";
    const showQuarter = type === "quarterly";
    $("#rpt_date_wrap")?.classList.toggle("hidden", !showDate);
    $("#rpt_year_wrap")?.classList.toggle("hidden", !showYear);
    $("#rpt_month_wrap")?.classList.toggle("hidden", !showMonth);
    $("#rpt_quarter_wrap")?.classList.toggle("hidden", !showQuarter);
  }

  function renderSummary(data) {
    const el = $("#rpt_summary");
    if (!el) return;
    const s = data.summary || {};
    const byPt = s.by_payment_type || data.by_payment_type || {};
    const rows = Object.entries(byPt)
      .map(
        ([k, v]) =>
          `<div class="kv"><span class="k">${escapeHtml(PT_LABELS[k] || k)}</span><span class="v">${money(v)} ₽</span></div>`
      )
      .join("");
    el.innerHTML = `
      <div class="kv"><span class="k">Период</span><span class="v">${escapeHtml(data.startDate || "—")} — ${escapeHtml(data.endDate || "—")}</span></div>
      <div class="kv"><span class="k">Тип отчёта</span><span class="v">${escapeHtml(data.reportType || "—")}</span></div>
      <div class="kv"><span class="k">Фирма</span><span class="v">${escapeHtml(data.firmName || "—")}</span></div>
      <div class="kv"><span class="k">Итого (все типы, со знаком)</span><span class="v"><strong>${money(s.total_signed)} ₽</strong></span></div>
      <div class="kv"><span class="k">Денежный ящик (только нал CASH)</span><span class="v"><strong>${money(data.cash_drawer ?? s.cash_drawer)} ₽</strong></span></div>
      <div class="section-title" style="margin-top:12px;font-size:0.9rem">По типам оплаты</div>
      ${rows || '<p class="hint">Нет разбивки</p>'}
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
        const cls = amt < 0 ? "style=\"color:var(--danger,#c00)\"" : "";
        return `<tr>
          <td>${escapeHtml(p.time || "—")}</td>
          <td>${escapeHtml(p.cashier || "—")}</td>
          <td>${escapeHtml(p.storeName || p.storeId || "—")}</td>
          <td>${escapeHtml(PT_LABELS[p.paymentType] || p.paymentType || "—")}</td>
          <td style="text-align:right" ${cls}>${money(amt)}</td>
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
          return `<div class="tpl-card" style="padding:8px 10px;margin-bottom:6px">
            <div><strong>${escapeHtml(h.reportType)}</strong> · ${escapeHtml((h.fetchedAt || "").slice(0, 19))}</div>
            <div class="hint">Ящик: ${money(s.cash_drawer)} · Итого: ${money(s.total_signed)} · точек: ${s.points ?? "—"}</div>
            <div class="hint">${escapeHtml(JSON.stringify(h.params || {}))}</div>
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
    let path = "";
    const qs = new URLSearchParams();
    if (ot) qs.set("order_types", ot);

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
      renderSummary(data);
      renderPoints(data);
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
    const summaryRows = [
      ["Тип отчёта", lastReport.reportType],
      ["Начало", lastReport.startDate],
      ["Конец", lastReport.endDate],
      ["Фирма", lastReport.firmName],
      ["Итого (со знаком)", s.total_signed],
      ["Денежный ящик (CASH)", lastReport.cash_drawer ?? s.cash_drawer],
      [],
      ["Тип оплаты", "Сумма"],
      ...Object.entries(byPt).map(([k, v]) => [PT_LABELS[k] || k, v]),
      [],
      ["Примечания"],
      ...(s.notes || []).map((n) => [n]),
    ];
    const detailRows = [
      ["Период", "Кассир", "Точка", "storeId", "Тип оплаты", "Сумма"],
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
    const fname = `eklk-report-${lastReport.reportType || "x"}-${lastReport.startDate || "x"}.xlsx`;
    XLSX.writeFile(wb, fname);
  }

  function bind() {
    const now = new Date();
    if ($("#rpt_date") && !$("#rpt_date").value) $("#rpt_date").value = todayISO();
    if ($("#rpt_year") && !$("#rpt_year").value) $("#rpt_year").value = now.getFullYear();
    if ($("#rpt_month")) $("#rpt_month").value = String(now.getMonth() + 1);
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
