import { describe, expect, it } from 'vitest';
import { navigationGroups } from '../src/layouts/Sidebar';

describe('proposal navigation', () => {
  const items = navigationGroups.flatMap((group) => group.items);

  it('places Overview first', () => {
    expect(navigationGroups[0]?.title).toBe('Overview');
    expect(navigationGroups[0]?.items[0]?.to).toBe('/overview');
  });

  it('uses one Digitization entry for scan review and custody', () => {
    const digitization = items.find((item) => item.label === 'Digitization');
    expect(digitization?.to).toBe('/digitization');
    expect(digitization?.also).toContain('/custody');
    expect(items.some((item) => item.label === 'Custody register')).toBe(false);
  });

  it('does not expose maps, room layout, or support as separate menus', () => {
    const labels = items.map((item) => item.label);
    expect(labels).not.toContain('Maps');
    expect(labels).not.toContain('Rooms & shelves');
    expect(labels).not.toContain('Help & support');
  });
});
