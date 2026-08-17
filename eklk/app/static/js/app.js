(() => {
  const API = "/api/v1";
  let token = localStorage.getItem("eklk_token") || "";
  let paymentTypes = [];
  let groupCode = localStorage.getItem("eklk_group") || "";
  let firmData = null; // { firm_id, firm_name, tax_identity, tax_variant, stores: [...] }
  let createAttempted = false; // contact error only after submit attempt

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const VAT_OPTS = `
    <option value="none" selected>Без НДС</option>
    <option value="vat0">НДС 0%</option>
    <option value="vat5">НДС 5%</option>
    <option value="vat7">НДС 7%</option>
    <option value="vat10">НДС 10%</option>
    <option value="vat22">НДС 22%</option>
    <option value="vat20">НДС 20% (старая)</option>
    <option value="vat105">НДС 5/105</option>
    <option value="vat107">НДС 7/107</option>
    <option value="vat110">НДС 10/110</option>
    <option value="vat122">НДС 22/122</option>
    <option value="vat120">НДС 20/120 (старая)</option>`;

  const OBJECT_OPTS = `
    <option value="1">Товар</option>
    <option value="4">Услуга</option>
    <option value="3">Работа</option>
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

  // Atol Online v5 / ФФД 1.2 measure (тег 2108). 0 = шт
  const MEASURE_OPTS = `
    <option value="0" selected>шт</option>
    <option value="10">г</option>
    <option value="11">кг</option>
    <option value="12">т</option>
    <option value="20">см</option>
    <option value="21">дм</option>
    <option value="22">м</option>
    <option value="40">мл</option>
    <option value="41">л</option>
    <option value="42">м³</option>
    <option value="50">кВт·ч</option>
    <option value="70">сутки</option>
    <option value="71">час</option>
    <option value="72">мин</option>
    <option value="255">иное</option>`;

  const FISCAL_PAY = `
    <option value="0">Наличными</option>
    <option value="1" selected>Безналичными</option>
    <option value="2">Предоплата (зачёт аванса)</option>
    <option value="3">Постоплата (кредит)</option>
    <option value="4">Встречное предоставление</option>`;

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
    if (!el) return;
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
    const detailMsg = (() => {
      const d = data && data.detail;
      if (typeof d === "string") return d;
      if (Array.isArray(d)) {
        return d.map((x) => (typeof x === "string" ? x : x.msg || x.message || JSON.stringify(x))).join("; ");
      }
      if (d && typeof d === "object") return d.message || d.msg || JSON.stringify(d);
      return data.error || data.message || res.statusText || "Ошибка запроса";
    })();
    // 401 on login itself must NOT call logout (no session yet)
    if (res.status === 401) {
      const isLogin = String(path).indexOf("/auth/login") !== -1;
      if (!isLogin) logout(false);
      throw new Error(detailMsg || "Сессия истекла. Войдите снова.");
    }
    if (!res.ok) {
      throw new Error(detailMsg);
    }
    return data;
  }

  function logout(clearStorage = true) {
    token = "";
    if (clearStorage) {
      localStorage.removeItem("eklk_token");
      // eklk_group (last store) intentionally kept across logout
    }
    if ($("#appScreen")) $("#appScreen").classList.add("hidden");
    if ($("#loginScreen")) $("#loginScreen").classList.remove("hidden");
    if ($("#appFooter")) $("#appFooter").classList.add("hidden");
  }

  function money(n) {
    return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  }

  function storesList() {
    return (firmData && firmData.stores) || [];
  }

  function getSelectedStoreId() {
    const fromLs = localStorage.getItem("eklk_group");
    const stores = storesList();
    if (fromLs && stores.some((s) => String(s.store_id) === String(fromLs))) return String(fromLs);
    if (groupCode && stores.some((s) => String(s.store_id) === String(groupCode))) return String(groupCode);
    if (stores.length) return String(stores[0].store_id);
    return fromLs || groupCode || "";
  }

  function setSelectedStoreId(id, persistServer) {
    groupCode = String(id);
    localStorage.setItem("eklk_group", groupCode);
    ["c_store", "p_store", "r_store"].forEach((sid) => {
      const el = document.getElementById(sid);
      if (el && String(el.value) !== groupCode) el.value = groupCode;
    });
    if ($("#sum_shop")) {
      const st = storesList().find((s) => String(s.store_id) === groupCode);
      $("#sum_shop").textContent = st
        ? `${st.store_name} (ID ${st.store_id})`
        : `ID ${groupCode}`;
    }
    if (persistServer && token) {
      api("/auth/select-store", {
        method: "POST",
        body: JSON.stringify({ store_id: id }),
      }).catch(() => {});
    }
  }

  function fillStoreSelects() {
    const stores = storesList();
    const selected = getSelectedStoreId();
    const opts = stores.length
      ? stores
          .map(
            (s) =>
              `<option value="${s.store_id}">${s.store_name} (ID ${s.store_id})</option>`
          )
          .join("")
      : `<option value="${selected || ""}">${selected ? "ID " + selected : "Нет магазинов"}</option>`;
    ["c_store", "p_store", "r_store"].forEach((sid) => {
      const el = document.getElementById(sid);
      if (!el) return;
      el.innerHTML = opts;
      if (selected) el.value = selected;
    });
    setSelectedStoreId(selected || groupCode, false);
  }

  function applyFirmToSettings() {
    if (!firmData) {
      ["set_firm_name", "set_firm_id", "set_firm_inn", "set_firm_sno"].forEach((id) => {
        if ($("#" + id)) $("#" + id).textContent = "—";
      });
      if ($("#set_stores_list")) $("#set_stores_list").innerHTML = "<p class=\"hint\">Нет данных</p>";
      return;
    }
    if ($("#set_firm_name")) $("#set_firm_name").textContent = firmData.firm_name || "—";
    if ($("#set_firm_id")) $("#set_firm_id").textContent = firmData.firm_id || "—";
    if ($("#set_firm_inn")) $("#set_firm_inn").textContent = firmData.tax_identity || "—";
    if ($("#set_firm_sno")) $("#set_firm_sno").textContent = firmData.tax_variant || "—";
    // Preselect SNO from firm if present
    if (firmData.tax_variant) {
      if ($("#c_sno")) $("#c_sno").value = firmData.tax_variant;
      if ($("#p_sno")) $("#p_sno").value = firmData.tax_variant;
    }
    const stores = storesList();
    const selected = getSelectedStoreId();
    if ($("#set_stores_list")) {
      if (!stores.length) {
        $("#set_stores_list").innerHTML = "<p class=\"hint\">Магазины не найдены</p>";
      } else {
        $("#set_stores_list").innerHTML = stores
          .map((s) => {
            const active = String(s.store_id) === String(selected);
            return `<div class="store-card ${active ? "active" : ""}" data-store-id="${s.store_id}">
              <div class="store-card-title">${s.store_name || "—"} ${active ? "<span class=\"badge badge-done\">текущий</span>" : ""}</div>
              <div class="store-card-meta">ID: <code>${s.store_id}</code></div>
              <div class="store-card-meta">${s.store_address || "—"}</div>
              ${active ? "" : `<button type="button" class="btn btn-sm mt-2 store-pick" data-store-id="${s.store_id}">Выбрать</button>`}
            </div>`;
          })
          .join("");
        $$("#set_stores_list .store-pick").forEach((btn) => {
          btn.onclick = () => {
            setSelectedStoreId(btn.dataset.storeId, true);
            applyFirmToSettings();
            fillStoreSelects();
            updateCreateSummary();
            showAlert("Магазин выбран: " + btn.dataset.storeId, "success");
          };
        });
      }
    }
  }

  function ingestFirm(firm, selectedStoreId) {
    if (firm) firmData = firm;
    const stores = (firmData && firmData.stores) || [];
    const pick = (id) => {
      if (id == null || id === "") return null;
      const sid = String(id);
      if (!stores.length) return sid;
      return stores.some((s) => String(s.store_id) === sid) ? sid : null;
    };
    let chosen =
      pick(selectedStoreId) ||
      pick(localStorage.getItem("eklk_group")) ||
      pick(groupCode) ||
      (stores.length ? String(stores[0].store_id) : "");
    if (chosen) {
      groupCode = chosen;
      localStorage.setItem("eklk_group", groupCode);
    }
    fillStoreSelects();
    applyFirmToSettings();
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

  // --- FFD 1.2 / Atol Online 5: payment_method × payment_object ---
  // 1105 = признак способа расчёта; UI must block bad combos before API.
  // object: 1 товар, 3 услуга, 4 работа, 10 платёж, 11 агент.вознагр., 12 составной, 13 иной
  const OBJECT_BY_METHOD = {
    // FFD 1.2: 1=товар, 3=работа, 4=услуга, 10=платёж, ...
    full_payment:     [1, 3, 4, 10, 11, 12, 13],
    full_prepayment:  [1, 3, 4, 10, 11, 12, 13], // предоплата 100% — как полный расчёт
    prepayment:       [10, 12, 13],
    advance:          [10, 13],              // аванс — платёж
    partial_payment:  [1, 3, 4, 10, 11, 12, 13],
    credit:           [1, 3, 4, 10, 12, 13],
    credit_payment:   [10, 13],
  };
  const OBJECT_LABELS = {
    1: "Товар", 3: "Работа", 4: "Услуга", 10: "Платёж",
    11: "Агентское вознаграждение", 12: "Составной предмет", 13: "Иной предмет",
  };
  const METHOD_LABELS = {
    full_payment: "Полный расчёт",
    full_prepayment: "Предоплата 100%",
    prepayment: "Предоплата",
    advance: "Аванс",
    partial_payment: "Частичный расчёт",
    credit: "Передача в кредит",
    credit_payment: "Оплата кредита",
  };

  /** Rebuild .it-object options for a row based on .it-method */
  function syncObjectOptionsForRow(row) {
    if (!row) return;
    const methodEl = row.querySelector(".it-method");
    const objectEl = row.querySelector(".it-object");
    if (!methodEl || !objectEl) return;
    const method = methodEl.value || "full_payment";
    const allowed = OBJECT_BY_METHOD[method] || OBJECT_BY_METHOD.full_payment;
    let cur = parseInt(objectEl.value, 10);
    if (!allowed.includes(cur)) cur = allowed[0];
    objectEl.innerHTML = allowed
      .map((o) => `<option value="${o}" ${o === cur ? "selected" : ""}>${OBJECT_LABELS[o] || o}</option>`)
      .join("");
    markField(objectEl, true);
    markField(methodEl, true);
  }

  function syncAllItemConstraints(tbodyId) {
    $$(`#${tbodyId} .item-row`).forEach(syncObjectOptionsForRow);
  }

  /** Returns list of human issues for create-check form */
  function validateCreateCombinations() {
    const issues = [];
    $$("#c_items .item-row").forEach((row, idx) => {
      const n = idx + 1;
      const method = (row.querySelector(".it-method") && row.querySelector(".it-method").value) || "";
      const objectEl = row.querySelector(".it-object");
      const obj = objectEl ? parseInt(objectEl.value, 10) : 1;
      const allowed = OBJECT_BY_METHOD[method] || OBJECT_BY_METHOD.full_payment;
      if (!allowed.includes(obj)) {
        const msg =
          `Позиция ${n}: способ «${METHOD_LABELS[method] || method}» несовместим с предметом «${OBJECT_LABELS[obj] || obj}». ` +
          `Допустимо: ${allowed.map((o) => OBJECT_LABELS[o] || o).join(", ")}.`;
        issues.push(msg);
        markField(objectEl, false, msg);
        markField(row.querySelector(".it-method"), false, msg);
      } else {
        markField(objectEl, true);
        markField(row.querySelector(".it-method"), true);
      }
      const price = parseFloat(row.querySelector(".it-price").value) || 0;
      const qty = parseFloat(row.querySelector(".it-qty").value) || 0;
      if (price < 0 || qty <= 0) {
        issues.push(`Позиция ${n}: цена и количество должны быть > 0`);
      }
    });
    // payments sum vs items
    const total = itemsSum("c_items");
    const payTotal = paymentsSum("#c_payments");
    if (Math.abs(total - payTotal) > 0.009) {
      issues.push(
        `Сумма оплат (${money(payTotal)} ₽) не равна сумме позиций (${money(total)} ₽)`
      );
    }
    // advance/prepayment often requires payment type 2 when settling advance — soft hint only for pure advance items
    const allAdvance = $$("#c_items .item-row").every((row) => {
      const m = row.querySelector(".it-method");
      return m && ["advance", "full_prepayment", "prepayment"].includes(m.value);
    });
    if (allAdvance && $$("#c_items .item-row").length) {
      // ok
    }
    return issues;
  }

  function friendlyApiError(msg) {
    const s = String(msg || "");
    if (/1105|способа расч|payment_method|признак способа/i.test(s)) {
      return {
        main: "Некорректные параметры расчёта. Выбранный способ расчёта несовместим с предметом расчёта. Измените один из параметров.",
        detail: s,
      };
    }
    if (/120\s*:/i.test(s)) {
      return {
        main: "Касса отклонила чек: некорректные реквизиты. Проверьте способ и предмет расчёта, оплаты и СНО.",
        detail: s,
      };
    }
    return { main: s, detail: "" };
  }

  // Clone-from-order state
  let sourceDocumentId = null; // orderId of source when «Редактировать»
  let sourceExternalId = null;

  function setCloneBanner() {
    let el = $("#cloneBanner");
    if (!sourceDocumentId) {
      if (el) el.classList.add("hidden");
      return;
    }
    if (!el) {
      const formHint = $("#tab-create .card");
      if (formHint) {
        el = document.createElement("div");
        el.id = "cloneBanner";
        el.className = "clone-banner";
        formHint.parentNode.insertBefore(el, formHint);
      }
    }
    if (el) {
      el.classList.remove("hidden");
      el.innerHTML =
        `<strong>Новый документ на основе чека № ${sourceDocumentId}</strong>` +
        (sourceExternalId ? ` <span class="hint">(исх. external_id: ${sourceExternalId})</span>` : "") +
        ` · исходный чек не изменится · будет новый external_id` +
        ` <button type="button" class="btn btn-secondary btn-sm" id="cloneCancelBtn">Сбросить</button>`;
      const btn = $("#cloneCancelBtn");
      if (btn) {
        btn.onclick = () => {
          sourceDocumentId = null;
          sourceExternalId = null;
          setCloneBanner();
        };
      }
    }
  }

  function mapAtolVat(v) {
    if (!v) return "none";
    if (typeof v === "string") return v;
    if (v.type) return v.type;
    return "none";
  }

  function mapAtolMethod(m) {
    if (!m) return "full_payment";
    const s = String(m).toLowerCase();
    if (METHOD_LABELS[s]) return s;
    // numeric legacy
    const map = {
      "1": "full_prepayment",
      "2": "prepayment",
      "3": "advance",
      "4": "full_payment",
      "5": "partial_payment",
      "6": "credit",
      "7": "credit_payment",
    };
    return map[s] || "full_payment";
  }

  function fillCreateFormFromOrder(detail) {
    const atol = detail.atol5 || {};
    // Atol5 may be {receipt: {...}} or the receipt itself
    const receipt = atol.receipt || atol;
    const summary = detail.summary || {};
    sourceDocumentId = summary.order_id || ordersSelectedId;
    sourceExternalId = summary.external_id || null;
    lastExternalId = null; // force new id on submit

    // Operation: sale -> sell, refund heuristics
    let op = "sell";
    if (summary.is_sale === false || /refund|возврат/i.test(String(summary.order_type || ""))) {
      op = "sell_refund";
    }
    // atol operation
    if (receipt.operation) {
      const o = String(receipt.operation).toLowerCase();
      if (["sell", "sell_refund", "buy", "buy_refund"].includes(o)) op = o;
    }
    if ($("#c_operation")) $("#c_operation").value = op;

    // SNO
    const sno = (receipt.company && receipt.company.sno) || (firmData && firmData.tax_variant) || "osn";
    if ($("#c_sno") && [...$("#c_sno").options].some((o) => o.value === sno)) {
      $("#c_sno").value = sno;
    }

    // Store
    if (summary.store_id) setSelectedStoreId(summary.store_id, true);

    // Client
    const client = receipt.client || {};
    if ($("#c_email")) $("#c_email").value = client.email || "";
    if ($("#c_phone")) $("#c_phone").value = client.phone || "";
    if (client.name && $("#c_name")) {
      $("#c_extraBuyer") && $("#c_extraBuyer").classList.remove("hidden");
      $("#c_name").value = client.name;
    }
    if (client.inn && $("#c_inn")) {
      $("#c_extraBuyer") && $("#c_extraBuyer").classList.remove("hidden");
      $("#c_inn").value = client.inn;
    }

    // Items
    const items = receipt.items || [];
    const tb = $("#c_items");
    if (tb) {
      tb.innerHTML = "";
      if (!items.length) {
        tb.insertAdjacentHTML("beforeend", itemRowHtml());
      } else {
        items.forEach((it) => {
          tb.insertAdjacentHTML("beforeend", itemRowHtml());
          const row = tb.querySelector(".item-row:last-child");
          if (!row) return;
          const name = it.name || it.text || "Товар";
          const price = it.price != null ? it.price : 0;
          const qty = it.quantity != null ? it.quantity : 1;
          row.querySelector(".it-name").value = name;
          row.querySelector(".it-price").value = money(price);
          row.querySelector(".it-qty").value = qty;
          const measEl = row.querySelector(".it-measure");
          if (measEl && it.measure != null) {
            const mv = String(it.measure);
            if ([...measEl.options].some((o) => o.value === mv)) measEl.value = mv;
          }
          const vat = mapAtolVat(it.vat || it.vat_type);
          const vatEl = row.querySelector(".it-vat");
          if (vatEl && [...vatEl.options].some((o) => o.value === vat)) vatEl.value = vat;
          const method = mapAtolMethod(it.payment_method);
          row.querySelector(".it-method").value = method;
          // Сначала ограничиваем допустимые предметы, затем ставим значение
          syncObjectOptionsForRow(row);
          let obj = parseInt(it.payment_object, 10);
          if (isNaN(obj)) obj = 1;
          const objEl = row.querySelector(".it-object");
          if (objEl && [...objEl.options].some((o) => parseInt(o.value, 10) === obj)) {
            objEl.value = String(obj);
          }
          // Агентская позиция
          const agentCb = row.querySelector(".it-agent");
          if (agentCb && (it.agent_info || it.supplier_info || it.is_agent)) {
            agentCb.checked = true;
          }
        });
      }
      bindItemTable("c_items", updateCreateSummary);
      syncAllItemConstraints("c_items");
      syncAgentBoxFromItems();
    }

    // Агентские реквизиты — берём из первой позиции с agent_info / supplier_info
    const agentSrc = (receipt.items || []).find((it) => it.agent_info || it.supplier_info);
    if (agentSrc) {
      const ai = agentSrc.agent_info || {};
      const si = agentSrc.supplier_info || {};
      if ($("#c_agent_type") && ai.type) {
        const tEl = $("#c_agent_type");
        if ([...tEl.options].some((o) => o.value === ai.type)) tEl.value = ai.type;
      }
      if ($("#c_sup_name") && si.name) $("#c_sup_name").value = si.name;
      if ($("#c_sup_inn") && si.inn) $("#c_sup_inn").value = String(si.inn);
      if ($("#c_sup_phones") && si.phones) {
        $("#c_sup_phones").value = Array.isArray(si.phones) ? si.phones.join(", ") : String(si.phones);
      }
      const pa = ai.paying_agent || {};
      if ($("#c_pa_op") && pa.operation) $("#c_pa_op").value = pa.operation;
      if ($("#c_pa_phones") && pa.phones) {
        $("#c_pa_phones").value = Array.isArray(pa.phones) ? pa.phones.join(", ") : String(pa.phones);
      }
      const recv = ai.receive_payments_operator || {};
      if ($("#c_recv_phones") && recv.phones) {
        $("#c_recv_phones").value = Array.isArray(recv.phones) ? recv.phones.join(", ") : String(recv.phones);
      }
      const mt = ai.money_transfer_operator || {};
      if ($("#c_mt_name") && mt.name) $("#c_mt_name").value = mt.name;
      if ($("#c_mt_addr") && mt.address) $("#c_mt_addr").value = mt.address;
      if ($("#c_mt_inn") && mt.inn) $("#c_mt_inn").value = String(mt.inn);
      if ($("#c_mt_phones") && mt.phones) {
        $("#c_mt_phones").value = Array.isArray(mt.phones) ? mt.phones.join(", ") : String(mt.phones);
      }
      if (typeof syncAgentTypeFields === "function") syncAgentTypeFields();
    }

    // Доп. реквизит пользователя (1084)
    const aup = receipt.additional_user_props;
    if (aup && aup.name && aup.value) {
      if ($("#c_addProp")) $("#c_addProp").checked = true;
      if ($("#c_addPropBox")) $("#c_addPropBox").classList.remove("hidden");
      if ($("#c_addPropName")) $("#c_addPropName").value = aup.name;
      if ($("#c_addPropVal")) $("#c_addPropVal").value = aup.value;
    }

    // Payments
    const pays = receipt.payments || [];
    const payBox = $("#c_payments");
    if (payBox) {
      payBox.innerHTML = "";
      if (!pays.length) {
        payBox.insertAdjacentHTML("beforeend", payRowHtml(true));
      } else {
        pays.forEach((p) => {
          payBox.insertAdjacentHTML("beforeend", payRowHtml(true));
          const row = payBox.querySelector(".pay-row:last-child");
          if (!row) return;
          let t = parseInt(p.type, 10);
          // map legacy UI values if any
          if (t === 14) t = 2;
          if (t === 15) t = 3;
          if (t === 16) t = 4;
          if (![0, 1, 2, 3, 4].includes(t)) t = 1;
          row.querySelector(".pay-type").value = String(t);
          row.querySelector(".pay-sum").value = money(p.sum != null ? p.sum : 0);
        });
      }
      bindPays();
    }

    setCloneBanner();
    updateCreateSummary();
    // switch to create tab
    $$(".nav button[data-tab]").forEach((b) => b.classList.remove("active"));
    const tabBtn = document.querySelector('.nav button[data-tab="create"]');
    if (tabBtn) tabBtn.classList.add("active");
    $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
    if ($("#tab-create")) $("#tab-create").classList.remove("hidden");
    showAlert(
      "Форма заполнена из чека № " + sourceDocumentId + ". Исходный документ не изменится — будет создан новый.",
      "success"
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function editOrderAsNew(orderId) {
    try {
      const data = await api("/orders/" + encodeURIComponent(orderId));
      if (!data.atol5 && !data.raw_summary) {
        showAlert("Не удалось загрузить состав чека для редактирования");
        return;
      }
      fillCreateFormFromOrder(data);
    } catch (e) {
      const f = friendlyApiError(e.message);
      showAlert(f.main + (f.detail ? " — " + f.detail : ""));
    }
  }

  let lastExternalId = null;
  function nextExternalId(prefix) {
    lastExternalId = prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2, 10);
    return lastExternalId;
  }

  // --- Strict fiscal field helpers ---
  function markField(el, ok, msg) {
    if (!el) return;
    el.classList.toggle("invalid", !ok);
    el.title = ok ? "" : (msg || "Некорректное значение");
  }

  function validateInnValue(raw) {
    if (!raw || !String(raw).trim()) return { ok: false, digits: "", msg: "ИНН обязателен" };
    const digits = String(raw).replace(/\D/g, "");
    if (digits.length === 10 || digits.length === 12) return { ok: true, digits, msg: "" };
    return {
      ok: false,
      digits,
      msg: "ИНН: ровно 10 (юрлицо) или 12 (ИП) цифр, сейчас " + digits.length,
    };
  }

  // Phones: normalize on blur; red if cannot normalize
  ["c_phone", "p_phone", "r_phone", "c_sup_phones", "c_pa_phones", "c_recv_phones", "c_mt_phones"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("blur", () => {
      const v = el.value.trim();
      if (!v) {
        markField(el, true);
        return;
      }
      const n = normalizePhoneUI(v);
      if (n) {
        el.value = n;
        markField(el, true);
      } else {
        markField(el, false, "Нужен формат +79001234567");
      }
    });
    el.addEventListener("input", () => {
      // clear error while typing
      if (el.classList.contains("invalid") && el.value.trim()) {
        const n = normalizePhoneUI(el.value);
        if (n) markField(el, true);
      }
    });
  });

  // INN: only digits, length 10 or 12 — live check
  ["c_inn", "c_sup_inn", "c_mt_inn"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute("inputmode", "numeric");
    el.setAttribute("maxlength", "12");
    el.addEventListener("input", () => {
      // strip non-digits immediately
      const cleaned = el.value.replace(/\D/g, "").slice(0, 12);
      if (el.value !== cleaned) el.value = cleaned;
      if (!cleaned) {
        markField(el, true);
        return;
      }
      const r = validateInnValue(cleaned);
      markField(el, r.ok, r.msg);
    });
    el.addEventListener("blur", () => {
      const r = validateInnValue(el.value);
      if (el.value.trim()) markField(el, r.ok, r.msg);
    });
  });



  function itemRowHtml() {
    return `<tr class="item-row">
      <td><input class="it-name" placeholder="Товар или услуга" value="Товар" /></td>
      <td><input class="it-price" type="number" step="0.01" min="0" value="0.00" /></td>
      <td><input class="it-qty" type="number" step="0.001" min="0.001" value="1.000" /></td>
      <td><select class="it-measure">${MEASURE_OPTS}</select></td>
      <td><select class="it-vat">${VAT_OPTS}</select></td>
      <td><select class="it-object">${OBJECT_OPTS}</select></td>
      <td><select class="it-method">${METHOD_OPTS}</select></td>
      <td style="text-align:center"><input type="checkbox" class="it-agent" title="Агент по этой позиции" /></td>
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
          if (tbodyId === "c_items") syncAgentBoxFromItems();
        }
      };
    });
    tb.querySelectorAll("input, select").forEach((el) => {
      el.oninput = el.onchange = () => {
        if (el.classList.contains("it-method")) {
          syncObjectOptionsForRow(el.closest("tr"));
        }
        onChange && onChange();
        if (tbodyId === "c_items" && el.classList.contains("it-agent")) {
          syncAgentBoxFromItems();
        }
      };
    });
    // initial constraint sync
    tb.querySelectorAll(".item-row").forEach(syncObjectOptionsForRow);
  }

  function syncAgentBoxFromItems() {
    const on = anyItemAgent("c_items");
    $("#c_agentBox").classList.toggle("hidden", !on);
    if (on) syncAgentTypeFields();
    updateCreateSummary();
  }

  function collectItems(tbodyId) {
    return $$(`#${tbodyId} .item-row`).map((row) => {
      const price = parseFloat(row.querySelector(".it-price").value) || 0;
      const quantity = parseFloat(row.querySelector(".it-qty").value) || 1;
      const agentCb = row.querySelector(".it-agent");
      return {
        name: (row.querySelector(".it-name").value || "").trim() || "Товар",
        price,
        quantity,
        sum: Math.round(price * quantity * 100) / 100,
        vat_type: row.querySelector(".it-vat").value,
        measure: parseInt((row.querySelector(".it-measure") || {}).value, 10) || 0,
        payment_object: parseInt(row.querySelector(".it-object").value, 10) || 1,
        payment_method: row.querySelector(".it-method").value,
        is_agent: !!(agentCb && agentCb.checked),
      };
    });
  }

  function anyItemAgent(tbodyId) {
    return $$(`#${tbodyId} .item-row .it-agent`).some((cb) => cb.checked);
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
    const emailVal = ($("#c_email") && $("#c_email").value.trim()) || "";
    const phoneRaw = ($("#c_phone") && $("#c_phone").value.trim()) || "";
    const op = ($("#c_operation") && $("#c_operation").value) || "sell";
    const sno = ($("#c_sno") && $("#c_sno").value) || "osn";
    {
      const st = storesList().find((s) => String(s.store_id) === String(getSelectedStoreId()));
      if ($("#sum_shop"))
        $("#sum_shop").textContent = st
          ? `${st.store_name} (ID ${st.store_id})`
          : `ID ${getSelectedStoreId() || "—"}`;
    }
    if ($("#sum_op")) $("#sum_op").textContent = OP_LABELS[op] || op;
    if ($("#sum_sno")) $("#sum_sno").textContent = SNO_LABELS[sno] || sno;
    if ($("#sum_email")) $("#sum_email").textContent = emailVal || phoneRaw || "—";
    if ($("#sum_items")) $("#sum_items").textContent = String($$("#c_items .item-row").length);
    if ($("#sum_pay")) $("#sum_pay").textContent = money(total) + " ₽";
    if ($("#sum_total")) $("#sum_total").textContent = money(total) + " ₽";
    if ($("#c_payHint")) $("#c_payHint").textContent = "Автоподсчёт суммы товарных позиций: " + money(total);
    if ($("#c_total")) $("#c_total").value = money(total);

    const pays = $$("#c_payments .pay-row");
    if (pays.length === 1) {
      pays[0].querySelector(".pay-sum").value = money(total);
    }

    const payTotal = paymentsSum("#c_payments");
    const warn = $("#sum_warn");
    const issues = [];

    const hasContact = !!(emailVal || phoneRaw);
    // Показывать ошибку контакта только после попытки создания (createAttempted)
    if (!hasContact) {
      if (createAttempted) {
        issues.push("Укажите email или телефон покупателя");
        markField($("#c_email"), false, "Нужен email или телефон");
        markField($("#c_phone"), false, "Нужен email или телефон");
      } else {
        markField($("#c_email"), true);
        markField($("#c_phone"), true);
      }
    } else {
      if (emailVal && (emailVal.indexOf("@") < 1 || !emailVal.split("@")[1] || emailVal.split("@")[1].indexOf(".") < 0)) {
        issues.push("Некорректный email");
        markField($("#c_email"), false, "Некорректный email");
      } else {
        markField($("#c_email"), true);
      }
      if (phoneRaw) {
        const norm = normalizePhoneUI(phoneRaw);
        if (!norm) {
          issues.push("Телефон: формат +79001234567");
          markField($("#c_phone"), false, "Формат +79001234567");
        } else {
          markField($("#c_phone"), true);
        }
      } else {
        markField($("#c_phone"), true);
      }
    }

    if (total <= 0) issues.push("Добавьте товары с ненулевой суммой");

    const hasManualPay = $$("#c_payments .pay-row").some(
      (r) => (parseFloat(r.querySelector(".pay-sum").value) || 0) > 0
    );
    if (hasManualPay && Math.abs(payTotal - total) > 0.009) {
      issues.push(
        "Сумма оплат (" + money(payTotal) + ") ≠ сумме товаров (" + money(total) + ")"
      );
    }

    // Agent panel live
    if ($("#c_agentBox") && !$("#c_agentBox").classList.contains("hidden")) {
      const supInn = ($("#c_sup_inn") && $("#c_sup_inn").value.trim()) || "";
      const supPh = ($("#c_sup_phones") && $("#c_sup_phones").value.trim()) || "";
      const supName = ($("#c_sup_name") && $("#c_sup_name").value.trim()) || "";
      if (!supName) {
        issues.push("Наименование поставщика");
        markField($("#c_sup_name"), false);
      } else markField($("#c_sup_name"), true);
      const innR = validateInnValue(supInn);
      if (!innR.ok) {
        issues.push(innR.msg || "ИНН поставщика");
        markField($("#c_sup_inn"), false, innR.msg);
      } else markField($("#c_sup_inn"), true);
      if (!supPh) {
        issues.push("Телефон поставщика");
        markField($("#c_sup_phones"), false);
      } else if (!normalizePhoneUI(supPh)) {
        issues.push("Телефон поставщика: +79001234567");
        markField($("#c_sup_phones"), false);
      } else markField($("#c_sup_phones"), true);
    }

    // FFD combination rules (method × object, sums)
    try {
      const combo = validateCreateCombinations();
      issues.push(...combo);
    } catch (e) {
      console.warn("validateCreateCombinations", e);
    }

    if (issues.length) {
      warn.className = "warn-box error";
      warn.textContent = issues.join(". ");
      if ($("#c_submit")) $("#c_submit").disabled = true;
    } else {
      warn.className = "warn-box";
      warn.textContent = "✓ Ошибок нет";
      if ($("#c_submit") && $("#c_submit").dataset.busy !== "1") $("#c_submit").disabled = false;
    }
  }

  function updatePaySummary() {
    const total = itemsSum("p_items");
    $("#p_sum_total").textContent = money(total) + " ₽";
    const warn = $("#p_sum_warn");
    if (!warn) return;
    const issues = [];
    const em = ($("#p_email") && $("#p_email").value.trim()) || "";
    const ph = ($("#p_phone") && $("#p_phone").value.trim()) || "";
    if (!em && !ph) issues.push("Укажите email или телефон покупателя");
    if (total <= 0) issues.push("Добавьте товары с ненулевой суммой");
    if (issues.length) {
      warn.className = "warn-box error";
      warn.textContent = issues.join(". ");
    } else {
      warn.className = "warn-box";
      warn.textContent = "✓ Ошибок нет";
    }
  }

  // ---- Auth ----
  async function afterLogin(loginPayload) {
    if ($("#loginScreen")) $("#loginScreen").classList.add("hidden");
    if ($("#appScreen")) $("#appScreen").classList.remove("hidden");
    if ($("#appFooter")) $("#appFooter").classList.remove("hidden");
    try {
      if (loginPayload && loginPayload.firm) {
        // last store chosen by user wins over server default
        const preferred = localStorage.getItem("eklk_group") || loginPayload.selected_store_id;
        ingestFirm(loginPayload.firm, preferred);
      } else {
        const me = await api("/auth/me");
        if ($("#userName")) $("#userName").textContent = me.username || me.email || "";
        const preferred = localStorage.getItem("eklk_group") || me.selected_store_id;
        ingestFirm(me.firm, preferred);
      }
      const me2 = await api("/auth/me").catch(() => null);
      if (me2 && $("#userName")) $("#userName").textContent = me2.username || me2.email || "";
      await loadPaymentTypes();
      ensureItem("c_items", updateCreateSummary);
      ensureItem("p_items", updatePaySummary);
      if ($("#c_payments") && !$("#c_payments .pay-row")) {
        $("#c_payments").insertAdjacentHTML("beforeend", payRowHtml(true));
        bindPays();
      }
      ["c_store", "p_store"].forEach((sid) => {
        const el = document.getElementById(sid);
        if (!el) return;
        el.onchange = () => {
          setSelectedStoreId(el.value, true);
          updateCreateSummary();
        };
      });
      updateCreateSummary();
      updatePaySummary();
    } catch (e) {
      console.error("afterLogin", e);
      showAlert(e.message || String(e));
      throw e;
    }
  }

  async function loadPaymentTypes() {
    const sel = $("#p_type");
    try {
      const data = await api("/ecom/payment-types");
      paymentTypes = data.items || [];
      const providers = paymentTypes.filter((t) => t.id >= 100);
      if (sel) {
        sel.innerHTML = providers.length
          ? providers.map((t) => `<option value="${t.id}">${t.id} — ${t.description}</option>`).join("")
          : `<option value="103">103 — Сбербанк</option>`;
      }
    } catch (e) {
      if (sel) sel.innerHTML = `<option value="103">103 — Сбербанк</option>`;
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
    let html = `<div class="flex" style="margin-bottom:10px">
      ${statusBadge(data.status || "—")}
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
    const errEl = $("#loginError");
    if (errEl) errEl.classList.add("hidden");
    try {
      const userEl = $("#loginUser");
      const passEl = $("#loginPass");
      if (!userEl || !passEl) {
        throw new Error("Форма входа не загружена. Обновите страницу (Ctrl+F5).");
      }
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: (userEl.value || "").trim(),
          password: passEl.value || "",
        }),
      });
      token = data.access_token;
      localStorage.setItem("eklk_token", token);
      await afterLogin(data);
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || String(err);
        errEl.classList.remove("hidden");
      } else {
        alert(err.message || String(err));
      }
    }
  };

  $("#logoutBtn").onclick = () => logout(true);

  $$(".nav button[data-tab]").forEach((btn) => {
    btn.onclick = () => {
      $$(".nav button[data-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
      $(`#tab-${btn.dataset.tab}`).classList.remove("hidden");
      if (btn.dataset.tab === "orders") loadOrders();
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
    // legacy no-op; visibility from per-item checkboxes
    syncAgentBoxFromItems();
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
    $("#c_agent_type").addEventListener("change", () => {
      syncAgentTypeFields();
      updateCreateSummary();
    });
  }
  ["c_sup_name", "c_sup_inn", "c_sup_phones", "c_pa_op", "c_pa_phones", "c_recv_phones", "c_mt_name", "c_mt_addr", "c_mt_inn", "c_mt_phones"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", updateCreateSummary);
    el.addEventListener("blur", updateCreateSummary);
  });

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

  ["p_email", "p_phone"].forEach((id) => {
    const el = $("#" + id);
    if (el) el.oninput = el.onchange = updatePaySummary;
  });

  ["c_sup_name", "c_sup_inn", "c_sup_phones", "c_pa_phones", "c_recv_phones", "c_mt_phones", "c_mt_inn"].forEach((id) => {
    const el = $("#" + id);
    if (el) {
      el.addEventListener("input", updateCreateSummary);
      el.addEventListener("change", updateCreateSummary);
    }
  });

  ["c_email", "c_phone", "c_operation", "c_sno"].forEach((id) => {
    const el = $("#" + id);
    if (el) el.oninput = el.onchange = updateCreateSummary;
  });

  $("#c_reset").onclick = () => {
    $("#c_result").classList.add("hidden");
    $("#c_email").value = "";
    createAttempted = false;
    updateCreateSummary();
  };

  $("#c_submit").onclick = async () => {
    const btn = $("#c_submit");
    if (btn.dataset.busy === "1") return; // already sending
    btn.dataset.label = sourceDocumentId ? "Создать новый документ" : "Создать чек";

    createAttempted = true; // now show contact / required-field errors
    // Final UI validation before send
    updateCreateSummary();
    const comboIssues = validateCreateCombinations();
    const emailVal = ($("#c_email") && $("#c_email").value.trim()) || "";
    const phoneRaw = ($("#c_phone") && $("#c_phone").value.trim()) || "";
    if (!emailVal && !phoneRaw) {
      comboIssues.unshift("Укажите email или телефон покупателя");
    }
    if (comboIssues.length) {
      showAlert(comboIssues.join(" "));
      return;
    }

    if (sourceDocumentId) {
      const ok = window.confirm(
        "Будет создан новый документ. Исходный чек № " +
          sourceDocumentId +
          " останется без изменений.\n\nСоздать новый документ?"
      );
      if (!ok) return;
    }

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
    if (!$("#c_email").value.trim() && !($("#c_phone") && $("#c_phone").value.trim())) {
      issues.push("Укажите email или телефон покупателя");
    }
    if (total <= 0) issues.push("Сумма товаров должна быть больше 0");
    const payTotal = payments.reduce((s, p) => s + p.sum, 0);
    if (Math.abs(payTotal - total) > 0.009) {
      issues.push(
        "Сумма оплат (" + money(payTotal) + ") не равна сумме товаров (" + money(total) + ")"
      );
    }
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
      // Always new external_id (never reuse source)
      const external_id = nextExternalId(sourceDocumentId ? "EKLK-FROM-" + sourceDocumentId : "EKLK");
      const body = {
        external_id,
        source_document_id: sourceDocumentId ? String(sourceDocumentId) : undefined,
        items,
        payments,
        client: {
          email: $("#c_email").value.trim() || undefined,
          name: ($("#c_name") && $("#c_name").value.trim()) || undefined,
          phone: phoneNorm,
          inn: ($("#c_inn") && $("#c_inn").value.trim()) || undefined,
        },
        sno: $("#c_sno").value,
        group_code: String(($("#c_store") && $("#c_store").value) || getSelectedStoreId() || ""),
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

      // Agent — только если отмечен хотя бы на одной позиции
      if (items.some((it) => it.is_agent)) {
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
        const innCheck = validateInnValue(supInn);
        if (!innCheck.ok) {
          markField($("#c_sup_inn"), false, innCheck.msg);
          showAlert(innCheck.msg + " («" + supInn + "»)");
          setLoading(btn, false, "Создать чек");
          return;
        }
        const innDigits = innCheck.digits;
        const supPhoneNorm = normalizePhoneUI(supPhones);
        if (!supPhoneNorm) {
          markField($("#c_sup_phones"), false, "Нужен формат +79001234567");
          showAlert(
            "Телефон поставщика: нужен формат +79001234567. Сейчас: «" + supPhones + "»"
          );
          setLoading(btn, false, "Создать чек");
          return;
        }
        if ($("#c_sup_phones")) $("#c_sup_phones").value = supPhoneNorm;
        if ($("#c_sup_inn")) $("#c_sup_inn").value = innDigits;
        body.agent = {
          type: atype,
          supplier_name: supName,
          supplier_inn: innDigits,
          supplier_phones: supPhoneNorm,
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
      const srcNote = sourceDocumentId ? " (на основе № " + sourceDocumentId + ")" : "";
      showAlert("Чек принят кассой (uuid: " + (data.uuid || "—") + ")" + srcNote, "success");
      lastExternalId = null;
      sourceDocumentId = null;
      sourceExternalId = null;
      setCloneBanner();
    } catch (e) {
      const f = friendlyApiError(e.message);
      showAlert(f.main + (f.detail ? " Подробнее: " + f.detail : ""));
    } finally {
      setLoading(btn, false, sourceDocumentId ? "Создать новый документ" : "Создать чек");
    }
  };

  $("#p_submit").onclick = async () => {
    const btn = $("#p_submit");
    if (btn.dataset.busy === "1") return;
    const items = collectItems("p_items");
    const total = items.reduce((s, i) => s + i.sum, 0);
    if (total <= 0) return showAlert("Сумма товаров должна быть больше 0");
    const emailP = ($("#p_email") && $("#p_email").value.trim()) || "";
    const phoneRaw = ($("#p_phone") && $("#p_phone").value.trim()) || "";
    if (!emailP && !phoneRaw) {
      return showAlert("Укажите email или телефон покупателя (требование ФНС)");
    }
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
        group_code: String(($("#p_store") && $("#p_store").value) || getSelectedStoreId() || ""),
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




  // ---- Orders list ----
  let ordersOffset = 0;
  let ordersLimit = 30;
  let ordersSelectedId = null;

  function toIsoLocal(val) {
    if (!val) return undefined;
    // datetime-local -> ISO-ish UTC guess: treat as local, append Z-less; API wants ISO 8601
    // Convert: 2026-08-17T10:00 -> 2026-08-17T10:00:00Z (user enters as filter approx)
    if (val.length === 16) return val + ":00Z";
    return val;
  }

  // Статусы EcomKassa / Atol (fiscal + invoice) → русский UI
  const STATUS_LABELS = {
    // ожидание оплаты / обработки
    wait: "Ожидает",
    waiting: "Ожидает оплаты",
    pending: "Ожидает",
    created: "Создан",
    new: "Новый",
    draft: "Черновик",
    // в работе
    process: "В обработке",
    processing: "В обработке",
    in_progress: "В обработке",
    // оплата / фискализация
    paid: "Фискализация",
    payment: "Оплата",
    // успешное завершение
    done: "Завершён",
    completed: "Завершён",
    complete: "Завершён",
    success: "Успешно",
    ok: "Успешно",
    ready: "Готов",
    print: "Печать",
    printed: "Напечатан",
    // ошибки и отмены
    fail: "Ошибка",
    failed: "Ошибка",
    error: "Ошибка",
    canceled: "Отменён",
    cancelled: "Отменён",
    expired: "Истёк",
    timeout: "Истёк",
  };

  function statusBadge(st) {
    const raw = (st == null || st === "") ? "—" : String(st);
    const key = raw.toLowerCase().trim();
    const label = STATUS_LABELS[key] || raw;
    let tone = "wait";
    // зелёный — завершён / успешно
    if (["done", "completed", "complete", "ready", "printed", "success", "ok"].includes(key)) {
      tone = "done";
    }
    // синий — фискализация / оплачен
    else if (["paid", "payment"].includes(key)) {
      tone = "paid";
    }
    // красный — ошибки
    else if (["fail", "failed", "error", "canceled", "cancelled", "expired", "timeout"].includes(key)) {
      tone = "fail";
    }
    // жёлтый — ожидание / обработка
    else if (["wait", "waiting", "pending", "process", "processing", "in_progress", "created", "new", "draft"].includes(key)) {
      tone = "wait";
    }
    return `<span class="badge badge-status-${tone}" title="${raw}">${label}</span>`;
  }

  function typeLabel(t) {
    const map = {
      VCHR: "Чек",
      INVC: "Счёт на оплату",
      CORD: "Курьер",
      sell: "Приход",
      sell_refund: "Возврат прихода",
      buy: "Расход",
      buy_refund: "Возврат расхода",
    };
    return map[t] || t || "—";
  }

  function formatMoney(n) {
    if (n == null || n === "") return "—";
    return money(n) + " ₽";
  }

  function formatDt(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return iso;
    }
  }

  async function loadOrders() {
    const list = $("#o_list");
    if (!list) return;
    list.innerHTML = `<p class="hint">Загрузка…</p>`;
    ordersLimit = parseInt(($("#o_limit") && $("#o_limit").value) || "30", 10);
    const body = {
      offset: ordersOffset,
      limit: ordersLimit,
    };
    const ext = ($("#o_ext") && $("#o_ext").value.trim()) || "";
    if (ext) body.external_id = ext;
    const types = ($("#o_types") && $("#o_types").value) || "";
    if (types) body.order_types = types.split(",").map((x) => x.trim()).filter(Boolean);
    const since = toIsoLocal($("#o_since") && $("#o_since").value);
    const until = toIsoLocal($("#o_until") && $("#o_until").value);
    if (since) body.since = since;
    if (until) body.until = until;

    try {
      const data = await api("/orders/search", { method: "POST", body: JSON.stringify(body) });
      const rows = data.result || [];
      if (!rows.length) {
        list.innerHTML = `<p class="hint">Чеков не найдено</p>`;
      } else {
        list.innerHTML = `<table class="orders-table">
          <thead><tr>
            <th>ID</th><th>Дата</th><th>Тип</th><th>Статус</th><th>Сумма</th><th>Магазин</th><th></th>
          </tr></thead>
          <tbody>
            ${rows
              .map((r) => {
                const id = r.order_id;
                const active = String(id) === String(ordersSelectedId) ? "active" : "";
                return `<tr class="${active}" data-order-id="${id}">
                  <td><code>${id ?? "—"}</code></td>
                  <td>${formatDt(r.updated)}</td>
                  <td>${typeLabel(r.order_type)}</td>
                  <td>${statusBadge(r.status)}</td>
                  <td>${formatMoney(r.total)}</td>
                  <td>${r.store_name || r.store_id || "—"}</td>
                  <td><button type="button" class="btn btn-sm btn-secondary o-edit-btn" data-order-id="${id}" title="Создать новый документ на основе этого чека">Редактировать</button></td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>`;
        list.querySelectorAll("tr[data-order-id]").forEach((tr) => {
          tr.onclick = (ev) => {
            if (ev.target && ev.target.closest && ev.target.closest(".o-edit-btn")) return;
            openOrderDetail(tr.dataset.orderId);
          };
        });
        list.querySelectorAll(".o-edit-btn").forEach((btn) => {
          btn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            editOrderAsNew(btn.dataset.orderId);
          };
        });
      }
      const info = $("#o_page_info");
      if (info) {
        info.textContent = `показано ${rows.length} · смещение ${ordersOffset}`;
      }
      if ($("#o_prev")) $("#o_prev").disabled = ordersOffset <= 0;
      if ($("#o_next")) $("#o_next").disabled = rows.length < ordersLimit;
    } catch (e) {
      list.innerHTML = `<p class="hint" style="color:var(--danger)">${e.message}</p>`;
      showAlert(e.message);
    }
  }

  function paymentTypeLabel(t) {
    const map = {
      0: "Наличные",
      1: "Безналичные",
      2: "Предоплата (аванс)",
      3: "Постоплата (кредит)",
      4: "Встречное предоставление",
    };
    return map[t] || ("Тип " + t);
  }

  function renderReceipt(atol5, summary) {
    const el = $("#o_detail");
    const ph = $("#o_detail_placeholder");
    if (!el) return;
    if (ph) ph.classList.add("hidden");
    el.classList.remove("hidden");

    const receipt = (atol5 && atol5.receipt) || {};
    const company = receipt.company || {};
    const client = receipt.client || {};
    const items = receipt.items || [];
    const payments = receipt.payments || [];
    const total = receipt.total != null ? receipt.total : summary && summary.total;

    const oid = summary && summary.order_id != null ? summary.order_id : ordersSelectedId;
    let html = `<div class="r-head">
      <div class="r-title">Кассовый чек</div>
      <button type="button" class="btn btn-sm" id="o_detail_edit" data-order-id="${oid}">Редактировать</button>
      <div class="r-meta">ID ${summary?.order_id ?? "—"} · ${typeLabel(summary?.order_type)} · ${statusBadge(summary?.status || "")}</div>
      <div class="r-meta">${formatDt(summary?.updated)}</div>
      ${atol5?.external_id ? `<div class="r-meta">ext: ${atol5.external_id}</div>` : ""}
    </div>`;

    html += `<div class="r-line"><span>Магазин</span><span>${summary?.store_name || company.payment_address || "—"}</span></div>`;
    html += `<div class="r-line"><span>ИНН</span><span>${company.inn || "—"}</span></div>`;
    html += `<div class="r-line"><span>СНО</span><span>${company.sno || "—"}</span></div>`;
    if (client.email || client.phone || client.name) {
      html += `<div class="r-line"><span>Покупатель</span><span>${[client.name, client.email, client.phone].filter(Boolean).join(" · ") || "—"}</span></div>`;
    }
    if (receipt.cashier) {
      html += `<div class="r-line"><span>Кассир</span><span>${receipt.cashier}</span></div>`;
    }

    html += `<div style="margin:12px 0 4px;font-weight:600;font-size:0.8rem;color:var(--muted)">Позиции</div>`;
    if (!items.length) {
      html += `<p class="hint">Нет позиций (или формат Atol 5 недоступен)</p>`;
    } else {
      items.forEach((it) => {
        const vat = (it.vat && it.vat.type) || "—";
        html += `<div class="r-item">
          <div class="r-item-name">${it.name || "—"}</div>
          <div class="r-item-sub">${it.quantity ?? 1} × ${formatMoney(it.price)} · ${it.payment_method || ""} · НДС ${vat}</div>
          <div class="r-line"><span></span><span>${formatMoney(it.sum)}</span></div>
        </div>`;
      });
    }

    html += `<div class="r-total"><span>Итого</span><span>${formatMoney(total)}</span></div>`;
    if (payments.length) {
      html += `<div class="r-pay">Оплата: ${payments
        .map((p) => paymentTypeLabel(p.type) + " " + formatMoney(p.sum))
        .join("; ")}</div>`;
    }

    html += `<details style="margin-top:14px"><summary class="hint" style="cursor:pointer">JSON Atol 5</summary>
      <div class="result-box" style="max-height:240px">${JSON.stringify(atol5 || {}, null, 2)}</div>
    </details>`;

    el.innerHTML = html;
    const editBtn = $("#o_detail_edit");
    if (editBtn) {
      editBtn.onclick = () => editOrderAsNew(editBtn.dataset.orderId || oid);
    }
  }

  async function openOrderDetail(orderId) {
    ordersSelectedId = orderId;
    $$("#o_list tr[data-order-id]").forEach((tr) => {
      tr.classList.toggle("active", String(tr.dataset.orderId) === String(orderId));
    });
    const el = $("#o_detail");
    const ph = $("#o_detail_placeholder");
    if (ph) {
      ph.classList.remove("hidden");
      ph.textContent = "Загрузка чека…";
    }
    if (el) el.classList.add("hidden");
    try {
      const data = await api("/orders/" + encodeURIComponent(orderId));
      renderReceipt(data.atol5, data.summary);
    } catch (e) {
      if (ph) ph.textContent = e.message;
      showAlert(e.message);
    }
  }

  function bindOrdersUI() {
    if ($("#o_search")) $("#o_search").onclick = () => { ordersOffset = 0; loadOrders(); };
    if ($("#o_refresh")) $("#o_refresh").onclick = () => loadOrders();
    if ($("#o_reset")) {
      $("#o_reset").onclick = () => {
        if ($("#o_ext")) $("#o_ext").value = "";
        if ($("#o_types")) $("#o_types").value = "";
        if ($("#o_since")) $("#o_since").value = "";
        if ($("#o_until")) $("#o_until").value = "";
        if ($("#o_limit")) $("#o_limit").value = "30";
        ordersOffset = 0;
        loadOrders();
      };
    }
    if ($("#o_prev")) {
      $("#o_prev").onclick = () => {
        ordersOffset = Math.max(0, ordersOffset - ordersLimit);
        loadOrders();
      };
    }
    if ($("#o_next")) {
      $("#o_next").onclick = () => {
        ordersOffset += ordersLimit;
        loadOrders();
      };
    }
  }


  // Settings sub-tabs
  $$(".settings-tab").forEach((btn) => {
    btn.onclick = () => {
      $$(".settings-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const name = btn.dataset.settingsTab;
      $("#settings-org").classList.toggle("hidden", name !== "org");
      $("#settings-stores").classList.toggle("hidden", name !== "stores");
    };
  });

  if ($("#set_refresh")) {
    $("#set_refresh").onclick = async () => {
      try {
        const firm = await api("/auth/firm");
        ingestFirm(firm, getSelectedStoreId());
        showAlert("Профиль обновлён", "success");
      } catch (e) {
        showAlert(e.message);
      }
    };
  }

  bindOrdersUI();

  // Enter in filter fields triggers search
  ["o_ext", "o_since", "o_until"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        ordersOffset = 0;
        loadOrders();
      }
    });
  });
  if ($("#o_types")) {
    $("#o_types").onchange = () => { ordersOffset = 0; loadOrders(); };
  }
  if ($("#o_limit")) {
    $("#o_limit").onchange = () => { ordersOffset = 0; loadOrders(); };
  }

  if (token) afterLogin().catch(() => logout(true));
})();
