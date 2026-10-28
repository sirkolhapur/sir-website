// =====================================================================
// SIR question bank — DOCX reader
//
// Reads word/document.xml directly (no lossy converter) and returns
// lines for pdf-parser.mjs's segmentQuestions(), plus the embedded media
// files byte-for-byte. Dependencies are passed in so the same code runs
// in the browser (window.JSZip, window.DOMParser) and in Node tests.
//
//   parseDocx(arrayBuffer, { JSZip, DOMParser }) →
//     { lines, media: { "word/media/image1.png": { bytes, mime } }, warnings }
//
// Exact conversions only: Word super/subscript runs → ^{}/_{} ; Word
// equations (OMML) → LaTeX element by element. Anything that cannot be
// converted faithfully is kept (as text or image) and reported.
// =====================================================================

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const V = "urn:schemas-microsoft-com:vml";

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp",
  webp: "image/webp", svg: "image/svg+xml", emf: "image/x-emf", wmf: "image/x-wmf", tif: "image/tiff", tiff: "image/tiff" };
export const WEB_IMAGE = /^image\/(png|jpeg|gif|webp|svg\+xml|bmp)$/;

// Adobe Symbol font layout (what Word's w:sym with font "Symbol" uses).
const SYMBOL_FONT = {
  a: "α", b: "β", c: "χ", d: "δ", e: "ε", f: "φ", g: "γ", h: "η", i: "ι", j: "ϕ", k: "κ", l: "λ", m: "μ", n: "ν", o: "ο",
  p: "π", q: "θ", r: "ρ", s: "σ", t: "τ", u: "υ", w: "ω", x: "ξ", y: "ψ", z: "ζ",
  A: "Α", B: "Β", C: "Χ", D: "Δ", E: "Ε", F: "Φ", G: "Γ", H: "Η", I: "Ι", K: "Κ", L: "Λ", M: "Μ", N: "Ν", O: "Ο",
  P: "Π", Q: "Θ", R: "Ρ", S: "Σ", T: "Τ", U: "Υ", W: "Ω", X: "Ξ", Y: "Ψ", Z: "Ζ",
  "´": "×", "¸": "÷", "±": "±", "£": "≤", "³": "≥", "¹": "≠", "»": "≈", "®": "→",
  "¬": "←", "Û": "⇔", "Þ": "⇒", "¥": "∞", "¶": "∂", "Ö": "√", "å": "∑", "ò": "∫",
  "°": "°", "¢": "′", "²": "″", "Ñ": "∇", "Î": "∈", "µ": "∝", "-": "−", "+": "+", "=": "=",
};

const kids = (el) => Array.from(el?.childNodes || []).filter((n) => n.nodeType === 1);
const local = (el) => el.localName || String(el.nodeName).replace(/^.*:/, "");
const attr = (el, ns, name) => el?.getAttributeNS?.(ns, name) ?? el?.getAttribute?.(`w:${name}`) ?? null;
const first = (el, ns, name) => el ? (el.getElementsByTagNameNS(ns, name)[0] || null) : null;

