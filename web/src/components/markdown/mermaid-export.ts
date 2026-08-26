const DEFAULT_BACKGROUND = '#ffffff';
const DEFAULT_FOREGROUND = '#27272a';
const DEFAULT_ACCENT = '#2563eb';
const DEFAULT_BORDER = '#d4d4d8';
const MAX_CANVAS_DIMENSION = 8192;
const MAX_CANVAS_AREA = 32_000_000;
const DEFAULT_PNG_SCALE = 2;

export type MermaidSnapshot = {
  svg: string;
  width: number;
  height: number;
  background: string;
};

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readSvgDimensions(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox.length === 4 && viewBox.every(Number.isFinite)) {
    return {
      width: finitePositive(viewBox[2], 800),
      height: finitePositive(viewBox[3], 600),
    };
  }

  return {
    width: finitePositive(Number.parseFloat(svg.getAttribute('width') ?? ''), 800),
    height: finitePositive(Number.parseFloat(svg.getAttribute('height') ?? ''), 600),
  };
}

function resolveThemeColor(host: HTMLElement, property: string, fallback: string): string {
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.color = `var(${property}, ${fallback})`;
  host.appendChild(probe);
  const resolved = getComputedStyle(probe).color.trim();
  probe.remove();
  return resolved && !resolved.includes('var(') ? resolved : fallback;
}

function stripUnsafeSvgContent(svg: SVGSVGElement): void {
  svg.querySelectorAll('script, foreignObject').forEach((node) => node.remove());
  svg.querySelectorAll('*').forEach((node) => {
    node.removeAttribute('href');
    node.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
  });
  svg.querySelectorAll('style').forEach((style) => {
    style.textContent = (style.textContent ?? '').replace(/@import\s+url\([^)]*\)\s*;?/gi, '');
  });
}

/** Create a standalone, sanitized SVG with the current app theme frozen into it. */
export function createMermaidSnapshot(svg: SVGSVGElement, themeHost: HTMLElement): MermaidSnapshot {
  const { width, height } = readSvgDimensions(svg);
  const background = resolveThemeColor(themeHost, '--color-surface-hover', DEFAULT_BACKGROUND);
  const foreground = resolveThemeColor(themeHost, '--color-fg', DEFAULT_FOREGROUND);
  const accent = resolveThemeColor(themeHost, '--color-accent-fg', DEFAULT_ACCENT);
  const border = resolveThemeColor(themeHost, '--color-edge', DEFAULT_BORDER);
  const clone = svg.cloneNode(true) as SVGSVGElement;

  stripUnsafeSvgContent(clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.style.setProperty('--bg', background);
  clone.style.setProperty('--fg', foreground);
  clone.style.setProperty('--accent', accent);
  clone.style.setProperty('--border', border);

  const backgroundRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  backgroundRect.setAttribute('width', '100%');
  backgroundRect.setAttribute('height', '100%');
  backgroundRect.setAttribute('fill', background);
  backgroundRect.setAttribute('data-mermaid-export-background', '');
  clone.insertBefore(backgroundRect, clone.firstChild);

  return {
    svg: new XMLSerializer().serializeToString(clone),
    width,
    height,
    background,
  };
}

export function calculateMermaidPngDimensions(
  width: number,
  height: number,
  requestedScale = DEFAULT_PNG_SCALE,
): { width: number; height: number; scale: number } {
  const sourceWidth = finitePositive(width, 800);
  const sourceHeight = finitePositive(height, 600);
  const safeRequestedScale = finitePositive(requestedScale, DEFAULT_PNG_SCALE);
  const scale = Math.min(
    safeRequestedScale,
    MAX_CANVAS_DIMENSION / sourceWidth,
    MAX_CANVAS_DIMENSION / sourceHeight,
    Math.sqrt(MAX_CANVAS_AREA / (sourceWidth * sourceHeight)),
  );
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
    scale,
  };
}

function svgBlob(snapshot: MermaidSnapshot): Blob {
  return new Blob([snapshot.svg], { type: 'image/svg+xml;charset=utf-8' });
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function loadSvgImage(blob: Blob): Promise<{ image: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('mermaid_svg_load_failed'));
    };
    image.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('mermaid_png_encode_failed'));
    }, 'image/png');
  });
}

export async function renderMermaidSnapshotToPng(snapshot: MermaidSnapshot): Promise<Blob> {
  await document.fonts?.ready;
  const dimensions = calculateMermaidPngDimensions(snapshot.width, snapshot.height);
  const { image, url } = await loadSvgImage(svgBlob(snapshot));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('mermaid_canvas_unavailable');
    context.fillStyle = snapshot.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasToPngBlob(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadMermaidPng(snapshot: MermaidSnapshot, fileName: string): Promise<void> {
  triggerBlobDownload(await renderMermaidSnapshotToPng(snapshot), fileName);
}

export function downloadMermaidSvg(snapshot: MermaidSnapshot, fileName: string): void {
  triggerBlobDownload(svgBlob(snapshot), fileName);
}
