import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

import { app } from "electron";

import { resolveStateDir } from "../../src/config/paths-state.js";
import { validateDesktopPetPackage } from "../../src/pets/validator.js";
import { DESKTOP_PET_SCHEMA_VERSION } from "../../src/pets/manifest.js";
import { loopiDesktopPet } from "./loopi.js";
import { readDesktopPetRelationship } from "./relationship-store.js";
import type {
  DesktopPetAction,
  DesktopPetAnimation,
  DesktopPetAnchor,
  DesktopPetDefinition,
  DesktopPetIssue,
  DesktopPetPrefs,
  DesktopPetPersona,
  DesktopPetPersonaTone,
  DesktopPetState,
} from "./types.js";

const PREFS_FILE = "desktop-pet.json";
const PETS_DIR = "pets";
const FRAME_SIZE = 96;
const PET_ACTIONS: DesktopPetAction[] = [
  "idle",
  "sleep",
  "wake",
  "greet",
  "prepare",
  "research",
  "read",
  "create",
  "execute",
  "wait",
  "success",
  "concern",
  "pet",
  "pickedUp",
  "released",
];

export const defaultDesktopPetPrefs: DesktopPetPrefs = {
  enabled: false,
  showOnStartup: false,
  selectedPetId: "loopi",
  alwaysOnTop: true,
  bubbleEnabled: true,
  clickThroughWhenIdle: false,
  muted: false,
  behaviorMode: "companion",
  proactiveTipsEnabled: true,
  interactionEnabled: true,
  reducedMotion: false,
  sizePercent: 100,
  collapsed: false,
};

function prefsPath(): string {
  return join(app.getPath("userData"), PREFS_FILE);
}

export function desktopPetCustomDir(): string {
  return join(resolveStateDir(), PETS_DIR);
}

function clampSizePercent(value: unknown): number {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : defaultDesktopPetPrefs.sizePercent;
  return Math.min(140, Math.max(70, Math.round(n)));
}

function normalizeAnchor(value: unknown): DesktopPetAnchor | undefined {
  if (!value || typeof value !== "object") return undefined;
  const anchor = value as Partial<DesktopPetAnchor>;
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y))
    return undefined;
  return { x: Math.round(anchor.x), y: Math.round(anchor.y) };
}

function normalizePrefs(raw: unknown): DesktopPetPrefs {
  const obj =
    raw && typeof raw === "object" ? (raw as Partial<DesktopPetPrefs>) : {};
  const behaviorMode =
    obj.behaviorMode === "focus" ||
    obj.behaviorMode === "companion" ||
    obj.behaviorMode === "playful"
      ? obj.behaviorMode
      : defaultDesktopPetPrefs.behaviorMode;
  return {
    ...defaultDesktopPetPrefs,
    enabled:
      typeof obj.enabled === "boolean"
        ? obj.enabled
        : defaultDesktopPetPrefs.enabled,
    showOnStartup:
      typeof obj.showOnStartup === "boolean"
        ? obj.showOnStartup
        : defaultDesktopPetPrefs.showOnStartup,
    selectedPetId:
      typeof obj.selectedPetId === "string" && obj.selectedPetId.trim()
        ? obj.selectedPetId.trim()
        : defaultDesktopPetPrefs.selectedPetId,
    alwaysOnTop:
      typeof obj.alwaysOnTop === "boolean"
        ? obj.alwaysOnTop
        : defaultDesktopPetPrefs.alwaysOnTop,
    bubbleEnabled:
      typeof obj.bubbleEnabled === "boolean"
        ? obj.bubbleEnabled
        : defaultDesktopPetPrefs.bubbleEnabled,
    clickThroughWhenIdle:
      typeof obj.clickThroughWhenIdle === "boolean"
        ? obj.clickThroughWhenIdle
        : defaultDesktopPetPrefs.clickThroughWhenIdle,
    muted:
      typeof obj.muted === "boolean" ? obj.muted : defaultDesktopPetPrefs.muted,
    behaviorMode,
    proactiveTipsEnabled:
      typeof obj.proactiveTipsEnabled === "boolean"
        ? obj.proactiveTipsEnabled
        : defaultDesktopPetPrefs.proactiveTipsEnabled,
    interactionEnabled:
      typeof obj.interactionEnabled === "boolean"
        ? obj.interactionEnabled
        : defaultDesktopPetPrefs.interactionEnabled,
    reducedMotion:
      typeof obj.reducedMotion === "boolean"
        ? obj.reducedMotion
        : defaultDesktopPetPrefs.reducedMotion,
    remindersPausedUntil:
      typeof obj.remindersPausedUntil === "number" &&
      Number.isFinite(obj.remindersPausedUntil) &&
      obj.remindersPausedUntil > Date.now()
        ? obj.remindersPausedUntil
        : undefined,
    sizePercent: clampSizePercent(obj.sizePercent),
    collapsed:
      typeof obj.collapsed === "boolean"
        ? obj.collapsed
        : defaultDesktopPetPrefs.collapsed,
    anchor: normalizeAnchor(obj.anchor),
  };
}

