"use client";
/* eslint-disable @next/next/no-img-element -- User-supplied local data URLs need direct image rendering for live crop transforms. */

import { type ChangeEvent, type CSSProperties, type DragEvent, type RefObject, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "lambenti-sidebar-logo-settings";
const RETIRED_STORAGE_KEYS = ["lambenti-sidebar-logo-layout-v2"];

const DEFAULT_LOGO_SETTINGS = {
  src: "/lambenti-logo-sidebar.webp",
  cropX: 0,
  cropY: 0,
  scale: 100,
  frameHeight: 112,
  edgeFade: 58,
  edgeOpacity: 86
};

type LogoSettings = typeof DEFAULT_LOGO_SETTINGS;
type PendingDropTarget = "empty" | "editor";

function coerceNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function coerceLogoSrc(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function parseStoredSettings(raw: string | null, defaultImageUrl: string): LogoSettings | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LogoSettings>;
    return {
      src: coerceLogoSrc(parsed.src, defaultImageUrl),
      cropX: coerceNumber(parsed.cropX, DEFAULT_LOGO_SETTINGS.cropX, -45, 45),
      cropY: coerceNumber(parsed.cropY, DEFAULT_LOGO_SETTINGS.cropY, -45, 45),
      scale: coerceNumber(parsed.scale, DEFAULT_LOGO_SETTINGS.scale, 30, 240),
      frameHeight: coerceNumber(parsed.frameHeight, DEFAULT_LOGO_SETTINGS.frameHeight, 72, 180),
      edgeFade: coerceNumber(parsed.edgeFade, DEFAULT_LOGO_SETTINGS.edgeFade, 15, 95),
      edgeOpacity: coerceNumber(parsed.edgeOpacity, DEFAULT_LOGO_SETTINGS.edgeOpacity, 0, 100)
    };
  } catch {
    return null;
  }
}

function readStoredSettings(defaultImageUrl: string): LogoSettings | null {
  const currentSettings = parseStoredSettings(window.localStorage.getItem(STORAGE_KEY), defaultImageUrl);
  if (currentSettings) return currentSettings;

  for (const retiredKey of RETIRED_STORAGE_KEYS) {
    const migratedSettings = parseStoredSettings(window.localStorage.getItem(retiredKey), defaultImageUrl);
    if (migratedSettings) return migratedSettings;
  }

  return null;
}

function makeDefaultSettings(defaultImageUrl: string): LogoSettings {
  return { ...DEFAULT_LOGO_SETTINGS, src: defaultImageUrl };
}

function logoFrameStyle(settings: LogoSettings): CSSProperties {
  const edgeStop = Math.max(42, Math.min(90, 100 - settings.edgeFade * 0.55));

  return {
    height: `${settings.frameHeight}px`,
    "--logo-edge-opacity": `${settings.edgeOpacity / 100}`,
    "--logo-edge-stop": `${edgeStop}%`,
    "--logo-edge-overlay-opacity": `${Math.min(1, 0.18 + settings.edgeFade / 110)}`
  } as CSSProperties;
}

function logoImageStyle(settings: LogoSettings): CSSProperties {
  const offset = (100 - settings.scale) / 2;
  return {
    height: `${settings.scale}%`,
    left: `${50 + settings.cropX}%`,
    top: `${offset + settings.cropY}%`,
    transform: "translateX(-50%)",
    width: "auto"
  };
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read image.")));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

function firstImage(files: FileList | File[]) {
  return Array.from(files).find((file) => file.type.startsWith("image/"));
}

function persistCurrentSettings(settings: LogoSettings) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  for (const retiredKey of RETIRED_STORAGE_KEYS) {
    window.localStorage.removeItem(retiredKey);
  }
}

