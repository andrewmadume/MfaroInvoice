import assert from "node:assert/strict";
import test from "node:test";
import { csvCell, currencyDecimals, formatMoney } from "../src/lib/finance.ts";
import { allRows } from "../src/lib/queries.ts";
import { copySessionResponse } from "../src/lib/session-response.ts";
import { applicationUrl } from "../src/lib/site-url.ts";

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
