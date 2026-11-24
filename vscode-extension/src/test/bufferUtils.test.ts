import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as buf from "../bufferUtils";

describe("bufferUtils", () => {
  it("matchQuoteObject detects inner and around quotes", () => {
    const line = 'const msg = "hello world";';
    assert.equal(buf.matchQuoteObject(line, 14, 24), 'i"');
    assert.equal(buf.matchQuoteObject(line, 13, 25), 'a"');
  });

  it("matchQuoteObject does NOT misclassify space between two separate strings", () => {
    const line = 'foo("bar", "baz")';
    assert.equal(buf.matchQuoteObject(line, 10, 11), null);
  });

  it("matchQuoteObject handles escaped quotes", () => {
    const line = 'const s = "a \\"quoted\\" word";';
    assert.equal(buf.matchQuoteObject(line, 12, 28), 'i"');
  });

  it("matchBracketObject handles nested single-line and multi-line blocks", () => {
    const line = "foo(bar(1, 2), 3)";
    assert.equal(buf.matchBracketObject([line], 1, 5, 1, 16, 1, false), "i(");
    assert.equal(buf.matchBracketObject([line], 1, 4, 1, 17, 1, false), "a(");

    const block = ["function demo() {", "  const a = 1;", "  return a;", "}"];
    assert.equal(buf.matchBracketObject(block, 2, 1, 3, 11, 1, true), "i{");
  });

  it("matchTagObject detects inline and multi-line HTML tags", () => {
    const line = "<button class='x'>Click me</button>";
    assert.equal(buf.matchTagObject([line], 1, 19, 1, 26, 1), "it");
    assert.equal(buf.matchTagObject([line], 1, 1, 1, line.length, 1), "at");

    const multi = ["<div>", "  hello", "</div>"];
    assert.equal(buf.matchTagObject(multi, 2, 1, 2, 7, 1), "it");
  });

  it("matchWordObject detects iw, aw, iW", () => {
    const line = "const my_var = foo.bar();";
    assert.equal(buf.matchWordObject(line, 7, 12), "iw");
    assert.equal(buf.matchWordObject(line, 7, 13), "aw");
    assert.equal(buf.matchWordObject(line, 16, 25), "iW");
  });

  it("matchParagraphObject detects ip and ap", () => {
    const lines = ["", "const a = 1;", "const b = 2;", "const c = 3;", "", "return a;"];
    assert.equal(buf.matchParagraphObject(lines, 2, 4, 1, 6), "ip");
    assert.equal(buf.matchParagraphObject(lines, 2, 5, 1, 6), "ap");
  });

  it("bestCharFind picks practical 1st occurrence and rejects golfy >2 occurrences", () => {
    const line = "const value = compute(alpha, beta, gamma);";
    const cf = buf.bestCharFind(line, 1, 22, true);
    assert.ok(cf);
    assert.equal(cf.motion, "f(");

    const noisy = "aaaaaaa_eeeee_eeeee_eeeee";
    const cfNoisy = buf.bestCharFind(noisy, 1, 22, true);
    assert.equal(cfNoisy, null);
  });

  it("bestCharFind prefers t<delimiter> over f<letter> right before a delimiter", () => {
    const line = "const result = calculate(arg);";
    const cf = buf.bestCharFind(line, 1, 24, true);
    assert.ok(cf);
    assert.equal(cf.motion, "t(");
  });
});
