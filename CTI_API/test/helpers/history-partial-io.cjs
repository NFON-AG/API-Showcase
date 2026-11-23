// Test-only partial-write injection: write real bytes through the original I/O
// path before reporting ENOSPC. Retain the existing hold/pre-write controls.
require('./history-io.cjs');
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.CTI_DATA_DIR;
const file = path.join(dir, 'call-events.jsonl');
const trigger = path.join(dir, '.partial-append');
const appendFile = fs.promises.appendFile;
fs.promises.appendFile = async function(target, text, ...args) {
  if (String(target) !== file || !fs.existsSync(trigger)) return appendFile.call(this, target, text, ...args);
  const mode = fs.readFileSync(trigger, 'utf8');
  fs.unlinkSync(trigger);
  const bytes = Buffer.from(text);
  const firstNewline = bytes.indexOf(10);
  const cut = mode === 'complete-no-lf' ? bytes.length - 1 : mode === 'complete' ? bytes.length :
    firstNewline >= 0 && firstNewline < bytes.length - 1 ? firstNewline + 1 + Math.floor((bytes.length - firstNewline - 1) / 2) : Math.max(1, Math.floor(bytes.length / 2));
  await appendFile.call(this, target, bytes.subarray(0, cut), ...args);
  fs.writeFileSync(path.join(dir, '.wrote-partial'), JSON.stringify({ bytesWritten: cut, attemptedBytes: bytes.length }));
  throw Object.assign(Error('Synthetic ENOSPC after actual history append'), { code: 'ENOSPC' });
};
