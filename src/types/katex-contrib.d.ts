/**
 * katex/contrib/mhchem has no bundled type declarations (the katex package
 * only types its "." export). It is a side-effect-only import: loading the
 * module registers the \ce{} macro on the shared KaTeX instance, which
 * rehype-katex then renders chemical equations through.
 */
declare module "katex/contrib/mhchem";
