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

function normalizePaper(parsed, filename) {
  const fallbackTitle = (filename || "Untitled Paper").replace(/\.[^/.]+$/, "");
  const paper = parsed.paper || parsed;

  return {
    title: String(paper.title || fallbackTitle).trim(),
    author: String(paper.author || "Unknown Author").trim(),
    year: String(paper.year || "n.d.").trim(),
    questions: String(paper.questions || paper.researchPurpose || "Not clearly stated in the provided text.").trim(),
    methodology: String(paper.methodology || "Not clearly stated in the provided text.").trim(),
    findings: String(paper.findings || "Not clearly stated in the provided text.").trim(),
    limitations: String(paper.limitations || "Not clearly stated in the provided text.").trim(),
    utility: String(paper.utility || "Use this paper to support related literature-review arguments.").trim(),
    quotes: String(paper.quotes || "").trim(),
    matrixFocus: String(paper.matrixFocus || paper.questions || "").trim(),
    matrixMethod: String(paper.matrixMethod || paper.methodology || "").trim(),
    matrixFindings: String(paper.matrixFindings || paper.findings || "").trim(),
  };
}

function buildCompareMatrix(papers) {
  return {
    researchFocus: papers.map((p) => ({
      label: `${(p.author || "Unknown").split(",")[0]} (${p.year || "n.d."})`,
      value: p.matrixFocus || p.questions || "",
    })),
    methods: papers.map((p) => ({
      label: `${(p.author || "Unknown").split(",")[0]} (${p.year || "n.d."})`,
      value: p.matrixMethod || p.methodology || "",
    })),
    insights: papers.map((p) => ({
      label: `${(p.author || "Unknown").split(",")[0]} (${p.year || "n.d."})`,
      value: p.matrixFindings || p.findings || "",
    })),
  };
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

    const systemPrompt = [
      "You are ScholarPilot, an academic literature-review analyst.",
      "Extract structured findings ONLY from the provided paper text.",
      "Do not invent citations, statistics, or claims that are not supported by the text.",
      "If a field is unclear, say so briefly instead of hallucinating.",
      "Respond with a single JSON object (no markdown) using this exact shape:",
      "{",
      '  "paper": {',
      '    "title": string,',
      '    "author": string,',
      '    "year": string,',
      '    "questions": string,',
      '    "methodology": string,',
      '    "findings": string,',
      '    "limitations": string,',
      '    "utility": string,',
      '    "quotes": string,',
      '    "matrixFocus": string,',
      '    "matrixMethod": string,',
      '    "matrixFindings": string',
      "  }",
      "}",
      "Keep each field concise (1–3 sentences).",
    ].join("\n");

    const userPrompt = [
      `Filename: ${filename}`,
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
      return res.status(deepseekRes.status === 401 ? 502 : 502).json({
        error: message,
      });
    }

    const content = deepseekData?.choices?.[0]?.message?.content;
    const parsed = extractJson(content);
    const paper = normalizePaper(parsed, filename);

    const allPapers = [...existingPapers.map((p) => ({
      title: p.title,
      author: p.author,
      year: p.year,
      questions: p.questions,
      methodology: p.methodology,
      findings: p.findings,
      limitations: p.limitations,
      matrixFocus: p.matrixFocus,
      matrixMethod: p.matrixMethod,
      matrixFindings: p.matrixFindings,
    })), paper];

    const matrix = buildCompareMatrix(allPapers);

    return res.status(200).json({
      ok: true,
      model: MODEL,
      paper,
      matrix,
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
