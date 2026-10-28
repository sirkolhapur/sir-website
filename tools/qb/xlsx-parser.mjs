// =====================================================================
// SIR question bank — XLSX reader
//
// Reads the first worksheet with SheetJS (passed in as XLSX) using the
// SIR question template already published in the coordinator dashboard:
//   Question_No, Question, Option_A…Option_D, Correct_Answer, Marks,
//   Negative_Marks, Question_Type (TEXT|MATH|IMAGE), Question_LaTeX, Image_Ref
// plus optional columns: Subject, Chapter, Topic, Subtopic, Difficulty,
// Solution, Exam, Source.
//
// Each row becomes one review item (no segmentation needed). The answer
// in Correct_Answer is the sheet's own answer key. Image_Ref names an
// image file uploaded in the same batch; a missing file is reported.
// Images pasted *inside* cells cannot be read by SheetJS and are
// reported, never silently dropped.
//
//   parseXlsx(arrayBuffer, { XLSX, JSZip }, { attachments: Set<string> })
//     → { rows: [{ row, draft, issues, blocking, answer_source, source_text }], warnings }
// =====================================================================

export const TEMPLATE_COLUMNS = ["Question_No", "Question", "Option_A", "Option_B", "Option_C", "Option_D", "Correct_Answer",
  "Marks", "Negative_Marks", "Question_Type", "Question_LaTeX", "Image_Ref"];
export const OPTIONAL_COLUMNS = ["Subject", "Chapter", "Topic", "Subtopic", "Difficulty", "Solution", "Exam", "Source"];

const cell = (r, k) => String(r[k] ?? "").trim();

export async function parseXlsx(buffer, { XLSX, JSZip }, { attachments = new Set() } = {}) {
  const warnings = [];
  if (JSZip) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const embedded = Object.keys(zip.files).filter((p) => p.startsWith("xl/media/"));
      if (embedded.length) warnings.push(`The workbook contains ${embedded.length} picture(s) pasted into cells. They cannot be linked to rows automatically — upload them as image files in the same batch and name them in Image_Ref.`);
    } catch { /* not a zip: SheetJS will report it */ }
  }
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("Workbook has no worksheet");
  if (wb.SheetNames.length > 1) warnings.push(`Only the first worksheet ("${wb.SheetNames[0]}") is read; ${wb.SheetNames.length - 1} other sheet(s) ignored.`);
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  if (!raw.length) throw new Error("No question rows found");
  const headers = Object.keys(raw[0]);
  const missing = ["Question", "Option_A", "Option_B", "Option_C", "Option_D", "Correct_Answer"].filter((h) => !headers.includes(h));
  if (missing.length) throw new Error(`Missing required column(s): ${missing.join(", ")}. Use the SIR template.`);
  const unknown = headers.filter((h) => !TEMPLATE_COLUMNS.includes(h) && !OPTIONAL_COLUMNS.includes(h) && !/^__EMPTY/.test(h));
  if (unknown.length) warnings.push(`Columns not used: ${unknown.join(", ")}`);

  const seen = new Map();
  const rows = raw.map((r, i) => {
    const row = i + 2;
    const issues = [], blocking = [];
    const block = (m) => { issues.push(m); blocking.push(m); };
    const qno = cell(r, "Question_No");
    if (qno && seen.has(qno)) block(`Duplicate Question_No ${qno} (also on row ${seen.get(qno)})`);
    if (qno) seen.set(qno, row);

    let question = cell(r, "Question");
    const latex = cell(r, "Question_LaTeX");
    if (latex) question += (question ? "\n\n" : "") + (/^\$.*\$$/s.test(latex) ? latex : `$$${latex}$$`);
    const type = (cell(r, "Question_Type") || "TEXT").toUpperCase();
    if (!["TEXT", "MATH", "IMAGE"].includes(type)) block(`Question_Type "${type}" must be TEXT, MATH or IMAGE`);
    if (type === "MATH" && !latex) block("Question_Type is MATH but Question_LaTeX is empty");

    const imageRef = cell(r, "Image_Ref");
    if (imageRef) {
      if (attachments.has(imageRef.toLowerCase())) question += `\n\n![Figure](attach:${imageRef})`;
      else block(`Image_Ref "${imageRef}" was not uploaded with this sheet — upload the image file in the same batch`);
    } else if (type === "IMAGE") block("Question_Type is IMAGE but Image_Ref is empty");

    const options = ["A", "B", "C", "D"].map((k) => ({ key: k, text: cell(r, `Option_${k}`) }));
    options.forEach((o) => { if (!o.text) block(`Option ${o.key} is empty`); });
    if (!question) block("Question text is empty");

    const keys = cell(r, "Correct_Answer").toUpperCase().split(/[\s,;/]+/).filter(Boolean);
    let answer = null, qtype = "single";
    if (!keys.length) block("Correct_Answer is empty");
    else if (keys.some((k) => !["A", "B", "C", "D"].includes(k))) block(`Correct_Answer "${cell(r, "Correct_Answer")}" must be A, B, C or D`);
    else if (keys.length === 1) answer = keys[0];
    else { qtype = "multi"; answer = [...new Set(keys)].sort(); }

    const marks = Number(cell(r, "Marks") || 4), negative = Number(cell(r, "Negative_Marks") || 0);
    if (!(marks > 0)) block("Marks must be greater than 0");
    if (!(negative >= 0)) block("Negative_Marks must be 0 or more");
    const difficulty = Math.min(5, Math.max(1, Math.round(Number(cell(r, "Difficulty")) || 2)));

    return {
      row,
      source_number: qno || String(row - 1),
      source_location: `row ${row}`,
      answer_source: answer ? "the spreadsheet's Correct_Answer column" : null,
      source_text: TEMPLATE_COLUMNS.concat(OPTIONAL_COLUMNS).filter((h) => cell(r, h)).map((h) => `${h}: ${cell(r, h)}`).join("\n"),
      given: { subject: cell(r, "Subject").toLowerCase(), chapter: cell(r, "Chapter"), topic: cell(r, "Topic"), subtopic: cell(r, "Subtopic") },
      issues, blocking,
      draft: {
        code: null, subject: null, chapter: null, topic: null, subtopic: null, branch: null,
        type: qtype, difficulty, exam: cell(r, "Exam") ? cell(r, "Exam").toLowerCase().split(/[\s,;]+/).filter(Boolean) : [],
        tags: [], source: cell(r, "Source") || null, status: "live", marks, negative,
        question, options, hint: null, solution: cell(r, "Solution") || null, unit: null, answer, tolerance: 0, figures: [],
      },
    };
  });
  return { rows, warnings };
}
