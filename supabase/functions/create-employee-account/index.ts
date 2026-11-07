import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_PERMISSIONS = ["invoices", "inventory", "customers", "suppliers", "production", "reports", "settings"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return json(401, { error: "جلسة الدخول غير صالحة" });

  const { data: profile, error: profileError } = await admin.from("profiles").select("is_admin").eq("id", authData.user.id).maybeSingle();
  if (profileError || profile?.is_admin !== true) return json(403, { error: "هذه العملية متاحة لمدير النظام فقط" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "بيانات الطلب غير صحيحة" }); }
  const username = String(body.username ?? "").trim().toLowerCase();
  const fullName = String(body.full_name ?? "").trim().slice(0, 120);
  const password = String(body.password ?? "");
  const requested = body.permissions && typeof body.permissions === "object" && !Array.isArray(body.permissions) ? body.permissions as Record<string, unknown> : {};
  const permissions: Record<string, boolean> = {};
  for (const key of ALLOWED_PERMISSIONS) permissions[key] = requested[key] === true;
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return json(400, { error: "اسم المستخدم يجب أن يكون من 3 إلى 40 حرفاً إنجليزياً أو رقماً أو . _ -" });
  if (password.length < 10) return json(400, { error: "كلمة المرور يجب ألا تقل عن 10 أحرف" });

  const { data: existing } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (existing) return json(409, { error: "اسم المستخدم مستخدم بالفعل" });
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: username + "@ms-factory.local", password, email_confirm: true,
  });
  if (createError || !created.user) return json(400, { error: createError?.message ?? "تعذر إنشاء الحساب" });

  const { error: profileUpdateError } = await admin.from("profiles").update({
    username, full_name: fullName || username, must_change_password: true,
    permissions, created_by: authData.user.id, is_admin: false,
  }).eq("id", created.user.id);
  if (profileUpdateError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json(500, { error: "تعذر حفظ ملف المستخدم، وتم التراجع عن إنشاء الحساب" });
  }
  return json(200, { success: true, username, user_id: created.user.id });
});
