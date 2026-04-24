import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  TextDocumentPositionParams,
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  Hover,
  Diagnostic,
  DiagnosticSeverity,
  Location,
  Position,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let workspaceFolders: string[] = [];

const TRANSITION_DOCS: Record<string, string> = {
  C: "**CompletionTrans** — fires when the source node completes.",
  S: "**SuccessTrans** — fires on success.",
  F: "**FailureTrans** — fires on failure.",
  T: "**TimerTrans(s)** — fires after `s` seconds.",
  D: "**DataTrans** — fires on `DataEvent`.",
  N: "**NullTrans** — fires immediately (chain steps).",
  Tap: "**TapTrans** — tap / touch.",
  Hear: "**HearTrans(pattern)** — speech match.",
};

connection.onInitialize((params: InitializeParams) => {
  workspaceFolders = (params.workspaceFolders ?? []).map((w) => URI.parse(w.uri).fsPath);
  if (workspaceFolders.length === 0 && params.rootUri) {
    workspaceFolders = [URI.parse(params.rootUri).fsPath];
  }
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: ["=", "C", "N", "T", "D"] },
      hoverProvider: true,
      definitionProvider: true,
    },
  };
});

function defaultGenfsmPath(): string | undefined {
  const root = workspaceFolders[0];
  if (!root) return undefined;
  const candidate = path.join(root, "vex-aim-tools", "genfsm");
  if (fs.existsSync(candidate)) return candidate;
  return undefined;
}

async function getGenfsmPath(docUri: string): Promise<string | undefined> {
  const cfg = await connection.workspace.getConfiguration({
    section: "fsm",
    scopeUri: docUri,
  });
  const explicit = (cfg as { genfsmPath?: string }).genfsmPath;
  if (explicit && explicit.length > 0) return explicit;
  return defaultGenfsmPath();
}

async function getPythonPath(docUri: string): Promise<string> {
  const cfg = await connection.workspace.getConfiguration({
    section: "fsm",
    scopeUri: docUri,
  });
  return (cfg as { pythonPath?: string }).pythonPath || "python3";
}

async function validateDocument(doc: TextDocument): Promise<void> {
  const genfsm = await getGenfsmPath(doc.uri);
  if (!genfsm) {
    connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
    return;
  }
  const cfg = await connection.workspace.getConfiguration({
    section: "fsm",
    scopeUri: doc.uri,
  });
  if ((cfg as { validateOnChange?: boolean }).validateOnChange === false) {
    connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
    return;
  }

  const filePath = URI.parse(doc.uri).fsPath;
  const py = await getPythonPath(doc.uri);

  const child = cp.spawn(py, [genfsm, filePath, "-"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString();
  });
  child.on("close", () => {
    const diagnostics: Diagnostic[] = [];
    const lineRe = /Line\s+(\d+):\s*(.+)/g;
    let m: RegExpExecArray | null;
    while ((m = lineRe.exec(stderr)) !== null) {
      const line = Math.max(0, parseInt(m[1], 10) - 1);
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line, character: 0 },
          end: { line, character: 200 },
        },
        message: m[2].trim(),
        source: "genfsm",
      });
    }
    if (/Error:/.test(stderr) && diagnostics.length === 0) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        message: stderr
          .split("\n")
          .filter(Boolean)
          .slice(-3)
          .join(" "),
        source: "genfsm",
      });
    }
    connection.sendDiagnostics({ uri: doc.uri, diagnostics });
  });
  child.on("error", () => {
    connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
  });
}

documents.onDidChangeContent((change) => {
  void validateDocument(change.document);
});
documents.onDidOpen((e) => {
  void validateDocument(e.document);
});

connection.onCompletion((params: TextDocumentPositionParams): Promise<CompletionItem[]> => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return Promise.resolve([]);
  const line = doc.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line, character: 500 },
  });
  if (!line.includes("=") && !line.includes("$setup")) return Promise.resolve([]);

  const items: CompletionItem[] = [];
  const types = ["C", "N", "D", "S", "F", "T", "Tap", "Hear"];
  for (const t of types) {
    const detail = TRANSITION_DOCS[t]?.replace(/\*\*/g, "") ?? "";
    items.push({
      label: `=${t}=>`,
      kind: CompletionItemKind.Operator,
      detail,
      insertText:
        t === "T" ? "=T($1)=>" : t === "Hear" ? "=Hear($1)=>" : `=${t}=>`,
      insertTextFormat:
        t === "T" || t === "Hear" ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
    });
  }
  items.push({
    label: "=>",
    kind: CompletionItemKind.Operator,
    detail: "Shorthand arrow (prefer explicit =C=>, =N=>, …)",
    insertText: "=>",
  });
  return Promise.resolve(items);
});

connection.onHover((params: TextDocumentPositionParams): Hover | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const off = doc.offsetAt(params.position);
  const text = doc.getText();
  const before = text.slice(Math.max(0, off - 40), off + 40);
  const m = before.match(/=([A-Za-z]+)(?:\([^)]*\))?=>/);
  if (!m) return null;
  const kind = m[1];
  const docMd = TRANSITION_DOCS[kind];
  if (!docMd) {
    return {
      contents: {
        kind: "markdown",
        value: `Transition **${kind}** (see genfsm / aim_fsm).`,
      },
    };
  }
  return { contents: { kind: "markdown", value: docMd } };
});

/** Python statement keywords that can appear as `word:` but are not FSM labels. */
const PYTHON_LABEL_EXCLUDE = new Set([
  "if",
  "elif",
  "else",
  "for",
  "while",
  "def",
  "class",
  "try",
  "except",
  "finally",
  "with",
  "async",
  "await",
  "return",
  "import",
  "from",
  "pass",
  "break",
  "continue",
  "raise",
  "assert",
  "global",
  "nonlocal",
  "del",
  "lambda",
  "match",
  "case",
  "yield",
]);

