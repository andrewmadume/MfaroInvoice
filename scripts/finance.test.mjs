import assert from "node:assert/strict";
import test from "node:test";
import { csvCell, currencyDecimals, formatMoney } from "../src/lib/finance.ts";
import { allRows } from "../src/lib/queries.ts";

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
