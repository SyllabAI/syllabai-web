/**
 * MathML speech-text → LaTeX converter for SME-derived corpus content.
 *
 * Problem (user-reported 2026-09-20, igcse-maths-b-16 note rn_XDKBYvZP5QNfgHTx,
 * confirmed across 34/49 packages, ~24,600 artifacts corpus-wide): chunks of
 * the upstream math carry Chrome MathML *speech text* instead of LaTeX — the
 * accessibility serialization of the original Wiris MathML, e.g.
 *   `fraction numerator x open parentheses x minus 1 close parentheses over
 *    denominator open parentheses x plus 4 close parentheses end fraction`
 * instead of `\frac{x(x-1)}{(x+4)}`. Upstream dumped these verbatim into
 * inline code spans (21,842 spans) and into some `$…$` segments (694), so the
 * site rendered long English "fraction numerator … over denominator …" strings
 * where formatted math should be.
 *
 * speechToTex() reconstructs LaTeX from that grammar. It is strictly guarded:
 * if ANY grammar word survives conversion, or the produced TeX does not parse
 * with KaTeX, it returns null and callers keep the original text. A failed
 * conversion therefore degrades to today's rendering, never to garbage math.
 *
 * Grammar reference (sampled corpus-wide, see scripts/test_speech_math_22a.ts):
 *   fractions   "fraction numerator N over denominator D end fraction",
 *               bare "13 over 4"
 *   powers      "x to the power of n minus 1 end exponent" → x^{n-1},
 *               "to the power of apostrophe" → {'}
 *   roots       "square root of X end root" → \sqrt{X}, ordinal roots
 *               ("fourth root of X" → \sqrt[4]{X}), terminator-less atom scope
 *   sub/super   "m subscript i" → m_{i}, "… end subscript" terminator
 *   tables      "table row cell A end cell equals cell B end cell end table"
 *               → \begin{gathered} A & = B \end{gathered}; attribute tables
 *               "table attributes columnalign right center left columnspacing
 *               0px end attributes row …" → \begin{array}{rcl} …
 *   big ops     "sum from i equals 1 to n of X" → \sum_{i=1}^{n} X,
 *               "limit as h rightwards arrow 0 of X" → \lim_{h \to 0} X,
 *               "stack sum", "integral"
 *   accents     "x with bar on top" → \bar{x}, "top enclose r" → \vec{r}
 *   cancelling  "up diagonal strike 4 end strike" → \cancel{4}
 *   wrappers    "begin mathsize 16px style … end style" → stripped,
 *               "invisible function application" → stripped
 *   tokens      "open parentheses"/"left parenthesis" → (, "equals" → =,
 *               "negative" → -, "squared" → ^{2}, "straight d" → \mathrm{d},
 *               "bold i" → \boldsymbol{i}, "pi" → \pi, "space" → ' ',
 *               "percent sign" → \%, "identical to" → \equiv, "and" → text
 */

import katex from "katex";

/** Phrases whose presence (with `squared`/`cubed`/`straight X`/`bold X`)
 *  identifies a span as MathML speech text. Deliberately strong markers only,
 *  so ordinary code spans (spec ids, URLs, `4CH1_1.2`) never match. */
const STRONG_MARKERS = [
  "open parentheses", "close parentheses", "open square brackets",
  "close square brackets", "open curly brackets", "close curly brackets",
  "left parenthesis", "right parenthesis", "open bracket", "close bracket",
  "open brace", "close brace", "fraction numerator", "over denominator",
  "end fraction", "end table", "end row", "end cell", "end root",
  "end exponent", "end subscript", "end superscript", "to the power",
  "square root of", "cube root of", "with subscript", "with superscript",
  "with bar on top", "with dot on top", "with hat on top", "with tilde on top",
  "with rightwards arrow on top", "with blank below", "with blank above",
  "top enclose", "up diagonal strike", "end strike", "cross times",
  "percent sign", "identical to", "plus-or-minus", "rightwards arrow",
  "rightwards double arrow", "leftwards arrow", "stack sum", "begin mathsize",
  "begin inline style", "begin display style", "vertical line", "divided by",
  "less than or equal to", "greater than or equal to",
].join("|");

const STRONG_MARKER_RE = new RegExp(
  `${STRONG_MARKERS}|\\bsquared\\b|\\bcubed\\b|\\bstraight [a-z]|\\bbold [a-z]`,
);

