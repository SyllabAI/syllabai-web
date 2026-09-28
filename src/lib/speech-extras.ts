/**
 * T-SME-23a: targeted mini-grammar handlers for speech-text spans the main
 * chain can't convert. SAFETY CONTRACT: every returned string is checked by
 * hasResidualGrammar() (no Chrome speech vocabulary may survive outside
 * \text{}) and by the caller's katexOk() — no English words can leak into
 * math as implicit-multiplication variables.
 *
 * Handlers: recurringDecimals, stackHandler, formulaPlaceholder, blankSum,
 * blankFraction, degreeToken (word→symbol), angleBrackets, multilineBr.
 */
import { looksLikeSpeechText, speechToTexSafe } from "./speech-math";

/** Chrome speech vocabulary that must never survive in converted math. */
const GRAMMAR = new RegExp(
  "\\b(open parentheses|close parentheses|open bracket|close bracket|" +
    "open curly|close curly|open square brackets|close square brackets|" +
    "open angle brackets|close angle brackets|fraction numerator|" +
    "over denominator|end fraction|end table|end cell|end row|end stack|" +
    "end attributes|end style|end enclose|end exponent|to the power|" +
    "square root|end root|cube root|with bar on top|subscript|superscript|" +
    "presubscript|presuperscript|stack sum|sum from|sum for|begin mathsize|" +
    "table|attributes|stack|italic|bold|straight|equals|plus|minus|times|" +
    "divided by|squared|cubed|percent sign|cross times|plus-or-minus|" +
    "vertical line|increment|degree|less than|greater than|less or equal|" +
    "greater or equal|identical to|rightwards|direct double arrow|" +
    "with dot|with bar|blank|over|percent|minus sign|plus sign|" +
    "left parenthesis|right parenthesis|left bracket|right bracket|" +
    "square bracket|curly bracket|left square|right square|" +
    "end strike|end enclose|root of|th root|enclose|root|strike)\\b",
  "i",
);

/** \text{} contents that are always recon garbage (dangling grammar words) */
const BAD_TEXT_CONTENT =
  /^\s*(end|open|close|left|right|fraction|numerator|denominator|strike|enclose|bracket|parenthesis|table|row|cell|root|of|the|and|equals|plus|minus|times|squared|cubed|over|percent|numerator sign)\s*[.,]?\s*$/i;

/** true if any Chrome speech word survives — outside OR inside \text{} */
export function hasResidualGrammar(tex: string): boolean {
  // structural-grammar tokens must not survive anywhere — including inside
  // \text{} (recon wraps unknown grammar words as \text{left parenthesis})
  if (GRAMMAR.test(tex.replace(/\\[a-zA-Z]+/g, " "))) return true;
  for (const m of tex.matchAll(/\\text\s*\{([^{}]*)\}/g)) {
    if (BAD_TEXT_CONTENT.test(m[1])) return true;
  }
  const stripped = tex
    .replace(/\\text\s*\{[^{}]*\}/g, " ")
    .replace(/\\[a-zA-Z]+/g, " ") // strip LaTeX macros (\times contains "times"!)
    .replace(/\\(?:left|right)?\s*[|()[\]]/g, " ");
  return GRAMMAR.test(stripped);
}