export async function readDesktopPetPrefs(): Promise<DesktopPetPrefs> {
  try {
    const text = await readFile(prefsPath(), "utf8");
    return normalizePrefs(JSON.parse(text));
  } catch {
    return defaultDesktopPetPrefs;
  }
}

export async function writeDesktopPetPrefs(
  prefs: DesktopPetPrefs,
): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(
    prefsPath(),
    `${JSON.stringify(normalizePrefs(prefs), null, 2)}\n`,
    "utf8",
  );
}

export async function patchDesktopPetPrefs(
  patch: Partial<DesktopPetPrefs>,
): Promise<DesktopPetPrefs> {
  const current = await readDesktopPetPrefs();
  const next = normalizePrefs({ ...current, ...patch });
  await writeDesktopPetPrefs(next);
  return next;
}

function mimeForImagePath(path: string): string | null {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  return null;
}

function safeResolve(root: string, child: unknown): string | null {
  if (typeof child !== "string" || !child.trim()) return null;
  const candidate = resolve(root, child);
  const normalizedRoot = resolve(root);
  if (
    candidate !== normalizedRoot &&
    !candidate.startsWith(`${normalizedRoot}\\`) &&
    !candidate.startsWith(`${normalizedRoot}/`)
  ) {
    return null;
  }
  return candidate;
}

