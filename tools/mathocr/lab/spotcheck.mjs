// Builds the teacher spot-check sheet (one self-contained HTML file):
// every benchmark expression and every held-out option with its source
// crop, the expected formula (our ground truth) and what each system
// produced. The teacher marks "ground truth correct?" and "prototype
// correct?" and exports a CSV. Works offline except for KaTeX (CDN).
//   node spotcheck.mjs  → spotcheck.html
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, "..", "rtest", "x.js"));
const { PNG } = (() => { try { return require("pngjs"); } catch { return {}; } })();
const J = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), "utf8"));
const b64 = (f) => fs.existsSync(f) ? "data:image/png;base64," + fs.readFileSync(f).toString("base64") : "";

const rows = [];
// Benchmark (crops already cut).
const bench = fs.existsSync(path.join(HERE, "proto_bench/score_bench.json")) ? Object.fromEntries(J("proto_bench/score_bench.json").map((r) => [r.id, r])) : {};
for (const [id, t] of Object.entries(J("truth.json").items)) {
  const s = bench[id];
  rows.push({ set: "benchmark", id, img: b64(path.join(HERE, "crops", id + ".png")), expected: t.tex ? `$${t.tex}$` : "(needs annotation: " + t.needs_human + ")", proto: s?.got ?? "", status: s?.status ?? "" });
}
// Held-out: crop each option from the page using the prototype's crop where it exists, else none.
const held = fs.existsSync(path.join(HERE, "proto_held/score_held.json")) ? J("proto_held/score_held.json") : [];
const heldRes = fs.existsSync(path.join(HERE, "proto_held/result.json")) ? J("proto_held/result.json") : null;
const cropsDir = path.join(HERE, "proto_held/crops");
for (const tq of J("held/truth.json").questions) for (const [key, [kind, exp]] of Object.entries(tq.opts)) {
  const id = `p${tq.page}_q${tq.num}${key}`, s = held.find((r) => r.id === id);
  rows.push({ set: "held-out", id, img: b64(path.join(cropsDir, id + ".png")), expected: kind === "formula" ? `$${exp}$` : kind === "text" ? exp : "(graph option)", proto: s?.got ?? "", status: s?.status ?? "" });
}
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Math OCR Spot-check</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js"></script>
<style>body{font:14px system-ui,sans-serif;margin:16px;color:#14213d}h1{font-size:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd;padding:6px;vertical-align:middle}th{background:#f1f3f8;position:sticky;top:0}
td img{max-width:320px;max-height:110px}.id{font:11px monospace}.k{font-size:17px}textarea{width:100%;min-height:34px}label{white-space:nowrap;margin-right:6px}.bar{position:sticky;top:0;background:#fff;padding:8px 0;z-index:2}</style></head><body>
<h1>SIR Math OCR — teacher spot-check</h1>
<p>For each row compare the <b>source crop</b> with (1) the <b>expected formula</b> we wrote and (2) the <b>prototype output</b>. Mark both, add a note if anything is wrong, then press <b>Export CSV</b> and send the file back. Your marks are kept in this browser until you export.</p>
<div class="bar"><button id="exp">Export CSV</button> <span id="cnt"></span></div>
<table><tr><th>#</th><th>set / id</th><th>source crop</th><th>expected (ground truth)</th><th>ground truth correct?</th><th>prototype output</th><th>prototype correct?</th><th>note</th></tr>
${rows.map((r, i) => `<tr data-i="${i}"><td>${i + 1}</td><td class="id">${r.set}<br>${esc(r.id)}<br>${esc(r.status)}</td><td>${r.img ? `<img src="${r.img}" alt="">` : "<i>no crop — see the page</i>"}</td><td class="k">${esc(r.expected)}</td>
<td><label><input type="radio" name="g${i}" value="yes">yes</label><label><input type="radio" name="g${i}" value="no">no</label></td><td class="k">${esc(r.proto)}</td>
<td><label><input type="radio" name="p${i}" value="yes">yes</label><label><input type="radio" name="p${i}" value="no">no</label></td><td><textarea name="n${i}"></textarea></td></tr>`).join("\n")}
</table>
<script>
const ROWS=${JSON.stringify(rows.map((r) => ({ set: r.set, id: r.id, expected: r.expected, proto: r.proto })))};
renderMathInElement(document.body,{delimiters:[{left:"$",right:"$",display:false}],throwOnError:false});
const KEY="sir-mathocr-spotcheck";let saved={};try{saved=JSON.parse(localStorage.getItem(KEY)||"{}")}catch{}
for(const [n,v] of Object.entries(saved)){const el=document.querySelector('[name="'+n+'"]'+(n[0]==="n"?"":'[value="'+v+'"]'));if(el){if(n[0]==="n")el.value=v;else el.checked=true;}}
const count=()=>{document.getElementById("cnt").textContent=ROWS.filter((_,i)=>document.querySelector('[name="g'+i+'"]:checked')).length+" / "+ROWS.length+" rows marked";};count();
document.addEventListener("change",e=>{const t=e.target;saved[t.name]=t.value;try{localStorage.setItem(KEY,JSON.stringify(saved))}catch{};count();});
document.addEventListener("input",e=>{if(e.target.tagName==="TEXTAREA"){saved[e.target.name]=e.target.value;try{localStorage.setItem(KEY,JSON.stringify(saved))}catch{}}});
document.getElementById("exp").onclick=()=>{const q=s=>'"'+String(s??"").replace(/"/g,'""')+'"';const v=(n)=>(document.querySelector('[name="'+n+'"]:checked')||{}).value||"";
const csv=["set,id,expected,prototype,ground_truth_correct,prototype_correct,note"].concat(ROWS.map((r,i)=>[r.set,r.id,q(r.expected),q(r.proto),v("g"+i),v("p"+i),q(document.querySelector('[name="n'+i+'"]').value)].join(","))).join("\\r\\n");
const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\\ufeff"+csv],{type:"text/csv"}));a.download="mathocr-spotcheck.csv";a.click();};
</script></body></html>`;
fs.writeFileSync(path.join(HERE, "spotcheck.html"), html);
console.log("spotcheck.html:", rows.length, "rows,", rows.filter((r) => r.img).length, "with crops");