/** shared Chrome word → LaTeX symbol map (full-sentence transforms) */
export function wordToSymbol(s: string): string {
  return s
    .replace(/\bopen parentheses\b/g, " ( ")
    .replace(/\bclose parentheses\b/g, " ) ")
    .replace(/\bopen square brackets\b/g, " [ ")
    .replace(/\bclose square brackets\b/g, " ] ")
    .replace(/\bgreater or equal than\b/g, " \\ge ")
    .replace(/\bless or equal than\b/g, " \\le ")
    .replace(/\bgreater than\b/g, " > ")
    .replace(/\bless than\b/g, " < ")
    .replace(/\bidentical to\b/g, " \\equiv ")
    .replace(/\balmost equal to\b/g, " \\approx ")
    .replace(/\bcapital omega\b/g, " \\Omega ")
    .replace(/\bcapital delta\b/g, " \\Delta ")
    .replace(/\bcapital sigma\b/g, " \\Sigma ")
    .replace(/\bcapital lambda\b/g, " \\Lambda ")
    .replace(/\bcapital theta\b/g, " \\Theta ")
    .replace(/\bcapital pi\b/g, " \\Pi ")
    .replace(/\bcross times\b|\btimes\b/g, " \\times ")
    .replace(/\bdivided by\b/g, " \\div ")
    .replace(/\bplus-or-minus\b/g, " \\pm ")
    .replace(/\bpercent sign\b/g, " \\% ")
    .replace(/\bplus sign\b/g, " + ")
    .replace(/\bminus sign\b/g, " - ")
    .replace(/\bdegree\b/g, " ^{\\circ} ")
    .replace(/\bsquared\b/g, " ^{2} ")
    .replace(/\bcubed\b/g, " ^{3} ")
    .replace(/\bequals\b/g, " = ")
    .replace(/\bplus\b/g, " + ")
    .replace(/\bminus\b/g, " - ")
    .replace(/\bnegative\b/g, " - ")
    .replace(/\bcomma\b/g, " , ")
    .replace(/\bcolon\b/g, " : ")
    .replace(/∶/g, " : ")
    .replace(/\bspace\b/g, " ")
    .replace(/<br\s*\/?>/gi, " \\quad ")
    .replace(/\bitalic\b|\bbold\b/g, " ")
    .replace(/\balpha\b/g, " \\alpha ")
    .replace(/\bbeta\b/g, " \\beta ")
    .replace(/\bgamma\b/g, " \\gamma ")
    .replace(/\bdelta\b/g, " \\delta ")
    .replace(/\blambda\b/g, " \\lambda ")
    .replace(/\btheta\b/g, " \\theta ")
    .replace(/\bomega\b/g, " \\omega ");
}

/** Chrome word→symbol pre-map BEFORE speechToTexSafe (vocab gaps) */
export function symbolPreMap(s: string): string {
  return s
    .replace(/\bincrement\b/g, " \\Delta ")
    .replace(/ϕ/g, " \\phi ")
    .replace(/φ/g, " \\varphi ")
    .replace(/θ/g, " \\theta ")
    .replace(/π/g, " \\pi ")
    .replace(/µ|μ/g, " \\mu ")
    .replace(/Ω/g, " \\Omega ")
    .replace(/ω/g, " \\omega ")
    .replace(/\bvertical line\b/g, " \\mid ")
    .replace(/\bno space\b/g, " no\\ ")
    .replace(/\bgreater or equal than\b/g, " \\ge ")
    .replace(/\bless or equal than\b/g, " \\le ")
    .replace(/\bgreater than\b/g, " > ")
    .replace(/\bless than\b/g, " < ")
    .replace(/<br\s*\/?>/gi, " \\quad ")
    // SME chemistry / notation constructs
    .replace(/begin mathsize \d+px style/g, " ")
    .replace(/\bend style\b/g, " ")
    .replace(/\bend subscript\b/g, " ")
    .replace(/\bend superscript\b/g, " ")
    .replace(/\bend exponent\b/g, " ")
    .replace(/superscript \u29b5/g, " ^{\\circ} ")
    .replace(/subscript \u29b5/g, " _{\\circ} ")
    .replace(/\u29b5/g, " ^{\\circ} ")
    .replace(/to the power of plus sign/g, " ^{+} ")
    .replace(/to the power of minus sign/g, " ^{-} ")
    // serialization duplicate: "3 to the power of 4 space to the power of space"
    .replace(/\s*to the power of\s*$/, " ")
    .replace(/to the power of (\S+) space to the power of space?/g, "to the power of $1 ")
    // roots pre-map: consuming "end root" first, then boundary-closed form
    .replace(/cube root of ((?:(?!over denominator|end root|end cell|end fraction|fraction numerator).)+?) end root/g, " \\sqrt[3]{$1} ")
    .replace(/cube root of ((?:(?!over denominator|end root|end cell|end fraction|fraction numerator).)+?)(?= over denominator| end root| end cell)/g, " \\sqrt[3]{$1} ")
    .replace(/square root of ((?:(?!over denominator|end root|end cell|end fraction|fraction numerator).)+?) end root/g, " \\sqrt{$1} ")
    .replace(/square root of ((?:(?!over denominator|end root|end cell|end fraction|fraction numerator).)+?)(?= over denominator| end root| end cell)/g, " \\sqrt{$1} ")
    .replace(/\bmidline horizontal ellipsis\b/g, " \\cdots ")
    .replace(/stack (?:down|up) diagonal strike\s+([\d.]+)\s+with\s+([\d.]+)\s+below/g,
      (_m, x: string, y: string) => ` \\cancel{${x}}_{${y}} `)
    .replace(/stack (?:down|up) diagonal strike\s+([\d.]+)\s+with\s+([\d.]+)\s+on top/g,
      (_m, x: string, y: string) => ` \\cancel{${x}}^{${y}} `)
    .replace(/\bleft parenthesis\b/g, " ( ")
    .replace(/\bright parenthesis\b/g, " ) ")
    .replace(/\bleft square bracket\b|\bleft bracket\b/g, " [ ")
    .replace(/\bright square bracket\b|\bright bracket\b/g, " ] ")
    .replace(/to the power of ([\w{}^]+) over ([\w{}^]+)(?:\s+end exponent)?/g, " ^{\\frac{$1}{$2}} ")
    .replace(/([A-Za-z0-9]+)-th root of (.+?) end root/g, " \\sqrt[$1]{$2} ");
}

