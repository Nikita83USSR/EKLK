/**
 * EKLK Home dashboard — отдельный модуль (не ядро).
 * Периоды как в Отчётах. Данные: GET /api/v1/dashboard/summary
 */
(() => {
  const $ = (s) => document.querySelector(s);
  let gaugeChart = null;
  const miniCharts = {};
  let bound = false;

  const PT_KEYS = [
    { key: "CASH", canvas: "dash_pt_cash", val: "dash_pt_cash_val", color: "#22c55e", label: "Наличные" },
    { key: "CREDIT_CARD", canvas: "dash_pt_card", val: "dash_pt_card_val", color: "#3b82f6", label: "Безналичные" },
    { key: "PRE_PAID", canvas: "dash_pt_prepaid", val: "dash_pt_prepaid_val", color: "#f59e0b", label: "Зачёты" },
    { key: "POST_PAID", canvas: "dash_pt_credit", val: "dash_pt_credit_val", color: "#8b5cf6", label: "Кредит" },
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
    return v.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " ₽";
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

  function setDelta(el, v) {
    if (!el) return;
    el.className = "dash-delta " + (v > 0 ? "up" : v < 0 ? "down" : "flat");
    el.textContent = v == null || Number.isNaN(Number(v)) ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`;
  }

  function syncFilterVisibility() {
    const type = $("#dash_period")?.value || "daily";
    const showDate = type === "daily" || type === "weekly";
    const showYear = type === "monthly" || type === "quarterly" || type === "annual";
    $("#dash_date_wrap")?.classList.toggle("hidden", !showDate);
    $("#dash_year_wrap")?.classList.toggle("hidden", !showYear);
    $("#dash_month_wrap")?.classList.toggle("hidden", type !== "monthly");
    $("#dash_quarter_wrap")?.classList.toggle("hidden", type !== "quarterly");
  }

  function destroyMini() {
    Object.keys(miniCharts).forEach((k) => {
      try { miniCharts[k].destroy(); } catch (_) {}
      delete miniCharts[k];
    });
  }

  function renderGauge(profit, gaugePct) {
    const canvas = $("#dash_gauge");
    if (!canvas || typeof Chart === "undefined") return;
    if (gaugeChart) {
      try { gaugeChart.destroy(); } catch (_) {}
      gaugeChart = null;
    }
    const pct = Math.max(0, Math.min(100, Number(gaugePct) || 0));
    const isDark = document.body?.getAttribute("data-theme") === "dark"
      || document.body?.getAttribute("data-theme") === "glass";
    const track = isDark ? "rgba(148,163,184,0.25)" : "#e2e8f0";
    gaugeChart = new Chart(canvas, {
      type: "doughnut",
      data: {
        datasets: [{
          data: [pct, 100 - pct],
          backgroundColor: ["#60a5fa", track],
          borderWidth: 0,
          circumference: 180,
          rotation: 270,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "72%",
        layout: { padding: { top: 0, bottom: 0, left: 4, right: 4 } },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    });
  }

  function renderMiniCharts(byPt, total) {
    destroyMini();
    if (typeof Chart === "undefined") return;
    const isDark = document.body?.getAttribute("data-theme") === "dark"
      || document.body?.getAttribute("data-theme") === "glass";
    const track = isDark ? "rgba(148,163,184,0.25)" : "#e2e8f0";
    const sum = Number(total) || 0;

    PT_KEYS.forEach((cfg) => {
      const amount = Number(byPt[cfg.key]) || 0;
      const elVal = $("#" + cfg.val);
      if (elVal) elVal.textContent = money(amount);
      const canvas = $("#" + cfg.canvas);
      if (!canvas) return;
      const pct = sum > 0 ? Math.max(0, Math.min(100, (amount / sum) * 100)) : 0;
      miniCharts[cfg.key] = new Chart(canvas, {
        type: "doughnut",
        data: {
          datasets: [{
            data: [pct || 0.0001, Math.max(0.0001, 100 - pct)],
            backgroundColor: [cfg.color, track],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          cutout: "68%",
          layout: { padding: 2 },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label(ctx) {
                  if (ctx.dataIndex !== 0) return "";
                  return `${cfg.label}: ${pct.toFixed(1)}%`;
                },
              },
            },
          },
        },
      });
    });
  }

  function render(data) {
    if ($("#dash_firm")) {
      $("#dash_firm").textContent = data.firmName
        ? `${data.firmName} · ${data.period_label || data.date || ""}`
        : data.period_label || data.date || "";
    }
    if ($("#dash_invoices")) $("#dash_invoices").textContent = money(data.by_invoices);
    if ($("#dash_checks")) $("#dash_checks").textContent = money(data.by_checks);
    if ($("#dash_profit")) $("#dash_profit").textContent = money(data.profit);
    const ch = data.changes || {};
    setDelta($("#dash_profit_pct"), ch.profit_pct);
    if ($("#dash_sales_count")) $("#dash_sales_count").textContent = String(data.sales_count ?? "—");
    setDelta($("#dash_sales_pct"), ch.sales_count_pct);
    if ($("#dash_avg_check")) $("#dash_avg_check").textContent = money(data.avg_check);
    setDelta($("#dash_avg_pct"), ch.avg_check_pct);
    if ($("#dash_total")) $("#dash_total").textContent = money(data.total_checks);
    setDelta($("#dash_total_pct"), ch.total_checks_pct);
    if ($("#dash_cash")) $("#dash_cash").textContent = money(data.cash_balance);

    const labels = data.payment_labels || {};
    const byPt = data.by_payment_type || {};
    const box = $("#dash_pay_types");
    if (box) {
      const keys = Object.keys(byPt).sort((a, b) => (byPt[b] || 0) - (byPt[a] || 0));
      if (!keys.length) {
        box.innerHTML = `<span class="hint">Нет данных за период</span>`;
      } else {
        box.innerHTML = keys
          .map(
            (k) =>
              `<div class="dash-pay-item"><span>${escapeHtml(labels[k] || k)}</span><strong>${money(
                byPt[k]
              )}</strong></div>`
          )
          .join("");
      }
    }

    renderGauge(data.profit, data.gauge_pct);
    renderMiniCharts(byPt, data.total_checks);
  }

  async function load() {
    const type = $("#dash_period")?.value || "daily";
    const qs = new URLSearchParams({ period: type });
    if (type === "daily" || type === "weekly") {
      const d = $("#dash_date")?.value || todayISO();
      qs.set("date", d);
    } else {
      qs.set("year", $("#dash_year")?.value || new Date().getFullYear());
      if (type === "monthly") qs.set("month", $("#dash_month")?.value || new Date().getMonth() + 1);
      if (type === "quarterly") {
        const q = $("#dash_quarter")?.value || Math.floor(new Date().getMonth() / 3) + 1;
        qs.set("quarter", q);
      }
    }
    try {
      const data = await api("/dashboard/summary?" + qs.toString());
      render(data);
    } catch (e) {
      alert(e.message || String(e), "error");
    }
  }

  function initDefaults() {
    const now = new Date();
    if ($("#dash_date") && !$("#dash_date").value) $("#dash_date").value = todayISO();
    if ($("#dash_year") && !$("#dash_year").value) $("#dash_year").value = String(now.getFullYear());
    if ($("#dash_month") && !$("#dash_month").value) $("#dash_month").value = String(now.getMonth() + 1);
    if ($("#dash_quarter") && !$("#dash_quarter").value) {
      $("#dash_quarter").value = String(Math.floor(now.getMonth() / 3) + 1);
    }
    syncFilterVisibility();
  }

  function bind() {
    initDefaults();
    $("#dash_refresh")?.addEventListener("click", load);
    $("#dash_period")?.addEventListener("change", () => {
      syncFilterVisibility();
      load();
    });
    ["dash_date", "dash_year", "dash_month", "dash_quarter"].forEach((id) => {
      $("#" + id)?.addEventListener("change", load);
    });
    document.querySelectorAll("[data-dash-tab]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        const tab = el.getAttribute("data-dash-tab");
        if (tab && window.EKLK && typeof window.EKLK.showTab === "function") {
          window.EKLK.showTab(tab, true);
        } else if (tab) {
          location.href = "/" + tab;
        }
      });
    });
  }

  window.EKLK_HOME = {
    onShow() {
      if (!bound) {
        bind();
        bound = true;
      } else {
        syncFilterVisibility();
      }
      load();
    },
  };
})();
