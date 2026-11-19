import { describe, expect, it } from 'vitest';
import {
  buildLevelEstimates,
  COMPRESSION_LEVELS,
  recommendLevel,
} from '../src/lib/compression-levels';

describe('compression levels', () => {
  it('orders the three levels from light to strong', () => {
    expect(COMPRESSION_LEVELS.map((def) => def.key)).toEqual(['light', 'balanced', 'strong']);
  });

  it('keeps quality and scale monotonic: light keeps the most, strong the least', () => {
    const [light, balanced, strong] = COMPRESSION_LEVELS;
    expect(light.quality).toBeGreaterThan(balanced.quality);
    expect(balanced.quality).toBeGreaterThan(strong.quality);
    expect(light.scale).toBeGreaterThan(balanced.scale);
    expect(balanced.scale).toBeGreaterThan(strong.scale);
  });

  it('recommends by bytes per page', () => {
    expect(recommendLevel(0)).toBe('light');
    expect(recommendLevel(100 * 1024)).toBe('light');
    expect(recommendLevel(200 * 1024)).toBe('balanced');
    expect(recommendLevel(500 * 1024)).toBe('strong');
  });

  it('treats a non-finite average as light rather than throwing', () => {
    expect(recommendLevel(Number.NaN)).toBe('light');
    expect(recommendLevel(-1)).toBe('light');
  });

  it('marks exactly one recommended level and computes the saved fraction', () => {
    const estimates = buildLevelEstimates(1_000_000, 5, {
      light: 900_000,
      balanced: 500_000,
      strong: 300_000,
    });
    // 1 MB over 5 pages = 200 KB/page -> balanced.
    expect(estimates.filter((row) => row.recommended).map((row) => row.level)).toEqual([
      'balanced',
    ]);
    expect(estimates.find((row) => row.level === 'strong')?.savedFraction).toBeCloseTo(0.7);
    expect(estimates.find((row) => row.level === 'light')?.savedFraction).toBeCloseTo(0.1);
  });

  it('reports a negative saving when a level would grow the file', () => {
    const estimates = buildLevelEstimates(100_000, 10, {
      light: 150_000,
      balanced: 150_000,
      strong: 150_000,
    });
    expect(estimates.every((row) => row.savedFraction < 0)).toBe(true);
  });
});