async function imageToDataUrl(path: string): Promise<string | null> {
  const mime = mimeForImagePath(path);
  if (!mime) return null;
  try {
    const data = await readFile(path);
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}

function numberFromManifest(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function unitNumberFromManifest(value: unknown, fallback: number): number {
  return Math.min(1, Math.max(0, numberFromManifest(value, fallback)));
}

function stringListFromManifest(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  return values.length ? values : undefined;
}

function personaFromManifest(value: unknown): DesktopPetPersona | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const tone: DesktopPetPersonaTone =
    raw.tone === "warm" || raw.tone === "playful" || raw.tone === "focused"
      ? raw.tone
      : "calm";
  const phraseSource = raw.phrases && typeof raw.phrases === "object"
    ? raw.phrases as Record<string, unknown>
    : {};
  const phrases = {
    greeting: stringListFromManifest(phraseSource.greeting),
    success: stringListFromManifest(phraseSource.success),
    waiting: stringListFromManifest(phraseSource.waiting),
    error: stringListFromManifest(phraseSource.error),
  };
  return {
    tone,
    warmth: unitNumberFromManifest(raw.warmth, 0.6),
    energy: unitNumberFromManifest(raw.energy, 0.4),
    humor: unitNumberFromManifest(raw.humor, 0.1),
    ...(Object.values(phrases).some(Boolean) ? { phrases } : {}),
  };
}

function positiveNumberFromManifest(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

async function loadManifestAnimation(
  dir: string,
  action: DesktopPetAction,
  raw: unknown,
  sheetBoundsBySrc: Map<string, { width: number; height: number }>,
): Promise<{ animation: DesktopPetAnimation | null; issue?: string }> {
  if (!raw || typeof raw !== "object") {
    return { animation: null, issue: `${action}: animation must be an object` };
  }
  const obj = raw as Record<string, unknown>;
  const sourcePath = safeResolve(dir, obj.src);
  if (!sourcePath) {
    return {
      animation: null,
      issue: `${action}: src is required and must stay inside the pet folder`,
    };
  }
  const imageDataUrl = await imageToDataUrl(sourcePath);
  if (!imageDataUrl) {
    return {
      animation: null,
      issue: `${action}: src is unreadable or uses an unsupported image format`,
    };
  }
  const rawFrameWidth = positiveNumberFromManifest(obj.frameWidth);
  const rawFrameHeight = positiveNumberFromManifest(obj.frameHeight);
  const rawFrameCount = positiveNumberFromManifest(obj.frameCount);
  if (!rawFrameWidth || !rawFrameHeight || !rawFrameCount) {
    return {
      animation: null,
      issue: `${action}: frameWidth, frameHeight, and frameCount must be positive numbers`,
    };
  }
  const frameWidth = Math.round(rawFrameWidth);
  const frameHeight = Math.round(rawFrameHeight);
  const frameCount = Math.round(rawFrameCount);
  const fps = Math.max(1, Math.round(numberFromManifest(obj.fps, 8)));
  const offsetX = Math.max(0, Math.round(numberFromManifest(obj.offsetX, 0)));
  const offsetY = Math.max(0, Math.round(numberFromManifest(obj.offsetY, 0)));
  const sourceKey = typeof obj.src === "string" ? obj.src : "";
  const sheetBounds = sheetBoundsBySrc.get(sourceKey);
  return {
    animation: {
      imageDataUrl,
      frameWidth,
      frameHeight,
      frameCount,
      fps,
      loop: obj.loop !== false,
      offsetX,
      offsetY,
      sheetWidth: sheetBounds?.width,
      sheetHeight: sheetBounds?.height,
    },
  };
}

function estimateManifestSheetBounds(
  rawAnimations: Record<string, unknown>,
): Map<string, { width: number; height: number }> {
  const bounds = new Map<string, { width: number; height: number }>();
  for (const raw of Object.values(rawAnimations)) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.src !== "string" || !obj.src.trim()) continue;
    const frameWidth = positiveNumberFromManifest(obj.frameWidth);
    const frameHeight = positiveNumberFromManifest(obj.frameHeight);
    const frameCount = positiveNumberFromManifest(obj.frameCount);
    if (!frameWidth || !frameHeight || !frameCount) continue;
    const offsetX = Math.max(0, Math.round(numberFromManifest(obj.offsetX, 0)));
    const offsetY = Math.max(0, Math.round(numberFromManifest(obj.offsetY, 0)));
    const width = offsetX + Math.round(frameWidth) * Math.round(frameCount);
    const height = offsetY + Math.round(frameHeight);
    const existing = bounds.get(obj.src);
    bounds.set(obj.src, {
      width: Math.max(existing?.width ?? 0, width),
      height: Math.max(existing?.height ?? 0, height),
    });
  }
  return bounds;
}

