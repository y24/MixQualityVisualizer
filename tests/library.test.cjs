const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Library } = require('../desktop/library.cjs');

test('library persists results, preserves source aliases, migrates idempotently and validates IDs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mqv-library-'));
  const filename = path.join(dir, 'library.sqlite');
  let library = new Library(filename);
  try {
    const r = { id: 'a'.repeat(24), source: path.join(dir, '曲.wav'), name: '曲', duration: 12,
      version: 7, mode: 'mix', summary: { low_pct: { median: 22 } }, media_paths: { mix: 'preview.wav' }, series: { low_pct: [22] } };
    library.save(r); library.save(r);
    assert.equal(library.list(7).length, 1);
    library.save({ ...r, source: path.join(dir, 'コピー.wav') });
    assert.equal(library.list(7).length, 2);
    const cache = path.join(dir, 'analyses', r.id);fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'result.json'), JSON.stringify(r));
    library.save({ ...r, summary: { low_pct: { median: 33 } } });
    library.importCaches(path.dirname(cache));
    library.close();library = new Library(filename);
    const rows = library.list(7);
    const row = rows.find(x => x.source === r.source);
    assert.equal(rows.length, 2);assert.equal(row.summary.low_pct.median, 33);
    assert.equal(row.name, '曲.wav');assert.equal(row.compatible, true);assert.equal(row.sourceExists, false);
    assert.deepEqual(library.load(row.id).series, r.series);
    assert.deepEqual(library.load(row.id).media_paths, r.media_paths);
    assert.equal(library.list(8)[0].compatible, false);
    assert.throws(() => library.load('../escape'));assert.throws(() => library.load(999));
    assert.throws(() => library.remove([row.id, 'invalid']));
    assert.equal(library.list(7).length, 2);
    assert.equal(library.remove(rows.map(x=>x.id)), 2);
    assert.equal(library.list(7).length, 0);
    assert.throws(() => library.load(row.id));
    // A changed cache must not resurrect a deleted entry on the next launch.
    fs.writeFileSync(path.join(cache, 'result.json'), JSON.stringify({...r, cached: true}));
    library.close();library = new Library(filename);
    library.importCaches(path.dirname(cache));
    assert.equal(library.list(7).length, 0);
    assert.ok(fs.existsSync(path.join(cache, 'result.json')));
    // Explicitly analyzing again restores the registration.
    library.save(r);assert.equal(library.list(7).length, 1);
    const restored=library.list(7)[0];
    assert.equal(library.prepareAnalysis(restored.id).source, null);
    const source=path.join(cache,'result.json');
    library.save({...r,source,mode:'stems',analysis_request:{device:'cpu',stems:{vocals:source,drums:'missing.wav'}}});
    const prepared=library.prepareAnalysis(library.list(7).find(x=>x.source===source).id);
    assert.equal(prepared.source.path,source);
    assert.deepEqual(Object.keys(prepared.stems),['vocals']);
    assert.equal(prepared.device,'cpu');
  } finally { library.close();fs.rmSync(dir, { recursive: true, force: true }); }
});
