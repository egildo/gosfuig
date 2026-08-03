import { describe, it, expect } from 'vitest';
import { resolveFamily } from '../src/family.js';
import { resolvePalette } from '../src/palette.js';
import { renderDashboard } from '../src/dashboard/render.js';
import { contractRegion } from '../src/validate.js';

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('renderDashboard', () => {
  it('is a complete, self-contained HTML document with no external requests', () => {
    const html = renderDashboard(resolvePalette({ families: [{ name: 'green', hue: 150 }] }));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).toContain('<style>');
    // No CDN scripts, stylesheets or images — the file must open from file://.
    expect(html).not.toMatch(/<link[^>]+href=["']http/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<img/i);
  });

  it('renders one section per family, in palette order', () => {
    const html = renderDashboard(
      resolvePalette({
        families: [
          { name: 'green', hue: 150 },
          { name: 'red', hue: 27 },
        ],
      }),
    );
    expect(count(html, '<section class="fam">')).toBe(2);
    expect(html.indexOf('>green<')).toBeLessThan(html.indexOf('>red<'));
  });

  it('renders a swatch per step and a full N x N contrast grid', () => {
    const html = renderDashboard(resolvePalette({ families: [{ name: 'green', hue: 150 }] }));
    expect(count(html, 'class="sw"')).toBe(12);
    expect(count(html, 'class="cell ')).toBe(12 * 12);
  });

  it('honors a custom step count in both the strip and the grid', () => {
    const html = renderDashboard(
      resolvePalette({ families: [{ name: 'green', hue: 150, steps: 5 }] }),
    );
    expect(count(html, 'class="sw"')).toBe(5);
    expect(count(html, 'class="cell ')).toBe(25);
  });

  it('outlines exactly the contract region', () => {
    const html = renderDashboard(resolvePalette({ families: [{ name: 'green', hue: 150 }] }));
    const region = contractRegion(12);
    expect(count(html, ' contract"')).toBe(region.dark.length * region.light.length);
  });

  it('marks a locked swatch with a star', () => {
    const plain = renderDashboard(resolvePalette({ families: [{ name: 'blue', hue: 259 }] }));
    const locked = renderDashboard(
      resolvePalette({ families: [{ name: 'blue', hue: 259, locks: { '700': '#1d4ed8' } }] }),
    );
    // The marker legend also contains a ★, so compare relatively.
    expect(count(locked, '★')).toBe(count(plain, '★') + 1);
    expect(locked).toContain('#1d4ed8');
  });

  it('reports the contract verdict and the worst pair per family', () => {
    const pass = renderDashboard(resolvePalette({ families: [{ name: 'green', hue: 150 }] }));
    expect(pass).toContain('contract PASS');

    const fail = renderDashboard(
      resolvePalette({ families: [{ name: 'blue', hue: 259, locks: { '700': '#1d4ed8' } }] }),
    );
    expect(fail).toContain('contract FAIL');
    expect(fail).toContain('worst 700/200 = 3.8');
  });

  it('escapes HTML in the palette and family names', () => {
    const html = renderDashboard(
      resolvePalette({ name: 'a & b', families: [{ name: '<script>x</script>', hue: 150 }] }),
    );
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
  });

  it('paints every cell with a real background and foreground hex', () => {
    const family = resolveFamily({ name: 'green', hue: 150 });
    const html = renderDashboard({ name: 'p', families: [family] });
    for (const s of family.swatches) expect(html).toContain(s.hex);
    expect(count(html, 'style="background:#')).toBe(12 + 12 * 12);
  });
});