export function SidebarLogoControl({ defaultImageUrl = "/lambenti-logo-sidebar.webp" }: { defaultImageUrl?: string }) {
  const defaultSettings = makeDefaultSettings(defaultImageUrl);
  const [current, setCurrent] = useState<LogoSettings>(defaultSettings);
  const [draft, setDraft] = useState<LogoSettings>(defaultSettings);
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [dragTarget, setDragTarget] = useState<PendingDropTarget | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const emptyInputRef = useRef<HTMLInputElement>(null);
  const editorInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const nextSettings = readStoredSettings(defaultImageUrl) ?? makeDefaultSettings(defaultImageUrl);
    persistCurrentSettings(nextSettings);
    setCurrent(nextSettings);
    setDraft(nextSettings);
    setHasLoadedSettings(true);
  }, [defaultImageUrl]);

  function openEditorFrom(settings: LogoSettings) {
    setDraft(settings);
    setMessage(null);
    setIsEditorOpen(true);
  }

  async function loadImage(files: FileList | File[]) {
    const image = firstImage(files);
    if (!image) {
      setMessage("Drop or choose a PNG, JPEG, WebP, GIF, or SVG image.");
      return;
    }

    try {
      const src = await fileToDataUrl(image);
      const nextDraft: LogoSettings = {
        ...current,
        src,
        cropX: 0,
        cropY: 0,
        scale: 100,
        edgeFade: Math.max(current.edgeFade, DEFAULT_LOGO_SETTINGS.edgeFade),
        edgeOpacity: current.edgeOpacity
      };
      setDraft(nextDraft);
      setMessage(null);
      setIsEditorOpen(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read image.");
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragTarget(null);
    void loadImage(event.dataTransfer.files);
  }

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.currentTarget.files;
    if (!files) return;
    void loadImage(files);
    event.currentTarget.value = "";
  }

  function saveDraft() {
    setCurrent(draft);
    persistCurrentSettings(draft);
    setIsEditorOpen(false);
    setMessage(null);
  }

  function renderDropBox(target: PendingDropTarget, inputRef: RefObject<HTMLInputElement | null>, compact = false) {
    const isDragging = dragTarget === target;
    return (
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setDragTarget(target);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragTarget(target);
        }}
        onDragLeave={() => setDragTarget(null)}
        onDrop={onDrop}
        className={`rounded-2xl border-2 border-dashed text-center transition ${
          isDragging ? "border-mint bg-emerald-50" : "border-slate-300 bg-slate-50 hover:border-slate-400"
        } ${compact ? "p-4" : "p-6"}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={onFileInputChange}
        />
        <p className="text-sm font-semibold text-slate-900">Drop Logo Image Here</p>
        <p className="mt-1 text-xs text-slate-600">A live editor opens after the image is loaded.</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-3 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-mint focus:ring-offset-2"
        >
          Choose Image
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-3">
        {!hasLoadedSettings ? (
          <div className="lambenti-sidebar-logo block" style={logoFrameStyle(defaultSettings)} aria-label="Loading sidebar logo" />
        ) : current.src ? (
          <div className="group relative rounded-2xl focus-within:ring-2 focus-within:ring-mint focus-within:ring-offset-2">
            <button
              type="button"
              aria-label="Edit sidebar logo image"
              onClick={() => openEditorFrom(current)}
              className="block w-full rounded-2xl text-left focus:outline-none"
            >
              <span className="lambenti-sidebar-logo block" style={logoFrameStyle(current)}>
                <img
                  src={current.src}
                  alt=""
                  className="lambenti-sidebar-logo-image"
                  style={logoImageStyle(current)}
                  onError={() => {
                    setCurrent((settings) => ({ ...settings, src: "" }));
                    setMessage("Sidebar logo image could not be loaded. Drop the current logo again to replace it.");
                  }}
                />
              </span>
            </button>
            <div className="pointer-events-none absolute inset-0 flex items-start justify-end rounded-2xl bg-slate-950/50 p-2 opacity-0 shadow-inner backdrop-blur-[2px] transition group-hover:opacity-100 group-focus-within:opacity-100">
              <button
                type="button"
                onClick={() => openEditorFrom(current)}
                className="pointer-events-none rounded-full bg-mint px-3 py-1.5 text-xs font-semibold text-white shadow-lg transition hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-white group-hover:pointer-events-auto group-focus-within:pointer-events-auto"
              >
                Edit
              </button>
            </div>
          </div>
        ) : (
          <div>{renderDropBox("empty", emptyInputRef, true)}</div>
        )}
        {message ? <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{message}</p> : null}
      </div>

      {isEditorOpen ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Edit sidebar logo image">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/40">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
              <div className="bg-slate-950 p-5 text-white lg:p-6">
                <div className="mb-4">
                  <h2 className="text-xl font-semibold">Edit Logo Image</h2>
                  <p className="mt-1 text-sm text-slate-300">Preview crop, size, and edge blend changes live before saving.</p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-800 p-4 shadow-inner">
                  <div className="mx-auto max-w-sm">
                    <div className="lambenti-sidebar-logo shadow-2xl shadow-black/30" style={logoFrameStyle(draft)}>
                      {draft.src ? (
                        <img
                          src={draft.src}
                          alt="Logo preview"
                          className="lambenti-sidebar-logo-image"
                          style={logoImageStyle(draft)}
                        />
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-4 text-center text-xs uppercase tracking-[0.22em] text-slate-400">Live Preview</p>
                </div>
                <div className="mt-4">{renderDropBox("editor", editorInputRef, true)}</div>
              </div>

              <div className="space-y-5 p-5 lg:p-6">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Crop And Resize</h3>
                  <div className="mt-4 space-y-4">
                    <Slider label="Horizontal Crop" value={draft.cropX} min={-45} max={45} unit="%" onChange={(value) => setDraft((settings) => ({ ...settings, cropX: value }))} />
                    <Slider label="Vertical Crop" value={draft.cropY} min={-45} max={45} unit="%" onChange={(value) => setDraft((settings) => ({ ...settings, cropY: value }))} />
                    <Slider label="Image Size" value={draft.scale} min={30} max={240} unit="%" onChange={(value) => setDraft((settings) => ({ ...settings, scale: value }))} />
                    <Slider label="Logo Box Height" value={draft.frameHeight} min={72} max={180} unit="px" onChange={(value) => setDraft((settings) => ({ ...settings, frameHeight: value }))} />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Background Blend</h3>
                  <div className="mt-4 space-y-4">
                    <Slider label="Edge Blend Width" value={draft.edgeFade} min={15} max={95} unit="%" onChange={(value) => setDraft((settings) => ({ ...settings, edgeFade: value }))} />
                    <Slider label="Edge Opacity" value={draft.edgeOpacity} min={0} max={100} unit="%" onChange={(value) => setDraft((settings) => ({ ...settings, edgeOpacity: value }))} />
                  </div>
                  <p className="mt-3 text-xs text-slate-600">Lower edge opacity and wider blending make the logo fade into the sidebar background.</p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                  <button
                    type="button"
                    onClick={() => setDraft({ ...current })}
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Revert Changes
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditorOpen(false)}
                      className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveDraft}
                      className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-mint focus:ring-offset-2"
                    >
                      Save Logo
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Slider({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between gap-3 text-sm font-medium text-slate-700">
        <span>{label}</span>
        <span className="rounded-full bg-white px-2 py-0.5 font-mono text-xs text-slate-600 shadow-sm">
          {value}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="w-full accent-mint"
      />
    </label>
  );
}
