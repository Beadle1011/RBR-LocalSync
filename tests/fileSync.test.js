const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readIniFile, writeIniFile } = require('../server/utils/fileSync');

test('readIniFile parses ini content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filesync-'));
  const iniPath = path.join(dir, 'sample.ini');
  fs.writeFileSync(iniPath, 'a=1\nb=two\n');

  const data = readIniFile(iniPath);
  assert.strictEqual(data.a, '1');
  assert.strictEqual(data.b, 'two');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeIniFile creates ini file from object', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filesync-'));
  const iniPath = path.join(dir, 'out.ini');
  const original = { section: { key: 'value' } };
  writeIniFile(iniPath, original);

  const parsed = readIniFile(iniPath);
  assert.strictEqual(parsed.section.key, 'value');
  fs.rmSync(dir, { recursive: true, force: true });
});
