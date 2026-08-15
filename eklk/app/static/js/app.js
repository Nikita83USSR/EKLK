(() => {
  const API = "/api/v1";
  let token = localStorage.getItem("eklk_token") || "";
  let paymentTypes = [];
  let groupCode = localStorage.getItem("eklk_group") || "990";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const VAT_OPTS = `
    <option value="none">Без НДС</option>
    <option value="vat0">НДС 0%</option>
    <option value="vat10">НДС 10%</option>
    <option value="vat20" selected>НДС 20%</option>
    <option value="vat110">НДС 10/110</option>
    <option value="vat120">НДС 20/120</option>`;

  const OBJECT_OPTS = `
    <option value="1">Товар</option>
    <option value="3">Услуга</option>
    <option value="4">Работа</option>
    <option value="10">Платёж</option>
    <option value="11">Агентское вознаграждение</option>
    <option value="12">Составной предмет расчёта</option>
    <option value="13">Иной предмет расчёта</option>`;

  const METHOD_OPTS = `
    <option value="full_payment">Полный расчёт</option>
    <option value="full_prepayment">Предоплата 100%</option>
    <option value="prepayment">Предоплата</option>
    <option value="advance">Аванс</option>
    <option value="partial_payment">Частичный расчёт</option>
    <option value="credit">Передача в кредит</option>
    <option value="credit_payment">Оплата кредита</option>`;

  const FISCAL_PAY = `
    <option value="1">Наличными</option>
    <option value="2">Безналичными</option>
    <option value="14">Предоплата (зачёт аванса)</option>
    <option value="15">Постоплата (кредит)</option>
    <option value="16">Встречное предоставление</option>`;

  const OP_LABELS = {
    sell: "Приход",
    sell_refund: "Возврат прихода",
    buy: "Расход",
    buy_refund: "Возврат расхода",
  };
  const SNO_LABELS = {
    osn: "ОСН",
    usn_income: "УСН доходы",
    usn_income_outcome: "УСН доходы-расходы",
    esn: "ЕСН",
    patent: "Патент",
  };

  function showAlert(msg, type = "error") {
    const el = $("#globalAlert");
    el.className = `alert alert-${type}`;
    el.textContent = msg;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 7000);
  }

  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(API + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      logout(false);
      throw new Error(data.detail || "Сессия истекла. Войдите снова.");
    }
    if (!res.ok) {
      const d = data.detail;
      const msg = typeof d === "string" ? d : d?.message || JSON.stringify(d) || res.statusText;
      throw new Error(msg);
    }
    return data;
  }

  function logout(clearStorage = true) {
    token = "";
    if (clearStorage) localStorage.removeItem("eklk_token");
    $("#appScreen").classList.add("hidden");
    $("#loginScreen").classList.remove("hidden");
  }

  function money(n) {
    return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  }

  function itemRowHtml() {
    return `<tr class="item-row">
      <td><input class="it-name" placeholder="Товар или услуга" value="Товар" /></td>
      <td><input class="it-price" type="number" step="0.01" min="0" value="0.00" /></td>
      <td><input class="it-qty" type="number" step="0.001" min="0.001" value="1.000" /></td>
      <td><select class="it-vat">${VAT_OPTS}</select></td>
      <td><select class="it-object">${OBJECT_OPTS}</select></td>
      <td><select class="it-method">${METHOD_OPTS}</select></td>
      <td><button type="button" class="btn btn-secondary btn-sm it-rm">🗑</button></td>
    </tr>`;
  }

  function payRowHtml(fiscal = true) {
    const opts = fiscal ? FISCAL_PAY : "";
    return `<div class="pay-row">
      <div>
        <label>Вид оплаты</label>
        <select class="pay-type">${opts}</select>
      </div>
      <div>
        <label>Сумма, руб</label>
        <input class="pay-sum" type="number" step="0.01" min="0" value="0.00" />
      </div>
      <div>
        <label>&nbsp;</label>
        <button type="button" class="btn btn-danger btn-sm pay-rm">×</button>
      </div>
    </div>`;
  }

  function bindItemTable(tbodyId, onChange) {
    const tb = $(`#${tbodyId}`);
    tb.querySelectorAll(".it-rm").forEach((btn) => {
      btn.onclick = () => {
        if (tb.querySelectorAll(".item-row").length > 1) {
          btn.closest("tr").remove();
          onChange && onChange();
        }
      };
    });
    tb.querySelectorAll("input, select").forEach((el) => {
      el.oninput = el.onchange = () => onChange && onChange();
    });
  }

  function collectItems(tbodyId) {
    return $$(`#${tbodyId} .item-row`).map((row) => {
      const price = parseFloat(row.querySelector(".it-price").value) || 0;
      const quantity = parseFloat(row.querySelector(".it-qty").value) || 1;
      return {
        name: (row.querySelector(".it-name").value || "").trim() || "Товар",
        price,
        quantity,
        sum: Math.round(price * quantity * 100) / 100,
        vat_type: row.querySelector(".it-vat").value,
        payment_object: parseInt(row.querySelector(".it-object").value, 10) || 1,
        payment_method: row.querySelector(".it-method").value,
      };
    });
  }

  function itemsSum(tbodyId) {
    return collectItems(tbodyId).reduce((s, i) => s + i.sum, 0);
  }

  function ensureItem(tbodyId, onChange) {
    const tb = $(`#${tbodyId}`);
    if (!tb.querySelector(".item-row")) {
      tb.insertAdjacentHTML("beforeend", itemRowHtml());
      bindItemTable(tbodyId, onChange);
    }
  }

  // ---- Summary ----
  function updateCreateSummary() {
    const total = itemsSum("c_items");
    const email = $("#c_email").value || "—";
    const op = $("#c_operation").value;
    const sno = $("#c_sno").value;
    $("#sum_shop").textContent = `ID ${groupCode}`;
    $("#sum_op").textContent = OP_LABELS[op] || op;
    $("#sum_sno").textContent = SNO_LABELS[sno] || sno;
    $("#sum_email").textContent = email;
    $("#sum_items").textContent = String($$("#c_items .item-row").length);
    $("#sum_pay").textContent = money(total) + " ₽";
    $("#sum_total").textContent = money(total) + " ₽";
    $("#c_payHint").textContent = "Автоподсчёт суммы товарных позиций: " + money(total);
    $("#c_total").value = money(total);

    // Sync first payment sum if only one
    const pays = $$("#c_payments .pay-row");
    if (pays.length === 1) {
      pays[0].querySelector(".pay-sum").value = money(total);
    }

    const warn = $("#sum_warn");
    const issues = [];
    if (!$("#c_email").value.trim()) issues.push("Укажите email покупателя");
    if (total <= 0) issues.push("Добавьте товары с ненулевой суммой");
    if (issues.length) {
      warn.className = "warn-box error";
      warn.textContent = issues.join(". ");
    } else {
      warn.className = "warn-box";
      warn.textContent = "✓ Ошибок нет";
    }
  }

  function updatePaySummary() {
    $("#p_sum_total").textContent = money(itemsSum("p_items")) + " ₽";
  }

  // ---- Auth ----
  async function afterLogin() {
    $("#loginScreen").classList.add("hidden");
    $("#appScreen").classList.remove("hidden");
    try {
      const me = await api("/auth/me");
      $("#userName").textContent = me.username || me.email || "";
      $("#c_shop").value = `Магазин ID ${groupCode}`;
    } catch (e) {
      showAlert(e.message);
    }
    await loadPaymentTypes();
    ensureItem("c_items", updateCreateSummary);
    ensureItem("p_items", updatePaySummary);
    ensureItem("r_items");
    if (!$("#c_payments .pay-row")) {
      $("#c_payments").insertAdjacentHTML("beforeend", payRowHtml(true));
      bindPays();
    }
    updateCreateSummary();
    updatePaySummary();
  }

  async function loadPaymentTypes() {
    try {
      const data = await api("/ecom/payment-types");
      paymentTypes = data.items || [];
      const sel = $("#p_type");
      const providers = paymentTypes.filter((t) => t.id >= 100);
      sel.innerHTML = providers.length
        ? providers.map((t) => `<option value="${t.id}">${t.id} — ${t.description}</option>`).join("")
        : `<option value="103">103 — Сбербанк</option>`;
    } catch (e) {
      $("#p_type").innerHTML = `<option value="103">103 — Сбербанк</option>`;
    }
  }

  function bindPays() {
    $$("#c_payments .pay-rm").forEach((btn) => {
      btn.onclick = () => {
        if ($$("#c_payments .pay-row").length > 1) {
          btn.closest(".pay-row").remove();
          updateCreateSummary();
        }
      };
    });
  }

  function renderResult(el, data) {
    el.classList.remove("hidden");
    const status = data.status || "—";
    let badge = "badge-wait";
    if (status === "done") badge = "badge-done";
    if (status === "fail") badge = "badge-fail";
    let html = `<div class="flex" style="margin-bottom:10px">
      <span class="badge ${badge}">${status}</span>
      <span class="badge badge-invoice">${data.kind || "—"}</span>
      ${data.uuid ? `<code style="color:var(--muted);font-size:0.85rem">${data.uuid}</code>` : ""}
    </div>`;
    if (data.invoice_payload?.link) {
      html += `<a class="link-pay" href="${data.invoice_payload.link}" target="_blank" rel="noopener">Открыть страницу оплаты →</a>`;
      html += `<p class="hint" style="margin-top:8px">provider: ${data.invoice_payload.provider || "—"}</p>`;
    }
    if (data.permalink) html += `<p class="mt-2"><a href="${data.permalink}" target="_blank">Permalink чека</a></p>`;
    if (data.payload) {
      html += `<p class="hint mt-2">ФД: ${data.payload.fiscal_document_number ?? "—"} · ФП: ${data.payload.fiscal_document_attribute ?? "—"} · сумма: ${data.payload.total ?? "—"}</p>`;
    }
    html += `<div class="result-box">${JSON.stringify(data.raw || data, null, 2)}</div>`;
    el.innerHTML = html;
  }

  // Events
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    $("#loginError").classList.add("hidden");
    try {
      groupCode = ($("#loginGroup").value || "990").trim();
      localStorage.setItem("eklk_group", groupCode);
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: $("#loginUser").value.trim(),
          password: $("#loginPass").value,
          group_code: groupCode,
        }),
      });
      token = data.access_token;
      localStorage.setItem("eklk_token", token);
      await afterLogin();
    } catch (err) {
      $("#loginError").textContent = err.message;
      $("#loginError").classList.remove("hidden");
    }
  };

  $("#logoutBtn").onclick = () => logout(true);

  $$(".nav button[data-tab]").forEach((btn) => {
    btn.onclick = () => {
      $$(".nav button[data-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
      $(`#tab-${btn.dataset.tab}`).classList.remove("hidden");
    };
  });

  $("#c_toggleExtra").onclick = () => {
    $("#c_extraBuyer").classList.toggle("hidden");
  };
  $("#c_addProp").onchange = () => {
    $("#c_addPropBox").classList.toggle("hidden", !$("#c_addProp").checked);
  };

  $("#c_addItem").onclick = () => {
    $("#c_items").insertAdjacentHTML("beforeend", itemRowHtml());
    bindItemTable("c_items", updateCreateSummary);
    updateCreateSummary();
  };
  $("#c_addPay").onclick = () => {
    $("#c_payments").insertAdjacentHTML("beforeend", payRowHtml(true));
    bindPays();
  };
  $("#p_addItem").onclick = () => {
    $("#p_items").insertAdjacentHTML("beforeend", itemRowHtml());
    bindItemTable("p_items", updatePaySummary);
    updatePaySummary();
  };
  $("#r_addItem").onclick = () => {
    $("#r_items").insertAdjacentHTML("beforeend", itemRowHtml());
    bindItemTable("r_items");
  };

  ["c_email", "c_operation", "c_sno"].forEach((id) => {
    const el = $("#" + id);
    if (el) el.oninput = el.onchange = updateCreateSummary;
  });

  $("#c_reset").onclick = () => {
    $("#c_result").classList.add("hidden");
    $("#c_email").value = "";
    updateCreateSummary();
  };

  $("#c_submit").onclick = async () => {
    const btn = $("#c_submit");
    btn.disabled = true;
    try {
      const items = collectItems("c_items");
      const total = items.reduce((s, i) => s + i.sum, 0);
      let payments = $$("#c_payments .pay-row").map((row) => ({
        type: parseInt(row.querySelector(".pay-type").value, 10),
        sum: parseFloat(row.querySelector(".pay-sum").value) || 0,
      }));
      if (!payments.length || payments.every((p) => p.sum <= 0)) {
        payments = [{ type: 1, sum: total }];
      }
      const body = {
        items,
        payments,
        client: {
          email: $("#c_email").value || undefined,
          name: $("#c_name").value || undefined,
          phone: $("#c_phone").value || undefined,
          inn: $("#c_inn").value || undefined,
        },
        sno: $("#c_sno").value,
      };
      // operation sell vs refund — refund goes to different endpoint
      const op = $("#c_operation").value;
      let data;
      if (op === "sell_refund") {
        data = await api("/ecom/refunds", { method: "POST", body: JSON.stringify(body) });
      } else {
        data = await api("/ecom/checks", { method: "POST", body: JSON.stringify(body) });
      }
      renderResult($("#c_result"), data);
      showAlert("Чек отправлен", "success");
    } catch (e) {
      showAlert(e.message);
    } finally {
      btn.disabled = false;
    }
  };

  $("#p_submit").onclick = async () => {
    const btn = $("#p_submit");
    btn.disabled = true;
    try {
      const items = collectItems("p_items");
      const total = items.reduce((s, i) => s + i.sum, 0);
      const body = {
        items,
        payments: [{ type: parseInt($("#p_type").value, 10), sum: total }],
        client: {
          email: $("#p_email").value || undefined,
          phone: $("#p_phone").value || undefined,
          name: $("#p_name").value || undefined,
        },
        sno: $("#p_sno").value,
        success_url: $("#p_success").value || undefined,
      };
      const data = await api("/ecom/checks", { method: "POST", body: JSON.stringify(body) });
      renderResult($("#p_result"), data);
      showAlert("Ссылка создана", "success");
    } catch (e) {
      showAlert(e.message);
    } finally {
      btn.disabled = false;
    }
  };

  $("#s_submit").onclick = async () => {
    const uuid = $("#s_uuid").value.trim();
    if (!uuid) return showAlert("Укажите UUID");
    try {
      renderResult($("#s_result"), await api(`/ecom/checks/${encodeURIComponent(uuid)}`));
    } catch (e) {
      showAlert(e.message);
    }
  };

  $("#r_submit").onclick = async () => {
    const btn = $("#r_submit");
    btn.disabled = true;
    try {
      const items = collectItems("r_items");
      const total = items.reduce((s, i) => s + i.sum, 0);
      const body = {
        items,
        payments: [{ type: 1, sum: total }],
        client: {
          email: $("#r_email").value || undefined,
          phone: $("#r_phone").value || undefined,
        },
        original_uuid: $("#r_orig").value || undefined,
      };
      renderResult($("#r_result"), await api("/ecom/refunds", { method: "POST", body: JSON.stringify(body) }));
      showAlert("Возврат создан", "success");
    } catch (e) {
      showAlert(e.message);
    } finally {
      btn.disabled = false;
    }
  };

  if (token) afterLogin().catch(() => logout(true));
})();
