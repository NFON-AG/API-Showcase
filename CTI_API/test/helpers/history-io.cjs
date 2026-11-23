// Test-only filesystem timing/failure injection. The application source stays unchanged.
const fs = require('node:fs');
const path = require('node:path');
const dataDir = process.env.CTI_DATA_DIR;
const historyFile = path.join(dataDir, 'call-events.jsonl');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function boundary(operation) {
  const hold = path.join(dataDir, `.hold-${operation}`);
  if (fs.existsSync(hold)) {
    fs.writeFileSync(path.join(dataDir, `.entered-${operation}`), 'entered');
    const deadline = Date.now() + 5000;
    while (fs.existsSync(hold)) {
      if (Date.now() > deadline) throw Error(`Test did not release history ${operation}`);
      await sleep(5);
    }
  }
  const fail = path.join(dataDir, `.fail-${operation}`);
  if (fs.existsSync(fail)) {
    fs.unlinkSync(fail);
    throw Object.assign(Error('Synthetic history I/O failure'), { code: 'EIO' });
  }
}
const readFile = fs.promises.readFile;
fs.promises.readFile = async function(file, ...args) {
  if (String(file) !== historyFile) return readFile.call(this, file, ...args);
  let value, error;
  try { value = await readFile.call(this, file, ...args); } catch (e) { error = e; }
  await boundary('read');
  if (error) throw error;
  return value;
};
const appendFile = fs.promises.appendFile;
fs.promises.appendFile = async function(file, ...args) {
  if (String(file) === historyFile) await boundary('append');
  return appendFile.call(this, file, ...args);
};
