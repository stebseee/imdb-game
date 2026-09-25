// failure-summary-reporter.js — writes every failed round's error (plus the end of
// what it printed) to e2e/last-failures.txt, so it's easy to open and share
// instead of scrolling back through Terminal. The file is rewritten on every run.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'last-failures.txt');
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
const lastLines = (s, n) => s.split('\n').slice(-n).join('\n');
const firstLines = (s, n) => s.split('\n').slice(0, n).join('\n');

class FailureSummaryReporter {
  constructor() {
    this.failed = [];
    this.skipped = [];
  }

  onTestEnd(test, result) {
    const title = test.titlePath().filter(Boolean).join(' › ');
    if (result.status === 'failed' || result.status === 'timedOut') {
      const errors = result.errors.map(e => firstLines(stripAnsi(e.message || e.value || e), 60));
      const printed = stripAnsi(result.stdout.map(String).join(''));
      this.failed.push({ title, status: result.status, errors, printed });
    } else if (result.status === 'skipped') {
      this.skipped.push(title);
    }
  }

  onEnd(result) {
    if (!this.failed.length) {
      fs.writeFileSync(OUT, `All tests passed (${new Date().toLocaleString()}).\n`);
      return;
    }
    const parts = [`Test run ${new Date().toLocaleString()}: ${this.failed.length} failed\n`];
    this.failed.forEach((f, i) => {
      parts.push(`\n========== ${i + 1}) ${f.title} [${f.status}] ==========`);
      for (const e of f.errors) parts.push(e);
      if (f.printed.trim()) parts.push(`\n--- last lines it printed ---\n${lastLines(f.printed.trim(), 25)}`);
    });
    if (this.skipped.length) {
      parts.push(`\n========== Skipped (an earlier round in the same file failed) ==========`);
      for (const t of this.skipped) parts.push(`- ${t}`);
    }
    fs.writeFileSync(OUT, parts.join('\n') + '\n');
    console.log(`\n  Failure details saved to e2e/last-failures.txt (open it in VS Code and paste it to Claude).\n`);
  }
}

module.exports = FailureSummaryReporter;
