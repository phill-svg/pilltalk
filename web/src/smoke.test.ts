// web/src/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('project scaffold', () => {
  it('runs a basic assertion under vitest + jsdom', () => {
    document.body.innerHTML = '<div id="app"></div>';
    expect(document.getElementById('app')).not.toBeNull();
  });
});