const SKIP_DEFINITION_WORDS = new Set([
  "self",
  "True",
  "False",
  "None",
  "and",
  "or",
  "not",
  "in",
  "is",
]);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordAt(doc: TextDocument, pos: Position): string | undefined {
  const line = doc.getText({
    start: { line: pos.line, character: 0 },
    end: { line: pos.line, character: 1_000_000 },
  });
  let start = pos.character;
  let end = pos.character;
  const isId = (c: string) => /[a-zA-Z0-9_]/.test(c);
  while (start > 0 && isId(line[start - 1]!)) start--;
  while (end < line.length && isId(line[end]!)) end++;
  const w = line.slice(start, end);
  if (!w || !/^[a-zA-Z_]/.test(w)) return undefined;
  return w;
}

/** `name: Constructor(...` style lines (FSM state labels), excluding obvious Python. */
function collectFsmLabelLines(text: string): Map<string, number> {
  const lines = text.split("\n");
  const map = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(def|class)\s/.test(line)) continue;
    const m = line.match(/^\s*([a-zA-Z_]\w*)\s*:\s*(.+)$/);
    if (!m) continue;
    const name = m[1]!;
    if (PYTHON_LABEL_EXCLUDE.has(name)) continue;
    const rest = m[2]!.trim();
    if (!/^[\w.]+\s*\(/.test(rest) && !/^self\.[\w.]+\s*\(/.test(rest)) continue;
    map.set(name, i);
  }
  return map;
}

function findPythonDefInText(text: string, word: string): { line: number } | undefined {
  const classRe = new RegExp(`^\\s*class\\s+${escapeRe(word)}\\b`);
  const defRe = new RegExp(`^\\s*def\\s+${escapeRe(word)}\\b`);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (classRe.test(line) || defRe.test(line)) return { line: i };
  }
  return undefined;
}

function parseRgLocations(stdout: string): Location[] {
  const out: Location[] = [];
  for (const raw of stdout.split("\n")) {
    if (!raw.trim()) continue;
    const m = raw.match(/^(.+?):(\d+):(.*)$/);
    if (!m) continue;
    const filePath = m[1]!;
    const line = parseInt(m[2]!, 10);
    if (Number.isNaN(line)) continue;
    const lineText = m[3]!;
    const uri = URI.file(filePath).toString();
    out.push({
      uri,
      range: {
        start: { line: line - 1, character: 0 },
        end: { line: line - 1, character: lineText.length },
      },
    });
  }
  return out;
}

function rgFindPythonSymbol(roots: string[], word: string): Location[] {
  const c = `^class\\s+${escapeRe(word)}\\b`;
  const d = `^def\\s+${escapeRe(word)}\\b`;
  const acc: Location[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      const r = cp.spawnSync(
        "rg",
        ["-n", "--glob", "*.py", "-e", c, "-e", d, root],
        { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 },
      );
      if (r.status === 0 && r.stdout) acc.push(...parseRgLocations(r.stdout));
    } catch {
      /* rg missing */
    }
  }
  if (acc.length > 0) return acc;
  return walkFindPythonSymbol(roots, word);
}

function walkFindPythonSymbol(roots: string[], word: string): Location[] {
  const classRe = new RegExp(`^class\\s+${escapeRe(word)}\\b`);
  const defRe = new RegExp(`^def\\s+${escapeRe(word)}\\b`);
  const acc: Location[] = [];
  const skipDir = new Set(["node_modules", "__pycache__", ".git", "out", "dist", "build"]);

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".") && ent.name !== ".") continue;
      if (skipDir.has(ent.name)) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".py")) {
        let text: string;
        try {
          text = fs.readFileSync(p, "utf-8");
        } catch {
          continue;
        }
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (classRe.test(line) || defRe.test(line)) {
            acc.push({
              uri: URI.file(p).toString(),
              range: {
                start: { line: i, character: 0 },
                end: { line: i, character: line.length },
              },
            });
          }
        }
      }
    }
  }

  for (const root of roots) {
    if (fs.existsSync(root)) walk(root);
  }
  return acc;
}

connection.onDefinition((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const word = wordAt(doc, params.position);
  if (!word || SKIP_DEFINITION_WORDS.has(word)) return null;

  const text = doc.getText();
  const docUri = doc.uri;
  const fsPath = URI.parse(docUri).fsPath;

  const localPy = findPythonDefInText(text, word);
  if (localPy !== undefined) {
    const lineText = text.split("\n")[localPy.line] ?? "";
    const m = lineText.match(new RegExp(`\\b(${escapeRe(word)})\\b`));
    let ch = 0;
    if (m?.index !== undefined) ch = m.index;
    return {
      uri: docUri,
      range: {
        start: { line: localPy.line, character: ch },
        end: { line: localPy.line, character: ch + word.length },
      },
    };
  }

  const labelLines = collectFsmLabelLines(text);
  const labelLine = labelLines.get(word);
  if (labelLine !== undefined) {
    const lineText = text.split("\n")[labelLine] ?? "";
    const start = lineText.indexOf(word);
    const end = start >= 0 ? start + word.length : word.length;
    return {
      uri: docUri,
      range: {
        start: { line: labelLine, character: Math.max(0, start) },
        end: { line: labelLine, character: Math.max(0, end) },
      },
    };
  }

  const roots = workspaceFolders.length > 0 ? workspaceFolders : [path.dirname(fsPath)];
  const external = rgFindPythonSymbol(roots, word);
  if (external.length === 1) return external[0]!;
  if (external.length > 1) return external;
  return null;
});

documents.listen(connection);
connection.listen();