export function looksLikeSpeechText(s: string): boolean {
  return STRONG_MARKER_RE.test(s);
}

/** Innermost-first fraction: groups may not contain "fraction numerator"
 *  (nested cases fall through to the residual guard → null). Looping handles
 *  siblings after their inner children convert. Corpus check: 4,133
 *  fraction spans, 0 nested — this is belt-and-braces. */
const FRAC_RE =
  /fraction numerator ((?:(?! over denominator|fraction numerator ).)+) over denominator ((?:(?! end fraction|fraction numerator ).)+) end fraction/g;

const ORDINAL_ROOTS: [RegExp, string][] = [
  [/square root of (.+?) end root/g, " \\sqrt{$1} "],
  [/cube root of (.+?) end root/g, " \\sqrt[3]{$1} "],
  [/fourth root of (.+?) end root/g, " \\sqrt[4]{$1} "],
];

const ORDINAL_ROOTS_ATOM =
  /\b(square|cube|fourth|n-th) root of ((?:bold italic |bold |straight )?(blank|[a-zA-Z0-9.]+))/g;

function replaceOrdinalRootAtom(_m: string, deg: string, atom: string): string {
  const bare = atom.replace(/^(?:bold italic |bold |straight )/, "");
  const arg = deg === "square" ? "" : deg === "cube" ? "[3]" : deg === "fourth" ? "[4]" : "[n]";
  return ` \\sqrt${arg}{${bare}} `;
}

/** Attribute tables: column alignment list → {rcl}-style column spec. */
const TABLE_ATTRS_RES: RegExp[] = [
  /table attributes columnalign ((?:right|center|left|blank)(?: (?:right|center|left|blank))*) columnspacing \d+px end attributes row/g,
  /table attributes columnalign ((?:right|center|left|blank)(?: (?:right|center|left|blank))*) end attributes row/g,
];

function arrayCols(align: string): string {
  return align
    .split(" ")
    .map((c) => (c === "right" ? "r" : c === "left" ? "l" : "c"))
    .join("");
}

type PhraseReplacement = string | ((...args: unknown[]) => string);

/** Multi-word token table, applied in listed order — compound entries precede
 *  their substrings, and every "end X" precedes bare "X" (\bcell\b would
 *  otherwise eat the suffix of "end cell" and leave a stray "end" behind). */
