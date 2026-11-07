import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PERMISSION_KEYS = ["invoices", "inventory", "customers", "suppliers", "production", "reports", "settings"];
const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) return json(401, { error: "يجب تسجيل الدخول أولاً" });

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: me, error: meError } = await admin
      .from("profiles")
      .select("created_by")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (meError) return json(500, { error: "تعذر التحقق من الصلاحيات" });
    if (!me || me.created_by) return json(403, { error: "صاحب الحساب فقط يستطيع إضافة موظفين" });

    const body = await req.json().catch(() => null);
    const username = String(body?.username ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const fullName = String(body?.full_name ?? "").trim();
    const requested = body?.permissions && typeof body.permissions === "object" ? body.permissions : {};

    if (!username || !USERNAME_PATTERN.test(username)) {
      return json(400, { error: "اسم المستخدم لازم حروف إنجليزي وأرقام ونقطة بس" });
    }
    if (password.length < 6) return json(400, { error: "كلمة المرور لازم تكون 6 أحرف على الأقل" });

    const permissions: Record<string, boolean> = {};
    for (const key of PERMISSION_KEYS) permissions[key] = requested[key] === true;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: `${username}@ms-factory.local`,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      return json(400, { error: createError?.message ?? "تعذر إنشاء الحساب" });
    }

    const { error: profileError } = await admin
      .from("profiles")
      .update({
        username,
        full_name: fullName || username,
        created_by: userData.user.id,
        permissions,
        must_change_password: true,
      })
      .eq("id", created.user.id);

    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      const duplicate = profileError.code === "23505";
      return json(400, { error: duplicate ? "اسم المستخدم ده موجود قبل كده" : "تعذر حفظ بيانات الموظف" });
    }

    return json(200, { username });
  } catch (_e) {
    return json(500, { error: "حصل خطأ غير متوقع" });
  }
});
