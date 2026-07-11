# quip_ide

An extremely minimal, vim-first personal desktop IDE. Electron + CodeMirror 6 + xterm.js.

- Vim keybindings everywhere, nvim-style command line
- First-class `.ipynb` notebooks: cell editing, live run times, LaTeX/markdown rendering, local Jupyter kernel
- Real built-in terminal (your shell, via node-pty)
- Gruvbox-hard theme, near-zero UI chrome

## Install

**Prerequisites**

| What | Why | Get it |
| --- | --- | --- |
| Node.js ≥ 20 + npm | runs/builds the app | <https://nodejs.org> or `brew install node` |
| Python 3 + Jupyter | *(optional)* only for running notebook cells | `pip install jupyter-server ipykernel` |

**Steps**

```sh
git clone https://github.com/quip0/quip_ide.git
cd quip_ide
npm install     # also downloads Electron and rebuilds node-pty for it
npm start       # build + launch the app
```

That's it — a window opens; hit `⌘O` to open a folder. Everything but notebook execution works with zero extra setup. To run notebook cells, install the Jupyter bits above (any of framework/homebrew/conda/`~/.local` Pythons are auto-detected).

**Troubleshooting**

- *"Electron failed to install correctly"* — the binary download was interrupted. Fix: `rm -rf node_modules/electron && npm install`.
- *Terminal pane doesn't open* — node-pty needs to be built against Electron: `npx electron-rebuild -f -w node-pty` (normally automatic via postinstall).
- *"jupyter_server not found in any python"* — `pip install jupyter-server ipykernel` for whichever Python you use, then rerun the cell.

## Keys

| Key | Action |
| --- | --- |
| `⌘O` | Open folder (file picker) |
| `\` `e` | Toggle file tree |
| `\` `w` | Switch focus between split panes |
| `:open [-t] <path>` | Open file (in split with `-t`) |
| `:vsplit` / `:only` | Open / close split pane |
| `⌘J` | Toggle terminal |
| `⌘S` / `:w` | Save |
| `:q` | Close tab |
| `⌘⇧]` / `⌘⇧[` | Next / previous tab |
| `:cheat` | Keybind cheatsheet |

**File tree** — arrow keys (or `hjkl`) to navigate, `→`/`Enter` to open.

**Editor** — full vim keybindings (via codemirror-vim). Ex commands: `:w` `:q` `:wq` `:x` `:qa` (quit app), `:e <path>` (open file), `:term` (toggle terminal), `:Ex` (toggle file tree).

**Notebook (.ipynb)** — vim-style command mode on cells:

| Key | Action |
| --- | --- |
| `j` / `k` | Move between cells |
| `Enter` / `i` | Edit cell (vim inside the cell) |
| `Esc` | Back to cell command mode |
| `Shift-Enter` | Run cell and advance |
| `Ctrl-Enter` | Run cell in place |
| `a` / `b` | New cell above / below |
| `dd` | Delete cell |
| `R` / `:runall` | Run all cells |
| `:restart` | Restart kernel (clears state) |
| `:restartall` | Restart kernel, then run all |
| `m` / `y` | To markdown / to code |
| `gg` / `G` | First / last cell |

The first cell you run starts a local Jupyter server + python3 kernel automatically.
