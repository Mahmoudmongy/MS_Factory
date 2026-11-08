import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TABLES = [
  { name: "profiles", orderBy: "id" },
  { name: "customers", orderBy: "id" },
  { name: "suppliers", orderBy: "id" },
  { name: "products", orderBy: "id" },
  { name: "inventory", orderBy: "id" },
  { name: "invoices", orderBy: "id" },
  { name: "invoice_items", orderBy: "id" },
  { name: "returns", orderBy: "id" },
  { name: "vouchers", orderBy: "id" },
  { name: "production_orders", orderBy: "id" },
  { name: "factory_state", orderBy: "user_id" },
];

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, { error: "يجب تسجيل الدخول أولاً" });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json(500, { error: "إعدادات الخادم غير مكتملة" });

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return json(401, { error: "جلسة الدخول غير صالحة" });

  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("is_admin")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile) return json(403, { error: "تعذر التحقق من صلاحية الحساب" });
  if (profile.is_admin !== true) return json(403, { error: "النسخ الاحتياطي متاح لمدير النظام فقط" });

  try {
    const tables: Record<string, unknown[]> = {};
    const pageSize = 1000;
    const maxRowsPerTable = 50000;

    for (const table of TABLES) {
      const rows: unknown[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await service
          .from(table.name)
          .select("*")
          .order(table.orderBy, { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) {
          console.error("Backup read failed:", table.name, error);
          return json(500, { error: "تعذر قراءة جدول أثناء إنشاء النسخة الاحتياطية", table: table.name });
        }
        rows.push(...(data || []));
        if (!data || data.length < pageSize) break;
        offset += pageSize;
        if (offset >= maxRowsPerTable) {
          return json(413, { error: "حجم أحد الجداول تجاوز الحد الآمن للتصدير؛ استخدم تصدير قاعدة البيانات الكامل من أدوات Supabase", table: table.name });
        }
      }
      tables[table.name] = rows;
    }

    const backup = {
      format: "ms-factory-database-backup-v1",
      schema_version: 1,
      project_ref: new URL(url).hostname.split(".")[0],
      exported_at: new Date().toISOString(),
      exported_by: authData.user.id,
      includes_auth_passwords: false,
      restore_note: "Contains application tables and profiles. Supabase Auth passwords and sessions are not exportable and are not included.",
      tables,
    };
    const canonical = JSON.stringify(backup);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    const result = { ...backup, checksum_sha256: toHex(digest) };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="MS_Factory_Backup_${stamp}.json"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("Backup generation failed:", error);
    return json(500, { error: "حدث خطأ أثناء تجهيز النسخة الاحتياطية" });
  }
});
