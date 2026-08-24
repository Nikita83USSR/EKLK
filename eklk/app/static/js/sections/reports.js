/**
 * EKLK Reports — отдельный модуль.
 * Графики Chart.js: типы оплаты, приход/возврат, матрица, динамика.
 */
(() => {
  const $ = (s) => document.querySelector(s);

  let lastReport = null;
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
    return new Date().toISOString().slice(0, 10);
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

  function renderCharts(data) {
    destroyCharts();
    if (typeof Chart === "undefined") return;
    const s = data.summary || {};
    const ch = s.charts || {};

    // 1) Payment types bar
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
            backgroundColor: pay.values.map((v, i) =>
              v < 0 ? "rgba(239,68,68,0.7)" : COLORS[i % COLORS.length]
            ),
          }],
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: { y: { ticks: { callback: (v) => money(v) } } },
        },
      });
    }

    // 2) Direction doughnut
    const dir = ch.direction || {};
    const ctx2 = $("#rpt_chart_dir");
    if (ctx2 && dir.labels?.length) {
      charts.dir = new Chart(ctx2, {
        type: "doughnut",
        data: {
          labels: dir.labels,
          datasets: [{
            data: dir.values.map((v) => Math.abs(Number(v) || 0)),
            backgroundColor: ["#10b981", "#ef4444"],
          }],
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: "bottom" },
            tooltip: {
              callbacks: {
                label(ctx) {
                  const raw = dir.values[ctx.dataIndex];
                  return `${ctx.label}: ${money(raw)} ₽`;
                },
              },
            },
          },
        },
      });
    }

    // 3) Matrix stacked bar: income vs outcome per payment type
    const mx = ch.matrix || {};
    const ctx3 = $("#rpt_chart_matrix");
    if (ctx3 && mx.labels?.length) {
      charts.matrix = new Chart(ctx3, {
        type: "bar",
        data: {
          labels: mx.labels,
          datasets: [
            {
              label: "Приход (+)",
              data: mx.income || [],
              backgroundColor: "rgba(16,185,129,0.75)",
            },
            {
              label: "Возврат/расход (−)",
              data: (mx.outcome || []).map((v) => Math.abs(Number(v) || 0)),
              backgroundColor: "rgba(239,68,68,0.75)",
            },
          ],
        },
        options: {
          responsive: true,
          plugins: { legend: { position: "bottom" } },
          scales: {
            x: { stacked: false },
            y: { ticks: { callback: (v) => money(v) } },
          },
        },
      });
    }

    // 4) Time series
    const tm = ch.time || {};
    const ctx4 = $("#rpt_chart_time");
    if (ctx4 && tm.labels?.length) {
      const datasets = [{
        label: "Итого",
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
    const byPt = s.by_payment_type || data.by_payment_type || {};
    const matrix = s.by_direction_payment || {};
    const rows = Object.entries(byPt)
      .map(
        ([k, v]) =>
          `<div class="kv"><span class="k">${escapeHtml(PT_LABELS[k] || k)}</span><span class="v">${money(v)} ₽</span></div>`
      )
      .join("");

    // matrix table
    const payKeys = Object.keys(byPt);
    let matrixHtml = "";
    if (payKeys.length) {
      matrixHtml = `<div class="section-title" style="margin-top:14px;font-size:0.9rem">Операции × типы оплаты</div>
        <div class="orders-table-wrap"><table class="orders-table">
          <thead><tr><th>Направление</th>${payKeys.map((k) => `<th style="text-align:right">${escapeHtml(PT_LABELS[k] || k)}</th>`).join("")}<th style="text-align:right">Итого</th></tr></thead>
          <tbody>
            <tr>
              <td>Приход (+)</td>
              ${payKeys.map((k) => `<td style="text-align:right">${money((matrix.income || {})[k] || 0)}</td>`).join("")}
              <td style="text-align:right"><strong>${money(s.income_total)}</strong></td>
            </tr>
            <tr>
              <td>Возврат / расход (−)</td>
              ${payKeys.map((k) => {
                const v = (matrix.outcome || {})[k] || 0;
                return `<td style="text-align:right;color:var(--danger,#c00)">${money(v)}</td>`;
              }).join("")}
              <td style="text-align:right;color:var(--danger,#c00)"><strong>${money(s.outcome_total)}</strong></td>
            </tr>
            <tr>
              <td><strong>Нетто</strong></td>
              ${payKeys.map((k) => `<td style="text-align:right"><strong>${money(byPt[k] || 0)}</strong></td>`).join("")}
              <td style="text-align:right"><strong>${money(s.total_signed)}</strong></td>
            </tr>
          </tbody>
        </table></div>`;
    }

    el.innerHTML = `
      <div class="kv"><span class="k">Период</span><span class="v">${escapeHtml(data.startDate || "—")} — ${escapeHtml(data.endDate || "—")}</span></div>
      <div class="kv"><span class="k">Тип отчёта</span><span class="v">${escapeHtml(data.reportType || "—")}</span></div>
      <div class="kv"><span class="k">Фирма</span><span class="v">${escapeHtml(data.firmName || "—")}</span></div>
      <div class="kv"><span class="k">Итого нетто (все типы)</span><span class="v"><strong>${money(s.total_signed)} ₽</strong></span></div>
      <div class="kv"><span class="k">Приход (+)</span><span class="v">${money(s.income_total)} ₽</span></div>
      <div class="kv"><span class="k">Возврат / расход (−)</span><span class="v" style="color:var(--danger,#c00)">${money(s.outcome_total)} ₽</span></div>
      <div class="kv"><span class="k">Денежный ящик (только нал CASH)</span><span class="v"><strong>${money(data.cash_drawer ?? s.cash_drawer)} ₽</strong></span></div>
      <div class="section-title" style="margin-top:12px;font-size:0.9rem">По типам оплаты (нетто)</div>
      ${rows || '<p class="hint">Нет разбивки</p>'}
      ${matrixHtml}
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
      tbody.innerHTML = `<tr><td colspan="6" class="hint">Нет точек данных за период</td></tr>`;
      return;
    }
    tbody.innerHTML = points
      .map((p) => {
        const amt = Number(p.amount) || 0;
        const dir = amt > 0 ? "Приход" : amt < 0 ? "Возврат/расход" : "—";
        const cls = amt < 0 ? 'style="color:var(--danger,#c00)"' : "";
        return `<tr>
          <td>${escapeHtml(p.time || "—")}</td>
          <td>${escapeHtml(dir)}</td>
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
    const matrix = s.by_direction_payment || {};
    const summaryRows = [
      ["Тип отчёта", lastReport.reportType],
      ["Начало", lastReport.startDate],
      ["Конец", lastReport.endDate],
      ["Фирма", lastReport.firmName],
      ["Итого нетто", s.total_signed],
      ["Приход (+)", s.income_total],
      ["Возврат/расход (−)", s.outcome_total],
      ["Денежный ящик (CASH)", lastReport.cash_drawer ?? s.cash_drawer],
      [],
      ["Тип оплаты", "Нетто", "Приход", "Возврат/расход"],
      ...Object.keys(byPt).map((k) => [
        PT_LABELS[k] || k,
        byPt[k],
        (matrix.income || {})[k] || 0,
        (matrix.outcome || {})[k] || 0,
      ]),
      [],
      ["Примечания"],
      ...(s.notes || []).map((n) => [n]),
    ];
    const detailRows = [
      ["Период", "Направление", "Кассир", "Точка", "storeId", "Тип оплаты", "Сумма"],
      ...(lastReport.points || []).map((p) => {
        const amt = Number(p.amount) || 0;
        return [
          p.time,
          amt > 0 ? "Приход" : amt < 0 ? "Возврат/расход" : "—",
          p.cashier,
          p.storeName,
          p.storeId,
          PT_LABELS[p.paymentType] || p.paymentType,
          p.amount,
        ];
      }),
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

  // detail table header may need Направление column
  function ensureDetailHeader() {
    const table = $("#rpt_table");
    if (!table) return;
    const ths = table.querySelectorAll("thead th");
    if (ths.length === 5) {
      const tr = table.querySelector("thead tr");
      if (tr) {
        tr.innerHTML = `<th>Период</th><th>Направление</th><th>Кассир</th><th>Точка</th><th>Тип оплаты</th><th style="text-align:right">Сумма</th>`;
      }
    }
  }

  let bound = false;
  window.EKLK_REPORTS = {
    onShow() {
      if (!bound) {
        bind();
        ensureDetailHeader();
        bound = true;
      }
      loadHistory();
    },
  };
})();