/** last-resort generic chain: subscripts, fractions, fonts, prose-wrap.
 * Contract: structural grammar must be fully consumed BEFORE prose-wrap;
 * if any grammar word remains at that point, bail (null) - never wrap
 * grammar words in \text{}. */
export function genericChain(input: string): string | null {
  let s = symbolPreMap(input);
  // fill-in blanks: "_ _ _ _ _" -> \underline{\quad}
  s = s.replace(/(?:_\s*){2,}/g, " \\underline{\\quad} ");
  // "text th value end text" -> \text{th value}
  s = s.replace(/\btext\s+(.+?)\s+end text/g, " \\text{$1} ");
  // table grammar → array. Bare "row" = row separator (column vectors);
  // "cell … end cell" = cell markers; bare text between markers = cells too.
  // Outer "open parentheses … close parentheses" → \left(pmvector\right).
  const tableRe =
    /(open parentheses\s+)?table\s+([\s\S]+?)\s+end table(\s+close parentheses)?/;
  s = s.replace(tableRe, (_m, open: string | undefined, body: string, close: string | undefined) => {
    const inner0 = body
      .replace(/^\s*row\s+/, "")
      .replace(/\s+row\s*$/, "");
    const rows = inner0
      .split(/\s+row\s+/)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => r.split(/\b(?:end\s+)?cell\b/).map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean))
      .filter((r) => r.length > 0);
    if (!rows.length) return _m;
    const width = Math.max(...rows.map((r) => r.length));
    const b = rows.map((r) => r.join(" & ")).join(" \\\\ ");
    const inner =
      width === 1 && rows.length >= 2
        ? `\\begin{pmatrix}${b}\\end{pmatrix}`
        : `\\begin{array}{${"c".repeat(width)}}${b}\\end{array}`;
    return open || close ? ` \\left(${inner}\\right) ` : ` ${inner} `;
  });
  // sub/superscripts BEFORE fractions ("g subscript 1 over g subscript 2")
  s = s.replace(/([A-Za-z])\s+subscript\s+([a-zA-Z0-9]+)/g, "$1_{$2}");
  s = s.replace(/([A-Za-z0-9}\)])\s+superscript\s+([a-zA-Z0-9]+)/g, "$1^{$2}");
  s = s.replace(/([A-Za-z0-9}\)])\s+to the power of\s+([a-zA-Z0-9]+)(?:\s+end exponent)?/g, "$1^{$2}");
  // fraction grammar -> \frac
  for (let i = 0; i < 4; i++)
    s = s.replace(
      /fraction numerator\s+(.+?)\s+over denominator\s+(.+?)\s+end fraction/g,
      (_m, a: string, b: string) => `\\frac{${a.trim()}}{${b.trim()}}`,
    );
  // subscripted ratio: "g_{1} over g_{2}" -> \frac{g_{1}}{g_{2}}
  s = s.replace(
    /([A-Za-z])_\{(\d+)\}\s+over\s+([A-Za-z])_\{(\d+)\}/g,
    (_m, A: string, a: string, B: string, b: string) => `\\frac{${A}_{${a}}}{${B}_{${b}}}`,
  );
  // "X over Y" token pair -> \frac{X}{Y}
  for (let i = 0; i < 4; i++)
    s = s.replace(
      /(\w+|\{[^{}]*\})\s+over\s+(\w+|\{[^{}]*\})/,
      (_m, a: string, b: string) => `\\frac{${a}}{${b}}`,
    );
  // "straight X" -> \mathrm{X}
  s = s.replace(/\bstraight\s+([A-Za-z])(?!\w)/g, " \\mathrm{$1} ");
  // remaining simple word symbols + cosmetic italic/bold markers
  s = wordToSymbol(s);
  // STRUCTURAL GATE: any grammar word left? bail - never \text{}-wrap grammar
  if (hasResidualGrammar(s)) return null;
  // leftover prose words -> \text{} (never touch macros or single letters)
  s = s.replace(/(?<![\\\w])([a-z]{3,})(?![\w}])/g, " \\text{$1} ");
  const out = s.replace(/\s+/g, " ").trim();
  if (!out || out === input.trim()) return null;
  return out;
}

