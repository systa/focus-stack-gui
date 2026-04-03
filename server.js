import express from "express";
import multer from "multer";
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import os from "os";

const app = express();
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

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

function applyOptionsToArgs(options) {
  const args = [];
  for (const [key, value] of Object.entries(options || {})) {
    const flag = key.length === 1 ? `-${key}` : `--${key.replace(/_/g, "-")}`;

    if (typeof value === "boolean") {
      if (value) args.push(flag);
      continue;
    }

    if (Array.isArray(value)) {
      for (const v of value) {
        args.push(flag, String(v));
      }
      continue;
    }

    if (value !== null && value !== undefined) {
      args.push(flag, String(value));
    }
  }
  return args;
}

app.get("/health", (_req, res) => res.json({ status: "ok", binary: BINARY }));

app.post("/run", upload.array("files"), async (req, res) => {
  if (!(await checkBinary())) {
    return res.status(500).json({ error: `Binary not found: ${BINARY}` });
  }

  let args = [];
  let options = {};
  let outputFiles = [];
  let timeoutMs = 120_000;
  let input = "";

  try {
    if (req.body.args) {
      args = typeof req.body.args === "string" ? JSON.parse(req.body.args) : req.body.args;
    }
    if (req.body.options) {
      options = typeof req.body.options === "string" ? JSON.parse(req.body.options) : req.body.options;
    }
    if (req.body.outputFiles) {
      outputFiles = typeof req.body.outputFiles === "string" ? JSON.parse(req.body.outputFiles) : req.body.outputFiles;
    }
    if (req.body.timeoutMs) {
      timeoutMs = Number(req.body.timeoutMs) || timeoutMs;
    }
    if (req.body.input) {
      input = String(req.body.input);
    }
  } catch (err) {
    return res.status(400).json({ error: "invalid JSON in body fields", details: err.message });
  }

  if (!Array.isArray(args)) {
    return res.status(400).json({ error: "args must be array" });
  }
  if (!Array.isArray(outputFiles)) {
    return res.status(400).json({ error: "outputFiles must be array" });
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "focus-stack-"));
  try {
    // Write uploaded input files to temp working folder
    for (const file of req.files || []) {
      const filePath = path.join(tmpDir, file.originalname);
      await fs.writeFile(filePath, file.buffer);
    }

    const flags = applyOptionsToArgs(options);
    const finalArgs = [...args, ...flags];

    const stderrChunks = [];
    const stdoutChunks = [];
    let timedOut = false;

    const proc = spawn(BINARY, finalArgs, {
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

      if (timedOut) {
        res.status(504).json({ error: "process timeout" });
        return;
      }

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      const outputs = {};
      for (const out of outputFiles) {
        const outPath = path.join(tmpDir, out);
        try {
          const data = await fs.readFile(outPath);
          outputs[out] = {
            encoding: "base64",
            data: data.toString("base64"),
            size: data.length,
          };
        } catch {
          outputs[out] = { missing: true };
        }
      }

      res.json({
        exitCode: code,
        signal,
        stdout,
        stderr,
        outputs,
      });
    });

    if (input) {
      proc.stdin.write(input);
    }
    proc.stdin.end();
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    res.status(500).json({ error: "server error", details: err.message });
  } finally {
    setTimeout(() => fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {}), 5000);
  }
});

app.listen(PORT, () => {
  console.log(`focus-stack API running on http://0.0.0.0:${PORT}`);
});