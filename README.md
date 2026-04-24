# AIM FSM — syntax highlighting and language server

Support for **`.fsm`** files used with `genfsm` from the VEX AIM / `vex-aim-tools` stack: Python plus `$setup{ … }` blocks and transition arrows such as `=C=>`, `=T(0.5)=>`, `=>`.

## Features

- **Syntax highlighting** — built-in Python grammar plus highlights for `$setup` and transition operators.
- **Hover** — short descriptions for common transition letters (`C`, `N`, `T`, …) when the cursor is on an arrow.
- **Completion** — suggests `=C=>`, `=N=>`, `=T()=>`, etc. when editing transition lines.
- **Diagnostics** — if `genfsm` is configured, parse errors from `genfsm` are shown in the editor.
- **Go to Definition** — right-click or F12 on an identifier: jumps to a **state label** (`p_a:`, `wait:`, …) in the same file, or to a **`class` / `def`** in the workspace (searched with ripgrep when available, otherwise a Python file walk).

## Install (Cursor / VS Code)

### Option A — load this folder as a local extension (development)

1. Run `npm install` and `npm run build` in this directory (`fsm-language-support`).
2. In Cursor/VS Code: **Command Palette** → **Developer: Install Extension from Location…** (or **Install from VSIX…** if you packaged a VSIX).
3. Choose the `fsm-language-support` folder (the one that contains `package.json`).

After installation, open any `.fsm` file; the language mode should show as **AIM FSM** (or the file should already be associated via the extension).

### Option B — run from the repo without packaging

1. `cd fsm-language-support && npm install && npm run build`
2. **Command Palette** → **Developer: Install Extension from Location…** → select `fsm-language-support`.

### Watch mode (while editing the extension)

```bash
cd fsm-language-support && npm run watch
```

Reload the window (**Developer: Reload Window**) after changes to the compiled output.

## Settings

Open **Settings** and search for **AIM FSM**, or edit `settings.json`:

| Setting | Purpose |
|--------|---------|
| `fsm.genfsmPath` | Absolute path to the `genfsm` script. If empty, the server tries `${workspaceFolder}/vex-aim-tools/genfsm`. |
| `fsm.pythonPath` | Interpreter for running `genfsm` (default `python3`). |
| `fsm.validateOnChange` | When true, re-run `genfsm` as you type (if `genfsmPath` resolves). |

## Packaging a VSIX (optional)

```bash
cd fsm-language-support
npm install
npx @vscode/vsce package
```

Install the generated `.vsix` via **Extensions: Install from VSIX…**.

## License

[MIT](./LICENSE)