export function stripSpaceTokens(s: string): string {
  return s.replace(/\s+space\b/g, "").replace(/\bspace\s+/g, " ").trim();
}

/** recurring decimal sentences:
 * "4.8 right enclose 8 bottom enclose 6 921... space equals space 4.89 space
 *  open parentheses 3 space s. f. close parentheses"
 * → "4.8\\dot{8}\\dot{6}921... = 4.89 (\\text{ s.f.})" */
export function recurringDecimals(s: string): string | null {
  if (!/\b(right enclose|bottom enclose)\b/.test(s)) return null;
  if (/\b(fraction numerator|to the power|square root|subscript|superscript|open curly)\b/.test(s)) return null;
  let out = s;
  // unwrap an optional table wrapper: "table row blank blank cell X end cell end table"
  const tbl = out.match(/cell\s+(.+?)\s+end cell\s+end table\s*$/);
  if (tbl) out = tbl[1];
  // adjacent token order: "bottom enclose right enclose 3 9 end enclose" -> \dot{3}\dot{9}
  out = out.replace(
    /(?:right enclose|bottom enclose)\s+(?:right enclose|bottom enclose)\s*\.?\s*([\d.]+)\s+([\d.]+)(?:\s+end enclose)?/g,
    (_m, a: string, b: string) => {
      const dot = (x: string) => [...x.replace(/\./g, "")].map((c) => `\\dot{${c}}`).join("");
      return dot(a) + dot(b);
    },
  );
  out = out.replace(
    /(?:right enclose|bottom enclose)\s*\.?\s*([\d.]+)(?:\s+(?:right enclose|bottom enclose)\s*\.?\s*([\d.]+))?(?:\s+end enclose)?/g,
    (_m, a: string, b?: string) => {
      const dot = (x: string) => [...x.replace(/\./g, "")].map((c) => `\\dot{${c}}`).join("");
      return dot(a) + (b ? dot(b) : "");
    },
  );
  // adjacent token order: "bottom enclose right enclose 3 9 end enclose" → \\dot{3}\\dot{9}
  out = out.replace(
    /(?:right enclose|bottom enclose)\s+(?:right enclose|bottom enclose)\s*\.?\s*([\d.]+)\s+([\d.]+)(?:\s+end enclose)?/g,
    (_m, a: string, b: string) => {
      const dot = (x: string) => [...x.replace(/\./g, "")].map((c) => `\\dot{${c}}`).join("");
      return dot(a) + dot(b);
    },
  );
  out = wordToSymbol(out)
    .replace(/\bs\. f\./g, "\\text{ s.f.}")
    .replace(/\bd\. p\./g, "\\text{ d.p.}")
    .replace(/\s+/g, " ")
    .trim();
  if (/enclose/.test(out)) return null;
  return out;
}

