// ============================================================
// DRIVE SCORE — Netlify Function: Image Extraction via Claude
// ============================================================
// Calls Claude API directly from Netlify's edge — no Apps Script middleman.
// Set CLAUDE_API_KEY in Netlify environment variables (Site > Settings > Environment variables)
// ============================================================

const CLAUDE_MODEL = "claude-sonnet-4-20250514";

exports.handler = async function (event) {
  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const data = JSON.parse(event.body);
    const imageBase64 = data.image;
    const state = data.state || "";

    if (!imageBase64) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "No image provided" }) };
    }

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "API key not configured" }) };
    }

    // State-specific DOB instructions
    let dobInstruction = "";
    if (state === "Georgia") {
      dobInstruction = "For the date of birth, extract ONLY the year of birth (4-digit year). Return it in the 'yearOfBirth' field.";
    } else if (state === "North Carolina") {
      dobInstruction = "Do NOT extract any date of birth information. Leave dob and yearOfBirth empty.";
    } else {
      dobInstruction = "Extract the full date of birth. Dates on these forms are typically written as M/D/YY or MM/DD/YYYY with slashes between the parts. Read each number separately: the first number before the first slash is the MONTH, the second number between the slashes is the DAY, and the last number after the second slash is the YEAR. If the year is 2 digits (like 74), convert to 4 digits (1974). Return in MM/DD/YYYY format.";
    }

    // System prompt
    const systemPrompt =
      "You are an OCR transcription tool. You read handwritten text from images character by character. " +
      "You have no knowledge of real addresses, real street names, or real place names. You cannot validate or correct data. " +
      "You MUST transcribe exactly what is written, even if it seems wrong, misspelled, or nonsensical. " +
      "Street names may be unusual, made-up, or unfamiliar words — transcribe them letter by letter as written. " +
      "All numbers must be transcribed as the exact digits written — never substitute different numbers. " +
      "NEVER substitute a real or plausible value for what you actually see on the page.";

    // User prompt with chain-of-thought
    const prompt =
      "Look at this voter registration form. I need you to transcribe the handwritten fields.\n\n" +
      "STEP 1: For each field below, describe EXACTLY what characters you see written, one at a time. " +
      "For numbers, read each digit individually (e.g. 'I see the digits 4, 5, 7, 2, 8'). " +
      "For words, read each letter (e.g. 'I see P-A-L-M'). Be especially careful with:\n" +
      "- The street number (read every digit)\n" +
      "- The street name — this could be ANY word, including unusual, uncommon, or made-up words. Do NOT try to match it to a known street name. Read each letter individually: e.g. 'I see Y-U-C-K-U-S'. Transcribe exactly those letters even if the result is not a word you recognize.\n" +
      "- The Apt. # field — this is a SMALL box, usually right after the street address line. On Nevada forms it is labeled 'Apt. #'. It may contain a single digit or letter. Look very carefully for ANY handwriting in that small box.\n" +
      "- The 5-digit code field (the small box after the city name, sometimes labeled 'Zip' or 'Zip Code') — IGNORE what this field is used for. Treat it as 5 separate single digits. Read each digit position independently, one at a time: 'Position 1 (leftmost): I see a ___. Position 2: I see a ___.' and so on through Position 5 (rightmost). Each digit is its own independent reading.\n" +
      "- The date of birth — this is usually written with slashes like 6/5/74. Read the number BEFORE the first slash (that is the month), the number BETWEEN the slashes (that is the day), and the number AFTER the second slash (that is the year).\n\n" +
      "STEP 2: Compile your character-by-character reading into this JSON. " +
      "The JSON values MUST exactly match what you described in Step 1 — no corrections, no changes.\n" +
      "For the 5-digit code: each zipDigit field must match your individual position reading exactly.\n\n" +
      "Additional rules:\n" +
      "- " + dobInstruction + "\n" +
      "- 'street' = street number + street name only (no apt/unit). The street name must match your letter-by-letter reading exactly.\n" +
      "- 'apt' = value from the Apt. # field (could be a single character like '7')\n" +
      "- 'zipDigit1' through 'zipDigit5' = each digit from the 5-digit code field, from your position-by-position reading. zipDigit1 is the leftmost digit, zipDigit5 is the rightmost. Each must exactly match your reading for that position.\n" +
      "- Leave empty string for any field you cannot read\n" +
      "- 'confidence' = 'high', 'medium', or 'low'\n\n" +
      "CRITICAL: The JSON values MUST be a direct copy of your character-by-character reading from Step 1. If you wrote 'Y-U-C-K-U-S' in Step 1, the JSON must say 'YUCKUS', not a different word. Each zipDigit must exactly match what you read for that position — do NOT substitute any real-world code or number.\n\n" +
      "Begin with Step 1, then provide the JSON:\n" +
      '{"firstName":"","middleName":"","lastName":"","suffix":"","street":"","apt":"","city":"","zipDigit1":"","zipDigit2":"","zipDigit3":"","zipDigit4":"","zipDigit5":"","dob":"","yearOfBirth":"","confidence":""}';

    // Detect image type
    let mediaType = "image/jpeg";
    if (imageBase64.substring(0, 4) === "iVBO") {
      mediaType = "image/png";
    }

    // Call Claude API
    const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 3000,
        temperature: 0,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: imageBase64,
                },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    const apiResult = await apiResponse.json();

    // Check for API errors
    if (apiResult.error) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Claude API error: " + (apiResult.error.message || JSON.stringify(apiResult.error)) }),
      };
    }

    // Extract text response
    let responseText = "";
    if (apiResult.content && apiResult.content.length > 0) {
      for (let i = 0; i < apiResult.content.length; i++) {
        if (apiResult.content[i].type === "text") {
          responseText = apiResult.content[i].text;
          break;
        }
      }
    }

    if (!responseText) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "No response from Claude AI" }) };
    }

    // Parse JSON from response — strip markdown fences
    responseText = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "");

    // Find the last JSON object containing "firstName"
    let jsonStr = "";
    let braceDepth = 0;
    let jsonStart = -1;

    for (let ci = responseText.length - 1; ci >= 0; ci--) {
      if (responseText[ci] === "}") {
        if (braceDepth === 0) jsonStart = ci;
        braceDepth++;
      } else if (responseText[ci] === "{") {
        braceDepth--;
        if (braceDepth === 0 && jsonStart !== -1) {
          const candidate = responseText.substring(ci, jsonStart + 1);
          if (candidate.indexOf('"firstName"') !== -1) {
            jsonStr = candidate;
            break;
          }
        }
      }
    }

    if (!jsonStr) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Could not find JSON in AI response. Raw: " + responseText.substring(0, 300) }),
      };
    }

    const extracted = JSON.parse(jsonStr);
    return { statusCode: 200, headers, body: JSON.stringify(extracted) };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
