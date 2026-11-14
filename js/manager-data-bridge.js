const PAGE_SIZE = 1000;
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const text = value => value == null ? "" : String(value);
const dateMs = value => value ? new Date(value).getTime() || 0 : 0;
const rawText = (raw, ...keys) => {
  for (const key of keys) {
    const value = raw?.[key];
    if (value != null && value !== "") return typeof value === "object" ? (value.Name || value.name || value.Key || "") : String(value);
  }
  return "";
};
const stableId = (namespace, key) => {
  const input = String(key ?? "");
  let hash = 14695981039346656037n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return namespace * 1000000000000 + Number(hash % 1000000000000n);
};
const sourceKey = row => text(row?.external_id || row?.id);
async function readRows(client, table, ownerId) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client.from(table).select("*").eq("user_id", ownerId).order("id").range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error("Manager data bridge: " + table + ": " + error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}
function idMaps(rows, namespace) {
  const byUuid = new Map(), byExternal = new Map();
  for (const row of rows || []) {
    const id = stableId(namespace, sourceKey(row));
    if (row.id != null) byUuid.set(String(row.id), id);
    if (row.external_id != null) byExternal.set(String(row.external_id), id);
  }
  return { byUuid, byExternal, get: value => value == null ? 0 : byUuid.get(String(value)) || byExternal.get(String(value)) || 0 };
}
function accountType(type) {
  return ({ asset:"A", liability:"L", equity:"Q", income:"I", expense:"X" })[text(type).toLowerCase()] || "A";
}
function accountRole(role) {
  return ({ accounts_receivable:"ar", accounts_payable:"ap", cash:"cash", cash_account:"cash", inventory:"inv", capital:"cap", cost_of_goods_sold:"cogs", sales:"sales", sales_discount:"sdisc", purchase_discount:"pdisc", waste:"waste" })[role] || role || "";
}
function warehouseName(value, locations) {
  if (value == null || value === "") return "";
  const v = String(value);
  const found = locations.find(x => String(x.external_id) === v || String(x.id) === v || x.name === v);
  return found?.name || v;
}
function normalizeBreakdown(value, fallbackQty) {
  if (Array.isArray(value)) {
    const rows = value.map(x => ({ v: text(x.v || x.variant || x.name || "-"), qty: num(x.qty ?? x.quantity ?? x.Qty) })).filter(x => x.qty > 0);
    if (rows.length) return rows;
  }
  if (value && typeof value === "object") {
    const rows = Object.entries(value).flatMap(([key, item]) => {
      if (typeof item === "number" || typeof item === "string") return [{ v:key || "-", qty:num(item) }];
      if (item && typeof item === "object") return [{ v:text(item.v || item.variant || key || "-"), qty:num(item.qty ?? item.quantity ?? item.Qty) }];
      return [];
    }).filter(x => x.qty > 0);
    if (rows.length) return rows;
  }
  return [{ v:"-", qty:num(fallbackQty) }];
}
function mapManagerDataToState(data) {
  const accounts = data.accounts || [], customers = data.customers || [], suppliers = data.suppliers || [];
  const products = data.products || [], inventory = data.inventory || [], costs = data.costs || [];
  const locations = data.locations || [], invoices = data.invoices || [], invoiceLines = data.invoiceLines || [];
  const returns = data.returns || [], returnLines = data.returnLines || [], vouchers = data.vouchers || [];
  const voucherLines = data.voucherLines || [], ledger = data.ledger || [], journals = data.journals || [];
  const production = data.production || [], materials = data.materials || [], expenses = data.expenses || [];
  const writeoffs = data.writeoffs || [], transfers = data.transfers || [], currencies = data.currencies || [];

  const acctIds = idMaps(accounts, 1), customerIds = idMaps(customers, 2), supplierIds = idMaps(suppliers, 2);
  const productIds = idMaps(products, 3), invoiceIds = idMaps(invoices, 5), returnIds = idMaps(returns, 6);
  const voucherIds = idMaps(vouchers, 7), journalIds = idMaps(journals, 8), productionIds = idMaps(production, 9);
  const writeoffIds = idMaps(writeoffs, 10), transferIds = idMaps(transfers, 13);
  const partnerId = uuid => customerIds.get(uuid) || supplierIds.get(uuid);
  const accountByCode = new Map(accounts.map(a => [String(a.account_code || ""), acctIds.get(a.id)]));
  const accountByName = new Map(accounts.map(a => [String(a.name || "").trim().toLowerCase(), acctIds.get(a.id)]));
  const accountByRole = role => acctIds.get(accounts.find(a => accountRole(a.account_role) === role)?.id);
  const partnerRows = new Map();
  for (const p of customers) {
    const key = sourceKey(p), id = customerIds.get(p.id);
    partnerRows.set(key, { id, cloudId:key, name:p.name || "", phone:p.phone || "", email:p.email || "", c:1, s:0, type:p.customer_type === "wholesale" ? "w" : "r", gov:p.governorate || "", city:p.city || "", adr:p.address || "", legacyManager:true });
  }
  for (const p of suppliers) {
    const key = sourceKey(p), existing = partnerRows.get(key), id = supplierIds.get(p.id);
    if (existing) Object.assign(existing, { s:1, phone:existing.phone || p.phone || "", email:existing.email || p.email || "", adr:existing.adr || p.address || "" });
    else partnerRows.set(key, { id, cloudId:key, name:p.name || "", phone:p.phone || "", email:p.email || "", c:0, s:1, type:"w", gov:p.governorate || "", city:p.city || "", adr:p.address || "", legacyManager:true });
  }
  const partners = [...partnerRows.values()];
  const partnerByUuid = new Map();
  customers.forEach(p => partnerByUuid.set(String(p.id), customerIds.get(p.id)));
  suppliers.forEach(p => partnerByUuid.set(String(p.id), supplierIds.get(p.id)));
  const partnerName = id => partners.find(p => p.id === id)?.name || "";

  const warehouseNames = new Set();
  locations.forEach(x => { if (x.name) warehouseNames.add(String(x.name)); });
  (data.inventoryLocationBalances || []).forEach(x => { if (x.warehouse) warehouseNames.add(String(x.warehouse)); });
  inventory.forEach(x => { if (x.warehouse) warehouseNames.add(String(x.warehouse)); });
  products.forEach(x => { if (x.warehouse) warehouseNames.add(warehouseName(x.warehouse, locations)); });
  if (!warehouseNames.size) warehouseNames.add("المخزن الرئيسي");
  const wh = [...warehouseNames].sort((a,b)=>a.localeCompare(b,"ar")).map(name => ({ id:stableId(4,name), name, legacyManager:true }));
  const whId = value => {
    const name = warehouseName(value, locations) || [...warehouseNames][0];
    return wh.find(x => x.name === name)?.id || wh[0]?.id || 0;
  };

  const inventoryByProduct = new Map();
  for (const row of inventory) {
    const key = String(row.product_id);
    const group = inventoryByProduct.get(key) || {};
    const variant = text(row.variant || "-");
    group[variant] = num(group[variant]) + num(row.quantity);
    inventoryByProduct.set(key, group);
  }
  const costsByProduct = new Map();
  for (const row of [...costs].sort((a,b)=>String(a.effective_date||"").localeCompare(String(b.effective_date||"")))) {
    const key = String(row.product_id);
    const list = costsByProduct.get(key) || [];
    list.push({ date:String(row.effective_date||""), cost:num(row.unit_cost) });
    costsByProduct.set(key,list);
  }
  const productByUuid = new Map(products.map(p => [String(p.id),p]));
  const unitCostAt = (productUuid, date) => {
    const list = costsByProduct.get(String(productUuid)) || [];
    const eligible = list.filter(x => !date || !x.date || x.date <= String(date));
    return eligible.length ? eligible[eligible.length-1].cost : num(productByUuid.get(String(productUuid))?.buy_price);
  };
  const items = products.map(p => {
    const st = inventoryByProduct.get(String(p.id)) || {};
    if (!Object.keys(st).length && num(p.qty)) st["-"] = num(p.qty);
    const quantity = Object.values(st).reduce((a,b)=>a+num(b),0);
    const unitCost = unitCostAt(p.id, "9999-12-31");
    const stockRows = inventory.filter(x => String(x.product_id) === String(p.id));
    const warehouse = p.warehouse || stockRows[0]?.warehouse || locations[0]?.name || "";
    return { id:productIds.get(p.id), cloudId:sourceKey(p), name:p.name || "", sku:p.sku || "", model:p.model || "", wh:whId(warehouse), unit:p.unit || "قطعة", buy:num(p.buy_price), retail:num(p.retail_price), wholesale:num(p.wholesale_price), img:p.image_url || "", st, val:quantity*unitCost, legacyManager:true };
  });
  const productName = uuid => productByUuid.get(String(uuid))?.name || "";
  const itemUnit = uuid => productByUuid.get(String(uuid))?.unit || "قطعة";

  const linesByInvoice = new Map();
  for (const line of invoiceLines) {
    const key = String(line.invoice_id), list = linesByInvoice.get(key) || [];
    list.push(line); linesByInvoice.set(key,list);
  }
  const docs = invoices.map(inv => {
    const rows = (linesByInvoice.get(String(inv.id)) || []).sort((a,b)=>num(a.line_no)-num(b.line_no));
    const lines = rows.map(line => {
      const itemId = productIds.get(line.product_id);
      const cost = line.product_id ? unitCostAt(line.product_id, inv.invoice_date) : 0;
      const isAdjustment = line.source_line_kind === "extra_adjustment";
      return { iid:itemId || 0, name:line.item_name || line.account_name || productName(line.product_id), v:line.variant || "-", qty:isAdjustment?1:num(line.quantity), price:isAdjustment?num(line.line_total):num(line.unit_price), cost, note:rawText(line.raw||{},"lineDescription","LineDescription"), unit:itemUnit(line.product_id), a:line.raw?.account ? (acctIds.get(line.raw.account) || accountByCode.get(String(line.raw.account)) || accountByName.get(String(line.account_name||"").toLowerCase()) || accountByRole(inv.invoice_type==="sale"?"sales":"cogs")) : (isAdjustment ? accountByName.get(String(line.account_name||"").toLowerCase()) : 0) };
    });
    const raw = inv.raw || {}, type = inv.invoice_type === "sale" ? "sale" : "pur";
    const partnerUuid = inv.customer_id || inv.supplier_id;
    const partner = partnerId(partnerUuid);
    const location = type === "pur" ? rawText(raw,"PurchaseInventoryLocation") : "";
    const discount = num(inv.discount), total = num(inv.total);
    return { id:invoiceIds.get(inv.id), cloudId:sourceKey(inv), t:type, no:inv.invoice_no || sourceKey(inv), date:inv.invoice_date || "", ts:dateMs(inv.created_at), pid:partner, cat:type==="sale"?"mfg":"sup", dest:type==="pur"?(location?whId(location):"wh"):"", lines, gross:total+discount, disc:discount, total, note:inv.note || rawText(raw,"Description"), img:"", legacyManager:true };
  });

  const returnLinesById = new Map();
  for (const line of returnLines) {
    const key = String(line.return_id), list = returnLinesById.get(key) || [];
    list.push(line); returnLinesById.set(key,list);
  }
  for (const ret of returns) {
    const rows = (returnLinesById.get(String(ret.id)) || []).sort((a,b)=>num(a.line_no)-num(b.line_no));
    const lines = rows.map(line => ({ iid:productIds.get(line.product_id)||0, name:line.product_name || productName(line.product_id), v:line.variant || rawText(line.raw||{},"variant","Variant") || "-", qty:num(line.quantity), price:num(line.unit_price), cost:line.product_id?unitCostAt(line.product_id,ret.return_date):0, note:line.note || "", unit:itemUnit(line.product_id) }));
    const partner = partnerId(ret.customer_id || ret.supplier_id);
    docs.push({ id:returnIds.get(ret.id), cloudId:sourceKey(ret), t:ret.return_type==="sale_return"?"sret":"pret", no:ret.return_no || sourceKey(ret), date:ret.return_date || "", ts:dateMs(ret.created_at), pid:partner, cat:ret.return_type==="sale_return"?"mfg":"sup", dest:"", lines, gross:num(ret.total), disc:0, total:num(ret.total), note:ret.note || rawText(ret.raw||{},"Description"), img:"", legacyManager:true });
  }

  const invoiceIdByExternal = new Map(invoices.map(i=>[String(i.external_id),invoiceIds.get(i.id)]));
  const linesByVoucher = new Map();
  for (const line of voucherLines) {
    if (!line.voucher_id) continue;
    const key = String(line.voucher_id), list = linesByVoucher.get(key) || [];
    list.push(line); linesByVoucher.set(key,list);
  }
  const cashAccountIds = new Set(accounts.filter(a=>a.is_cash_account).map(a=>String(a.id)));
  const vch = vouchers.map(v => {
    const rows = (linesByVoucher.get(String(v.id)) || []).filter(x=>x.line_type!=="opening_balance");
    const ac = [], ln = [];
    for (const line of rows) {
      const cashUuid = line.bank_account_id || (cashAccountIds.has(String(line.account_id)) ? line.account_id : null);
      const counterpartUuid = line.account_id && String(line.account_id)!==String(cashUuid) ? line.account_id : null;
      if (cashUuid) ac.push({ a:acctIds.get(cashUuid), m:num(line.amount), fc:0 });
      if (counterpartUuid || line.customer_id || line.supplier_id) {
        const hasParty=!!(line.customer_id||line.supplier_id);
        ln.push({ a:hasParty?"p":acctIds.get(counterpartUuid), d:line.account_name || "", m:num(line.amount), x:0, lbl:hasParty?"حساب الطرف":"", pid:hasParty?partnerId(line.customer_id||line.supplier_id):0 });
      }
    }
    const raw = v.raw || {}, pid = partnerId(v.customer_id || v.supplier_id), alloc={};
    for(const line of (Array.isArray(raw.Lines)?raw.Lines:[])){const external=rawText(line,"AccountsReceivableSalesInvoice","PurchaseInvoice");const docId=invoiceIdByExternal.get(String(external));if(docId)alloc[docId]=(alloc[docId]||0)+num(line.Amount)+num(line.DiscountAmount);}
    if (!ac.length && v.account) {
      const accountId = acctIds.get(accounts.find(a=>a.name===v.account || a.account_code===v.account)?.id);
      if (accountId) ac.push({a:accountId,m:num(v.amount),fc:0});
    }
    return { id:voucherIds.get(v.id), cloudId:sourceKey(v), no:v.voucher_no || sourceKey(v), date:v.voucher_date || "", ts:dateMs(v.created_at), dir:v.direction==="in"?"in":"out", title:rawText(raw,"TransactionTitle","ReceiptCustomTitle","PaymentCustomTitle") || (v.direction==="in"?"إيصال استلام نقدية":"إيصال صرف نقدية"), pid, who:partnerName(pid) || rawText(raw,"Payee","Contact","Customer","Supplier"), desc:v.note || rawText(raw,"Description"), ac, ln, link:"sales", img:"", total:num(v.amount), alloc, legacyManager:true };
  });
  for (const tr of transfers) {
    const id = transferIds.get(tr.id), paid = acctIds.get(tr.paid_from_account_id), received = acctIds.get(tr.received_in_account_id);
    vch.push({ id, cloudId:sourceKey(tr), no:"TR-"+String(id).slice(-7), date:tr.transfer_date || "", ts:dateMs(tr.created_at), dir:"out", title:"تحويل بين الحسابات", pid:0, who:accounts.find(a=>String(a.id)===String(tr.received_in_account_id))?.name || "تحويل داخلي", desc:tr.description || "", ac:paid?[{a:paid,m:num(tr.amount),fc:0}]:[], ln:received?[{a:received,d:"تحويل إلى الحساب",m:num(tr.amount),x:0}]:[], link:"sales", img:"", total:num(tr.amount), alloc:{}, legacyManager:true });
  }

  const journalByExternal = new Map(journals.map(j=>[String(j.external_id),journalIds.get(j.id)]));
  const productionByExternal = new Map(production.map(p=>[String(p.external_id),productionIds.get(p.id)]));
  const writeoffByExternal = new Map(writeoffs.map(w=>[String(w.external_id),writeoffIds.get(w.id)]));
  const transferByExternal = new Map(transfers.map(t=>[String(t.external_id),transferIds.get(t.id)]));
  const invoiceByExternal = new Map(invoices.map(i=>[String(i.external_id),invoiceIds.get(i.id)]));
  const returnByExternal = new Map(returns.map(r=>[String(r.external_id),returnIds.get(r.id)]));
  const voucherByExternal = new Map(vouchers.map(v=>[String(v.external_id),voucherIds.get(v.id)]));
  const sourceMaps = {
    sales_invoices:invoiceByExternal, purchase_invoices:invoiceByExternal,
    credit_notes:returnByExternal, debit_notes:returnByExternal,
    receipts:voucherByExternal, payments:voucherByExternal,
    journal_entries:journalByExternal, production_orders:productionByExternal,
    inventory_write_offs:writeoffByExternal, inter_account_transfers:transferByExternal
  };
  const sourceType = {
    sales_invoices:"doc", purchase_invoices:"doc", credit_notes:"doc", debit_notes:"doc",
    receipts:"vch", payments:"vch", journal_entries:"je", production_orders:"po",
    inventory_write_offs:"wo", inter_account_transfers:"vch"
  };
  const L = ledger.map(row => {
    const source = String(row.source_record_type || ""), map = sourceMaps[source];
    const rid = map && row.source_manager_key ? map.get(String(row.source_manager_key)) || 0 : 0;
    return { id:stableId(11,row.id), d:row.transaction_date || "", ts:dateMs(row.created_at), ref:row.reference || "", desc:row.line_description || row.description || row.transaction_type || "", a:acctIds.get(row.account_id), dr:num(row.debit), cr:num(row.credit), pid:partnerId(row.customer_id || row.supplier_id), src:sourceType[source] || "opening", rid, fc:0, legacyManager:true };
  });
  const je = journals.map(j => ({ id:journalIds.get(j.id), cloudId:sourceKey(j), no:"JE-"+String(journalIds.get(j.id)).slice(-7), date:j.entry_date || "", ts:dateMs(j.created_at), desc:j.narration || rawText(j.raw||{},"Narration"), legacyManager:true }));

  const materialsByOrder = new Map();
  for (const m of materials) {
    const key = String(m.production_order_id), list = materialsByOrder.get(key) || [];
    list.push(m); materialsByOrder.set(key,list);
  }
  const expensesByOrder = new Map();
  for (const x of expenses) {
    const key = String(x.production_order_id), list = expensesByOrder.get(key) || [];
    list.push(x); expensesByOrder.set(key,list);
  }
  const po = production.map(order => {
    const mats = (materialsByOrder.get(String(order.id)) || []).sort((a,b)=>num(a.line_no)-num(b.line_no)).map(m=>({ iid:productIds.get(m.product_id)||0, qty:num(m.quantity), cost:num(m.line_total)||num(m.unit_cost)*num(m.quantity), note:m.material_name || "" }));
    const x = (expensesByOrder.get(String(order.id)) || []).sort((a,b)=>num(a.line_no)-num(b.line_no)).map(e=>({ a:acctIds.get(e.account_id), amt:num(e.amount), note:e.account_name || "" }));
    const subs = normalizeBreakdown(order.raw?.FinishedBreakdown || null, order.raw?.Qty || 0);
    const status = ["delivered","completed","complete","finished"].includes(String(order.status||"").toLowerCase())?2:["in_progress","in progress","processing"].includes(String(order.status||"").toLowerCase())?1:0;
    const loc = rawText(order.raw||{},"InventoryLocation");
    return { id:productionIds.get(order.id), cloudId:sourceKey(order), no:order.order_no || sourceKey(order), date:order.order_date || "", ts:dateMs(order.created_at), desc:order.description || "", iname:order.item_name || productName(order.product_id), iid:productIds.get(order.product_id)||0, wh:whId(loc), subs, mats, x, st:status, matCost:mats.reduce((a,m)=>a+num(m.cost),0), rec:status===2?subs.map(s=>({v:s.v,qty:s.qty})):[], wc:0, legacyManager:true };
  });

  const wo = writeoffs.map(w => {const rows=Array.isArray(w.items)?w.items:Object.values(w.items||{});const c=rows.reduce((a,x)=>{const key=rawText(x,"InventoryItem","item"),product=products.find(p=>String(p.external_id)===String(key)||String(p.sku)===String(key));return a+num(x.Amount||x.amount||x.total||x.cost||x.Qty)* (x.Qty!=null&&product?unitCostAt(product.id,w.writeoff_date):1)},0);return { id:writeoffIds.get(w.id), cloudId:sourceKey(w), no:sourceKey(w), ref:sourceKey(w), date:w.writeoff_date || "", ts:dateMs(w.created_at), desc:w.description || "", c, po:0, items:rows, legacyManager:true }});
  const mv = [];
  const invoiceUuidByExternal = new Map(invoices.map(i=>[String(i.external_id),i.id]));
  const returnUuidByExternal = new Map(returns.map(r=>[String(r.external_id),r.id]));
  for (const row of ledger) {
    const raw = row.raw || {}, itemKey = rawText(raw,"item"), qtyRaw = num(raw.qty);
    if (!itemKey || !qtyRaw) continue;
    const product = products.find(p=>String(p.external_id)===itemKey || String(p.sku)===itemKey);
    if (!product) continue;
    const type = row.transaction_type, absQty = Math.abs(qtyRaw);
    let sign = 0, src = sourceType[row.source_record_type] || "opening";
    if (type==="Sales Invoice" || type==="Debit Note" || type==="Inventory Write-off" || (type==="Production Order" && row.credit>0)) sign = -1;
    else if (type==="Purchase Invoice" || type==="Credit Note" || (type==="Production Order" && row.debit>0)) sign = 1;
    else if (type==="Journal Entry") sign = row.debit>0 ? 1 : row.credit>0 ? -1 : 0;
    if (!sign) continue;
    const cost = unitCostAt(product.id,row.transaction_date);
    const value = type==="Purchase Invoice" ? Math.abs(num(raw.amount) || num(raw.unitPrice)*absQty) : absQty*cost;
    const external = row.source_manager_key || "";
    const map = sourceMaps[row.source_record_type], rid = map && external ? map.get(String(external)) || 0 : 0;
    mv.push({ d:row.transaction_date || "", ts:dateMs(row.created_at), iid:productIds.get(product.id), v:"-", q:sign*absQty, val:sign*value, ref:row.reference || "", pid:partnerId(row.customer_id || row.supplier_id), rid, src });
  }

  // Reconcile the movement history to the current imported stock snapshot.
  // Any history not represented by source movements becomes an explicit opening balance.
  const movementTotals=new Map();
  for(const m of mv){const key=String(m.iid)+"|"+String(m.v||"-"),sum=movementTotals.get(key)||{q:0,val:0};sum.q+=num(m.q);sum.val+=num(m.val);movementTotals.set(key,sum);}
  const allMovementDates=mv.map(m=>m.d).filter(Boolean).sort();
  const openingDate=allMovementDates.length?new Date(new Date(allMovementDates[0]+"T00:00:00").getTime()-86400000).toISOString().slice(0,10):"1970-01-01";
  for(const item of items){for(const [variant,quantity] of Object.entries(item.st||{})){const key=String(item.id)+"|"+String(variant||"-"),sum=movementTotals.get(key)||{q:0,val:0};const openingQty=num(quantity)-sum.q,openingValue=num(item.val)-sum.val;if(Math.abs(openingQty)>.0001||Math.abs(openingValue)>.005){mv.push({d:openingDate,ts:dateMs(openingDate),iid:item.id,v:variant||"-",q:openingQty,val:openingValue,ref:"رصيد افتتاحي مستورد من Manager.io",pid:0,rid:0,src:"opening",legacyManager:true});}}}
  const curs = ["EGP","USD","EUR",...currencies.map(c=>c.code).filter(Boolean)];
  return { accts:accounts.map(a=>({ id:acctIds.get(a.id), cloudId:sourceKey(a), code:a.account_code || "", name:a.name || "", t:accountType(a.account_type), k:accountRole(a.account_role), cash:!!a.is_cash_account, cur:a.currency_code || "EGP", parentId:acctIds.get(a.parent_account_id)||null, legacyManager:true })), partners, wh, items, docs, vch, je, L, po, wo, mv, codes:[], emp:[], curs:[...new Set(curs)], managerBridgeVersion:1 };
}
export async function loadManagerDataBridge(client, ownerId) {
  if (!client || !ownerId) return null;
  const tables = {
    accounts:"manager_accounts", customers:"customers", suppliers:"suppliers",
    products:"products", inventory:"inventory", costs:"manager_inventory_cost_history",
    locations:"manager_custom_inventory_locations", inventoryLocationBalances:"inventory_location_balances",
    invoices:"invoices", invoiceLines:"manager_invoice_source_lines", returns:"returns", returnLines:"return_items",
    vouchers:"vouchers", voucherLines:"manager_voucher_lines", ledger:"manager_ledger_transactions",
    journals:"manager_journal_entries", production:"production_orders", materials:"production_order_materials",
    expenses:"production_order_expenses", writeoffs:"manager_inventory_write_offs",
    transfers:"manager_inter_account_transfers", currencies:"manager_foreign_currencies"
  };
  const entries=[];const tableEntries=Object.entries(tables);for(let i=0;i<tableEntries.length;i+=4){const batch=await Promise.all(tableEntries.slice(i,i+4).map(async ([key,table])=>[key,await readRows(client,table,ownerId)]));entries.push(...batch)}
  const data = Object.fromEntries(entries);
  const meaningful = ["accounts","customers","suppliers","products","invoices","ledger","vouchers"].some(key => data[key]?.length);
  return meaningful ? mapManagerDataToState(data) : null;
}
export { mapManagerDataToState, stableId };