const PHRASES: [RegExp, PhraseReplacement][] = [
  ...TABLE_ATTRS_RES.map(
    (re) =>
      [
        re,
        (m: string, align: string) => ` \\begin{array}{${arrayCols(align)}} `,
      ] as [RegExp, PhraseReplacement],
  ),
  [/stretchy left square bracket/g, "["],
  [/stretchy right square bracket/g, "]"],
  [/stretchy left parenthesis/g, "("],
  [/stretchy right parenthesis/g, ")"],
  [/almost equal to/g, "\\approx"],
  [/\btilde\b/g, "\\sim "],
  [/less than or equal to/g, "\\le"],
  [/greater than or equal to/g, "\\ge"],
  [/approximately equal to/g, "\\approx"],
  [/not identical to/g, "\\not\\equiv"],
  [/not equal to/g, "\\ne"],
  [/identical to/g, "\\equiv"],
  [/proportional to/g, "\\propto"],
  [/plus-or-minus/g, "\\pm"],
  [/plus or minus/g, "\\pm"],
  [/percent sign/g, "\\%"],
  [/less than/g, "<"],
  [/greater than/g, ">"],
  [/invisible function application/g, " "],
  [/rightwards harpoon over leftwards harpoon/g, " \\rightleftharpoons "],
  [/leftwards harpoon over rightwards harpoon/g, " \\rightleftharpoons "],
  [/open square brackets/g, "["],
  [/close square brackets/g, "]"],
  [/open curly brackets/g, "\\{"],
  [/close curly brackets/g, "\\}"],
  [/open parentheses/g, "("],
  [/close parentheses/g, ")"],
  [/left parenthesis/g, "("],
  [/right parenthesis/g, ")"],
  [/open bracket/g, "["],
  [/close bracket/g, "]"],
  [/open brace/g, "\\{"],
  [/close brace/g, "\\}"],
  [/double vertical line/g, "\\Vert"],
  [/vertical line/g, "\\vert"],
  [/cross times/g, "\\times"],
  [/divided by/g, "\\div"],
  [/rightwards double arrow/g, "\\Leftrightarrow"],
  [/leftwards double arrow/g, "\\Leftarrow"],
  [/rightwards arrow/g, "\\rightarrow"],
  [/leftwards arrow/g, "\\leftarrow"],
  [/upwards arrow/g, "\\uparrow"],
  [/downwards arrow/g, "\\downarrow"],
  [/up down arrow/g, "\\updownarrow"],
  [/not element of/g, "\\notin"],
  [/element of/g, "\\in "],
  [/subset of/g, "\\subset "],
  [/intersection/g, "\\cap "],
  [/union/g, "\\cup "],
  [/degree sign/g, "^{\\circ}"],
  [/infinity/g, "\\infty"],
  [/therefore/g, "\\therefore"],
  [/because/g, "\\because"],
  [/bold space/g, "\\;"],
  [/\bequals\b/g, "="],
  [/\bplus\b/g, "+"],
  [/\bminus\b/g, "-"],
  [/\bnegative\b/g, "-"],
  [/\btimes\b/g, "\\times"],
  [/\bcomma\b/g, ","],
  [/\bcolon\b/g, ":"],
  [/\bsemicolon\b/g, ";"],
  [/\bapostrophe\b/g, "'"],
  [/\bspace\b/g, " "],
  [/\bsquared\b/g, "^{2}"],
  [/\bcubed\b/g, "^{3}"],
  [/\bhalf\b/g, "\\frac{1}{2}"],
  [/\bthird\b/g, "\\frac{1}{3}"],
  [/\bquarter\b/g, "\\frac{1}{4}"],
  [/\bfourth\b/g, "\\frac{1}{4}"],
  [/\bfifth\b/g, "\\frac{1}{5}"],
  [/\bsixth\b/g, "\\frac{1}{6}"],
  [/\bblank\b/g, " "],
  // tables: "table row" opens (gathered); mid "row" is a row break;
  // "end cell" yields an alignment & (trimmed in cleanup when dangling)
  [/table row/g, " \\begin{gathered} "],
  [/\bend table\b/g, " \\end{gathered} "],
  [/\bend cell\b/g, " & "],
  [/\bend row\b/g, " \\\\ "],
  [/\bcell\b/g, " "],
  [/\brow\b/g, " \\\\ "],
  [/\btable\b/g, " "],
  // coordinate "and": (0, 2) and (1, 5)
  [/\band\b/g, "\\text{and}"],
  // bare "open"/"close" (unpaired or unknown noun) — render as plain parens
  [/\bopen\b/g, "("],
  [/\bclose\b/g, ")"],
];

const GREEK = [
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "rho", "sigma",
  "tau", "upsilon", "phi", "chi", "psi", "omega", "pi",
  "Delta", "Gamma", "Lambda", "Sigma", "Omega", "Theta", "Phi", "Psi", "Xi",
];

const FUNCTIONS = [
  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "sin", "cos", "tan",
  "sec", "csc", "cot", "log", "ln", "exp", "max", "min", "det", "gcd",
];

/** Structural grammar words that MUST be fully consumed — any survivor means
 *  the conversion mis-parsed the span (e.g. an unknown "open X" construct),
 *  NOT merely that the span mixes in English prose. Prose words (of, the,
 *  and, with…) are intentionally NOT here — they get wrapped in \text{}
 *  by wrapResidualProse() instead of failing the conversion. */
const RESIDUAL_RE = new RegExp(
  "\\b(open|close|parenthesis|parentheses|bracket|brackets|brace|braces|" +
  "curly|square|fraction|numerator|denominator|over|end|table|attributes|" +
  "columnalign|columnspacing|row|cell|style|mathsize|subscript|superscript|" +
  "exponent|strike|enclose|root|power|identical|cross|rightwards|" +
  "leftwards|diagonal|stack|vertical|double|arrow|approaches|limit|" +
  "invisible|function|application|text|presubscript|presuperscript|harpoon|" +
  "px|space|equals|plus|minus|negative|times|comma|colon|semicolon|" +
  "apostrophe|half|third|quarter|fourth|fifth|sixth|squared|cubed|bold|" +
  "straight|integral|sum|blank)\\b",
);

function stripLatexForResidual(s: string): string {
  return s.replace(/\\[a-zA-Z]+/g, " ").replace(/[^a-zA-Z ]/g, " ");
}