// ---------------------------------------------------------------------
// OMML → LaTeX
// ---------------------------------------------------------------------
const NARY = { "∑": "\\sum", "∫": "\\int", "∬": "\\iint", "∭": "\\iiint", "∮": "\\oint", "∏": "\\prod", "⋃": "\\bigcup", "⋂": "\\bigcap" };
const ACCENT = { "⃗": "\\vec", "→": "\\vec", "̂": "\\hat", "^": "\\hat", "̇": "\\dot", "̈": "\\ddot", "̅": "\\bar", "¯": "\\bar", "̃": "\\tilde", "~": "\\tilde" };
const FUNCS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "exp", "lim", "max", "min", "sinh", "cosh", "tanh", "arcsin", "arccos", "arctan", "det"]);
const texEscape = (s) => s.replace(/[\\{}#%&$]/g, (c) => (c === "\\" ? "\\backslash " : "\\" + c));

export function ommlToLatex(node, unknown = new Set()) {
  const conv = (n) => ommlToLatex(n, unknown);
  const part = (el, name) => { const c = kids(el).find((k) => local(k) === name); return c ? conv(c) : ""; };
  const prop = (el, prName, valName) => {
    const pr = kids(el).find((k) => local(k) === prName);
    const v = pr && kids(pr).find((k) => local(k) === valName);
    return v ? (v.getAttributeNS(M, "val") ?? v.getAttribute("m:val")) : null;
  };
  const name = local(node);
  switch (name) {
    case "oMathPara": return kids(node).filter((k) => local(k) === "oMath").map(conv).join(" \\\\ ");
    case "oMath": case "e": case "num": case "den": case "sup": case "sub": case "deg": case "lim": case "fName":
    case "box": case "borderBox": case "phant": case "groupChr":
      return kids(node).map(conv).join("");
    case "r": {
      const t = kids(node).filter((k) => local(k) === "t").map((k) => k.textContent).join("");
      const plain = !!first(node, M, "nor");
      if (plain && /[A-Za-z]{2,}/.test(t)) return `\\text{${texEscape(t)}}`;
      if (FUNCS.has(t.trim())) return `\\${t.trim()} `;
      return texEscape(t);
    }
    case "f": {
      const type = prop(node, "fPr", "type");
      const n = part(node, "num"), d = part(node, "den");
      return type === "lin" ? `${n}/${d}` : type === "noBar" ? `\\binom{${n}}{${d}}` : `\\frac{${n}}{${d}}`;
    }
    case "sSup": return `{${part(node, "e")}}^{${part(node, "sup")}}`;
    case "sSub": return `{${part(node, "e")}}_{${part(node, "sub")}}`;
    case "sSubSup": return `{${part(node, "e")}}_{${part(node, "sub")}}^{${part(node, "sup")}}`;
    case "sPre": return `{}_{${part(node, "sub")}}^{${part(node, "sup")}}{${part(node, "e")}}`;
    case "rad": { const deg = part(node, "deg"); return deg ? `\\sqrt[${deg}]{${part(node, "e")}}` : `\\sqrt{${part(node, "e")}}`; }
    case "d": {
      const beg = prop(node, "dPr", "begChr") ?? "(", end = prop(node, "dPr", "endChr") ?? ")";
      const sep = prop(node, "dPr", "sepChr") ?? ",";
      const L = { "(": "(", "[": "[", "{": "\\{", "|": "|", "‖": "\\|", "⟨": "\\langle", "": "." }, Rr = { ")": ")", "]": "]", "}": "\\}", "|": "|", "‖": "\\|", "⟩": "\\rangle", "": "." };
      const inner = kids(node).filter((k) => local(k) === "e").map(conv).join(sep === "|" ? " \\mid " : sep);
      return `\\left${L[beg] ?? texEscape(beg)} ${inner} \\right${Rr[end] ?? texEscape(end)}`;
    }
    case "nary": {
      const chr = prop(node, "naryPr", "chr") ?? "∫";
      const sub = part(node, "sub"), sup = part(node, "sup");
      return `${NARY[chr] ?? texEscape(chr)}${sub ? `_{${sub}}` : ""}${sup ? `^{${sup}}` : ""} ${part(node, "e")}`;
    }
    case "acc": { const chr = prop(node, "accPr", "chr") ?? "̂"; return `${ACCENT[chr] ?? "\\hat"}{${part(node, "e")}}`; }
    case "bar": return `\\overline{${part(node, "e")}}`;
    case "func": return `${part(node, "fName")}${part(node, "e")}`;
    case "limLow": return `{${part(node, "e")}}_{${part(node, "lim")}}`;
    case "limUpp": return `{${part(node, "e")}}^{${part(node, "lim")}}`;
    case "eqArr": return `\\begin{aligned}${kids(node).filter((k) => local(k) === "e").map(conv).join(" \\\\ ")}\\end{aligned}`;
    case "m": return `\\begin{matrix}${kids(node).filter((k) => local(k) === "mr").map((r) => kids(r).filter((k) => local(k) === "e").map(conv).join(" & ")).join(" \\\\ ")}\\end{matrix}`;
    default:
      if (/Pr$/.test(name) || name === "ctrlPr") return "";
      unknown.add(name);
      return kids(node).map(conv).join("");
  }
}

// ---------------------------------------------------------------------
// Numbering (numbering.xml): rebuild "1.", "(a)" … that Word generates
// ---------------------------------------------------------------------
function toRoman(n) {
  const map = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = ""; for (const [v, s] of map) while (n >= v) { out += s; n -= v; } return out;
}
function fmtNum(n, fmt) {
  switch (fmt) {
    case "lowerLetter": return String.fromCharCode(96 + ((n - 1) % 26) + 1);
    case "upperLetter": return String.fromCharCode(64 + ((n - 1) % 26) + 1);
    case "lowerRoman": return toRoman(n);
    case "upperRoman": return toRoman(n).toUpperCase();
    case "bullet": case "none": return "";
    default: return String(n);
  }
}
function readNumbering(doc) {
  if (!doc) return { numToAbs: {}, abs: {} };
  const abs = {}, numToAbs = {};
  for (const an of Array.from(doc.getElementsByTagNameNS(W, "abstractNum"))) {
    const id = attr(an, W, "abstractNumId"); abs[id] = {};
    for (const lvl of Array.from(an.getElementsByTagNameNS(W, "lvl"))) {
      const il = attr(lvl, W, "ilvl");
      abs[id][il] = {
        fmt: attr(first(lvl, W, "numFmt"), W, "val") || "decimal",
        text: attr(first(lvl, W, "lvlText"), W, "val") ?? "%1.",
        start: Number(attr(first(lvl, W, "start"), W, "val") || 1),
      };
    }
  }
  for (const num of Array.from(doc.getElementsByTagNameNS(W, "num"))) {
    numToAbs[attr(num, W, "numId")] = attr(first(num, W, "abstractNumId"), W, "val");
  }
  return { numToAbs, abs };
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
export async function parseDocx(buffer, { JSZip, DOMParser }) {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (p) => (zip.file(p) ? zip.file(p).async("string") : null);
  const xml = (s) => (s ? new DOMParser().parseFromString(s, "application/xml") : null);
  const docXml = await read("word/document.xml");
  if (!docXml) throw new Error("Not a Word document (word/document.xml missing)");
  const doc = xml(docXml);
  const rels = xml(await read("word/_rels/document.xml.rels"));
  const relTarget = {};
  for (const rel of Array.from(rels?.getElementsByTagName("Relationship") || [])) {
    const t = rel.getAttribute("Target");
    relTarget[rel.getAttribute("Id")] = t.startsWith("/") ? t.slice(1) : `word/${t}`;
  }
  const numbering = readNumbering(xml(await read("word/numbering.xml")));
  // Numbering can also come from the paragraph style ("List Number"),
  // possibly inherited through basedOn.
  const styleNum = {}, styleBase = {};
  for (const st of Array.from(xml(await read("word/styles.xml"))?.getElementsByTagNameNS(W, "style") || [])) {
    const id = attr(st, W, "styleId");
    const np = first(first(st, W, "pPr"), W, "numPr");
    if (np) styleNum[id] = { numId: attr(first(np, W, "numId"), W, "val"), ilvl: attr(first(np, W, "ilvl"), W, "val") || "0" };
    const based = first(st, W, "basedOn");
    if (based) styleBase[id] = attr(based, W, "val");
  }
  const styleNumPr = (styleId) => {
    for (let s = styleId, guard = 0; s && guard < 10; s = styleBase[s], guard++) if (styleNum[s]) return styleNum[s];
    return null;
  };
  const counters = {};
  const warnings = [];
  const unknownMath = new Set();
  const usedMedia = new Set();
  let equations = 0, objects = 0;

  const imageRef = (rid, label) => {
    const target = relTarget[rid];
    if (!target) { warnings.push(`Image relationship ${rid} not found`); return ""; }
    usedMedia.add(target);
    return ` ![${label}](docx-media:${target}) `;
  };

  // Text of one run, honouring super/subscript formatting exactly.
  const runText = (r) => {
    let t = "";
    for (const c of kids(r)) {
      const n = local(c);
      if (n === "t") t += c.textContent;
      else if (n === "tab") t += " ";
      else if (n === "br" || n === "cr") t += "\n";
      else if (n === "sym") {
        // Word "Symbol" font characters (private-use F0xx) → real Unicode.
        const code = parseInt(attr(c, W, "char") || "0", 16) & 0xff;
        const ch = SYMBOL_FONT[String.fromCharCode(code)];
        if (ch) t += ch; else { t += "�"; warnings.push(`Unknown Symbol-font character 0x${code.toString(16)} — check the text`); }
      }
      else if (n === "drawing") { const blip = first(c, A, "blip"); if (blip) t += imageRef(blip.getAttributeNS(R, "embed"), "Figure"); }
      else if (n === "object" || n === "pict") {
        const img = first(c, V, "imagedata");
        if (img) { objects++; t += imageRef(img.getAttributeNS(R, "id"), "Equation object"); }
      }
    }
    const va = attr(first(first(r, W, "rPr"), W, "vertAlign"), W, "val");
    if (t.trim() && va === "superscript") return `$^{${texEscape(t.trim())}}$`;
    if (t.trim() && va === "subscript") return `$_{${texEscape(t.trim())}}$`;
    return t;
  };

  const paraText = (p) => {
    let out = "";
    for (const c of kids(p)) {
      const n = local(c);
      if (n === "r") out += runText(c);
      else if (n === "hyperlink" || n === "smartTag" || n === "ins" || n === "fldSimple") out += kids(c).filter((k) => local(k) === "r").map(runText).join("");
      else if (n === "oMath" || n === "oMathPara") {
        equations++;
        const tex = ommlToLatex(c, unknownMath).replace(/\s+/g, " ").trim();
        out += n === "oMathPara" ? `\n$$${tex}$$\n` : `$${tex}$`;
      }
    }
    // Merge adjacent super/subscript fragments onto their base ("10" + "$^{-19}$" → "$10^{-19}$" is left to KaTeX: "10$^{-19}$" renders the same).
    return out;
  };

  const numberPrefix = (p) => {
    const pPr = first(p, W, "pPr");
    const numPr = first(pPr, W, "numPr");
    const fromStyle = styleNumPr(attr(first(pPr, W, "pStyle"), W, "val"));
    if (!numPr && !fromStyle) return "";
    const numId = (numPr && attr(first(numPr, W, "numId"), W, "val")) || fromStyle?.numId;
    const ilvl = (numPr && attr(first(numPr, W, "ilvl"), W, "val")) || fromStyle?.ilvl || "0";
    const absId = numbering.numToAbs[numId];
    const lv = numbering.abs[absId]?.[ilvl];
    if (!lv || numId === "0") return "";
    const key = `${absId}`;
    counters[key] ??= {};
    counters[key][ilvl] = (counters[key][ilvl] ?? lv.start - 1) + 1;
    for (const deeper of Object.keys(counters[key])) if (Number(deeper) > Number(ilvl)) delete counters[key][deeper];
    const label = lv.text.replace(/%(\d)/g, (_, k) => {
      const lvK = String(Number(k) - 1), def = numbering.abs[absId]?.[lvK];
      return fmtNum(counters[key][lvK] ?? def?.start ?? 1, def?.fmt ?? "decimal");
    });
    return label ? label + " " : "";
  };

  const lines = [];
  let para = 0;
  const push = (text) => {
    for (const piece of text.split("\n")) {
      if (!piece.trim()) continue;
      lines.push({ text: piece.replace(/[ \t]+/g, " ").trim(), page: 1, para, x0: 0, x1: 1000, y0: lines.length * 20, y1: lines.length * 20 + 18, conf: null });
    }
  };
  const body = first(doc, W, "body");
  for (const block of kids(body)) {
    const n = local(block);
    if (n === "p") { para++; push(numberPrefix(block) + paraText(block)); }
    else if (n === "tbl") {
      const rows = Array.from(block.getElementsByTagNameNS(W, "tr")).map((tr) =>
        kids(tr).filter((k) => local(k) === "tc").map((tc) => kids(tc).filter((k) => local(k) === "p").map(paraText).join(" ").replace(/\|/g, "\\|").trim()));
      if (rows.length) {
        para++;
        push(`| ${rows[0].join(" | ")} |`);
        push(`|${rows[0].map(() => "---").join("|")}|`);
        rows.slice(1).forEach((r) => push(`| ${r.join(" | ")} |`));
      }
    }
  }

  const media = {};
  for (const path of Object.keys(zip.files).filter((p) => p.startsWith("word/media/"))) {
    const ext = path.split(".").pop().toLowerCase();
    media[path] = { bytes: await zip.file(path).async("uint8array"), mime: MIME[ext] || "application/octet-stream", used: usedMedia.has(path) };
  }
  if (unknownMath.size) warnings.push(`Some Word equation parts could not be converted exactly (${[...unknownMath].join(", ")}) — check those formulas`);
  if (objects) warnings.push(`${objects} embedded equation/object picture(s) (e.g. MathType) kept as images — retype them as LaTeX if they are equations`);
  const unused = Object.entries(media).filter(([, m]) => !m.used).length;
  if (unused) warnings.push(`${unused} media file(s) in the document are not placed in the text (kept with the original)`);
  return { lines, media, warnings, stats: { paragraphs: para, equations, objects } };
}