/** arithmetic stacks (mstack): "stack attributes … end attributes row a plus
 * 20 d equals 43 end row row a plus 5 d equals 13 end row" → gathered rows */
export function stackHandler(s: string): string | null {
  if (!/\bstack attributes\b/.test(s)) return null;
  const inner = s.replace(/^negative\s+/, "").replace(/^.*?end attributes\s*/, "").replace(/\s*end stack\s*$/i, "");
  const rows = inner.split(/\bend row\b/).map((r) => r.replace(/\brow\b/g, " ").trim()).filter(Boolean);
  if (!rows.length) return null;
  const conv = rows.map((r) => wordToSymbol(r).replace(/\s+/g, " ").trim());
  const prefix = /^negative\s/.test(s) ? "-" : "";
  return `${prefix}\\begin{gathered}${conv.join(" \\\\ ")}\\end{gathered}`;
}

/** SME flashcard placeholder: "(formula in x)" — authored as generic formula */
export function formulaPlaceholder(s: string): string | null {
  if (!/formula space in italic space [a-z] close parentheses/.test(s)) return null;
  return wordToSymbol(
    s.replace(
      /open parentheses formula space in italic space ([a-z]) close parentheses/g,
      (_x, v: string) => `( \\text{formula in ${v}} )`,
    ),
  ).replace(/\s+/g, " ").trim();
}

export function blankSum(s: string): string | null {
  if (/^sum from blank to blank of$/.test(s.trim())) return "\\sum";
  return null;
}

export function blankFraction(s: string): string | null {
  if (!/_/.test(s)) return null;
  if (/\b(fraction numerator|to the power|square root|end table)\b/.test(s)) return null;
  const out = s.replace(/(?:_\s*){2,}/g, " \\underline{\\quad} ").replace(/\s+/g, " ").trim();
  return out === s.trim() ? null : out;
}

/** angle brackets: delegate inner content to speech-math recon */
export function angleBrackets(s: string): string | null {
  if (!/\bopen angle brackets\b/.test(s)) return null;
  const inner = s
    .replace(/\bopen angle brackets\b/g, " ")
    .replace(/\bclose angle brackets\b/g, " ")
    .trim();
  const pre = symbolPreMap(inner);
  const tex = speechToTexSafe(pre);
  if (tex === null) return null;
  return `\\langle ${tex} \\rangle`;
}

