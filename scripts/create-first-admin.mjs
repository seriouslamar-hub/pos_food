#!/usr/bin/env node
// Creates the first admin account in a new Supabase project, so someone can
// sign in to the back office. Run it once per environment:
//
//   node --env-file=.env.local scripts/create-first-admin.mjs --email you@example.com --name "Your Name"
//
// It uses SUPABASE_SERVICE_ROLE_KEY, creates a confirmed login with a random
// temporary password (printed once), and links it to an admin staff record.
// It refuses to run if an active admin already exists.

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
  },
});

const email = values.email?.trim().toLowerCase();
const fullName = values.name?.trim();
if (!email || !fullName) {
  console.error(
    'Usage: node --env-file=.env.local scripts/create-first-admin.mjs --email you@example.com --name "Your Name"',
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (use --env-file=.env.local).",
  );
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const { count, error: countError } = await db
  .from("staff")
  .select("id", { count: "exact", head: true })
  .eq("role", "admin")
  .eq("is_active", true);
if (countError) {
  console.error(
    `Couldn't read staff: ${countError.message}. Have the migrations been applied?`,
  );
  process.exit(1);
}
if (count > 0) {
  console.error(
    "An active admin already exists. Create more staff from the back office instead.",
  );
  process.exit(1);
}

const password = randomBytes(18).toString("base64url");
const { data: created, error: userError } = await db.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (userError || !created.user) {
  console.error(`Couldn't create the login: ${userError?.message}`);
  process.exit(1);
}

const { error: staffError } = await db.from("staff").insert({
  auth_user_id: created.user.id,
  branch_id: null,
  full_name: fullName,
  email,
  role: "admin",
  discount_limit_bps: 10000,
});
if (staffError) {
  await db.auth.admin.deleteUser(created.user.id);
  console.error(`Couldn't create the staff record: ${staffError.message}`);
  process.exit(1);
}

console.log(`Admin created on ${new URL(url).host}`);
console.log(`  Email:              ${email}`);
console.log(`  Temporary password: ${password}`);
console.log(
  "Sign in at /login. Keep this password safe; it isn't shown again.",
);
