import assert from "node:assert/strict";
import test from "node:test";

test("expense invoice uploads validate content headers and allowed file types", async () => {
  const { expenseFileInfo, validExpenseHeader, expenseSchema } = await import("../src/lib/expenses.ts");
  assert.equal(expenseFileInfo("receipt.JPEG","image/jpeg").extension,"jpg");
  assert.equal(expenseFileInfo("invoice.pdf","" ).type,"application/pdf");
  assert.equal(expenseFileInfo("script.svg","image/svg+xml"),null);
  assert.equal(expenseFileInfo("invoice.pdf","image/png"),null);
  assert.equal(validExpenseHeader(new TextEncoder().encode("%PDF-1.7"),"application/pdf"),true);
  assert.equal(validExpenseHeader(new TextEncoder().encode("<html>bad"),"application/pdf"),false);
  assert.equal(validExpenseHeader(new Uint8Array([137,80,78,71,13,10,26,10]),"image/png"),true);
  assert.equal(expenseSchema.safeParse({amount:-1}).success,false);
});
import { csvCell, currencyDecimals, formatMoney } from "../src/lib/finance.ts";
import { allRows } from "../src/lib/queries.ts";
import { copySessionResponse } from "../src/lib/session-response.ts";
import { applicationUrl } from "../src/lib/site-url.ts";
import { registrationErrorCode, registrationErrorMessage } from "../src/lib/auth-errors.ts";

test("registration explains delivery limits without reflecting provider errors", () => {
  const code = registrationErrorCode({code:"over_email_send_rate_limit",status:429});
  assert.equal(code,"email-rate-limited");
  assert.match(registrationErrorMessage(code),/Confirmation emails.*rate limited/);
  assert.equal(registrationErrorCode({code:"email_address_not_authorized"}),"email-delivery-unavailable");
  assert.equal(registrationErrorCode({status:429}),"too-many-attempts");
  assert.equal(registrationErrorCode({code:"unknown-provider-detail"}),"registration-failed");
  assert.doesNotMatch(registrationErrorMessage("<script>private provider detail</script>"),/script|private provider/);
  assert.match(registrationErrorMessage("invalid-registration"),/12–1024/);
  assert.match(registrationErrorMessage("constructor"),/could not create/);
});

test("application URLs select the correct environment and reject unsafe origins", () => {
  assert.equal(applicationUrl({NEXT_PUBLIC_SITE_URL:"http://localhost:3000/"}),"http://localhost:3000");
  assert.equal(applicationUrl({VERCEL_ENV:"production",VERCEL_PROJECT_PRODUCTION_URL:"app.example.com"}),"https://app.example.com");
  assert.equal(applicationUrl({VERCEL_ENV:"preview",VERCEL_URL:"preview.example.com",VERCEL_PROJECT_PRODUCTION_URL:"app.example.com"}),"https://preview.example.com");
  assert.throws(()=>applicationUrl({}),/Configure/);
  assert.throws(()=>applicationUrl({NEXT_PUBLIC_SITE_URL:"http://app.example.com"}),/HTTPS/);
  assert.throws(()=>applicationUrl({NEXT_PUBLIC_SITE_URL:"https://user:password@app.example.com"}),/credentials/);
});

test("authentication redirects retain refreshed cookies and cache protection", () => {
  const cookies=[{name:"session",value:"refreshed",httpOnly:true,path:"/"}];
  const source={cookies:{getAll:()=>cookies},headers:new Headers({"cache-control":"private, no-store","expires":"0","pragma":"no-cache"})};
  const copied=[];
  const target={cookies:{set:cookie=>copied.push(cookie)},headers:new Headers({location:"/login"})};
  assert.equal(copySessionResponse(source,target),target);
  assert.deepEqual(copied,cookies);
  assert.equal(target.headers.get("cache-control"),"private, no-store");
  assert.equal(target.headers.get("location"),"/login");
});

