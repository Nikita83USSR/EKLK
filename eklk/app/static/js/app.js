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

  /** Normalize phone in UI the same way as backend: +7XXXXXXXXXX */
  function normalizePhoneUI(phone) {
    if (!phone) return "";
    let d = String(phone).replace(/\D/g, "");
    if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
    if (d.length === 10 && d[0] === "9") d = "7" + d;
    if (d.length === 11 && d.startsWith("7")) return "+" + d;
    return null; // invalid
  }

  function paymentsSum(containerSel) {
    return $$(containerSel + " .pay-row").reduce((s, row) => {
      return s + (parseFloat(row.querySelector(".pay-sum").value) || 0);
    }, 0);
  }

  function setLoading(btn, loading, labelIdle, labelBusy) {
    if (!btn) return;
    btn.disabled = !!loading;
    btn.dataset.busy = loading ? "1" : "0";
    btn.textContent = loading ? (labelBusy || "Отправка…") : (labelIdle || btn.dataset.label || "Создать");
  }

  // Stable external_id per form attempt — retries return same check
  let lastExternalId = null;
  function nextExternalId(prefix) {
    lastExternalId = prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2, 10);
    return lastExternalId;
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

    const payTotal = paymentsSum("#c_payments");
    const warn = $("#sum_warn");
    const issues = [];
    if (!$("#c_email").value.trim()) issues.push("Укажите email покупателя");
    if (total <= 0) issues.push("Добавьте товары с ненулевой суммой");
    // Allow empty pay rows (auto-fill), but if user entered payments — must match
    const hasManualPay = $$("#c_payments .pay-row").some(
      (r) => (parseFloat(r.querySelector(".pay-sum").value) || 0) > 0
    );
    if (hasManualPay && Math.abs(payTotal - total) > 0.009) {
      issues.push(
        "Сумма оплат (" + money(payTotal) + ") ≠ сумме товаров (" + money(total) + "). Исправьте до отправки."
      );
    }
    const phoneRaw = ($("#c_phone") && $("#c_phone").value) || "";
    if (phoneRaw.trim()) {
      const norm = normalizePhoneUI(phoneRaw);
      if (!norm) {
        issues.push("Телефон должен быть вида +79001234567 (сейчас: «" + phoneRaw + "»)");
      }
    }
    if (issues.length) {
      warn.className = "warn-box error";
      warn.textContent = issues.join(" ");
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
    $$("#c_payments .pay-sum, #c_payments .pay-type").forEach((el) => {
      el.oninput = el.onchange = updateCreateSummary;
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

  /**
   * ФФД 1.2 / письмо ФНС:
   * - тег 1223 (данные агента) только для платёжных и банковских агентов
   * - supplier_info обязателен для ВСЕХ типов агента
   *
   * bank_paying_*  → paying + transfer (+ receive optional)
   * paying_*       → paying + receive
   * attorney / commission_agent / another → только supplier
   */
  const AGENT_UI = {
    bank_paying_agent:    { paying: true,  receive: false, transfer: true,  hint: "Банковский платёжный агент: операция, телефоны агента и данные оператора перевода + поставщик." },
    bank_paying_subagent: { paying: true,  receive: false, transfer: true,  hint: "Банковский платёжный субагент: операция, телефоны агента и данные оператора перевода + поставщик." },
    paying_agent:         { paying: true,  receive: true,  transfer: false, hint: "Платёжный агент: операция, телефоны агента и оператора по приёму платежей + поставщик." },
    paying_subagent:      { paying: true,  receive: true,  transfer: false, hint: "Платёжный субагент: операция, телефоны агента и оператора по приёму платежей + поставщик." },
    attorney:             { paying: false, receive: false, transfer: false, hint: "Поверенный: укажите только данные поставщика (принципала)." },
    commission_agent:     { paying: false, receive: false, transfer: false, hint: "Комиссионер: укажите только данные поставщика (комитента)." },
    another:              { paying: false, receive: false, transfer: false, hint: "Иной агент: укажите только данные поставщика." },
  };

  function syncAgentBox() {
    const on = document.querySelector('input[name="c_agent"]:checked')?.value === "1";
    $("#c_agentBox").classList.toggle("hidden", !on);
    if (on) syncAgentTypeFields();
  }

  function syncAgentTypeFields() {
    const type = ($("#c_agent_type") && $("#c_agent_type").value) || "another";
    const cfg = AGENT_UI[type] || AGENT_UI.another;
    $("#c_agent_paying").classList.toggle("hidden", !cfg.paying);
    $("#c_agent_receive").classList.toggle("hidden", !cfg.receive);
    $("#c_agent_transfer").classList.toggle("hidden", !cfg.transfer);
    if ($("#c_agent_hint")) $("#c_agent_hint").textContent = cfg.hint;
  }

  document.querySelectorAll('input[name="c_agent"]').forEach((r) => {
    r.addEventListener("change", syncAgentBox);
  });
  if ($("#c_agent_type")) {
    $("#c_agent_type").addEventListener("change", syncAgentTypeFields);
  }

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
    if (btn.dataset.busy === "1") return; // already sending
    btn.dataset.label = "Создать чек";

    const items = collectItems("c_items");
    const total = items.reduce((s, i) => s + i.sum, 0);
    let payments = $$("#c_payments .pay-row").map((row) => ({
      type: parseInt(row.querySelector(".pay-type").value, 10),
      sum: parseFloat(row.querySelector(".pay-sum").value) || 0,
    })).filter((p) => p.sum > 0);
    if (!payments.length) {
      payments = [{ type: 1, sum: total }];
    }

    // Pre-validate before API
    const issues = [];
    if (!$("#c_email").value.trim()) issues.push("Укажите email покупателя");
    if (total <= 0) issues.push("Сумма товаров должна быть больше 0");
    const payTotal = payments.reduce((s, p) => s + p.sum, 0);
    if (Math.abs(payTotal - total) > 0.009) {
      issues.push(
        "Сумма оплат (" + money(payTotal) + ") не равна сумме товаров (" + money(total) + ")"
      );
    }
    const phoneRaw = ($("#c_phone") && $("#c_phone").value.trim()) || "";
    let phoneNorm = undefined;
    if (phoneRaw) {
      phoneNorm = normalizePhoneUI(phoneRaw);
      if (!phoneNorm) {
        issues.push("Телефон: нужен формат +79001234567, сейчас «" + phoneRaw + "»");
      }
    }
    if (issues.length) {
      updateCreateSummary();
      showAlert(issues.join(". "));
      return;
    }

    setLoading(btn, true, "Создать чек", "Отправка на кассу…");
    try {
      // Same external_id on retry within this "attempt" after error? 
      // New attempt gets new id; double-click blocked by busy flag.
      const external_id = nextExternalId("EKLK");
      const body = {
        external_id,
        items,
        payments,
        client: {
          email: $("#c_email").value.trim() || undefined,
          name: ($("#c_name") && $("#c_name").value.trim()) || undefined,
          phone: phoneNorm,
          inn: ($("#c_inn") && $("#c_inn").value.trim()) || undefined,
        },
        sno: $("#c_sno").value,
      };

      // Additional user props (name + value)
      if ($("#c_addProp") && $("#c_addProp").checked) {
        const n = ($("#c_addPropName") && $("#c_addPropName").value.trim()) || "";
        const v = ($("#c_addPropVal") && $("#c_addPropVal").value.trim()) || "";
        if (!n || !v) {
          showAlert("Доп. реквизит: укажите и наименование, и значение");
          setLoading(btn, false, "Создать чек");
          return;
        }
        body.additional_user_props = { name: n, value: v };
      }

      // Agent — только релевантные поля по типу
      if (document.querySelector('input[name="c_agent"]:checked')?.value === "1") {
        const atype = $("#c_agent_type").value;
        const cfg = AGENT_UI[atype] || AGENT_UI.another;
        const supName = ($("#c_sup_name") && $("#c_sup_name").value.trim()) || "";
        const supInn = ($("#c_sup_inn") && $("#c_sup_inn").value.trim()) || "";
        const supPhones = ($("#c_sup_phones") && $("#c_sup_phones").value.trim()) || "";
        if (!supName || !supInn || !supPhones) {
          showAlert("Для агента обязательны: наименование, ИНН и телефон поставщика");
          setLoading(btn, false, "Создать чек");
          return;
        }
        body.agent = {
          type: atype,
          supplier_name: supName,
          supplier_inn: supInn,
          supplier_phones: supPhones,
        };
        if (cfg.paying) {
          body.agent.paying_operation = ($("#c_pa_op") && $("#c_pa_op").value.trim()) || undefined;
          body.agent.paying_phones = ($("#c_pa_phones") && $("#c_pa_phones").value.trim()) || undefined;
        }
        if (cfg.receive) {
          body.agent.receive_phones = ($("#c_recv_phones") && $("#c_recv_phones").value.trim()) || undefined;
        }
        if (cfg.transfer) {
          body.agent.transfer_name = ($("#c_mt_name") && $("#c_mt_name").value.trim()) || undefined;
          body.agent.transfer_address = ($("#c_mt_addr") && $("#c_mt_addr").value.trim()) || undefined;
          body.agent.transfer_inn = ($("#c_mt_inn") && $("#c_mt_inn").value.trim()) || undefined;
          body.agent.transfer_phones = ($("#c_mt_phones") && $("#c_mt_phones").value.trim()) || undefined;
        }
      }
      const op = $("#c_operation").value;
      let data;
      if (op === "sell_refund") {
        data = await api("/ecom/refunds", { method: "POST", body: JSON.stringify(body) });
      } else {
        data = await api("/ecom/checks", { method: "POST", body: JSON.stringify(body) });
      }
      renderResult($("#c_result"), data);
      showAlert("Чек принят кассой (uuid: " + (data.uuid || "—") + ")", "success");
      lastExternalId = null; // next create = new id
    } catch (e) {
      showAlert(e.message);
      // keep lastExternalId so user can retry same id if needed — actually we generate new each time
      // EcomKassa dedup is by external_id; busy flag already prevents triple-click
    } finally {
      setLoading(btn, false, "Создать чек");
    }
  };

  $("#p_submit").onclick = async () => {
    const btn = $("#p_submit");
    if (btn.dataset.busy === "1") return;
    const items = collectItems("p_items");
    const total = items.reduce((s, i) => s + i.sum, 0);
    if (total <= 0) return showAlert("Сумма товаров должна быть больше 0");
    const phoneRaw = ($("#p_phone") && $("#p_phone").value.trim()) || "";
    let phoneNorm = undefined;
    if (phoneRaw) {
      phoneNorm = normalizePhoneUI(phoneRaw);
      if (!phoneNorm) return showAlert("Телефон: нужен формат +79001234567");
    }
    setLoading(btn, true, "Создать ссылку", "Создание ссылки…");
    try {
      const body = {
        external_id: nextExternalId("PAY"),
        items,
        payments: [{ type: parseInt($("#p_type").value, 10), sum: total }],
        client: {
          email: $("#p_email").value || undefined,
          phone: phoneNorm,
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
      setLoading(btn, false, "Создать ссылку");
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
    if (btn.dataset.busy === "1") return;
    const items = collectItems("r_items");
    const total = items.reduce((s, i) => s + i.sum, 0);
    if (total <= 0) return showAlert("Сумма должна быть больше 0");
    const phoneRaw = ($("#r_phone") && $("#r_phone").value.trim()) || "";
    let phoneNorm = undefined;
    if (phoneRaw) {
      phoneNorm = normalizePhoneUI(phoneRaw);
      if (!phoneNorm) return showAlert("Телефон: нужен формат +79001234567");
    }
    setLoading(btn, true, "Создать возврат", "Отправка…");
    try {
      const body = {
        external_id: nextExternalId("REF"),
        items,
        payments: [{ type: 1, sum: total }],
        client: {
          email: $("#r_email").value || undefined,
          phone: phoneNorm,
        },
        original_uuid: $("#r_orig").value || undefined,
      };
      renderResult($("#r_result"), await api("/ecom/refunds", { method: "POST", body: JSON.stringify(body) }));
      showAlert("Возврат создан", "success");
    } catch (e) {
      showAlert(e.message);
    } finally {
      setLoading(btn, false, "Создать возврат");
    }
  };


  // Format phone fields on blur so user sees +7XXXXXXXXXX
  ["c_phone", "p_phone", "r_phone"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("blur", () => {
      const v = el.value.trim();
      if (!v) return;
      const n = normalizePhoneUI(v);
      if (n) el.value = n;
    });
  });

  if (token) afterLogin().catch(() => logout(true));
})();
