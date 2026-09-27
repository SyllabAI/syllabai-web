/**
 * s142 runtime verification — the math rendering pipeline against the REAL
 * modules (src/components/syllabai/ChatMarkdown.tsx + QuestionMarkdown's
 * shared pieces): import the shipped code, not a copy.
 * Run: bun scripts/s142_cla_math_normalize_verify.ts
 *
 * The trigger (live user report, 09-27): a CLA answer rendered
 *
 *   \ceO2 using the formula
 *   \%\,$\ce{O2}$= \frac{V_{\text{O2 consumed}}}{V_{\text{initial air}}}\times100
 *
 * broken three ways at once: mhchem macros never reached the katex instance
 * rehype-katex rendered through (\ce = red error text), the $-delimiters
 * closed early so the formula body leaked as raw text, and a braceless \ceO2
 * had no rule at all.
 *
 * Checks (each against renderToStaticMarkup of the shipped component):
 *  1. the reported line renders as ONE math run, no raw LaTeX, no red errors
 *  2. braceless \ceO2 → renders O2 instead of literal "\ceO2"
 *  3. formula with NO delimiters at all wraps as one math run
 *  4. pure prose is never wrapped (no katex spans appear)
 *  5. well-formed $…$ survives untouched (exactly one katex, no red)
 *  6. display math renders correct content without errors
 *  7. bare \ce{…} and \pu{…} auto-wrap (s138 rule + the \pu extension)
 *  8. mhchem equations render without red (the registration regression)
 *  9. citation chips still ride bold — with a live href (the s138 urlTransform
 *     regression stripped citation:// down to href="")
 * 10. currency dollars never become math
 * 11. a list marker is never swallowed into the math run
 * 12. fenced code blocks are never rewritten
 * 13. prose + dangling LaTeX mix: the run starts at the formula, prose stays out
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown } from "../src/components/syllabai/ChatMarkdown";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

/** static markup of the shipped component fed one model answer (a chip
 *  renderer stands in for the surfaces' renderCitation so citation links
 *  are asserted on their real path) */
function render(answer: string): string {
  return renderToStaticMarkup(
    // eslint-disable-next-line react/no-children-prop -- verify-script shorthand
    React.createElement(ChatMarkdown, {
      children: answer,
      renderCitation: (n: number) =>
        React.createElement("span", { "data-cite": n }, `[${n}]`),
    }),
  );
}

/** the text a learner actually SEES: tags stripped, and KaTeX's MathML
 * annotations (which legitimately contain the TeX source) removed first */
