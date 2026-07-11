// CodeMirror highlight + editor theme. All colors reference the CSS variables
// set by themes.js/applyThemeVars, so a theme switch restyles every editor live.
// (Export names kept from the original gruvbox-only implementation.)
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';

const v = (n) => `var(--${n})`;
const mix = (n, pct) => `color-mix(in srgb, var(--${n}) ${pct}%, transparent)`;

const style = HighlightStyle.define([
  // keywords & flow
  { tag: t.keyword, color: v('red') },
  { tag: t.controlKeyword, color: v('red'), fontWeight: 'bold' },
  { tag: t.moduleKeyword, color: v('aqua') },
  { tag: t.operatorKeyword, color: v('red') },
  { tag: t.definitionKeyword, color: v('red') },
  { tag: t.self, color: v('purple'), fontStyle: 'italic' },
  { tag: t.null, color: v('purple') },
  { tag: t.bool, color: v('purple') },
  { tag: t.atom, color: v('purple') },
  // names
  { tag: t.variableName, color: v('fg') },
  { tag: t.definition(t.variableName), color: v('blue') },
  { tag: t.function(t.variableName), color: v('green') },
  { tag: t.function(t.definition(t.variableName)), color: v('green'), fontWeight: 'bold' },
  { tag: t.definition(t.propertyName), color: v('aqua') },
  { tag: t.propertyName, color: v('blue') },
  { tag: t.attributeName, color: v('yellow') },
  { tag: t.className, color: v('yellow'), fontWeight: 'bold' },
  { tag: t.typeName, color: v('yellow') },
  { tag: t.standard(t.typeName), color: v('yellow'), fontStyle: 'italic' },
  { tag: t.namespace, color: v('aqua') },
  { tag: t.macroName, color: v('aqua') },
  { tag: t.labelName, color: v('orange') },
  { tag: t.tagName, color: v('aqua'), fontWeight: 'bold' },
  // literals
  { tag: t.string, color: v('green') },
  { tag: t.special(t.string), color: v('orange') },
  { tag: t.docString, color: v('green'), fontStyle: 'italic' },
  { tag: t.character, color: v('purple') },
  { tag: t.number, color: v('purple') },
  { tag: t.integer, color: v('purple') },
  { tag: t.float, color: v('purple') },
  { tag: t.regexp, color: v('orange') },
  { tag: t.escape, color: v('orange') },
  { tag: t.color, color: v('purple') },
  { tag: t.url, color: v('blue'), textDecoration: 'underline' },
  // operators & punctuation
  { tag: t.operator, color: v('aqua') },
  { tag: t.arithmeticOperator, color: v('aqua') },
  { tag: t.logicOperator, color: v('red') },
  { tag: t.compareOperator, color: v('aqua') },
  { tag: t.updateOperator, color: v('aqua') },
  { tag: t.definitionOperator, color: v('orange') },
  { tag: t.punctuation, color: v('fg2') },
  { tag: t.separator, color: v('fg2') },
  { tag: t.bracket, color: v('fg2') },
  { tag: t.angleBracket, color: v('fg2') },
  { tag: t.squareBracket, color: v('orange') },
  { tag: t.paren, color: v('fg2') },
  { tag: t.brace, color: v('fg2') },
  // comments & meta
  { tag: t.comment, color: v('dim'), fontStyle: 'italic' },
  { tag: t.lineComment, color: v('dim'), fontStyle: 'italic' },
  { tag: t.blockComment, color: v('dim'), fontStyle: 'italic' },
  { tag: t.meta, color: v('dim') },
  { tag: t.annotation, color: v('yellow'), fontStyle: 'italic' },
  { tag: t.processingInstruction, color: v('dim') },
  { tag: t.invalid, color: v('red'), textDecoration: 'underline wavy' },
  // markdown / prose
  { tag: t.heading, color: v('yellow'), fontWeight: 'bold' },
  { tag: t.heading1, color: v('orange'), fontWeight: 'bold' },
  { tag: t.heading2, color: v('yellow'), fontWeight: 'bold' },
  { tag: t.heading3, color: v('green'), fontWeight: 'bold' },
  { tag: t.strong, color: v('orange'), fontWeight: 'bold' },
  { tag: t.emphasis, color: v('purple'), fontStyle: 'italic' },
  { tag: t.strikethrough, color: v('dim'), textDecoration: 'line-through' },
  { tag: t.link, color: v('blue'), textDecoration: 'underline' },
  { tag: t.quote, color: v('dim'), fontStyle: 'italic' },
  { tag: t.monospace, color: v('aqua') },
  { tag: t.contentSeparator, color: v('bg3') },
  { tag: t.list, color: v('fg') },
  // misc
  { tag: t.constant(t.variableName), color: v('purple') },
  { tag: t.standard(t.variableName), color: v('blue'), fontStyle: 'italic' },
  { tag: t.local(t.variableName), color: v('fg') },
  { tag: t.special(t.variableName), color: v('orange') },
  { tag: t.deleted, color: v('red'), textDecoration: 'line-through' },
  { tag: t.inserted, color: v('green') },
  { tag: t.changed, color: v('yellow') },
  { tag: t.unit, color: v('purple') },
  { tag: t.modifier, color: v('orange'), fontStyle: 'italic' }
]);

export const gruvboxHighlight = syntaxHighlighting(style);

export const gruvboxEditorTheme = EditorView.theme({
  '&': { backgroundColor: v('bg'), color: v('fg') },
  '.cm-gutters': { backgroundColor: v('bg'), color: v('bg3'), border: 'none' },
  '.cm-activeLine': { backgroundColor: mix('fg', 5) },
  '.cm-activeLineGutter': { backgroundColor: mix('fg', 5), color: v('yellow') },
  '.cm-cursor': { borderLeftColor: v('fg') },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: v('bg3') + ' !important' },
  '.cm-selectionMatch': { backgroundColor: v('sel') },
  '.cm-searchMatch': { backgroundColor: mix('yellow', 30), outline: `1px solid ${v('yellow')}` },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: mix('orange', 45) },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: v('bg3'), color: v('orange') + ' !important' },
  '.cm-fat-cursor': { background: v('accent') + ' !important', color: v('bg') + ' !important' },
  '&:not(.cm-focused) .cm-fat-cursor': { background: 'none !important', outline: `1px solid ${v('bg3')}` }
}, { dark: true });
