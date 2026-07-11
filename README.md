# quip_ide

An extremely minimal, vim-first personal desktop IDE. Electron + CodeMirror 6 + xterm.js.

## Run

```sh
npm install
npm start
```

Notebook execution needs Jupyter available to `python3`:

```sh
pip install jupyter-server ipykernel
```

## Keys

| Key | Action |
| --- | --- |
| `⌘O` | Open folder (file picker) |
| `\` `e` | Toggle file tree |
| `⌘J` | Toggle terminal |
| `⌘S` / `:w` | Save |
| `:q` | Close file |

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
| `m` / `y` | To markdown / to code |
| `gg` / `G` | First / last cell |

The first cell you run starts a local Jupyter server + python3 kernel automatically.
