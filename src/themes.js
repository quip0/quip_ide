// Theme palettes. Every color in the app (UI chrome, CodeMirror, xterm) flows
// from these 16 slots via CSS variables, so switching is instant and live.
export const THEMES = {
  'gruvbox-hard':    { bg: '#1d2021', bg2: '#282828', bg3: '#504945', sel: '#3c3836', border: '#3c3836', fg: '#ebdbb2', fg2: '#bdae93', dim: '#928374', accent: '#fabd2f', red: '#fb4934', green: '#b8bb26', yellow: '#fabd2f', blue: '#83a598', purple: '#d3869b', aqua: '#8ec07c', orange: '#fe8019' },
  'gruvbox-soft':    { bg: '#32302f', bg2: '#3c3836', bg3: '#665c54', sel: '#504945', border: '#504945', fg: '#ebdbb2', fg2: '#bdae93', dim: '#928374', accent: '#fabd2f', red: '#fb4934', green: '#b8bb26', yellow: '#fabd2f', blue: '#83a598', purple: '#d3869b', aqua: '#8ec07c', orange: '#fe8019' },
  'dracula':         { bg: '#282a36', bg2: '#21222c', bg3: '#44475a', sel: '#44475a', border: '#343746', fg: '#f8f8f2', fg2: '#b8b8b2', dim: '#6272a4', accent: '#bd93f9', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#8be9fd', purple: '#bd93f9', aqua: '#8be9fd', orange: '#ffb86c' },
  'nord':            { bg: '#2e3440', bg2: '#3b4252', bg3: '#4c566a', sel: '#434c5e', border: '#3b4252', fg: '#d8dee9', fg2: '#aeb8c9', dim: '#616e88', accent: '#88c0d0', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', purple: '#b48ead', aqua: '#88c0d0', orange: '#d08770' },
  'tokyonight':      { bg: '#1a1b26', bg2: '#24283b', bg3: '#3b4261', sel: '#283457', border: '#292e42', fg: '#c0caf5', fg2: '#a9b1d6', dim: '#565f89', accent: '#7aa2f7', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', purple: '#bb9af7', aqua: '#7dcfff', orange: '#ff9e64' },
  'catppuccin-mocha':{ bg: '#1e1e2e', bg2: '#313244', bg3: '#45475a', sel: '#313244', border: '#313244', fg: '#cdd6f4', fg2: '#bac2de', dim: '#6c7086', accent: '#cba6f7', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', blue: '#89b4fa', purple: '#cba6f7', aqua: '#94e2d5', orange: '#fab387' },
  'catppuccin-latte':{ bg: '#eff1f5', bg2: '#e6e9ef', bg3: '#bcc0cc', sel: '#ccd0da', border: '#bcc0cc', fg: '#4c4f69', fg2: '#5c5f77', dim: '#8c8fa1', accent: '#8839ef', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d', blue: '#1e66f5', purple: '#8839ef', aqua: '#179299', orange: '#fe640b' },
  'solarized-dark':  { bg: '#002b36', bg2: '#073642', bg3: '#586e75', sel: '#073642', border: '#073642', fg: '#93a1a1', fg2: '#839496', dim: '#586e75', accent: '#b58900', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', purple: '#6c71c4', aqua: '#2aa198', orange: '#cb4b16' },
  'solarized-light': { bg: '#fdf6e3', bg2: '#eee8d5', bg3: '#93a1a1', sel: '#eee8d5', border: '#d9d2c2', fg: '#586e75', fg2: '#657b83', dim: '#93a1a1', accent: '#b58900', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', purple: '#6c71c4', aqua: '#2aa198', orange: '#cb4b16' },
  'monokai':         { bg: '#272822', bg2: '#2d2e27', bg3: '#49483e', sel: '#3e3d32', border: '#3e3d32', fg: '#f8f8f2', fg2: '#c5c4bc', dim: '#75715e', accent: '#a6e22e', red: '#f92672', green: '#a6e22e', yellow: '#e6db74', blue: '#66d9ef', purple: '#ae81ff', aqua: '#66d9ef', orange: '#fd971f' },
  'one-dark':        { bg: '#282c34', bg2: '#21252b', bg3: '#4b5263', sel: '#3e4451', border: '#181a1f', fg: '#abb2bf', fg2: '#9198a5', dim: '#5c6370', accent: '#61afef', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', purple: '#c678dd', aqua: '#56b6c2', orange: '#d19a66' },
  'everforest':      { bg: '#2d353b', bg2: '#343f44', bg3: '#475258', sel: '#3d484d', border: '#3d484d', fg: '#d3c6aa', fg2: '#bfb08c'.replace('8c','9c'), dim: '#859289', accent: '#a7c080', red: '#e67e80', green: '#a7c080', yellow: '#dbbc7f', blue: '#7fbbb3', purple: '#d699b6', aqua: '#83c092', orange: '#e69875' },
  'rose-pine':       { bg: '#191724', bg2: '#1f1d2e', bg3: '#403d52', sel: '#26233a', border: '#26233a', fg: '#e0def4', fg2: '#908caa', dim: '#6e6a86', accent: '#f6c177', red: '#eb6f92', green: '#9ccfd8', yellow: '#f6c177', blue: '#31748f', purple: '#c4a7e7', aqua: '#9ccfd8', orange: '#ebbcba' },
  'kanagawa':        { bg: '#1f1f28', bg2: '#2a2a37', bg3: '#54546d', sel: '#363646', border: '#363646', fg: '#dcd7ba', fg2: '#c8c093', dim: '#727169', accent: '#e6c384', red: '#c34043', green: '#98bb6c', yellow: '#e6c384', blue: '#7e9cd8', purple: '#957fb8', aqua: '#7aa89f', orange: '#ffa066' },
  'ayu-dark':        { bg: '#0a0e14', bg2: '#131721', bg3: '#3d4751', sel: '#253340', border: '#1b2733', fg: '#b3b1ad', fg2: '#8f8c87', dim: '#626a73', accent: '#ffb454', red: '#f07178', green: '#c2d94c', yellow: '#ffb454', blue: '#59c2ff', purple: '#d4bfff', aqua: '#95e6cb', orange: '#ff8f40' },
  'one-light':       { bg: '#fafafa', bg2: '#eaeaeb', bg3: '#a0a1a7', sel: '#e5e5e6', border: '#dbdbdc', fg: '#383a42', fg2: '#50525a', dim: '#a0a1a7', accent: '#4078f2', red: '#e45649', green: '#50a14f', yellow: '#c18401', blue: '#4078f2', purple: '#a626a4', aqua: '#0184bc', orange: '#c18401' }
};

export const DEFAULT_THEME = 'gruvbox-hard';

let activeName = DEFAULT_THEME;
export const activeTheme = () => THEMES[activeName];
export const activeThemeName = () => activeName;

// Set CSS variables on :root; returns the palette (caller updates terminals).
export function applyThemeVars(name) {
  const t = THEMES[name];
  if (!t) return null;
  activeName = name;
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(t)) root.setProperty('--' + k, v);
  root.setProperty('--err', t.red);
  return t;
}

export function termThemeOf(t = activeTheme()) {
  return {
    background: t.bg, foreground: t.fg,
    cursor: t.accent, cursorAccent: t.bg, selectionBackground: t.bg3,
    black: t.bg2, red: t.red, green: t.green, yellow: t.yellow,
    blue: t.blue, magenta: t.purple, cyan: t.aqua, white: t.fg2,
    brightBlack: t.dim, brightRed: t.red, brightGreen: t.green, brightYellow: t.yellow,
    brightBlue: t.blue, brightMagenta: t.purple, brightCyan: t.aqua, brightWhite: t.fg
  };
}
