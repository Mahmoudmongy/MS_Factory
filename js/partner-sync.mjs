// Pure partner mapping helpers shared by the cloud sync layer and unit tests.
// The local app stores customers and suppliers together in S.partners using c/s flags.
const VALUE_FIELDS = {
  name: ["name", "nm", "title"],
  phone: ["phone", "tel", "mobile", "ph"],
  email: ["email", "mail"],
  governorate: ["gov", "governorate", "state"],
  city: ["city", "town"],
  address: ["addr", "address", "adr", "add"]
};

function firstValue(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function truthyFlag(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function isAccountLike(name) {
  const value = String(name || "").trim();
  const excluded = ["مصروف", "خصوم", "تكلفة", "رأس المال", "راس المال", "المخزون", "الموردون", "تحت التصنيع", "هالك", "عمال", "قطاعة", "إيراد", "ايراد", "أرباح", "خسائر", "ضرائب", "أصول"];
  return !value || excluded.some(part => value.includes(part));
}

function externalKey(item) {
  const value = firstValue(item, ["id", "external_id", "no", "code", "sku"]);
  return String(value || firstValue(item, ["name", "nm", "title"]) || "").trim();
}

function partnerRoles(item, source) {
  const type = String(firstValue(item, ["type", "kind", "cat", "category", "partner_type"]) || "").toLowerCase();
  let customer = source === "customers" || truthyFlag(item?.c) || truthyFlag(item?.isCustomer) || truthyFlag(item?.is_customer);
  let supplier = source === "suppliers" || truthyFlag(item?.s) || truthyFlag(item?.isSupplier) || truthyFlag(item?.is_supplier);

  if (type.includes("customer") || type.includes("client") || type.includes("عميل")) customer = true;
  if (type.includes("supplier") || type.includes("vendor") || type.includes("مورد")) supplier = true;

  // Historic partner arrays without role flags were treated as customers by the old sync.
  if (!customer && !supplier) customer = true;
  return { customer, supplier };
}

function customerType(item) {
  const type = String(firstValue(item, ["customer_type", "type", "kind"]) || "").toLowerCase();
  return type === "w" || type.includes("wholesale") || type.includes("جملة") ? "wholesale" : "retail";
}

function toBase(item, userId) {
  const row = {
    user_id: userId,
    external_id: externalKey(item),
    name: String(firstValue(item, VALUE_FIELDS.name) || "").trim(),
    phone: String(firstValue(item, VALUE_FIELDS.phone) || "").trim() || null,
    email: String(firstValue(item, VALUE_FIELDS.email) || "").trim() || null,
    governorate: String(firstValue(item, VALUE_FIELDS.governorate) || "").trim() || null,
    city: String(firstValue(item, VALUE_FIELDS.city) || "").trim() || null,
    address: String(firstValue(item, VALUE_FIELDS.address) || "").trim() || null
  };
  return row;
}

/**
 * Build deduplicated rows for the two Supabase master-data tables.
 * A person with both local flags set is deliberately uploaded to both tables.
 */
export function buildPartnerUpserts(state, userId) {
  const inputs = [
    ["partners", state?.partners],
    ["customers", state?.customers],
    ["suppliers", state?.suppliers],
    ["clients", state?.clients]
  ];
  const customers = new Map();
  const suppliers = new Map();

  for (const [source, records] of inputs) {
    if (!Array.isArray(records)) continue;
    for (const item of records) {
      if (!item || typeof item !== "object") continue;
      const base = toBase(item, userId);
      if (!base.name || !base.external_id || isAccountLike(base.name)) continue;
      const roles = partnerRoles(item, source);

      if (roles.customer) {
        const row = { ...base, customer_type: customerType(item) };
        if (!customers.has(row.external_id)) customers.set(row.external_id, row);
      }
      if (roles.supplier) {
        if (!suppliers.has(base.external_id)) suppliers.set(base.external_id, { ...base });
      }
    }
  }

  return { customers: [...customers.values()], suppliers: [...suppliers.values()] };
}

/**
 * Merge separate cloud customer/supplier tables back into S.partners.
 * Never discards local fields; when the same external ID exists in both cloud
 * tables, the customer/supplier flags are combined into one local partner.
 */
export function mergePartnerRows(existing, cloudCustomers, cloudSuppliers) {
  const map = new Map();
  for (const item of Array.isArray(existing) ? existing : []) {
    const key = externalKey(item);
    if (key) map.set(key, item);
  }

  let added = 0;
  const incoming = [
    ...(Array.isArray(cloudCustomers) ? cloudCustomers : []),
    ...(Array.isArray(cloudSuppliers) ? cloudSuppliers : [])
  ];

  for (const remote of incoming) {
    if (!remote || typeof remote !== "object") continue;
    const key = externalKey(remote);
    if (!key) continue;
    let local = map.get(key);
    const isCustomer = remote.partner_role === "customer" || truthyFlag(remote.c);
    const isSupplier = remote.partner_role === "supplier" || truthyFlag(remote.s);

    if (!local) {
      local = {
        id: remote.id ?? key,
        name: String(remote.name || ""),
        phone: remote.phone || "",
        email: remote.email || "",
        gov: remote.gov || remote.governorate || "",
        city: remote.city || "",
        adr: remote.addr || remote.address || "",
        c: isCustomer ? 1 : 0,
        s: isSupplier ? 1 : 0,
        type: remote.customer_type === "wholesale" ? "w" : "r"
      };
      map.set(key, local);
      added++;
      continue;
    }

    local.c = truthyFlag(local.c) || isCustomer ? 1 : 0;
    local.s = truthyFlag(local.s) || isSupplier ? 1 : 0;
    // Fill gaps only. A locally edited value is not overwritten by a stale pull.
    if (!local.email && remote.email) local.email = remote.email;
    if (!local.gov && (remote.gov || remote.governorate)) local.gov = remote.gov || remote.governorate;
    if (!local.city && remote.city) local.city = remote.city;
    if (!local.adr && (remote.addr || remote.address)) local.adr = remote.addr || remote.address;
    if (!local.phone && remote.phone) local.phone = remote.phone;
    if ((!local.type || local.type === "r") && remote.customer_type === "wholesale") local.type = "w";
  }

  return { arr: [...map.values()], added };
}