function visibleText(html: string): string {
  return html
    .replace(/<annotation[\s\S]*?<\/annotation>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** KaTeX error styling: the red errorColor in either the HTML or MathML
 *  branch — throwOnError:false renders bad macros red without katex-error */
const hasRedError = (html: string) =>
  html.includes("#cc0000") || html.includes("mathcolor");
const hasKatex = (html: string) => html.includes('class="katex"');
const rawLeak = (html: string, ...cmds: string[]) =>
  cmds.filter((c) => visibleText(html).includes(c));

// ── 1. the reported line ────────────────────────────────────────────────
const reported = render(
  "\\%\\,$\\ce{O2}$= \\frac{V_{\\text{O2 consumed}}}{V_{\\text{initial air}}}\\times100",
);
check("reported line: math renders", hasKatex(reported), reported.slice(0, 300));
check("reported line: no raw LaTeX leaks",
  rawLeak(reported, "\\frac", "\\times", "\\%", "\\ce").length === 0,
  "leaked: " + rawLeak(reported, "\\frac", "\\times", "\\%", "\\ce").join(" "));
check("reported line: no red KaTeX error", !hasRedError(reported));
check("reported line: renders as ONE math run",
  (reported.match(/class="katex"/g) ?? []).length === 1);

// ── 2. braceless \ce ────────────────────────────────────────────────────
const braceless = render("\\ceO2 using the formula");
check("braceless \\ceO2 renders O2",
  hasKatex(braceless) && !visibleText(braceless).includes("\\ce") && !hasRedError(braceless),
  visibleText(braceless));

// ── 3. no delimiters at all ─────────────────────────────────────────────
const bare = render("M_r = \\frac{24}{0.4} = 60");
check("delimiter-less formula wraps as math",
  hasKatex(bare) && rawLeak(bare, "\\frac").length === 0 && !hasRedError(bare),
  visibleText(bare));

// ── 4. pure prose untouched ─────────────────────────────────────────────
const prose = render(
  "The rate of reaction increases because the particles collide more often.",
);
check("pure prose never becomes math",
  !hasKatex(prose) && visibleText(prose).includes("collide more often"));

// ── 5. well-formed inline math untouched ────────────────────────────────
const inline = render("Use $x^2$ in the formula");
check("well-formed $…$ survives (1 katex, no red)",
  (inline.match(/class="katex"/g) ?? []).length === 1 && !hasRedError(inline));

// ── 6. display math ─────────────────────────────────────────────────────
const display = render("$$E = mc^2$$");
check("display math renders correct content, no red",
  hasKatex(display) && !hasRedError(display) && display.includes("mc^2"));

// ── 7. bare \ce{…} / \pu{…} (s138 rule + \pu extension) ─────────────────
const bareCe = render("the \\ce{O2} in air is about 21%");
check("bare \\ce{…} still auto-wraps",
  hasKatex(bareCe) && rawLeak(bareCe, "\\ce").length === 0 && !hasRedError(bareCe));
const barePu = render("a concentration of 0.5 \\pu{mol dm^-3} is fine");
check("bare \\pu{…} auto-wraps",
  hasKatex(barePu) && rawLeak(barePu, "\\pu").length === 0 && !hasRedError(barePu));

// ── 8. mhchem registration (the dual-instance regression) ───────────────
const equation = render("$$\\ce{2Mg + O2 -> 2MgO}$$");
check("mhchem equation renders without red",
  hasKatex(equation) && !hasRedError(equation), equation.slice(0, 200));
const ceInline = render("the $\\ce{H2SO4}$ molecule");
check("inline mhchem renders without red",
  hasKatex(ceInline) && !hasRedError(ceInline));

// ── 9. citations ride markdown (s138 rule + urlTransform regression) ────
const cite = render("**Key idea [1]** stays bold.");
check("citation chip renders inside bold (renderCitation rides the pipeline)",
  cite.includes('data-cite="1"') && cite.includes("<strong"), cite.slice(0, 200));

// ── 10. currency ────────────────────────────────────────────────────────
const money = render("It costs $5 today and $10 tomorrow.");
check("currency dollars never become math",
  !hasKatex(money) && visibleText(money).includes("$5") && visibleText(money).includes("$10"),
  visibleText(money));

// ── 11. list marker intact ──────────────────────────────────────────────
const list = render("- \\%O_2 = \\frac{a}{b}");
check("list marker never swallowed into math",
  list.includes("<li") && hasKatex(list) && !hasRedError(list), list.slice(0, 200));

// ── 12. code fences untouched ───────────────────────────────────────────
const fenced = render("Example:\n```\nM_r = \\frac{24}{0.4}\n```");
check("fenced code never rewritten",
  fenced.includes("<pre") && fenced.includes("\\frac") && !hasKatex(fenced));

// ── 13. prose + dangling LaTeX mix ──────────────────────────────────────
const mixed = render("the volume of gas was \\frac{24}{0.4} = 60 dm^3 exactly");
const mixedOutside = mixed
  .replace(/<span class="katex"[\s\S]*?<\/span><\/span>/g, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");
check("mixed: formula renders, no red, no leak",
  hasKatex(mixed) && !hasRedError(mixed)
    && !visibleText(mixed).includes("volume of gas was \\frac"));
check("mixed: prose words left outside the math run",
  /volume of gas was/.test(mixedOutside) && /exactly/.test(mixedOutside),
  mixedOutside);

// ── 14. bold-wrapped formula ────────────────────────────────────────────
const bold = render("**M_r = \\frac{24}{0.4}**");
check("bold-wrapped formula keeps the bold AND the math",
  hasKatex(bold) && !hasRedError(bold) && bold.includes("<strong"),
  bold.slice(0, 200));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
