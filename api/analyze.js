/**
 * Vercel Serverless Function — DeepSeek V4 Flash literature analysis
 * POST /api/analyze
 * Body: { text: string, filename?: string, papers?: Array<{title, author, year, ...}> }
 *
 * Requires env: DEEPSEEK_API_KEY
 */

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-v4-flash";
const MAX_TEXT_CHARS = 60000;

const DIMENSIONS = [
  { key: "researchPurpose", label: "Research Purpose / Focus" },
  { key: "methodology", label: "Methodology & Sample" },
  { key: "findings", label: "Core Findings / Insights" },
  { key: "limitations", label: "Limitations" },
  { key: "crossReference", label: "Cross-Reference / Divergence" },
  { key: "researchGap", label: "Research Gap Addressed" },
  { key: "futureDirections", label: "Suggested Future Directions" },
];

const UNSTATED = "Not clearly stated in the provided text.";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function extractJson(raw) {
  if (!raw || typeof raw !== "string") {
    throw new Error("Empty model response");
  }

  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      return JSON.parse(fenced[1].trim());
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Model did not return valid JSON");
  }
}

function pickField(paper, keys) {
  for (const key of keys) {
    if (paper[key] != null && String(paper[key]).trim()) {
      return String(paper[key]).trim();
    }
  }
  return UNSTATED;
}

function normalizePaper(parsed, filename) {
  const fallbackTitle = (filename || "Untitled Paper").replace(/\.[^/.]+$/, "");
  const paper = parsed.paper || parsed;

  return {
    title: String(paper.title || fallbackTitle).trim(),
    author: String(paper.author || "Unknown Author").trim(),
    year: String(paper.year || "n.d.").trim(),
    researchPurpose: pickField(paper, ["researchPurpose", "questions", "researchFocus", "purpose"]),
    methodology: pickField(paper, ["methodology", "methods", "sample"]),
    findings: pickField(paper, ["findings", "insights", "coreFindings"]),
    limitations: pickField(paper, ["limitations", "limitation"]),
    crossReference: pickField(paper, ["crossReference", "divergence", "comparison"]),
    researchGap: pickField(paper, ["researchGap", "gap"]),
    futureDirections: pickField(paper, ["futureDirections", "futureWork", "suggestedFutureDirections"]),
  };
}

function paperLabel(p) {
  return `${(p.author || "Unknown").split(",")[0]} (${p.year || "n.d."})`;
}

function buildCompareMatrix(papers) {
  const matrix = { columns: papers.map((p) => paperLabel(p)), rows: {} };
  for (const dim of DIMENSIONS) {
    matrix.rows[dim.key] = {
      label: dim.label,
      cells: papers.map((p) => ({
        label: paperLabel(p),
        value: p[dim.key] || "",
      })),
    };
  }
  return matrix;
}

function summarizeExistingPapers(papers) {
  if (!papers.length) return "None yet — this is the first paper in the matrix.";
  return papers
    .map((p, i) => {
      return [
        `Paper ${i + 1}: ${p.title || "Untitled"} — ${paperLabel(p)}`,
        `  Purpose: ${p.researchPurpose || p.questions || UNSTATED}`,
        `  Findings: ${p.findings || UNSTATED}`,
        `  Gap: ${p.researchGap || UNSTATED}`,
      ].join("\n");
    })
    .join("\n\n");
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "DEEPSEEK_API_KEY is not configured on the server.",
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const filename = typeof body.filename === "string" ? body.filename : "uploaded.pdf";
    const existingPapers = Array.isArray(body.papers) ? body.papers : [];

    if (!text || text.length < 40) {
      return res.status(400).json({
        error: "PDF text is missing or too short to analyze. Try a text-based (non-scanned) PDF.",
      });
    }

    const truncated = text.slice(0, MAX_TEXT_CHARS);
    const normalizedExisting = existingPapers.map((p) => ({
      title: p.title,
      author: p.author,
      year: p.year,
      researchPurpose: p.researchPurpose || p.questions || "",
      methodology: p.methodology || "",
      findings: p.findings || "",
      limitations: p.limitations || "",
      crossReference: p.crossReference || "",
      researchGap: p.researchGap || "",
      futureDirections: p.futureDirections || "",
    }));

    const systemPrompt = [
      "You are ScholarPilot, an academic literature-review analyst.",
      "Extract structured findings ONLY from the provided paper text.",
      "Do not invent citations, statistics, or claims that are not supported by the text.",
      "If a field is unclear, say so briefly instead of hallucinating.",
      "You MUST extract these exact 7 analysis dimensions:",
      "1. Research Purpose / Focus",
      "2. Methodology & Sample",
      "3. Core Findings / Insights",
      "4. Limitations",
      "5. Cross-Reference / Divergence (How this paper agrees/disagrees with others in the matrix)",
      "6. Research Gap Addressed",
      "7. Suggested Future Directions",
      "Respond with a single JSON object (no markdown) using this exact shape:",
      "{",
      '  "paper": {',
      '    "title": string,',
      '    "author": string,',
      '    "year": string,',
      '    "researchPurpose": string,',
      '    "methodology": string,',
      '    "findings": string,',
      '    "limitations": string,',
      '    "crossReference": string,',
      '    "researchGap": string,',
      '    "futureDirections": string',
      "  }",
      "}",
      "For crossReference: explicitly compare agreement/disagreement with previously analyzed papers when provided; if none exist, note that this is the first paper in the matrix.",
      "Keep each field concise (1–3 sentences).",
    ].join("\n");

    const userPrompt = [
      `Filename: ${filename}`,
      "",
      "Previously analyzed papers in the comparison matrix:",
      summarizeExistingPapers(normalizedExisting),
      "",
      "Academic PDF text to analyze:",
      "-----",
      truncated,
      "-----",
    ].join("\n");

    const deepseekRes = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        stream: false,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const deepseekData = await deepseekRes.json().catch(() => ({}));

    if (!deepseekRes.ok) {
      const message =
        deepseekData?.error?.message ||
        deepseekData?.message ||
        `DeepSeek API error (${deepseekRes.status})`;
      return res.status(502).json({
        error: message,
      });
    }

    const content = deepseekData?.choices?.[0]?.message?.content;
    const parsed = extractJson(content);
    const paper = normalizePaper(parsed, filename);

    const allPapers = [...normalizedExisting, paper];
    const matrix = buildCompareMatrix(allPapers);

    return res.status(200).json({
      ok: true,
      model: MODEL,
      paper,
      matrix,
      dimensions: DIMENSIONS,
      paperCount: allPapers.length,
    });
  } catch (err) {
    console.error("analyze error:", err);
    return res.status(500).json({
      error: err.message || "Failed to analyze PDF text.",
    });
  }
};

module.exports.config = {
  maxDuration: 60,
};
