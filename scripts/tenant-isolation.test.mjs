import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_TEST_ALPHA_EMAIL", "SUPABASE_TEST_ALPHA_PASSWORD",
  "SUPABASE_TEST_BETA_EMAIL", "SUPABASE_TEST_BETA_PASSWORD",
  "SUPABASE_TEST_ALPHA_BUSINESS_ID", "SUPABASE_TEST_BETA_BUSINESS_ID",
  "SUPABASE_TEST_BETA_CLIENT_ID", "SUPABASE_TEST_BETA_INVOICE_ID",
];

function requiredEnvironment() {
  const missing = required.filter((name) => !process.env[name]);
  assert.equal(missing.length, 0, `Missing required test environment variables: ${missing.join(", ")}`);
  return process.env;
}

async function signIn(email, password) {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  assert.equal(error, null, `Could not authenticate test user: ${error?.message}`);
  return client;
}

async function expectNoRows(label, request) {
  const { data, error } = await request;
  assert.equal(error, null, `${label} returned an unexpected database error: ${error?.message}`);
  assert.deepEqual(data, [], `${label} leaked tenant data`);
}

async function expectRejectedOrNoEffect(label, request) {
  const { data, error } = await request;
  assert.ok(error || !data || data.length === 0, `${label} unexpectedly succeeded`);
}

test("Company Alpha cannot access or mutate Company Beta data", async () => {
  const env = requiredEnvironment();
  const alpha = await signIn(env.SUPABASE_TEST_ALPHA_EMAIL, env.SUPABASE_TEST_ALPHA_PASSWORD);
  const betaBusiness = env.SUPABASE_TEST_BETA_BUSINESS_ID;

  await expectNoRows("Beta clients", alpha.from("clients").select("id").eq("business_id", betaBusiness));
  await expectNoRows("Beta invoices", alpha.from("invoices").select("id").eq("business_id", betaBusiness));
  await expectNoRows("Beta payments", alpha.from("payments").select("id").eq("business_id", betaBusiness));
  await expectNoRows("Beta documents", alpha.from("documents").select("id").eq("business_id", betaBusiness));

  await expectRejectedOrNoEffect("Beta client insert", alpha.from("clients").insert({ business_id: betaBusiness, name: "Unauthorized test client" }).select("id"));
  await expectRejectedOrNoEffect("Beta client update", alpha.from("clients").update({ name: "Unauthorized update" }).eq("id", env.SUPABASE_TEST_BETA_CLIENT_ID).select("id"));
  await expectRejectedOrNoEffect("Beta client delete", alpha.from("clients").delete().eq("id", env.SUPABASE_TEST_BETA_CLIENT_ID).select("id"));
  await expectRejectedOrNoEffect("Beta payment insert", alpha.from("payments").insert({ business_id: betaBusiness, invoice_id: env.SUPABASE_TEST_BETA_INVOICE_ID, amount: 1, currency_code: "ZAR" }).select("id"));
  await expectRejectedOrNoEffect("Cross-tenant payment reference", alpha.from("payments").insert({ business_id: env.SUPABASE_TEST_ALPHA_BUSINESS_ID, invoice_id: env.SUPABASE_TEST_BETA_INVOICE_ID, amount: 1, currency_code: "ZAR" }).select("id"));

  const { data: files, error: storageError } = await alpha.storage.from("business-documents").list(betaBusiness);
  assert.ok(storageError || files?.length === 0, "Beta storage objects were exposed to Alpha");
});

test("Company Beta cannot access Company Alpha data", async () => {
  const env = requiredEnvironment();
  const beta = await signIn(env.SUPABASE_TEST_BETA_EMAIL, env.SUPABASE_TEST_BETA_PASSWORD);
  await expectNoRows("Alpha clients", beta.from("clients").select("id").eq("business_id", env.SUPABASE_TEST_ALPHA_BUSINESS_ID));
  await expectNoRows("Alpha invoices", beta.from("invoices").select("id").eq("business_id", env.SUPABASE_TEST_ALPHA_BUSINESS_ID));
  await expectNoRows("Alpha payments", beta.from("payments").select("id").eq("business_id", env.SUPABASE_TEST_ALPHA_BUSINESS_ID));
  await expectNoRows("Alpha documents", beta.from("documents").select("id").eq("business_id", env.SUPABASE_TEST_ALPHA_BUSINESS_ID));
});
