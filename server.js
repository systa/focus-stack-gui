import express from "express";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import os from "os";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BINARY = process.env.FOCUS_STACK_BIN || "/usr/local/bin/focus-stack";

async function checkBinary() {
  try {
    await fs.access(BINARY);
    return true;
  } catch {
    return false;
  }
}

app.get("/health", (_req, res) => res.json({ status: "ok", binary: BINARY }));

app.post("/run", async (req, res) => {
  if (!(await checkBinary())) {
    return res.status(500).json({ error: `Binary not found: ${BINARY}` });
  }

  const { args = [], input = "", timeoutMs = 120_000 } = req.body;
  if (!Array.isArray(args)) {
    return res.status(400).json({ error: "args must be array" });
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "focus-stack-"));
  const stderrChunks = [];
  const stdoutChunks = [];
  let timedOut = false;

  const proc = spawn(BINARY, args, {
    cwd: tmpDir,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });

  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);

  proc.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
  proc.stderr.on("data", (chunk) => stderrChunks.push(chunk));

  proc.on("error", (err) => {
    clearTimeout(timer);
    res.status(500).json({ error: "spawn error", details: err.message });
  });

  proc.on("close", async (code, signal) => {
    clearTimeout(timer);
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    if (timedOut) {
      return res.status(504).json({ error: "process timeout" });
    }
    res.json({
      exitCode: code,
      signal,
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
    });
  });

  if (input) {
    proc.stdin.write(input);
  }
  proc.stdin.end();
});

app.listen(PORT, () => {
  console.log(`focus-stack API running on http://0.0.0.0:${PORT}`);
});