// ============================================================
// DRIVE SCORE — Netlify Function: Image Extraction via Claude
// ============================================================
// Set CLAUDE_API_KEY in Netlify environment variables
// ============================================================

const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

exports.handler = async function (event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

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
      dobInstruction = "yearOfBirth = 4-digit year only. Leave dob empty.";
    } else if (state === "North Carolina") {
      dobInstruction = "Leave dob and yearOfBirth empty.";
    } else {
      dobInstruction = "dob = full date in MM/DD/YYYY format. If year is 2 digits, convert to 4 (e.g. 74 → 1974).";
    }

    const systemPrompt =
      "You are a strict OCR tool. Transcribe ONLY the exact handwritten characters visible on the form. " +
      "Never correct, autocomplete, or substitute values. " +
      "If a street name looks unusual, transcribe it exactly letter by letter. " +
      "If a number looks odd, transcribe the exact digits you see. " +
      "Respond with ONLY a JSON object, no other text.";

    const prompt =
      "Transcribe the handwritten fields from this voter registration form into JSON.\n\n" +
      "Rules:\n" +
      "- street = house number + street name (no apt)\n" +
      "- Transcribe EVERY digit of the house number — look carefully, there may be 4+ digits\n" +
      "- Street names may be unusual or made-up words — copy exactly what is written\n" +
      "- zip = transcribe all 5 digits exactly as written, do NOT replace with a real zip code\n" +
      "- " + dobInstruction + "\n" +
      "- Leave empty string for any unreadable field\n\n" +
      "Respond with ONLY this JSON, no other text:\n" +
      '{"firstName":"","middleName":"","lastName":"","suffix":"","street":"","apt":"","city":"","dob":"","yearOfBirth":"","zip":"","confidence":""}';

    let mediaType = "image/jpeg";
    if (imageBase64.substring(0, 4) === "iVBO") {
      mediaType = "image/png";
    }

    const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 500,
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

    if (apiResult.error) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Claude API error: " + (apiResult.error.message || JSON.stringify(apiResult.error)) }),
      };
    }

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

    // Parse JSON — strip markdown fences if present
    responseText = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    // Find JSON object
    const firstBrace = responseText.indexOf("{");
    const lastBrace = responseText.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "No JSON in response. Raw: " + responseText.substring(0, 300) }),
      };
    }

    const extracted = JSON.parse(responseText.substring(firstBrace, lastBrace + 1));
    return { statusCode: 200, headers, body: JSON.stringify(extracted) };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
