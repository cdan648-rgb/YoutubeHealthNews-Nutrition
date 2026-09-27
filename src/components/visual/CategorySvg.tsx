/**
 * Our own generative artwork, one motif per category.
 *
 * Why generate SVG rather than use stock imagery: a photograph of a laboratory or a
 * person in a white coat adds no information and, on a health site, risks reading as
 * clinical evidence for whatever claim sits beside it. These are deliberately
 * abstract — geometry, not medicine — and each is a couple of kilobytes of markup
 * with no network request and no licensing question.
 *
 * Output is deterministic: the same (motif, seed) always draws the same figure, so an
 * article's artwork is stable across rebuilds and across server and client renders.
 */
import type { IconKey } from '@/lib/domain/types';

export type Motif = IconKey | 'lattice';

/**
 * A tiny deterministic PRNG (mulberry32).
 *
 * `Math.random()` would produce different artwork on the server and the client,
 * causing a hydration mismatch, and different artwork on every rebuild.
 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable seed from any string, so a slug or a category name can drive the artwork. */
export function seedFrom(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

type Props = {
  readonly motif: Motif;
  readonly seed?: string;
  readonly className?: string;
  /** Decorative by default; pass a label when the figure carries meaning. */
  readonly title?: string;
};

const VIEWBOX = { width: 320, height: 180 } as const;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Molecular lattice: nodes joined by bonds. Micronutrients, vitamins. */
function molecule(next: () => number): React.ReactElement[] {
  const nodes = Array.from({ length: 9 }, () => ({
    x: round(30 + next() * 260),
    y: round(25 + next() * 130),
    r: round(3 + next() * 5),
  }));
  const bonds: React.ReactElement[] = [];
  nodes.forEach((a, i) => {
    const b = nodes[(i + 1 + Math.floor(next() * 2)) % nodes.length];
    if (b === undefined) return;
    bonds.push(
      <line key={`b${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={1} opacity={0.45} />,
    );
  });
  return [
    ...bonds,
    ...nodes.map((n, i) => <circle key={`n${i}`} cx={n.x} cy={n.y} r={n.r} strokeWidth={1.2} />),
  ];
}

/** Nested arcs radiating outward. Metabolism, energy. */
function flame(next: () => number): React.ReactElement[] {
  return Array.from({ length: 7 }, (_, i) => {
    const scale = 0.3 + i * 0.1;
    const wobble = round(next() * 12 - 6);
    return (
      <path
        key={i}
        d={`M ${160 + wobble} 165 C ${160 - 90 * scale} ${140 - 60 * scale}, ${160 - 40 * scale} ${30 + 20 * scale}, ${160 + wobble} ${20 + 10 * scale} C ${160 + 40 * scale} ${30 + 20 * scale}, ${160 + 90 * scale} ${140 - 60 * scale}, ${160 + wobble} 165 Z`}
        fill="none"
        strokeWidth={1}
        opacity={round(0.15 + i * 0.09)}
      />
    );
  });
}

/** Stacked sine waves. Hormones, signalling, brainwaves. */
function wave(next: () => number): React.ReactElement[] {
  return Array.from({ length: 6 }, (_, row) => {
    const amp = 6 + next() * 16;
    const period = 40 + next() * 40;
    const y = 30 + row * 24;
    let d = `M 10 ${round(y)}`;
    for (let x = 10; x <= 310; x += 5) {
      d += ` L ${x} ${round(y + Math.sin((x / period) * Math.PI * 2) * amp)}`;
    }
    return <path key={row} d={d} fill="none" strokeWidth={1.1} opacity={round(0.25 + row * 0.1)} />;
  });
}

/** Concentric shield outlines. Immunity, defence. */
function shield(next: () => number): React.ReactElement[] {
  return Array.from({ length: 5 }, (_, i) => {
    const inset = i * 12 + round(next() * 3);
    return (
      <path
        key={i}
        d={`M 160 ${20 + inset} L ${272 - inset} ${48 + inset} L ${272 - inset} ${96 - inset / 2} C ${272 - inset} ${132} 220 ${158 - inset / 2} 160 ${166 - inset} C 100 ${158 - inset / 2} ${48 + inset} ${132} ${48 + inset} ${96 - inset / 2} L ${48 + inset} ${48 + inset} Z`}
        fill="none"
        strokeWidth={1.1}
        opacity={round(0.55 - i * 0.08)}
      />
    );
  });
}

/** Branching ducts. Digestive tract, liver, kidney. */
function organ(next: () => number): React.ReactElement[] {
  const paths: React.ReactElement[] = [];
  const branch = (x: number, y: number, angle: number, length: number, depth: number): void => {
    if (depth === 0 || length < 8) return;
    const x2 = round(x + Math.cos(angle) * length);
    const y2 = round(y + Math.sin(angle) * length);
    paths.push(
      <line
        key={`${depth}-${paths.length}`}
        x1={round(x)}
        y1={round(y)}
        x2={x2}
        y2={y2}
        strokeWidth={round(depth * 0.5)}
        opacity={0.5}
      />,
    );
    branch(x2, y2, angle - 0.4 - next() * 0.3, length * 0.72, depth - 1);
    branch(x2, y2, angle + 0.4 + next() * 0.3, length * 0.72, depth - 1);
  };
  branch(160, 170, -Math.PI / 2, 46, 5);
  return paths;
}

/** Interlocking arcs with a gap. Joints, cartilage. */
function joint(next: () => number): React.ReactElement[] {
  return Array.from({ length: 4 }, (_, i) => {
    const r = 26 + i * 15;
    const shift = round(next() * 6 - 3);
    return (
      <g key={i} opacity={round(0.6 - i * 0.1)}>
        <path
          d={`M ${110 + shift} ${90 - r} A ${r} ${r} 0 0 1 ${110 + shift} ${90 + r}`}
          fill="none"
          strokeWidth={1.3}
        />
        <path
          d={`M ${210 - shift} ${90 + r} A ${r} ${r} 0 0 1 ${210 - shift} ${90 - r}`}
          fill="none"
          strokeWidth={1.3}
        />
      </g>
    );
  });
}

/** Expanding rings on a slow rhythm. Breathing, prevention, mind-body. */
function breath(next: () => number): React.ReactElement[] {
  return Array.from({ length: 8 }, (_, i) => (
    <circle
      key={i}
      cx={160}
      cy={90}
      r={round(10 + i * 9 + next() * 3)}
      fill="none"
      strokeWidth={1.1}
      opacity={round(0.5 - i * 0.05)}
    />
  ));
}

/** A regular grid, gently perturbed. Generic fallback. */
function lattice(next: () => number): React.ReactElement[] {
  const dots: React.ReactElement[] = [];
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 11; col += 1) {
      dots.push(
        <circle
          key={`${row}-${col}`}
          cx={round(26 + col * 27 + next() * 4)}
          cy={round(24 + row * 27 + next() * 4)}
          r={round(1.4 + next() * 2)}
          strokeWidth={0.8}
          opacity={round(0.3 + next() * 0.4)}
        />,
      );
    }
  }
  return dots;
}

const RENDERERS: Record<Motif, (next: () => number) => React.ReactElement[]> = {
  molecule,
  flame,
  wave,
  shield,
  organ,
  joint,
  breath,
  lattice,
};

/**
 * Renders a category motif.
 *
 * Colour comes from `currentColor` so the figure inherits the surrounding text colour
 * and therefore works in both light and dark themes without a second asset.
 */
export function CategorySvg({ motif, seed = motif, className, title }: Props) {
  const next = rng(seedFrom(`${motif}:${seed}`));
  const decorative = title === undefined;

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
      className={className}
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      stroke="currentColor"
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={title}
    >
      {RENDERERS[motif](next)}
    </svg>
  );
}