async function loadCustomPet(
  dir: string,
): Promise<{ pet: DesktopPetDefinition | null; issue?: DesktopPetIssue }> {
  const validation = await validateDesktopPetPackage(dir);
  if (validation.ok === false) {
    return { pet: null, issue: validation.issue };
  }

  try {
    const raw = JSON.parse(
      await readFile(join(dir, "manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    if (raw.schemaVersion !== DESKTOP_PET_SCHEMA_VERSION) {
      return {
        pet: null,
        issue: {
          dir,
          reason: "Invalid manifest.json",
          details: [`schemaVersion must be ${DESKTOP_PET_SCHEMA_VERSION}`],
        },
      };
    }
    const folderId = basename(dir)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-");
    const rawId =
      typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : folderId;
    const id = `custom:${rawId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`;
    const name =
      typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : null;
    const description =
      typeof raw.description === "string" && raw.description.trim()
        ? raw.description.trim()
        : null;
    const sourcePrompt =
      typeof raw.sourcePrompt === "string" && raw.sourcePrompt.trim()
        ? raw.sourcePrompt.trim()
        : undefined;
    const rawAnimations =
      raw.animations && typeof raw.animations === "object"
        ? (raw.animations as Record<string, unknown>)
        : null;
    const thumbnailPath = safeResolve(dir, raw.thumbnail);
    const thumbnailDataUrl = thumbnailPath
      ? await imageToDataUrl(thumbnailPath)
      : null;
    const details: string[] = [];
    if (!name) details.push("name is required");
    if (!description) details.push("description is required");
    if (!rawAnimations) details.push("animations is required");
    if (!thumbnailDataUrl)
      details.push("thumbnail is required and must be a readable image");
    if (details.length > 0 || !rawAnimations) {
      return {
        pet: null,
        issue: { dir, reason: "Invalid manifest.json", details },
      };
    }

    const sheetBoundsBySrc = estimateManifestSheetBounds(rawAnimations);
    const entries = await Promise.all(
      PET_ACTIONS.map(async (action) => {
        const result = await loadManifestAnimation(
          dir,
          action,
          rawAnimations[action],
          sheetBoundsBySrc,
        );
        if (!result.animation) {
          details.push(result.issue ?? `${action}: invalid animation`);
          return null;
        }
        return [action, result.animation] as const;
      }),
    );
    if (entries.some((entry) => !entry)) {
      return {
        pet: null,
        issue: { dir, reason: "Invalid animation manifest", details },
      };
    }
    const animations = Object.fromEntries(
      entries as Array<readonly [DesktopPetAction, DesktopPetAnimation]>,
    ) as Record<DesktopPetAction, DesktopPetAnimation>;
    return {
      pet: {
        id,
        name,
        description,
        sourcePrompt,
        builtin: false,
        renderer: "spritesheet",
        canvasWidth: Math.max(
          1,
          Math.round(numberFromManifest(raw.canvasWidth, FRAME_SIZE)),
        ),
        canvasHeight: Math.max(
          1,
          Math.round(numberFromManifest(raw.canvasHeight, FRAME_SIZE)),
        ),
        thumbnailDataUrl,
        animations,
        persona: personaFromManifest(raw.persona),
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      pet: null,
      issue: {
        dir,
        reason: "manifest.json is missing or unreadable",
        details: [message],
      },
    };
  }
}

export async function listDesktopPets(): Promise<{
  pets: DesktopPetDefinition[];
  issues: DesktopPetIssue[];
}> {
  const customDir = desktopPetCustomDir();
  await mkdir(customDir, { recursive: true });
  const custom: DesktopPetDefinition[] = [];
  const issues: DesktopPetIssue[] = [];
  try {
    const entries = await readdir(customDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const result = await loadCustomPet(join(customDir, entry.name));
      if (result.pet) custom.push(result.pet);
      if (result.issue) issues.push(result.issue);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    issues.push({
      dir: customDir,
      reason: "Could not read custom pets directory",
      details: [message],
    });
  }
  return { pets: [loopiDesktopPet, ...custom], issues };
}

export async function readDesktopPetState(
  visible: boolean,
): Promise<DesktopPetState> {
  const [prefs, petList, relationship] = await Promise.all([
    readDesktopPetPrefs(),
    listDesktopPets(),
    readDesktopPetRelationship(),
  ]);
  const { pets, issues } = petList;
  const selectedExists = pets.some((pet) => pet.id === prefs.selectedPetId);
  return {
    prefs: selectedExists
      ? prefs
      : { ...prefs, selectedPetId: defaultDesktopPetPrefs.selectedPetId },
    relationship,
    pets,
    visible,
    customPetsDir: desktopPetCustomDir(),
    petIssues: issues,
    activities: [],
  };
}
