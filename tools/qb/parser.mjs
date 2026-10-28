// =====================================================================
// SIR question bank — Markdown question parser
//
// Dependency-free ES module. Runs in Node (tools/qb/qb.mjs) and in the
// browser (coordinator dashboard upload), so both paths validate a
// question exactly the same way.
//
// File format (one question per .md file — see question-bank/README.md):
//
//   ---
//   id: PHY-KIN-0001
//   subject: physics
//   chapter: kinematics
//   topic: motion-under-gravity
//   type: single            # single | multi | integer | numerical | matrix_match
//   difficulty: 1           # 1–5
//   exam: [jee-main, neet]
//   answer: B               # multi: [A, C]  numerical: 0.25  matrix: {A: [Q], B: [P, R]}
//   ---
//   ## Question
//   …markdown + $LaTeX$…
//   ## Options
//   (A) …
//   (B) …
//   ## Hint
//   ## Solution
// =====================================================================

export const QUESTION_TYPES = ["single", "multi", "integer", "numerical", "matrix_match"];
export const STATUSES = ["draft", "live", "retired"];

const CODE_RE = /^[A-Z]{2,4}-[A-Z0-9]{2,4}-[0-9]{4,6}$/;

// ---------------------------------------------------------------------
// Minimal YAML-ish frontmatter: `key: value` lines, inline [a, b] lists,
// inline {A: [P], B: Q} maps, block "- item" lists, # comments.
// ---------------------------------------------------------------------
function stripComment(line) {
  let inQuote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) { if (ch === inQuote) inQuote = null; continue; }
    if (ch === '"' || ch === "'") { inQuote = ch; continue; }
    if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v === "" || v === "~" || v === "null") return null;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) return Number(v);
  if (v.startsWith("[") && v.endsWith("]")) return splitTop(v.slice(1, -1)).map(parseScalar).filter(x => x !== null);
  if (v.startsWith("{") && v.endsWith("}")) {
    const out = {};
    for (const pair of splitTop(v.slice(1, -1))) {
      const idx = pair.indexOf(":");
      if (idx === -1) throw new Error(`Bad map entry "${pair}"`);
      const val = parseScalar(pair.slice(idx + 1));
      out[pair.slice(0, idx).trim()] = Array.isArray(val) ? val : (val === null ? [] : [val]);
    }
    return out;
  }
  return v;
}

// Split "a, [b, c], {d: e}" on top-level commas.
function splitTop(s) {
  const parts = [];
  let depth = 0, cur = "", q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === "[" || ch === "{") depth++;
    if (ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) { if (cur.trim()) parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function parseFrontmatter(text) {
  const meta = {};
  let lastKey = null;
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = stripComment(rawLine).replace(/\s+$/, "");
    if (!line.trim()) return;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && lastKey) {
      if (!Array.isArray(meta[lastKey])) meta[lastKey] = [];
      meta[lastKey].push(parseScalar(item[1]));
      return;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) throw new Error(`Frontmatter line ${i + 1} is not "key: value": ${rawLine}`);
    lastKey = kv[1].toLowerCase();
    meta[lastKey] = parseScalar(kv[2]);
  });
  return meta;
}

// ---------------------------------------------------------------------
// Body sections (## Heading) and option lists
// ---------------------------------------------------------------------
function splitSections(body) {
  const sections = {};
  let current = null;
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      current = h[1].trim().toLowerCase().replace(/\s+/g, " ");
      sections[current] = [];
      continue;
    }
    if (current) sections[current].push(line);
  }
  for (const k of Object.keys(sections)) sections[k] = sections[k].join("\n").trim();
  return sections;
}

// "(A) text" / "A) text" / "- (A) text" / "A. text"; continuation lines
// belong to the previous option.
function parseOptions(text, keyPattern) {
  const re = new RegExp(`^\\s*(?:[-*]\\s+)?\\(?(${keyPattern})[).]\\s*(.*)$`);
  const opts = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) opts.push({ key: m[1].toUpperCase(), text: m[2] });
    else if (opts.length && line.trim()) opts[opts.length - 1].text += "\n" + line.trim();
  }
  return opts.map(o => ({ key: o.key, text: o.text.trim() }));
}

function pickSection(sections, ...names) {
  for (const n of names) if (sections[n] !== undefined && sections[n] !== "") return sections[n];
  return null;
}

