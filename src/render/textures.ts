import type { BoardTheme } from "./themes";
import { mulberry32 } from "../util/math";

const TILE = 768;
const PAPER_TILE = 256;
const cache = new Map<string, string>();

export function getSurfaceTexture(theme: BoardTheme): string {
  const key = `surface-v5:${theme.id}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const url = svgUrl(buildSurface(theme));
  cache.set(key, url);
  return url;
}

export function getPaperTexture(theme: BoardTheme): string {
  const key = `paper-v5:${theme.id}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const url = svgUrl(buildPaper(theme));
  cache.set(key, url);
  return url;
}

function buildSurface(theme: BoardTheme): string {
  const spec = theme.surface;
  const random = mulberry32(spec.seed * 7919 + 13);
  const defs = `
    <filter id="fineDark" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.86" numOctaves="3" seed="${spec.seed}" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.2126 0.7152 0.0722 0 0"/>
    </filter>
    <filter id="fineLight" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves="2" seed="${spec.seed + 5}" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.2126 0.7152 0.0722 0 0"/>
    </filter>
    <filter id="coarseDark" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.075" numOctaves="3" seed="${spec.seed + 11}" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.2126 0.7152 0.0722 0 0"/>
    </filter>
    <filter id="coarseLight" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="3" seed="${spec.seed + 19}" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.2126 0.7152 0.0722 0 0"/>
    </filter>
    <radialGradient id="mottleDark">
      <stop offset="0" stop-color="${spec.tint}" stop-opacity="0.5"/>
      <stop offset="0.55" stop-color="${spec.tint}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${spec.tint}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="mottleLight">
      <stop offset="0" stop-color="${spec.light}" stop-opacity="0.42"/>
      <stop offset="0.55" stop-color="${spec.light}" stop-opacity="0.14"/>
      <stop offset="1" stop-color="${spec.light}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="parchmentDark">
      <stop offset="0" stop-color="${spec.tint}" stop-opacity="0.62"/>
      <stop offset="0.6" stop-color="${spec.tint}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${spec.tint}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="parchmentLight">
      <stop offset="0" stop-color="${spec.light}" stop-opacity="0.5"/>
      <stop offset="0.6" stop-color="${spec.light}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="${spec.light}" stop-opacity="0"/>
    </radialGradient>
  `;

  let body = "";
  let noiseDark = 0.2;
  let noiseLight = 0.06;
  let coarse = 0;
  let coarseLight = 0;

  switch (spec.kind) {
    case "cork": {
      body += buildCork(random, spec.tint, spec.light, spec.base);
      noiseDark = 0.26;
      noiseLight = 0.05;
      coarse = 0.16;
      break;
    }
    case "felt": {
      body += buildFelt(random, spec.tint, spec.light);
      noiseDark = 0.34;
      noiseLight = 0.05;
      coarse = 0.08;
      break;
    }
    case "concrete": {
      body += buildConcrete(random, spec.tint, spec.light);
      noiseDark = 0.24;
      noiseLight = 0.07;
      coarse = 0.32;
      coarseLight = 0.1;
      break;
    }
    case "parchment": {
      body += buildParchment(random, spec.light);
      noiseDark = 0.19;
      noiseLight = 0.06;
      coarse = 0.22;
      coarseLight = 0.08;
      break;
    }
    case "whiteboard": {
      body += buildWhiteboard(random);
      noiseDark = 0.05;
      noiseLight = 0.08;
      break;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">
    <defs>${defs}</defs>
    <rect width="${TILE}" height="${TILE}" fill="${spec.base}"/>
    ${body}
    ${coarse > 0 ? `<rect width="${TILE}" height="${TILE}" filter="url(#coarseDark)" opacity="${coarse}"/>` : ""}
    ${coarseLight > 0 ? `<rect width="${TILE}" height="${TILE}" filter="url(#coarseLight)" opacity="${coarseLight}"/>` : ""}
    <rect width="${TILE}" height="${TILE}" filter="url(#fineDark)" opacity="${noiseDark}"/>
    <rect width="${TILE}" height="${TILE}" filter="url(#fineLight)" opacity="${noiseLight}"/>
  </svg>`;
}

function buildCork(random: () => number, tint: string, light: string, base: string): string {
  const parts: string[] = [];
  const chips = [tint, "#6d4525", "#d8b782", "#8a5a2f", light, "#a97a43"];
  const stains = [tint, light, "#5e3b1d"];
  for (let i = 0; i < 380; i++) {
    const x = random() * TILE;
    const y = random() * TILE;
    const rx = 0.7 + Math.pow(random(), 2.2) * 4.4;
    const ry = rx * (0.45 + random() * 0.55);
    const rotation = random() * 360;
    const fill = chips[Math.floor(random() * chips.length)];
    const opacity = 0.1 + random() * 0.32;
    parts.push(wrappedEllipse(x, y, rx, ry, rotation, fill, opacity));
  }
  for (let i = 0; i < 210; i++) {
    const x = random() * TILE;
    const y = random() * TILE;
    const length = 3 + random() * 13;
    const angle = (random() - 0.5) * 0.7 + (random() > 0.8 ? Math.PI / 2 : 0);
    parts.push(
      wrappedLine(
        x,
        y,
        x + Math.cos(angle) * length,
        y + Math.sin(angle) * length,
        random() > 0.55 ? "#5c3a1c" : light,
        0.5 + random() * 0.5,
        0.05 + random() * 0.14,
      ),
    );
  }
  for (let i = 0; i < 8; i++) {
    const x = random() * TILE;
    const y = random() * TILE;
    const rx = 60 + random() * 150;
    const ry = 25 + random() * 80;
    parts.push(wrappedEllipse(x, y, rx, ry, random() * 180, stains[i % stains.length], 0.012 + random() * 0.025));
  }
  // A few larger cork chips give the surface a hand-cut, uneven feel.
  for (let i = 0; i < 26; i++) {
    const x = random() * TILE;
    const y = random() * TILE;
    const r = 2.4 + random() * 4.5;
    parts.push(wrappedEllipse(x, y, r, r * 0.66, random() * 360, base, 0.16 + random() * 0.16));
  }
  return parts.join("");
}

function buildFelt(random: () => number, tint: string, light: string): string {
  const parts: string[] = [];
  for (let i = 0; i < 420; i++) {
    const x = random() * TILE;
    const y = random() * TILE;
    const length = 5 + random() * 28;
    const angle = (random() - 0.5) * 0.16;
    parts.push(
      wrappedLine(
        x,
        y,
        x + Math.cos(angle) * length,
        y + Math.sin(angle) * length,
        random() > 0.62 ? light : tint,
        0.4 + random() * 0.7,
        0.018 + random() * 0.055,
      ),
    );
  }
  for (let i = 0; i < 5; i++) {
    parts.push(
      wrappedEllipse(
        random() * TILE,
        random() * TILE,
        70 + random() * 140,
        30 + random() * 90,
        random() * 180,
        tint,
        0.03 + random() * 0.04,
      ),
    );
  }
  return parts.join("");
}

function buildConcrete(random: () => number, tint: string, light: string): string {
  const parts: string[] = [];
  // Soft cement clouds keep the wall from reading as flat, evenly-lit noise.
  for (let i = 0; i < 16; i++) {
    parts.push(
      wrappedEllipse(
        random() * TILE,
        random() * TILE,
        110 + random() * 180,
        65 + random() * 140,
        random() * 360,
        random() > 0.6 ? "url(#mottleLight)" : "url(#mottleDark)",
        0.6 + random() * 0.3,
      ),
    );
  }
  // Laitance: pale cement slurry streaks running down the formwork.
  for (let i = 0; i < 26; i++) {
    const x = random() * TILE;
    const y = random() * TILE;
    const length = 40 + random() * 170;
    const angle = -Math.PI / 2 + (random() - 0.5) * 0.55;
    parts.push(
      wrappedLine(
        x,
        y,
        x + Math.cos(angle) * length,
        y + Math.sin(angle) * length,
        light,
        2 + random() * 6,
        0.03 + random() * 0.04,
      ),
    );
  }
  // Exposed aggregate: shadow first, then the stone sitting slightly up-left.
  for (let i = 0; i < 170; i++) {
    const x = random() * TILE;
    const y = random() * TILE;
    const r = 1.2 + Math.pow(random(), 1.8) * 4.6;
    const ry = r * (0.6 + random() * 0.5);
    const rotation = random() * 360;
    parts.push(wrappedEllipse(x + 0.8, y + 1, r, ry, rotation, "#30322e", 0.05 + random() * 0.07));
    parts.push(
      wrappedEllipse(
        x,
        y,
        r,
        ry,
        rotation,
        random() > 0.5 ? light : tint,
        0.1 + random() * 0.16,
      ),
    );
  }
  for (let i = 0; i < 850; i++) {
    const r = 0.35 + Math.pow(random(), 2) * 1.9;
    parts.push(
      wrappedEllipse(
        random() * TILE,
        random() * TILE,
        r,
        r * (0.7 + random() * 0.6),
        random() * 360,
        random() > 0.35 ? tint : "#3f413e",
        0.08 + random() * 0.18,
      ),
    );
  }
  // Pits with a lit lip catch the light at normal zoom.
  for (let i = 0; i < 55; i++) {
    const x = random() * TILE;
    const y = random() * TILE;
    const r = 0.6 + random() * 1.8;
    parts.push(wrappedEllipse(x, y, r, r * (0.7 + random() * 0.5), random() * 360, "#3d3f3a", 0.12 + random() * 0.12));
    parts.push(wrappedEllipse(x - 0.5, y - 0.5, r * 0.7, r * 0.45, random() * 360, light, 0.1 + random() * 0.1));
  }
  for (let i = 0; i < 8; i++) {
    parts.push(buildCrack(random));
  }
  return parts.join("");
}

function buildParchment(random: () => number, light: string): string {
  const parts: string[] = [];
  // Water damage and sun-faded patches.
  for (let i = 0; i < 18; i++) {
    parts.push(
      wrappedEllipse(
        random() * TILE,
        random() * TILE,
        60 + random() * 170,
        40 + random() * 120,
        random() * 360,
        random() > 0.7 ? "url(#parchmentLight)" : "url(#parchmentDark)",
        0.55 + random() * 0.35,
      ),
    );
  }
  for (let i = 0; i < 820; i++) {
    const x = random() * TILE;
    const y = random() * TILE;
    const length = 2 + Math.pow(random(), 2) * 30;
    const angle = (random() - 0.5) * 1.1;
    parts.push(
      wrappedLine(
        x,
        y,
        x + Math.cos(angle) * length,
        y + Math.sin(angle) * length,
        random() > 0.6 ? "#6d5434" : light,
        0.4 + random() * 0.8,
        0.06 + random() * 0.18,
      ),
    );
  }
  // Long fold creases, each with a lit ridge beside a shadowed groove.
  for (let i = 0; i < 7; i++) {
    const x = random() * TILE;
    const y = random() * TILE;
    const angle = (random() - 0.5) * 1.6 + (random() > 0.5 ? 0 : Math.PI / 2);
    const length = 300 + random() * 400;
    const x2 = x + Math.cos(angle) * length;
    const y2 = y + Math.sin(angle) * length;
    parts.push(wrappedLine(x, y, x2, y2, "#6f5535", 1.7 + random() * 1.2, 0.09 + random() * 0.05));
    parts.push(wrappedLine(x + 1.4, y + 1.1, x2 + 1.4, y2 + 1.1, light, 1, 0.18 + random() * 0.08));
  }
  // Foxing: clustered rust-brown age spots.
  for (let i = 0; i < 42; i++) {
    const cx = random() * TILE;
    const cy = random() * TILE;
    const count = 2 + Math.floor(random() * 4);
    for (let k = 0; k < count; k++) {
      const r = 0.6 + Math.pow(random(), 1.6) * 2.8;
      parts.push(
        wrappedEllipse(
          cx + (random() - 0.5) * 56,
          cy + (random() - 0.5) * 40,
          r,
          r * (0.6 + random() * 0.6),
          random() * 360,
          random() > 0.5 ? "#8a6a42" : "#a17c4c",
          0.08 + random() * 0.1,
        ),
      );
    }
  }
  for (let i = 0; i < 44; i++) {
    const x = random() * TILE;
    const y = random() * TILE;
    const length = 5 + random() * 26;
    parts.push(
      wrappedLine(x, y, x + length, y + (random() - 0.5) * 4, "#8d7248", 0.5, 0.07 + random() * 0.13),
    );
  }
  for (let i = 0; i < 36; i++) {
    const r = 0.4 + random() * 1.1;
    parts.push(wrappedEllipse(random() * TILE, random() * TILE, r, r * (0.6 + random() * 0.7), random() * 360, "#5c452c", 0.08 + random() * 0.08));
  }
  return parts.join("");
}

function buildWhiteboard(random: () => number): string {
  const parts: string[] = [];
  parts.push(`<pattern id="dotGrid" width="64" height="64" patternUnits="userSpaceOnUse">
      <circle cx="32" cy="32" r="1.6" fill="#54666b" opacity="0.2"/>
    </pattern>`);
  // The pattern must live in defs to be addressable; the SVG below re-inserts it
  // before painting, so keep the actual rect here with a local pattern reference.
  const defs = `<defs>${parts.join("")}</defs>`;
  const body = [
    defs,
    `<rect width="${TILE}" height="${TILE}" fill="url(#dotGrid)"/>`,
  ];
  for (let i = 0; i < 7; i++) {
    body.push(
      wrappedEllipse(
        random() * TILE,
        random() * TILE,
        40 + random() * 140,
        20 + random() * 80,
        random() * 360,
        random() > 0.5 ? "url(#mottleDark)" : "url(#mottleLight)",
        0.22 + random() * 0.2,
      ),
    );
  }
  for (let i = 0; i < 18; i++) {
    const x = random() * TILE;
    const y = random() * TILE;
    const length = 30 + random() * 150;
    const angle = (random() - 0.5) * 1.4;
    body.push(
      wrappedLine(
        x,
        y,
        x + Math.cos(angle) * length,
        y + Math.sin(angle) * length,
        random() > 0.5 ? "#718286" : "#ffffff",
        2 + random() * 9,
        0.012 + random() * 0.022,
      ),
    );
  }
  return body.join("");
}

function buildPaper(theme: BoardTheme): string {
  const random = mulberry32(theme.paperSeed * 331 + 7);
  const fibers: string[] = [];
  for (let i = 0; i < 90; i++) {
    const x = random() * PAPER_TILE;
    const y = random() * PAPER_TILE;
    const length = 2 + random() * 16;
    const angle = (random() - 0.5) * 0.6;
    const light = random() > 0.5;
    fibers.push(
      `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + Math.cos(angle) * length)}" y2="${n(y + Math.sin(angle) * length)}" stroke="${light ? "#ffffff" : "#20180f"}" stroke-width="${n(0.35 + random() * 0.5)}" opacity="${n(0.05 + random() * 0.08)}"/>`,
    );
    if (x < 18 || x > PAPER_TILE - 18 || y < 18 || y > PAPER_TILE - 18) {
      fibers.push(`<line x1="${n(x - PAPER_TILE)}" y1="${n(y)}" x2="${n(x - PAPER_TILE + Math.cos(angle) * length)}" y2="${n(y + Math.sin(angle) * length)}" stroke="#20180f" stroke-width="0.4" opacity="0.06"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAPER_TILE}" height="${PAPER_TILE}" viewBox="0 0 ${PAPER_TILE} ${PAPER_TILE}">
    <defs>
      <filter id="paperGrain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="2" seed="${theme.paperSeed}" stitchTiles="stitch"/>
        <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.2126 0.7152 0.0722 0 0"/>
      </filter>
      <filter id="paperLight" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="${theme.paperSeed + 3}" stitchTiles="stitch"/>
        <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.2126 0.7152 0.0722 0 0"/>
      </filter>
    </defs>
    <rect width="${PAPER_TILE}" height="${PAPER_TILE}" filter="url(#paperGrain)" opacity="0.13"/>
    <rect width="${PAPER_TILE}" height="${PAPER_TILE}" filter="url(#paperLight)" opacity="0.045"/>
    ${fibers.join("")}
  </svg>`;
}

function buildCrack(random: () => number): string {
  const points: Array<[number, number]> = [];
  let x = random() * TILE;
  let y = random() * TILE;
  const heading = random() * Math.PI * 2;
  const wobble = 0.4 + random() * 0.5;
  points.push([x, y]);
  const steps = 10 + Math.floor(random() * 12);
  for (let i = 0; i < steps; i++) {
    const angle = heading + Math.sin(i * 0.7 + wobble) * 0.5 + (random() - 0.5) * 0.55;
    x += Math.cos(angle) * (4 + random() * 7);
    y += Math.sin(angle) * (4 + random() * 7);
    points.push([x, y]);
  }
  const mainPath = points.map(([px, py], index) => `${index === 0 ? "M" : "L"} ${n(px)} ${n(py)}`).join(" ");
  const width = 1.1 + random() * 0.9;
  const opacity = 0.26 + random() * 0.14;
  const branches: string[] = [];
  const branchCount = 1 + Math.floor(random() * 3);
  for (let b = 0; b < branchCount; b++) {
    const seed = points[2 + Math.floor(random() * Math.max(1, points.length - 3))];
    let bx = seed[0];
    let by = seed[1];
    let branchAngle = heading + (random() > 0.5 ? 1 : -1) * (0.55 + random() * 0.9);
    const branchSteps = 3 + Math.floor(random() * 6);
    let branchPath = `M ${n(bx)} ${n(by)}`;
    for (let i = 0; i < branchSteps; i++) {
      branchAngle += (random() - 0.5) * 0.8;
      bx += Math.cos(branchAngle) * (3 + random() * 7);
      by += Math.sin(branchAngle) * (3 + random() * 7);
      branchPath += ` L ${n(bx)} ${n(by)}`;
    }
    branches.push(
      `<path d="${branchPath}" stroke="#262825" stroke-width="${n(Math.max(0.5, width * 0.55))}" opacity="${n(opacity * 0.8)}"/>`,
    );
  }
  const inner = `<path d="${mainPath}" stroke="#262825" stroke-width="${n(width + 2)}" opacity="${n(opacity * 0.22)}"/><path d="${mainPath}" transform="translate(0.9 1.1)" stroke="#c9cac3" stroke-width="${n(width + 0.5)}" opacity="${n(opacity * 0.4)}"/><path d="${mainPath}" stroke="#262825" stroke-width="${n(width)}" opacity="${n(opacity)}"/>${branches.join("")}`;
  const parts: string[] = [];
  for (const dx of [-TILE, 0, TILE]) {
    for (const dy of [-TILE, 0, TILE]) {
      parts.push(
        `<g transform="translate(${dx} ${dy})" fill="none" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`,
      );
    }
  }
  return parts.join("");
}

function wrappedEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation: number,
  fill: string,
  opacity: number,
): string {
  const parts: string[] = [];
  for (const dx of [-TILE, 0, TILE]) {
    for (const dy of [-TILE, 0, TILE]) {
      const x = cx + dx;
      const y = cy + dy;
      const radius = Math.max(rx, ry) + 2;
      if (x + radius < 0 || x - radius > TILE || y + radius < 0 || y - radius > TILE) continue;
      parts.push(
        `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" opacity="${n(opacity)}" transform="rotate(${n(rotation)} ${n(x)} ${n(y)})"/>`,
      );
    }
  }
  return parts.join("");
}

function wrappedLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  width: number,
  opacity: number,
): string {
  const parts: string[] = [];
  for (const dx of [-TILE, 0, TILE]) {
    for (const dy of [-TILE, 0, TILE]) {
      const ax = x1 + dx;
      const ay = y1 + dy;
      const bx = x2 + dx;
      const by = y2 + dy;
      if (Math.max(ax, bx) < 0 || Math.min(ax, bx) > TILE || Math.max(ay, by) < 0 || Math.min(ay, by) > TILE) continue;
      parts.push(
        `<line x1="${n(ax)}" y1="${n(ay)}" x2="${n(bx)}" y2="${n(by)}" stroke="${stroke}" stroke-width="${n(width)}" opacity="${n(opacity)}" stroke-linecap="round"/>`,
      );
    }
  }
  return parts.join("");
}

function n(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

function svgUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s{2,}/g, " "))}`;
}