/** Wrap leftover English prose runs in \text{} — chemistry/economics formulas
 *  embed mtext prose ("percent by mass of oxygen", "Sales of a business")
 *  directly in the math. Words ≥2 letters (plus the articles a/A) group into
 *  \text{…} runs; single letters stay as math variables. Returns null when
 *  the span turns out to be prose-dominated with no math structure (giant
 *  upstream paragraph-serialization artifacts) — those are better left as
 *  code spans. */
function wrapResidualProse(s: string): string | null {
  const tokens = s.split(/(\s+)/);
  const isWord = (t: string) => /^[a-zA-Z]['’a-zA-Z]*$/.test(t);
  const isProseWord = (t: string) => isWord(t) && (t.length >= 2 || /^[aA]$/.test(t));
  let out = "";
  let run: string[] = [];
  let wrappedChars = 0;
  let allLetterChars = 0;
  const flush = () => {
    if (!run.length) return;
    // a run needs at least one ≥2-letter word (a lone "a" stays a variable)
    if (run.some((w) => w.length >= 2)) {
      out += `\\text{${run.join(" ")}}`;
      wrappedChars += run.join(" ").replace(/[^a-zA-Z]/g, "").length;
    } else {
      out += run.join(" ");
    }
    run = [];
  };
  for (const tok of tokens) {
    if (isProseWord(tok)) {
      run.push(tok);
      continue;
    }
    flush();
    out += tok;
    allLetterChars += (tok.replace(/\\text|[a-zA-Z]/g, (m) => (m === "\\text" ? "" : m)).match(/[a-zA-Z]/g) ?? []).length;
  }
  flush();
  allLetterChars += wrappedChars;
  // prose-dominated spans with no real math structure → keep original
  const hasMathStructure = /\\(frac|sqrt|sum|int|lim|vec|bar|cancel|xrightarrow)/.test(out);
  if (!hasMathStructure && allLetterChars > 0 && wrappedChars / allLetterChars > 0.5) {
    return null;
  }
  return out;
}

/** Is `tex` parseable by KaTeX? (throwOnError, strict warnings silenced) */
function parses(tex: string): boolean {
  try {
    katex.renderToString(tex, { throwOnError: true, strict: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Close \begin{array}{…} blocks that the generic "end table" → gathered
 *  pass mismatched, and drop dangling alignment & before \\ or \end. */
function fixupArraysAndDanglingAmps(s: string): string {
  s = s.replace(
    /\\begin\{array\}(\{[^}]*\})((?:(?!\\begin\{)[\s\S])*?)\\end\{gathered\}/g,
    // NB: $1 already includes its braces — do not re-wrap ({{rcl}} bug)
    (_m, cols: string, body: string) => `\\begin{array}${cols}${body}\\end{array}`,
  );
  s = s.replace(/ &\s*(?=\\\\|\\(?:begin|end)\{)/g, " ");
  return s;
}

/**
 * Convert MathML speech text to LaTeX. Returns null when the conversion is
 * not confident (residual grammar words, or the produced TeX fails to parse) —
 * callers then keep the original string.
 */
export function speechToTex(raw: string): string | null {
  // "…cross times 100\\n> \\n> equals…" — upstream escaped blockquote markers
  // inside code spans; swallow \\n> pairs so no stray ">" reaches the math
  let s = raw.replace(/\\n> ?/g, " ").replace(/\\n/g, " ");

  // MathML style wrappers
  s = s.replace(/begin (?:mathsize \d+px|inline|display) style/g, " ");
  s = s.replace(/end style/g, " ");

  // structural passes — loop until stable (inner-first for nested stacks)
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(FRAC_RE, (_m, n: string, d: string) => ` \\frac{${n.trim()}}{${d.trim()}} `);
    for (const [re, rep] of ORDINAL_ROOTS) s = s.replace(re, rep);
    s = s.replace(/up diagonal strike (.+?) end strike/g, " \\cancel{$1} ");
    // f-prime before a bracket has NO "end exponent" of its own — without
    // this, the generic rule below swallows the whole rest of the span into
    // the superscript ("f^{'(x) = 2(4x⁴-1}")
    s = s.replace(/to the power of apostrophe (?=open (?:parentheses|square brackets|curly brackets))/g, " ^{'} ");
    // "apostrophe apostrophe" → f^{''} — KaTeX rejects a space between primes
    s = s.replace(/to the power of (.+?) end exponent/g,
      (_m, x: string) => ` ^{${x.trim().replace(/'\s+'/g, "''")}} `);
    s = s.replace(/subscript (.+?) end subscript/g, (_m, x: string) => ` _{${x.trim()}} `);
    s = s.replace(/superscript (.+?) end superscript/g, (_m, x: string) => ` ^{${x.trim()}} `);
    s = s.replace(/sum from (.+?) to (.+?) of /g, " \\sum_{$1}^{$2} ");
    s = s.replace(/integral from (.+?) to (.+?) of /g, " \\int_{$1}^{$2} ");
    s = s.replace(/limit as (.+?) (?:rightwards arrow|approaches) (.+?) of /g,
      " \\lim_{$1 \\to $2} ");
    // mtext runs: "text d end text" → \text{d}, "text Operating margin = end text"
    s = s.replace(/\btext (.+?) end text/g, " \\text{$1} ");
    // nth root: "n-th root of a to the power of m end root"
    s = s.replace(/n-th root of (.+?) end root/g, " \\sqrt[n]{$1} ");
  }

  // nuclear isotope notation: "straight U presubscript 92 presuperscript 238"
  s = s.replace(/([a-zA-Z\)]) presubscript (\d+) presuperscript (\d+)/g, "$1_{$2}^{$3}");
  s = s.replace(/([a-zA-Z\)]) presuperscript (\d+) presubscript (\d+)/g, "$1^{$2}_{$3}");
  // decay arrow with particle above: "rightwards arrow with straight alpha on top"
  s = s.replace(/rightwards arrow with (.+?) on top/g, " \\xrightarrow{$1} ");

  // postfix accents (attach to previous atom); tolerate bold/straight modifiers
  // on either side ("bold r with bold bar on top") — accent styling is dropped
  s = s.replace(/((?:bold |straight )?[a-zA-Z0-9\)])\s+with\s+(?:bold |straight )?(bar|dot|hat|tilde)\s+on\s+top/g,
    (_m, a: string, acc: string) => ` \\${acc}{${a.replace(/\b(?:bold|straight) /, "")}} `);
  s = s.replace(/((?:bold |straight )?[a-zA-Z0-9\)])\s+with\s+(?:bold |straight )?rightwards\s+arrow\s+on\s+top/g,
    (_m, a: string) => ` \\vec{${a.replace(/\b(?:bold|straight) /, "")}} `);
  s = s.replace(/top enclose ((?:straight |bold )?[a-zA-Z])/g,
    (_m, a: string) => ` \\vec{${a.replace(/\b(?:straight|bold) /, "")}} `);
  s = s.replace(/ with blank (?:below|above)(?: and blank on top)?/g, " ");

  // prefix ops with atomic scope (no terminator present)
  s = s.replace(ORDINAL_ROOTS_ATOM, replaceOrdinalRootAtom);
  s = s.replace(/up diagonal strike ([a-zA-Z0-9]+)/g, " \\cancel{$1} ");
  s = s.replace(/up diagonal strike (blank|[a-zA-Z0-9.]+)/g, " \\cancel{$1} ");
  s = s.replace(/to the power of (?:bold italic |bold |straight )?apostrophe/g, " ^{'} ");
  s = s.replace(/to the power of (?:bold italic |bold |straight )?negative (blank|[a-zA-Z0-9.]+)/g, " ^{-$1} ");
  s = s.replace(/to the power of (?:bold italic |bold |straight )?(blank|[a-zA-Z0-9.]+)/g,
    (_m, a: string) => ` ^{${a.replace(/^(?:bold italic |bold |straight )/, "")}} `);
  s = s.replace(/subscript (?:bold italic |bold |straight )?(blank|[a-zA-Z0-9.]+)/g, " _{$1} ");
  s = s.replace(/superscript (?:bold italic |bold |straight )?(blank|[a-zA-Z0-9.]+)/g, " ^{$1} ");

  // big operators without limits
  s = s.replace(/stack sum/g, " \\sum ");
  s = s.replace(/sum for blank of/g, " \\sum ");
  s = s.replace(/\bintegral\b/g, " \\int ");

  // straight/bold letters BEFORE Greek so "straight pi" → \mathrm{\pi} (upright)
  s = s.replace(/\bcapital (sigma|delta|gamma|omega|theta|lambda|phi|psi|xi|pi|upsilon|epsilon)\b/g,
    (_m, g: string) => g.charAt(0).toUpperCase() + g.slice(1));
  s = s.replace(/\bstraight ([a-zA-Z]+)\b/g, " \\mathrm{$1} ");
  // "bold less than", "bold equals", "bold integral" — bold styling on operator
  // words is dropped so the phrase table sees them
  s = s.replace(/\bbold (?=less|greater|percent|space|equals|plus|minus|times|integral|sum|sin|cos|tan|log|ln|sec|csc|cot)\b/g, " ");
  s = s.replace(/\bbold italic ([a-zA-Z0-9.]+)\b/g, " \\boldsymbol{$1} ");
  s = s.replace(/\bbold percent sign\b/g, " \\boldsymbol{\\%} ");
  s = s.replace(/\bbold\.?(?=[\s)]|$)/g, " "); // stray "bold." tokens (bold ".")
  s = s.replace(/\bbold ([a-zA-Z0-9.]+)\b/g, " \\boldsymbol{$1} ");

  // phrase table; table entries carry replace callbacks (array headers)
  for (const [re, rep] of PHRASES) {
    s = typeof rep === "string"
      ? s.replace(re, rep)
      : s.replace(re, rep as unknown as (...args: string[]) => string);
  }
  // glue "x ^{2}" → "x^{2}" so the complex bare-over LHS below matches
  s = s.replace(/\s+([\^_])\{/g, "$1{"); // also collapses the double spaces power-atomic emits

  // Protect already-built LaTeX commands (\frac{…}{…}, \mathrm{r}, \sqrt[3]{…},
  // \begin{array}{rcl}…) with non-word placeholders while the bare-over rules
  // run — stops operands matching inside command braces without blocking
  // legitimate matches inside ^{…}/\frac{…} built by earlier passes.
  const cmds: string[] = [];
  s = s.replace(/\\[a-zA-Z]+(?:\[[^\]]*\])?(?:\{[^}]*\}){0,2}/g, (m) => {
    cmds.push(m);
    return `\x01${"\x02".repeat(cmds.length)}\x03`;
  });

  // complex bare-over — "13 over 4", "16 over ( x - 2 )^{2}", "x^{n} over x",
  // "pi over 3", "charge over r^{2}" — operands may be multi-letter (prose
  // nouns get \text{} later); lookarounds block word tails and placeholders
  s = s.replace(
    /(?<![a-zA-Z0-9.\x01\x02\x03])((?:\x01\x02+\x03|[0-9]+(?:\.[0-9]+)?|[a-zA-Z]+)(?:\^\{[^}]*\})?) over ((?:\x01\x02+\x03|-[0-9.]+|[0-9.]+|[a-zA-Z]+|\([^()]+\))(?:\^\{[^}]*\})?)(?![a-zA-Z0-9.])/g,
    " \\frac{$1}{$2} ",
  );
  // parenthesized-power LHS: "( 3 - sqrt{x} )^{2} over x"
  s = s.replace(
    /(?<![a-zA-Z0-9.\x01\x02\x03])\(([^()]*)\)\^\{([^}]*)\} over ((?:\x01\x02+\x03|[0-9.]+|[a-zA-Z]+|\([^()]*\))(?:\^\{[^}]*\})?)(?![a-zA-Z0-9.\x03])/g,
    " \\frac{($1)^{$2}}{$3} ",
  );

  // restore protected commands
  s = s.replace(/\x01(\x02+)\x03/g, (_m, runs: string) => cmds[runs.length - 1]);

  for (const g of GREEK) s = s.replace(new RegExp(`\\b${g}\\b`, "g"), `\\${g} `);
  for (const f of FUNCTIONS) s = s.replace(new RegExp(`\\b${f}\\b`, "g"), `\\${f} `);

  // wrap leftover English prose runs ("mass of an element") in \text{};
  // prose-dominated no-structure spans → null (keep original)
  const wrapped = wrapResidualProse(s);
  if (wrapped === null) return null;
  s = wrapped;

  // primes must be adjacent (f^{''}); drop dangling & at row/env ends
  s = s.replace(/'\s+'/g, "''");
  // raw dollars in economics/business math ("\frac{$ 105 , 731}{…}")
  s = s.replace(/(?<!\\)\$/g, "\\$");
  s = fixupArraysAndDanglingAmps(s);

  s = s.replace(/[ \t]+/g, " ").trim();

  return s;
}

/** speechToTex + KaTeX parse gate. null → caller keeps the original. */
export function speechToTexSafe(raw: string): string | null {
  const tex = speechToTex(raw);
  if (tex === null) return null;
  return parses(tex) ? tex : null;
}
