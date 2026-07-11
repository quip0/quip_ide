// Gruvbox (hard) — palette + a deliberately maximal CodeMirror highlight style.
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';

export const gruv = {
  bg0h: '#1d2021', bg0: '#282828', bg1: '#3c3836', bg2: '#504945', bg3: '#665c54',
  fg: '#ebdbb2', fg2: '#d5c4a1', fg3: '#bdae93', gray: '#928374',
  red: '#fb4934', green: '#b8bb26', yellow: '#fabd2f', blue: '#83a598',
  purple: '#d3869b', aqua: '#8ec07c', orange: '#fe8019',
  redDim: '#cc241d', greenDim: '#98971a', yellowDim: '#d79921', blueDim: '#458588',
  purpleDim: '#b16286', aquaDim: '#689d6a', orangeDim: '#d65d0e'
};

const style = HighlightStyle.define([
  // keywords & flow
  { tag: t.keyword, color: gruv.red },
  { tag: t.controlKeyword, color: gruv.red, fontWeight: 'bold' },
  { tag: t.moduleKeyword, color: gruv.aqua },
  { tag: t.operatorKeyword, color: gruv.red },
  { tag: t.definitionKeyword, color: gruv.red },
  { tag: t.self, color: gruv.purple, fontStyle: 'italic' },
  { tag: t.null, color: gruv.purple },
  { tag: t.bool, color: gruv.purple },
  { tag: t.atom, color: gruv.purple },
  // names
  { tag: t.variableName, color: gruv.fg },
  { tag: t.definition(t.variableName), color: gruv.blue },
  { tag: t.function(t.variableName), color: gruv.green },
  { tag: t.function(t.definition(t.variableName)), color: gruv.green, fontWeight: 'bold' },
  { tag: t.definition(t.propertyName), color: gruv.aqua },
  { tag: t.propertyName, color: gruv.blue },
  { tag: t.attributeName, color: gruv.yellow },
  { tag: t.className, color: gruv.yellow, fontWeight: 'bold' },
  { tag: t.typeName, color: gruv.yellow },
  { tag: t.standard(t.typeName), color: gruv.yellow, fontStyle: 'italic' },
  { tag: t.namespace, color: gruv.aqua },
  { tag: t.macroName, color: gruv.aqua },
  { tag: t.labelName, color: gruv.orange },
  { tag: t.tagName, color: gruv.aqua, fontWeight: 'bold' },
  // literals
  { tag: t.string, color: gruv.green },
  { tag: t.special(t.string), color: gruv.orange },
  { tag: t.docString, color: gruv.greenDim, fontStyle: 'italic' },
  { tag: t.character, color: gruv.purple },
  { tag: t.number, color: gruv.purple },
  { tag: t.integer, color: gruv.purple },
  { tag: t.float, color: gruv.purple },
  { tag: t.regexp, color: gruv.orange },
  { tag: t.escape, color: gruv.orange },
  { tag: t.color, color: gruv.purple },
  { tag: t.url, color: gruv.blue, textDecoration: 'underline' },
  // operators & punctuation
  { tag: t.operator, color: gruv.aqua },
  { tag: t.arithmeticOperator, color: gruv.aqua },
  { tag: t.logicOperator, color: gruv.red },
  { tag: t.compareOperator, color: gruv.aqua },
  { tag: t.updateOperator, color: gruv.aqua },
  { tag: t.definitionOperator, color: gruv.orange },
  { tag: t.punctuation, color: gruv.fg3 },
  { tag: t.separator, color: gruv.fg3 },
  { tag: t.bracket, color: gruv.fg2 },
  { tag: t.angleBracket, color: gruv.fg3 },
  { tag: t.squareBracket, color: gruv.orange },
  { tag: t.paren, color: gruv.fg2 },
  { tag: t.brace, color: gruv.fg2 },
  // comments & meta
  { tag: t.comment, color: gruv.gray, fontStyle: 'italic' },
  { tag: t.lineComment, color: gruv.gray, fontStyle: 'italic' },
  { tag: t.blockComment, color: gruv.gray, fontStyle: 'italic' },
  { tag: t.meta, color: gruv.gray },
  { tag: t.annotation, color: gruv.yellow, fontStyle: 'italic' },
  { tag: t.processingInstruction, color: gruv.gray },
  { tag: t.invalid, color: gruv.red, textDecoration: 'underline wavy' },
  // markdown / prose
  { tag: t.heading, color: gruv.yellow, fontWeight: 'bold' },
  { tag: t.heading1, color: gruv.orange, fontWeight: 'bold' },
  { tag: t.heading2, color: gruv.yellow, fontWeight: 'bold' },
  { tag: t.heading3, color: gruv.green, fontWeight: 'bold' },
  { tag: t.strong, color: gruv.orange, fontWeight: 'bold' },
  { tag: t.emphasis, color: gruv.purple, fontStyle: 'italic' },
  { tag: t.strikethrough, color: gruv.gray, textDecoration: 'line-through' },
  { tag: t.link, color: gruv.blue, textDecoration: 'underline' },
  { tag: t.quote, color: gruv.gray, fontStyle: 'italic' },
  { tag: t.monospace, color: gruv.aqua },
  { tag: t.contentSeparator, color: gruv.bg3 },
  { tag: t.list, color: gruv.fg },
  // misc
  { tag: t.constant(t.variableName), color: gruv.purple },
  { tag: t.standard(t.variableName), color: gruv.blue, fontStyle: 'italic' },
  { tag: t.local(t.variableName), color: gruv.fg },
  { tag: t.special(t.variableName), color: gruv.orange },
  { tag: t.deleted, color: gruv.red, textDecoration: 'line-through' },
  { tag: t.inserted, color: gruv.green },
  { tag: t.changed, color: gruv.yellow },
  { tag: t.unit, color: gruv.purple },
  { tag: t.modifier, color: gruv.orange, fontStyle: 'italic' },
  { tag: t.keyword, color: gruv.red }
]);