test("CSV neutralizes text formulas while preserving numeric data and quoting", () => {
  for (const value of ["=1+1", "+SUM(A1)", "-1+1", "@SUM(A1)", " \t=1"]) assert.equal(csvCell(value),`"'${value}"`);
  assert.equal(csvCell(-12.5),'"-12.5"');
  assert.equal(csvCell('A "quoted", client'),'"A ""quoted"", client"');
});
test("currency formatting follows document currency and precision", () => {
  assert.equal(currencyDecimals("USD"),2); assert.equal(currencyDecimals("UGX"),0); assert.equal(currencyDecimals("BHD"),3);
  assert.match(formatMoney(0.115,"USD"),/USD.*0\.12/);
  assert.match(formatMoney(123.45,"UGX"),/UGX.*123/);
});
test("exports continue when API caps a page below the requested size", async () => {
  const records=Array.from({length:1003},(_,id)=>({id}));
  const actual=await allRows(async(from,to)=>({data:records.slice(from,Math.min(to+1,from+37)),error:null}));
  assert.deepEqual(actual,records);
  await assert.rejects(allRows(async()=>({data:null,error:{message:"database error"}})),/Unable to load/);
});


test("invoice formats reject unknown tokens and retain long sequences", async () => {
  const { numberFormat, previewInvoiceNumber, contrastingText, designSchema } = await import("../src/lib/invoice-design.ts");
  assert.equal(numberFormat.safeParse("{prefix}/{year}/{month}/{number}").success,true);
  for (const value of ["{number}{number}","{unknown}-{number}","<script>{number}","INV"]) assert.equal(numberFormat.safeParse(value).success,false);
  assert.equal(previewInvoiceNumber("{prefix}/{year}/{month}/{number}","MF",3,1000001,new Date("2026-10-30")),"MF/2026/10/1000001");
  assert.equal(contrastingText("#ffffff"),"#172033");
  assert.equal(contrastingText("#061b6b"),"#ffffff");
  assert.equal(designSchema.safeParse({template:"letterhead"}).success,true);
  assert.equal(designSchema.safeParse({template:"unsupported"}).success,false);
  assert.equal(designSchema.safeParse({accent:"red;display:none"}).success,false);
});

test("expense validation preserves entered amounts, dates and supplier details", async () => {
  const { expenseSchema } = await import("../src/lib/expenses.ts");
  const invoice = {
    businessId: "11111111-1111-4111-8111-111111111111",
    supplier: "  Local supplier  ", expenseDate: "2028-02-29",
    category: "materials", description: "  Stock purchase  ", amount: "1250.50",
    currency: "ZAR", status: "unpaid", invoiceReference: "",
    storagePath: "", filename: "invoice.pdf",
  };
  const parsed = expenseSchema.parse(invoice);
  assert.equal(parsed.amount, 1250.5);
  assert.equal(parsed.supplier, "Local supplier");
  assert.equal(parsed.description, "Stock purchase");
  assert.equal(parsed.expenseDate, "2028-02-29");
  for (const amount of [0, -1, Infinity, NaN, "not a number", 1_000_000_001]) {
    assert.equal(expenseSchema.safeParse({ ...invoice, amount }).success, false);
  }
  assert.equal(expenseSchema.safeParse({ ...invoice, expenseDate: "2027-02-29" }).success, false);
  assert.equal(expenseSchema.safeParse({ ...invoice, businessId: "../other-business" }).success, false);
  assert.equal(expenseSchema.safeParse({ ...invoice, status: "issued" }).success, false);
});

test("invoice branding retains defaults and banking values after validator update", async () => {
  const { designSchema } = await import("../src/lib/invoice-design.ts");
  const design = designSchema.parse({ template: "letterhead", bankName: "  Demo Bank  ", accountNumber: "00123456" });
  assert.equal(design.template, "letterhead");
  assert.equal(design.accent, "#1155cc");
  assert.equal(design.background, "#ffffff");
  assert.equal(design.bankName, "Demo Bank");
  assert.equal(design.accountNumber, "00123456");
  assert.equal(design.paymentInstructions, "");
  assert.equal(design.terms, "");
  assert.equal(design.logoPath, "");
  assert.equal(designSchema.safeParse({ bankName: "x".repeat(161) }).success, false);
});
