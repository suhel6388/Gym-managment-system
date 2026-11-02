import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../data");
const SETTINGS_FILE = path.join(DATA_DIR, "ai-assistant-settings.json");

function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const DEFAULT_SETTINGS = {
  defaultQuestionLimit: 3,
  model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
  apiKey: process.env.GEMINI_API_KEY || "",
  enabled: true,
  gyms: {},
};

let inMemorySettings = null;

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.error("[ai-settings] Failed to create data directory:", err);
  }
}

function loadSettings() {
  if (inMemorySettings) return inMemorySettings;

  ensureDataDir();
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const content = fs.readFileSync(SETTINGS_FILE, "utf-8");
      const parsed = JSON.parse(content);
      inMemorySettings = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        apiKey: parsed.apiKey || process.env.GEMINI_API_KEY || "",
        model: parsed.model || process.env.GEMINI_MODEL || "gemini-1.5-flash",
      };
      return inMemorySettings;
    }
  } catch (err) {
    console.error("[ai-settings] Error reading settings file, using defaults:", err);
  }

  inMemorySettings = { ...DEFAULT_SETTINGS };
  saveSettings(inMemorySettings);
  return inMemorySettings;
}

function saveSettings(settings) {
  inMemorySettings = settings;
  ensureDataDir();
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (err) {
    console.error("[ai-settings] Error persisting settings to file:", err);
  }
}

export function getAiSettings() {
  const settings = loadSettings();
  const envKey = (process.env.GEMINI_API_KEY || "").trim();
  const fileKey = (settings.apiKey || "").trim();
  const effectiveKey = envKey || fileKey;

  return {
    defaultQuestionLimit: settings.defaultQuestionLimit ?? 3,
    model: process.env.GEMINI_MODEL || settings.model || "gemini-1.5-flash",
    apiKeyConfigured: Boolean(effectiveKey),
    apiKeySource: envKey ? "env (.env)" : fileKey ? "settings" : "none",
    enabled: settings.enabled !== false,
  };
}

export function updateAiSettings(updates = {}) {
  const current = loadSettings();
  if (typeof updates.defaultQuestionLimit === "number" && updates.defaultQuestionLimit > 0) {
    current.defaultQuestionLimit = updates.defaultQuestionLimit;
  }
  if (updates.model && typeof updates.model === "string") {
    current.model = updates.model.trim();
  }
  if (updates.apiKey !== undefined && typeof updates.apiKey === "string") {
    current.apiKey = updates.apiKey.trim();
  }
  if (updates.enabled !== undefined) {
    current.enabled = Boolean(updates.enabled);
  }
  saveSettings(current);
  return getAiSettings();
}

export function getGymQuota(gymId) {
  const settings = loadSettings();
  const today = getTodayString();
  const gymState = settings.gyms[gymId] || {
    questionsUsed: 0,
    lastResetDate: today,
  };

  // Reset counter daily
  if (gymState.lastResetDate !== today) {
    gymState.questionsUsed = 0;
    gymState.lastResetDate = today;
    settings.gyms[gymId] = gymState;
    saveSettings(settings);
  }

  const limit = gymState.customLimit ?? settings.defaultQuestionLimit ?? 3;
  const used = gymState.questionsUsed || 0;
  const remaining = Math.max(0, limit - used);

  return {
    gymId,
    limit,
    used,
    remaining,
    canAsk: remaining > 0,
  };
}

export function incrementGymQuota(gymId) {
  const settings = loadSettings();
  const today = getTodayString();
  const gymState = settings.gyms[gymId] || {
    questionsUsed: 0,
    lastResetDate: today,
  };

  if (gymState.lastResetDate !== today) {
    gymState.questionsUsed = 0;
    gymState.lastResetDate = today;
  }

  gymState.questionsUsed += 1;
  settings.gyms[gymId] = gymState;
  saveSettings(settings);

  const limit = gymState.customLimit ?? settings.defaultQuestionLimit ?? 3;
  const used = gymState.questionsUsed;
  const remaining = Math.max(0, limit - used);

  return {
    gymId,
    limit,
    used,
    remaining,
    canAsk: remaining > 0,
  };
}

export function setGymCustomLimit(gymId, customLimit) {
  const settings = loadSettings();
  const today = getTodayString();
  const gymState = settings.gyms[gymId] || {
    questionsUsed: 0,
    lastResetDate: today,
  };

  gymState.customLimit = customLimit;
  settings.gyms[gymId] = gymState;
  saveSettings(settings);

  return getGymQuota(gymId);
}

export function resetGymUsage(gymId) {
  const settings = loadSettings();
  const today = getTodayString();
  const gymState = settings.gyms[gymId] || {
    questionsUsed: 0,
    lastResetDate: today,
  };

  gymState.questionsUsed = 0;
  gymState.lastResetDate = today;
  settings.gyms[gymId] = gymState;
  saveSettings(settings);

  return getGymQuota(gymId);
}

export function getRawApiKey() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return process.env.GEMINI_API_KEY.trim();
  }
  const settings = loadSettings();
  return (settings.apiKey || "").trim();
}

export function getSelectedModel() {
  return process.env.GEMINI_MODEL?.trim() || loadSettings().model || "gemini-1.5-flash";
}