export const gruvboxHighlight = syntaxHighlighting(style);

export const gruvboxEditorTheme = EditorView.theme({
  '&': { backgroundColor: gruv.bg0h, color: gruv.fg },
  '.cm-gutters': { backgroundColor: gruv.bg0h, color: gruv.bg3, border: 'none' },
  '.cm-activeLine': { backgroundColor: '#26292a' },
  '.cm-activeLineGutter': { backgroundColor: '#26292a', color: gruv.yellow },
  '.cm-cursor': { borderLeftColor: gruv.fg },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: gruv.bg2 + ' !important' },
  '.cm-selectionMatch': { backgroundColor: gruv.bg1 },
  '.cm-searchMatch': { backgroundColor: gruv.yellowDim + '55', outline: `1px solid ${gruv.yellowDim}` },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: gruv.orangeDim + '77' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: gruv.bg2, color: gruv.orange + ' !important' },
  '.cm-fat-cursor': { background: gruv.yellow + ' !important', color: gruv.bg0h + ' !important' },
  '&:not(.cm-focused) .cm-fat-cursor': { background: 'none !important', outline: `1px solid ${gruv.bg3}` }
}, { dark: true });

// gruvbox ANSI palette for xterm
export const gruvboxTerm = {
  background: gruv.bg0h, foreground: gruv.fg,
  cursor: gruv.fg, cursorAccent: gruv.bg0h, selectionBackground: gruv.bg2,
  black: gruv.bg0, red: gruv.redDim, green: gruv.greenDim, yellow: gruv.yellowDim,
  blue: gruv.blueDim, magenta: gruv.purpleDim, cyan: gruv.aquaDim, white: '#a89984',
  brightBlack: gruv.gray, brightRed: gruv.red, brightGreen: gruv.green, brightYellow: gruv.yellow,
  brightBlue: gruv.blue, brightMagenta: gruv.purple, brightCyan: gruv.aqua, brightWhite: gruv.fg
};
