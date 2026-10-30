// Self-check of the scorer's equivalence rules.
import fs from "node:fs";
const src = fs.readFileSync(new URL("./score.mjs", import.meta.url), "utf8");
fs.writeFileSync(new URL("./_canon.mjs", import.meta.url), src.split("// -------------------------------------------- production")[0] + "\nexport { canon };");
const { canon } = await import("./_canon.mjs");
// [a, b, should the exact forms be equal?]
const pairs = [
  ["{\\frac{1}{2}}", "\\frac{1}{2}", true],
  ["1 0^{2}", "10^{2}", true],
  ["\\mathrm{~N~m^{2}~C}^{-1}", "N\\,m^{2}\\,C^{-1}", true],
  ["\\left(2\\right)", "(2)", true],
  ["\\epsilon_0", "\\varepsilon_{0}", true],
  ["4\\pi\\in_{0}", "4\\pi\\varepsilon_0", true],
  ["\\cfrac{Q}{6}", "\\frac{Q}{6}", true],
  ["\\textstyle{\\sqrt{2}}", "\\sqrt 2", true],
  ["\\frac{q}{m}\\ ;", "\\frac{q}{m}", true],
  ["\\vec r", "\\hat r", false],
  ["\\varepsilon_o", "\\varepsilon_0", false],
  ["10^{-5}", "10^{5}", false],
  ["\\frac{q}{2\\varepsilon_0}", "q/2\\varepsilon_0", false],
  ["2.36\\times10^{10}", "2.36\\times10^{40}", false],
];
let bad = 0;
for (const [a, b, want] of pairs) {
  const A = canon(a), B = canon(b), eq = A.exact === B.exact;
  if (eq !== want) bad++;
  console.log(eq === want ? "ok " : "BAD", eq ? "equal   " : "differ  ", a, "|", b, "|", A.exact, "|", B.exact);
}
console.log(bad ? `${bad} rule(s) wrong` : "all equivalence rules behave as intended");
