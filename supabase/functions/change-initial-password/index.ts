import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return json(401, { error: "جلسة الدخول غير صالحة" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "بيانات الطلب غير صحيحة" }); }
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 10 || password.length > 128) {
    return json(400, { error: "كلمة المرور يجب أن تكون من 10 إلى 128 حرفاً" });
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,is_admin,must_change_password")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile) return json(403, { error: "تعذر التحقق من صلاحية الحساب" });
  if (profile.is_admin === true || profile.must_change_password !== true) {
    return json(403, { error: "تغيير كلمة المرور الأولي غير مطلوب لهذا الحساب" });
  }

  const { error: passwordError } = await admin.auth.admin.updateUserById(
    authData.user.id,
    { password },
  );
  if (passwordError) return json(400, { error: passwordError.message });

  const { data: updatedProfile, error: updateError } = await admin
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", authData.user.id)
    .eq("must_change_password", true)
    .select("id")
    .maybeSingle();
  if (updateError || !updatedProfile) {
    return json(500, { error: "تم تحديث كلمة المرور، لكن تعذر تأكيد إكمال الخطوة. سجّل الدخول مرة أخرى أو تواصل مع المدير." });
  }

  return json(200, { success: true });
});