// ---------------------------------------------------------------------
// Hash (stable across Node and browser): first 12 hex of SHA-256
// ---------------------------------------------------------------------
function stableStringify(v) {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  }
  return JSON.stringify(v ?? null);
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------
// Public: parse one file → question object (throws on format errors)
// ---------------------------------------------------------------------
export async function parseQuestion(source, fileName = "") {
  const text = source.replace(/^﻿/, "");
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fm) throw new Error("Missing frontmatter (--- … ---) at the top of the file");

  const meta = parseFrontmatter(fm[1]);
  const sections = splitSections(fm[2]);
  const type = String(meta.type || "").toLowerCase();

  const q = {
    code: String(meta.id || meta.code || "").trim().toUpperCase(),
    subject: String(meta.subject || "").trim().toLowerCase(),
    chapter: String(meta.chapter || "").trim().toLowerCase(),
    topic: String(meta.topic || "").trim().toLowerCase(),
    subtopic: meta.subtopic ? String(meta.subtopic).trim().toLowerCase() : null,
    branch: meta.branch ? String(meta.branch).trim().toLowerCase() : null,
    type,
    difficulty: meta.difficulty,
    exam: toList(meta.exam).map(x => String(x).toLowerCase()),
    tags: toList(meta.tags).map(x => String(x).toLowerCase()),
    source: meta.source ? String(meta.source) : "original",
    status: meta.status ? String(meta.status).toLowerCase() : "draft",
    marks: meta.marks ?? 4,
    negative: meta.negative ?? (type === "single" || type === "multi" ? 1 : 0),
    question: pickSection(sections, "question"),
    options: null,
    hint: pickSection(sections, "hint"),
    solution: pickSection(sections, "solution"),
    unit: meta.unit != null ? String(meta.unit) : null,
    answer: meta.answer,
    tolerance: meta.tolerance ?? 0,
    source_file: fileName ? fileName.replace(/\\/g, "/").split("/").pop() : null
  };
  if (q.status === "ready") q.status = "live";

  if (type === "single" || type === "multi") {
    const optText = pickSection(sections, "options");
    q.options = optText ? parseOptions(optText, "[A-Ha-h]") : [];
  } else if (type === "matrix_match") {
    const left = pickSection(sections, "column i", "column 1", "list i", "list 1");
    const right = pickSection(sections, "column ii", "column 2", "list ii", "list 2");
    q.options = {
      left: left ? parseOptions(left, "[A-Ha-h]") : [],
      right: right ? parseOptions(right, "[P-Zp-z]|[1-9]") : []
    };
  }

  q.answer = normaliseAnswer(type, q.answer);

  const hashed = { ...q };
  delete hashed.source_file;
  q.content_hash = (await sha256Hex(stableStringify(hashed))).slice(0, 12);
  return q;
}

function toList(v) {
  if (v == null || v === "") return [];
  return Array.isArray(v) ? v : String(v).split(",").map(s => s.trim()).filter(Boolean);
}

function normaliseAnswer(type, a) {
  if (a == null) return null;
  if (type === "single") return String(a).trim().replace(/[()]/g, "").toUpperCase();
  if (type === "multi") return toList(a).map(x => String(x).trim().replace(/[()]/g, "").toUpperCase()).sort();
  if (type === "integer" || type === "numerical") return typeof a === "number" ? a : Number(String(a).trim());
  if (type === "matrix_match") {
    if (typeof a !== "object" || Array.isArray(a)) return a;
    const out = {};
    for (const [k, v] of Object.entries(a)) out[k.toUpperCase()] = toList(v).map(x => String(x).toUpperCase()).sort();
    return out;
  }
  return a;
}

