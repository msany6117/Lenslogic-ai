import { StockQualityCheckItem, StockQualityReport } from './techBgTypes';

/**
 * Technical & Visual Stock Quality Analyzer.
 * Inspects real pixel statistics on a rendered canvas and evaluates resolution,
 * contrast spread, gradient smoothness (banding risk), pixel noise, and copy space.
 * Provides guidance only — does not guarantee marketplace acceptance or sales.
 */
export function analyzeStockQuality(
  canvas: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  isTransparentMode: boolean
): StockQualityReport {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width;
  const h = canvas.height;
  const megapixels = Number(((targetWidth * targetHeight) / 1_000_000).toFixed(1));
  const dimensionsLabel = `${targetWidth.toLocaleString()} × ${targetHeight.toLocaleString()} px`;

  const checks: StockQualityCheckItem[] = [];

  // 1. Resolution & Dimensions Integrity
  const longEdge = Math.max(targetWidth, targetHeight);
  const shortEdge = Math.min(targetWidth, targetHeight);
  if (longEdge >= 3840 && shortEdge >= 2160) {
    checks.push({
      id: 'resolution',
      label: 'Resolution & Pixel Dimensions',
      status: 'pass',
      value: `${dimensionsLabel} (${megapixels} MP)`,
      guidance:
        'Meets ultra-HD 4K/8K commercial scale with true full-resolution procedural rendering.',
    });
  } else if (megapixels >= 4.0) {
    checks.push({
      id: 'resolution',
      label: 'Resolution & Pixel Dimensions',
      status: 'review',
      value: `${dimensionsLabel} (${megapixels} MP)`,
      guidance:
        'Usable for web and digital layouts; switch to 4K or 8K preset for broad large-format stock coverage.',
    });
  } else {
    checks.push({
      id: 'resolution',
      label: 'Resolution & Pixel Dimensions',
      status: 'warn',
      value: `${dimensionsLabel} (${megapixels} MP)`,
      guidance:
        'Custom resolution is below typical 4 MP commercial minimums. Increase dimensions or select 4K/8K.',
    });
  }

  if (!ctx || w < 16 || h < 16) {
    return {
      overallTier: 'Needs Review',
      checkedAt: Date.now(),
      dimensionsLabel,
      megapixels,
      checks,
      disclaimer:
        'Technical and visual guidance only. Results do not represent automated approval or sales guarantees on Adobe Stock or any marketplace.',
    };
  }

  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const stride = Math.max(1, Math.floor((w * h) / 48000)); // ~48k balanced samples

  const lums: number[] = [];
  let opaqueCount = 0;
  let clippedHigh = 0;
  let clippedLow = 0;

  // Quadrant activity accumulators (for negative space / composition balance)
  const quadSum = [0, 0, 0, 0];
  const quadSq = [0, 0, 0, 0];
  const quadCount = [0, 0, 0, 0];

  // Neighbor step counters for banding & harsh noise
  let smoothSteps = 0;
  let flatRunSteps = 0;
  let harshSpikes = 0;
  let edgeTransitions = 0;

  for (let y = 1; y < h - 1; y += Math.max(1, Math.round(Math.sqrt(stride)))) {
    for (let x = 1; x < w - 1; x += Math.max(1, Math.round(Math.sqrt(stride)))) {
      const idx = (y * w + x) * 4;
      const a = data[idx + 3];
      if (a < 20) continue;
      opaqueCount++;

      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lums.push(lum);

      if (lum > 250) clippedHigh++;
      if (lum < 3) clippedLow++;

      const qIdx = (y >= h / 2 ? 2 : 0) + (x >= w / 2 ? 1 : 0);
      quadSum[qIdx] += lum;
      quadSq[qIdx] += lum * lum;
      quadCount[qIdx]++;

      // Horizontal & vertical neighbor diffs
      const idxR = (y * w + (x + 1)) * 4;
      const idxD = ((y + 1) * w + x) * 4;
      const lumR = 0.2126 * data[idxR] + 0.7152 * data[idxR + 1] + 0.0722 * data[idxR + 2];
      const lumD = 0.2126 * data[idxD] + 0.7152 * data[idxD + 1] + 0.0722 * data[idxD + 2];

      const diff = (Math.abs(lum - lumR) + Math.abs(lum - lumD)) * 0.5;
      if (diff < 8) {
        smoothSteps++;
        if (diff === 0) flatRunSteps++;
      }
      if (diff > 65) harshSpikes++;
      if (diff > 18) edgeTransitions++;
    }
  }

  lums.sort((a, b) => a - b);
  const n = Math.max(1, lums.length);
  const p5 = lums[Math.floor(n * 0.05)] ?? 0;
  const p95 = lums[Math.floor(n * 0.95)] ?? 200;
  const spread = p95 - p5;
  const clipPct = ((clippedHigh + clippedLow) / Math.max(1, opaqueCount)) * 100;

  // 2. Dynamic Range & Contrast
  if (spread >= 75 && clipPct < 35) {
    checks.push({
      id: 'contrast',
      label: 'Tonal Separation & Dynamic Range',
      status: 'pass',
      value: `${Math.round(spread)} pts spread`,
      guidance:
        'Balanced tonal separation between background atmosphere and foreground highlights.',
    });
  } else if (spread >= 40) {
    checks.push({
      id: 'contrast',
      label: 'Tonal Separation & Dynamic Range',
      status: 'review',
      value: `${Math.round(spread)} pts spread`,
      guidance:
        'Subtle low-contrast mood. Consider raising Contrast or Glow Intensity slightly if stronger focal pop is desired.',
    });
  } else {
    checks.push({
      id: 'contrast',
      label: 'Tonal Separation & Dynamic Range',
      status: 'warn',
      value: `${Math.round(spread)} pts spread`,
      guidance:
        'Very narrow tonal range or heavy clipping detected. Adjust Contrast/Brightness for cleaner depth.',
    });
  }

  // 3. Color Banding Risk
  const flatRatio = smoothSteps > 0 ? flatRunSteps / smoothSteps : 0;
  if (isTransparentMode) {
    checks.push({
      id: 'banding',
      label: 'Alpha & Gradient Smoothness',
      status: 'pass',
      value: `${Math.round((opaqueCount / Math.max(1, (w * h) / stride)) * 100)}% coverage`,
      guidance:
        'Transparent overlay channel active; export as PNG or WebP to preserve clean alpha edges.',
    });
  } else if (flatRatio < 0.42) {
    checks.push({
      id: 'banding',
      label: 'Color Banding & Dither Smoothness',
      status: 'pass',
      value: `${Math.round((1 - flatRatio) * 100)}% smooth micro-variation`,
      guidance:
        'Shader micro-dithering maintains smooth tonal transitions without visible 8-bit gradient steps.',
    });
  } else if (flatRatio < 0.68) {
    checks.push({
      id: 'banding',
      label: 'Color Banding & Dither Smoothness',
      status: 'review',
      value: `${Math.round((1 - flatRatio) * 100)}% smooth micro-variation`,
      guidance:
        'Large low-variance areas present. Export as PNG or high-quality JPEG (92%+) to preserve smooth gradients.',
    });
  } else {
    checks.push({
      id: 'banding',
      label: 'Color Banding & Dither Smoothness',
      status: 'warn',
      value: 'Flat regions detected',
      guidance:
        'Increase Depth Control or Detail Level to add richer gradient modulation across dark surfaces.',
    });
  }

  // 4. Composition Balance & Copy Negative Space
  const quadStds = quadCount.map((cnt, qi) => {
    if (cnt < 10) return 0;
    const mean = quadSum[qi] / cnt;
    return Math.sqrt(Math.max(0, quadSq[qi] / cnt - mean * mean));
  });
  const minQuadStd = Math.min(...quadStds);
  const maxQuadStd = Math.max(...quadStds);
  const edgeDensityPct = (edgeTransitions / Math.max(1, opaqueCount)) * 100;

  if (maxQuadStd > minQuadStd * 1.15 && edgeDensityPct < 38) {
    checks.push({
      id: 'composition',
      label: 'Composition Balance & Copy Space',
      status: 'pass',
      value: `${edgeDensityPct.toFixed(1)}% active edge ratio`,
      guidance:
        'Asymmetric visual density leaves clean breathing room for headlines, UI overlays, or presentation text.',
    });
  } else if (edgeDensityPct < 52) {
    checks.push({
      id: 'composition',
      label: 'Composition Balance & Copy Space',
      status: 'review',
      value: `${edgeDensityPct.toFixed(1)}% active edge ratio`,
      guidance:
        'Moderately uniform visual energy across quadrants; works well as a full-bleed backdrop or patterned texture.',
    });
  } else {
    checks.push({
      id: 'composition',
      label: 'Composition Balance & Copy Space',
      status: 'warn',
      value: `${edgeDensityPct.toFixed(1)}% active edge ratio`,
      guidance:
        'Very busy structural density across frame. Lower Pattern Density or Complexity if clean text space is needed.',
    });
  }

  // 5. Artifacts & Unwanted Noise Check
  const spikePct = (harshSpikes / Math.max(1, opaqueCount)) * 100;
  if (spikePct < 4.5) {
    checks.push({
      id: 'artifacts',
      label: 'Noise & Rendering Cleanliness',
      status: 'pass',
      value: `${spikePct.toFixed(1)}% high-contrast edges`,
      guidance:
        'Vector primitives and shader fields rendered cleanly without aliasing speckles or random pixel noise.',
    });
  } else {
    checks.push({
      id: 'artifacts',
      label: 'Noise & Rendering Cleanliness',
      status: 'review',
      value: `${spikePct.toFixed(1)}% sharp edge transitions`,
      guidance:
        'High density of crisp high-contrast lines; inspect fullscreen preview at 100% scale before final export.',
    });
  }

  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const reviewCount = checks.filter((c) => c.status === 'review').length;

  const overallTier: StockQualityReport['overallTier'] =
    warnCount > 0
      ? 'Needs Review'
      : reviewCount >= 2
        ? 'Good with Minor Adjustments'
        : 'Strong Technical Fit';

  return {
    overallTier,
    checkedAt: Date.now(),
    dimensionsLabel,
    megapixels,
    checks,
    disclaimer:
      'Technical and visual guidance only. Results do not represent automated approval or sales guarantees on Adobe Stock or any marketplace.',
  };
}
