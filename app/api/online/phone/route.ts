import { withinRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST {phone}: makes sure an online customer's phone login exists, so the
 * page can text them a code. Sign-ups are otherwise off for everyone, so
 * nobody can make an email or phone login on their own. Rate limited per
 * visitor. Says nothing about whether the number was new. It's marked
 * confirmed so the code texted is a sign-in code: nobody gets a session
 * without it.
 */
export async function POST(request: Request) {
  const { phone } = (await request.json().catch(() => ({}))) as {
    phone?: string;
  };
  if (typeof phone !== "string" || !/^\+[1-9]\d{7,14}$/.test(phone))
    return Response.json(
      { error: "Enter a mobile number, like 024 412 3456." },
      { status: 400 },
    );
  if (
    !(await withinRateLimit("online.phone", 10)) ||
    !(await withinRateLimit(`online.phone:${phone}`, 5))
  )
    return Response.json(
      { error: "Too many tries. Wait a few minutes." },
      { status: 429 },
    );
  const { error } = await createAdminClient().auth.admin.createUser({
    phone,
    phone_confirm: true,
  });
  if (error && !/already|exists|registered/i.test(error.message)) {
    console.error("Couldn't prepare a phone login", error.message);
    return Response.json(
      { error: "We couldn't send a code. Try again." },
      { status: 502 },
    );
  }
  return new Response(null, { status: 204 });
}
