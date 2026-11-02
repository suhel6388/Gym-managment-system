import {
  getRawApiKey,
  getSelectedModel,
  getGymQuota,
  incrementGymQuota,
} from "./ai-settings.store.js";
import {
  fetchGymSnapshot,
  buildSystemPrompt,
  generateDeterministicAnswer,
} from "./gym-ai-context.service.js";

export async function askGymAiAssistant({ gymId, message }) {
  const quota = getGymQuota(gymId);
  if (!quota.canAsk) {
    return {
      error: "QUOTA_EXCEEDED",
      message: `You have reached your limit of ${quota.limit} questions. Please contact your platform Super Admin to increase your gym's AI quota.`,
      quota,
    };
  }

  // 1. Fetch live DB snapshot for this specific gym
  const snapshot = await fetchGymSnapshot(gymId);
  const systemPrompt = buildSystemPrompt(snapshot);
  const apiKey = getRawApiKey();
  const model = getSelectedModel();

  let replyText = "";

  // 2. Call Gemini API if API key is set
  if (apiKey) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const payload = {
        contents: [
          {
            role: "user",
            parts: [{ text: message }],
          },
        ],
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 800,
        },
      };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      } else {
        const errText = await response.text();
        console.warn(`[gemini] Gemini API call returned ${response.status}:`, errText);
        // Fallback to deterministic live DB response
        replyText = generateDeterministicAnswer(message, snapshot);
      }
    } catch (apiErr) {
      console.warn("[gemini] Network error calling Gemini, using live DB response:", apiErr);
      replyText = generateDeterministicAnswer(message, snapshot);
    }
  } else {
    // No API key configured yet -> deliver instant live DB answer
    replyText = generateDeterministicAnswer(message, snapshot);
  }

  if (!replyText) {
    replyText = generateDeterministicAnswer(message, snapshot);
  }

  // 3. Deduct question from gym quota
  const updatedQuota = incrementGymQuota(gymId);

  return {
    reply: replyText,
    quota: updatedQuota,
    model: apiKey ? model : "Gym DB Assistant (Live)",
  };
}
