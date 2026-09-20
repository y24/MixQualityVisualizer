const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

class Library {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS tracks (
        id INTEGER PRIMARY KEY, analysis_id TEXT NOT NULL, source TEXT NOT NULL,
        name TEXT NOT NULL, duration REAL NOT NULL, mode TEXT NOT NULL,
        version TEXT NOT NULL, summary TEXT NOT NULL, result TEXT NOT NULL,
        updated_at TEXT NOT NULL, UNIQUE(analysis_id, source)
      );
      CREATE TABLE IF NOT EXISTS imported_caches (
        path TEXT PRIMARY KEY, mtime REAL NOT NULL, size INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS removed_tracks (
        analysis_id TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY(analysis_id,source)
      );
      CREATE TABLE IF NOT EXISTS workspace_session (id INTEGER PRIMARY KEY CHECK(id=1), snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_results (
        analysis_id TEXT NOT NULL, source TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(analysis_id,source)
      );`);
  }
  save(result, importing = false) {
    if (!/^[a-f0-9]{24}$/.test(result.id) || !result.source || !Number.isFinite(result.duration))
      throw new Error('ライブラリに保存する解析結果が不正です。');
    const { media, ...stored } = result;
    const source = path.resolve(result.source);
    if (importing && this.db.prepare('SELECT 1 FROM removed_tracks WHERE analysis_id=? AND source=?').get(result.id, source)) return;
    this.db.prepare(`INSERT INTO tracks
      (analysis_id,source,name,duration,mode,version,summary,result,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(analysis_id,source) DO ${importing ? 'NOTHING' :
        'UPDATE SET name=excluded.name, summary=excluded.summary, result=excluded.result, updated_at=excluded.updated_at'}`)
      .run(result.id, path.resolve(result.source), path.basename(result.source), result.duration,
        result.mode, String(result.version), JSON.stringify(result.summary || {}), JSON.stringify(stored), new Date().toISOString());
    if (!importing) this.db.prepare('DELETE FROM removed_tracks WHERE analysis_id=? AND source=?').run(result.id, source);
  }
  importCaches(directory) {
    if (!fs.existsSync(directory)) return;
    for (const id of fs.readdirSync(directory)) {
      if (!/^[a-f0-9]{24}$/.test(id)) continue;
      const filename = path.join(directory, id, 'result.json');
      let result, stat;
      try {
        stat = fs.statSync(filename);
        const imported = this.db.prepare('SELECT mtime,size FROM imported_caches WHERE path=?').get(filename);
        if (imported?.mtime === stat.mtimeMs && imported.size === stat.size) continue;
        result = JSON.parse(fs.readFileSync(filename, 'utf8'));
      }
      catch { continue; } // Incomplete analyses are not library entries.
      if (result.id === id && result.source && Number.isFinite(result.duration)) {
        this.save(result, true);
        this.db.prepare('INSERT OR REPLACE INTO imported_caches(path,mtime,size) VALUES (?,?,?)').run(filename, stat.mtimeMs, stat.size);
      }
    }
  }
  list(version) {
    return this.db.prepare('SELECT id,analysis_id,name,source,duration,mode,version,summary,updated_at FROM tracks ORDER BY updated_at DESC,id DESC').all()
      .map(row => ({ ...row, summary: JSON.parse(row.summary), compatible: row.version === String(version), sourceExists: fs.existsSync(row.source) }));
  }
  load(id) {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid library id');
    const row = this.db.prepare('SELECT result FROM tracks WHERE id=?').get(id);
    if (!row) throw new Error('音源がライブラリに見つかりません。');
    return JSON.parse(row.result);
  }
  remove(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !Number.isSafeInteger(id) || id < 1))
      throw new Error('削除する音源を選択してください。');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const remember = this.db.prepare('INSERT OR IGNORE INTO removed_tracks(analysis_id,source) SELECT analysis_id,source FROM tracks WHERE id=?');
      const remove = this.db.prepare('DELETE FROM tracks WHERE id=?');
      let count = 0;
      for (const id of new Set(ids)) { remember.run(id); count += remove.run(id).changes; }
      this.db.exec('COMMIT');
      return count;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  prepareAnalysis(id) {
    const result = this.load(id), saved = result.analysis_request || {};
    const file = filename => filename && fs.existsSync(filename) ? {path:filename,name:path.basename(filename)} : null;
    const stems = {};
    if (result.mode === 'stems') for (const part of ['vocals','drums','bass','other']) {
      const stem = file(saved.stems?.[part]);
      if (stem) stems[part] = stem;
    }
    return { id, source:file(result.source), mode:result.mode, model:result.model,
      device:saved.device || result.requested_device || 'auto', stems };
  }
  close() { this.db.close(); }
  saveSession(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.workspaces)) throw new Error('Invalid workspace session');
    const tracks = snapshot.workspaces.flatMap(w => [w.track, ...w.references]);
    if (tracks.some(t => !t || typeof t.id !== 'string' || typeof t.source !== 'string')) throw new Error('Invalid workspace track');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const copy = this.db.prepare('INSERT OR IGNORE INTO workspace_results SELECT analysis_id,source,result FROM tracks WHERE analysis_id=? AND source=?');
      const exists = this.db.prepare('SELECT 1 FROM workspace_results WHERE analysis_id=? AND source=?');
      for (const track of tracks) {
        copy.run(track.id, path.resolve(track.source));
        if (!exists.get(track.id, path.resolve(track.source))) throw new Error('保存するワークスペースの解析結果が見つかりません。');
      }
      this.db.prepare('INSERT OR REPLACE INTO workspace_session(id,snapshot) VALUES (1,?)').run(JSON.stringify(snapshot));
      const keep = new Set(tracks.map(t => JSON.stringify([t.id,path.resolve(t.source)])));
      for (const row of this.db.prepare('SELECT analysis_id,source FROM workspace_results').all()) {
        if (!keep.has(JSON.stringify([row.analysis_id,row.source]))) this.db.prepare('DELETE FROM workspace_results WHERE analysis_id=? AND source=?').run(row.analysis_id,row.source);
      }
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  loadSession() {
    const row = this.db.prepare('SELECT snapshot FROM workspace_session WHERE id=1').get();
    return {snapshot:row ? JSON.parse(row.snapshot) : null, results:this.db.prepare('SELECT result FROM workspace_results').all().map(r=>JSON.parse(r.result))};
  }
}
module.exports = { Library };