// ---------------------------------------------------------------------
// Public: validate a parsed question against the taxonomy.
// Returns an array of human-readable problems ([] = valid).
// ---------------------------------------------------------------------
export function validateQuestion(q, taxonomy) {
  const errs = [];
  const err = m => errs.push(m);

  if (!CODE_RE.test(q.code)) err(`id "${q.code}" must look like PHY-KIN-0001`);
  if (!QUESTION_TYPES.includes(q.type)) err(`type must be one of ${QUESTION_TYPES.join(", ")}`);
  if (!Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 5) err("difficulty must be a whole number 1–5");
  if (!STATUSES.includes(q.status)) err(`status must be one of ${STATUSES.join(", ")}`);
  if (!q.question) err('missing "## Question" section');

  const subject = taxonomy.subjects.find(s => s.id === q.subject);
  if (!subject) {
    err(`unknown subject "${q.subject}"`);
  } else {
    const chapter = subject.chapters.find(c => c.slug === q.chapter);
    if (!chapter) {
      err(`unknown chapter "${q.chapter}" in ${subject.id}`);
    } else {
      const expectedPrefix = `${subject.code}-${chapter.code}-`;
      if (q.code && !q.code.startsWith(expectedPrefix)) err(`id should start with ${expectedPrefix} for ${chapter.name}`);
      const topic = (chapter.topics || []).map(normTopic).find(t => t.slug === q.topic);
      if (!topic) {
        err(`unknown topic "${q.topic}" in chapter ${chapter.slug}`);
      } else if (q.subtopic && !topic.subtopics.some(st => st.slug === q.subtopic)) {
        err(`unknown subtopic "${q.subtopic}" in topic ${topic.slug}`);
      }
      if (q.branch && !(chapter.branches || []).includes(q.branch)) {
        err(`branch "${q.branch}" is not valid for ${chapter.slug}`);
      }
    }
  }

  const examIds = (taxonomy.exam_tags || DEFAULT_EXAM_TAGS).map(e => e.id || e);
  q.exam.forEach(e => { if (!examIds.includes(e)) err(`unknown exam tag "${e}" (use ${examIds.join(", ")})`); });

  if (q.type === "single" || q.type === "multi") {
    const keys = (q.options || []).map(o => o.key);
    if (keys.length < 2) err('need at least 2 options under "## Options", e.g. "(A) …"');
    if (new Set(keys).size !== keys.length) err("duplicate option letters");
    (q.options || []).forEach(o => { if (!o.text) err(`option (${o.key}) is empty`); });
    if (q.type === "single" && !keys.includes(q.answer)) err(`answer "${q.answer}" is not one of the options ${keys.join(", ")}`);
    if (q.type === "multi") {
      if (!Array.isArray(q.answer) || !q.answer.length) err("multi-correct answer must be a list like [A, C]");
      else q.answer.forEach(a => { if (!keys.includes(a)) err(`answer "${a}" is not one of the options`); });
    }
  } else if (q.type === "integer") {
    if (!Number.isInteger(q.answer)) err("integer answer must be a whole number");
  } else if (q.type === "numerical") {
    if (typeof q.answer !== "number" || Number.isNaN(q.answer)) err("numerical answer must be a number");
    if (typeof q.tolerance !== "number" || q.tolerance < 0) err("tolerance must be a number ≥ 0");
  } else if (q.type === "matrix_match") {
    const left = q.options?.left?.map(o => o.key) || [];
    const right = q.options?.right?.map(o => o.key) || [];
    if (!left.length || !right.length) err('matrix-match needs "## Column I" (A, B, …) and "## Column II" (P, Q, … or 1, 2, …)');
    if (!q.answer || typeof q.answer !== "object" || Array.isArray(q.answer)) err("matrix-match answer must look like {A: [Q], B: [P, R]}");
    else for (const [k, v] of Object.entries(q.answer)) {
      if (!left.includes(k)) err(`answer row "${k}" is not in Column I`);
      v.forEach(x => { if (!right.includes(x)) err(`answer "${k}: ${x}" is not in Column II`); });
    }
  }

  // A worked solution is optional: many source books print none, and one
  // must never be invented to satisfy a rule.
  return errs;
}

export const DEFAULT_EXAM_TAGS = ["jee-main", "jee-adv", "neet", "mht-cet", "boards", "foundation", "olympiad"];

// Taxonomy topics are written as [slug, label] or {slug, label, subtopics}.
export function normTopic(t) {
  if (Array.isArray(t)) return { slug: t[0], label: t[1], subtopics: [] };
  return {
    slug: t.slug,
    label: t.label,
    subtopics: (t.subtopics || []).map(st => Array.isArray(st) ? { slug: st[0], label: st[1] } : st)
  };
}

// Parse + validate many files; never throws. Used by CLI and dashboard.
// files: [{ name, text }]
export async function parseMany(files, taxonomy) {
  const ok = [], failed = [];
  const seen = new Map();
  for (const f of files) {
    try {
      const q = await parseQuestion(f.text, f.name);
      const errors = validateQuestion(q, taxonomy);
      if (seen.has(q.code)) errors.push(`duplicate id — also used in ${seen.get(q.code)}`);
      seen.set(q.code, f.name);
      if (errors.length) failed.push({ file: f.name, code: q.code, errors });
      else ok.push(q);
    } catch (e) {
      failed.push({ file: f.name, code: null, errors: [e.message] });
    }
  }
  return { ok, failed };
}