/** spans with leaked <br> HTML — split lines, convert each via speech-math */
export function multilineBr(s: string): string | null {
  if (!/<br\s*\/?>/.test(s)) return null;
  const lines = s.split(/<br\s*\/?>/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const texLines = lines.map((l) => speechToTexSafe(symbolPreMap(l)));
  if (texLines.some((t) => t === null)) return null;
  return `\\begin{gathered}${texLines.join(" \\\\ ")}\\end{gathered}`;
}

/** isotope nuclear equations: "straight U presubscript 92 presuperscript 235
 * space rightwards arrow ..." -> {}_{92}^{235}\\mathrm{U} \\rightarrow
 * Chrome emits "end presubscript"/"end presuperscript" terminators
 * inconsistently, so all forms accept optional terminators. */
export function isotopeChain(s: string): string | null {
  if (!/\bpresubscript\b/.test(s) && !/\bscriptbase\b/.test(s)) return null;
  const VAL = "(midline horizontal ellipsis(?:\\s+midline horizontal ellipsis)*|(?:minus\\s+)?[\\d.]+|(?:negative\\s+)?[\\d.]+|(?:straight\\s+)?[A-Za-z]+(?:\\s+(?:plus|minus|negative)\\s+(?:straight\\s+)?[A-Za-z\\d.]+)*)";
  const ISO =
    "(?:([A-Za-z]+)\\s+)?" +
    "presubscript\\s+" + VAL + "(?:\\s+end presubscript)?" +
    "\\s*" +
    "presuperscript\\s+" + VAL + "(?:\\s+end presuperscript)?";
  const val = (v: string) => {
    let x = v.replace(/\bstraight\s+/g, "");
    if (x.includes("midline horizontal ellipsis")) return "\\cdots";
    x = x.replace(/\bplus\b/g, " + ").replace(/\bminus\b/g, " - ").replace(/\bnegative\b/g, " -").replace(/\\s+/g, " ").trim();
    return x;
  };
  let t = s
    .replace(/\bstraight\s+/g, "")
    .replace(/\bbold\b/g, " ")
    .replace(/scriptbase\s+text\s+([A-Za-z]+)\s+end text\s+end scriptbase/g, " \\mathrm{$1} ")
    .replace(/\btext\s+([A-Za-z])\s+end text\b/g, " \\text{$1} ")
    .replace(new RegExp(ISO, "g"), (_m, el: string | undefined, sub: string, sup: string) => {
      const base = el ? `\\mathrm{${el}}` : "";
      return `{}_{${val(sub)}}^{${val(sup)}}${base}`;
    })
    .replace(/\brightwards arrow with ([\s\S]+?) on top\b/g, (_m, c: string) => ` \\xrightarrow{${c.trim()}} `)
    .replace(/\brightwards arrow\b/g, " \\rightarrow ")
    .replace(/superscript minus\b/g, " ^{-} ")
    .replace(/\bplus-or-minus\b/g, " \\pm ");
  t = wordToSymbol(t);
  return t;
}

/** modulus / absolute value: "vertical line z vertical line" ->
 * \\left|z\\right| (paired bars); "asterisk times" = conjugate star */
export function modulusBars(s: string): string | null {
  if (!/\bvertical line\b/.test(s)) return null;
  let t = s
    .replace(/\bstraight\s+([A-Za-z])(?!\w)/g, " \\mathrm{$1} ")
    .replace(/\basterisk times\b/g, " ^{\\ast} ");
  const parts = t.split(/\bvertical line\b/);
  if (parts.length < 3) return null;
  const out = parts
    .map((p, i) => (i % 2 === 1 ? `\\left|${p.trim()}\\right|` : p))
    .join(" ");
  return wordToSymbol(out).replace(/\\s+/g, " ").trim();
}

/** Composed fallback — every output is grammar-gated; caller must katexOk(). */
export function speechExtras(s: string): string | null {
  const variants = [s, stripSpaceTokens(s)].filter(
    (x): x is string => !!x && x.length > 0,
  );
  for (const c of variants) {
    for (const r of [
      recurringDecimals(c),
      angleBrackets(c),
      multilineBr(c),
      stackHandler(c),
      formulaPlaceholder(c),
      blankSum(c),
      blankFraction(c),
      isotopeChain(c),
      modulusBars(c),
    ]) {
      if (r !== null && !hasResidualGrammar(r)) return r;
    }
  }
  // full-sentence word→symbol transform (degreeToken generalized)
  for (const c of variants) {
    const r = wordToSymbol(c).replace(/\s+/g, " ").trim();
    if (r !== c.trim() && !hasResidualGrammar(r) && /[\\^]/.test(r)) return r;
  }
  // generic chain (subscripts, \\frac, fonts, prose-wrap)
  for (const c of variants) {
    const r = genericChain(c);
    if (r !== null && !hasResidualGrammar(r)) return r;
  }
  return null;
}
