/**
 * NO DEAD COPY — and no dead copy that reads like a claim.
 *
 * Two Phase 7 blocks each left behind a `*_COPY` key that nothing rendered, and
 * both of them read like a sentence the product does not actually say:
 *
 *   - `SCREENING_COPY.sectionHeading` was written and never rendered, so the
 *     screening section's real heading stayed the old one (P7-7a fixed that by
 *     rendering it).
 *   - `THUMBNAIL_COPY.imageNotShownLabel` — "What is standing in for an image
 *     here" — presupposes a stand-in, and P7-4's invariant is the opposite: the
 *     image slot is a declared absence with no placeholder and no stock
 *     stand-in. Nothing rendered it, so no user read it. That is luck, not
 *     design.
 *
 * A dead key is not dangerous because it is rendered. It is dangerous because it
 * is *available*: the next person to wire up that section reaches for the key
 * that is already there, and inherits a sentence nobody checked. So the rule is
 * mechanical rather than a matter of review: **every key of every exported
 * `*_COPY` object must be referenced somewhere in non-test source.** A key that
 * only its own definition mentions fails the suite.
 *
 * HOW THE REFERENCE IS DECIDED (deliberately generous, so a live key never
 * fails this test):
 *
 *   1. The object is used WHOLESALE somewhere in non-test source — spread
 *      (`...COPY`), iterated (`Object.values(COPY)` / `entries` / `keys`), in
 *      which case every one of its keys is genuinely reachable and none of them
 *      is dead.
 *   2. The key's name appears as a BARE WORD in any non-test source file other
 *      than the file that defines it. This is the same scan the Phase 7 sweep
 *      used. It is a text scan, not a binding-resolution scan, so it is
 *      forgiving in exactly one direction: a name that also happens to be
 *      another object's key counts as referenced. That direction is safe — it
 *      can miss a dead key, never fail a live one.
 *   3. The key's name appears more than once in its own defining file, i.e.
 *      somewhere other than the single line that defines it.
 *
 * A key reached only through a COMPUTED lookup (`COPY[someVariable]`) would not
 * be seen by (2) — that is what (1) is for: an object read that way is normally
 * also iterated or spread, and if it is not, naming the keys in the scan is the
 * honest fix rather than teaching this test to resolve bindings.
 *
 * WHAT THIS TEST DOES NOT CLAIM: that a referenced key is rendered, or that its
 * sentence is true. It asserts exactly one thing — nothing in this product's copy
 * layer is unreachable. Truth is the honesty audit's job (`./audit`), and the
 * banned-claim sweep's (`./studio-copy.test.ts`).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

/** A test file is not a place a user reads anything from. */
function isTestFile(p: string): boolean {
  return /(^|[\\/])__tests__[\\/]/.test(p) || /\.(test|spec)\.tsx?$/.test(p);
}

interface CopyKey {
  name: string;
  line: number;
}
interface CopyObject {
  name: string;
  file: string;
  keys: CopyKey[];
}

/** Every exported `*_COPY` object literal in non-test source, with its top-level keys. */
function findCopyObjects(files: string[]): CopyObject[] {
  const found: CopyObject[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (!/_COPY\b/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isVariableStatement(node)) {
        const exported = (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (exported) {
          for (const decl of node.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || !/_COPY$/.test(decl.name.text)) continue;
            let init: ts.Expression | undefined = decl.initializer;
            while (
              init &&
              (ts.isAsExpression(init) || ts.isParenthesizedExpression(init) || ts.isSatisfiesExpression(init))
            ) {
              init = init.expression;
            }
            if (!init || !ts.isObjectLiteralExpression(init)) continue;
            const keys: CopyKey[] = [];
            for (const prop of init.properties) {
              if (
                !ts.isPropertyAssignment(prop) &&
                !ts.isShorthandPropertyAssignment(prop) &&
                !ts.isMethodDeclaration(prop)
              ) {
                continue;
              }
              const nameNode = prop.name;
              if (!nameNode) continue;
              if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode)) {
                keys.push({
                  name: nameNode.text,
                  line: sf.getLineAndCharacterOfPosition(nameNode.getStart(sf)).line + 1,
                });
              }
            }
            found.push({ name: decl.name.text, file, keys });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

const allFiles = walk(SRC);
const sourceFiles = allFiles.filter((f) => !isTestFile(f));
const sourceText = new Map(sourceFiles.map((f) => [f, readFileSync(f, "utf8")]));
const copyObjects = findCopyObjects(sourceFiles);

/** `...COPY`, `Object.values(COPY)`, `Object.entries(COPY)`, `Object.keys(COPY)`. */
function usedWholesale(objectName: string, definingFile: string): boolean {
  const pattern = new RegExp(
    `(\\.\\.\\.\\s*${objectName}\\b)|(Object\\.(values|entries|keys)\\(\\s*${objectName}\\s*[),])`,
  );
  for (const file of sourceFiles) {
    if (file === definingFile) continue;
    if (pattern.test(sourceText.get(file)!)) return true;
  }
  return false;
}

function bareWordPattern(name: string): RegExp {
  return new RegExp(`(^|[^A-Za-z0-9_$])${name.replace(/\$/g, "\\$")}([^A-Za-z0-9_$]|$)`);
}

function countMatches(text: string, pattern: RegExp): number {
  const g = new RegExp(pattern.source, "g");
  return (text.match(g) ?? []).length;
}

/** A key is referenced if the object is used wholesale, or the name appears elsewhere in non-test source. */
function referencedElsewhere(object: CopyObject, key: CopyKey): boolean {
  const pattern = bareWordPattern(key.name);
  for (const file of sourceFiles) {
    if (file === object.file) continue;
    if (pattern.test(sourceText.get(file)!)) return true;
  }
  // The defining file itself, beyond the one line that declares the key.
  return countMatches(sourceText.get(object.file)!, pattern) > 1;
}

describe("every key of every exported *_COPY object is referenced in non-test source", () => {
  test("the scan found the copy layer at all", () => {
    // A guard that passes because it scanned nothing is worse than no guard. If a
    // refactor moves or renames the copy modules, this fails loudly instead of
    // reporting a clean sweep of an empty set.
    expect(copyObjects.length).toBeGreaterThanOrEqual(10);
    const totalKeys = copyObjects.reduce((n, o) => n + o.keys.length, 0);
    expect(totalKeys).toBeGreaterThanOrEqual(200);
    expect(copyObjects.map((o) => o.name)).toContain("THUMBNAIL_COPY");
    expect(copyObjects.map((o) => o.name)).toContain("QUALITY_COPY");
  });

  test("no key is dead", () => {
    const dead: string[] = [];
    for (const object of copyObjects) {
      if (usedWholesale(object.name, object.file)) continue;
      for (const key of object.keys) {
        if (referencedElsewhere(object, key)) continue;
        dead.push(`${object.name}.${key.name}  (${relative(ROOT, object.file)}:${key.line})`);
      }
    }
    expect(dead).toEqual([]);
  });

  test("the key `imageNotShownLabel` is gone, and the phrase it carried with it", () => {
    // The instance that motivated this guard, asserted by name so a revert is
    // visible rather than silent: the image slot is a declared absence, and no
    // copy object may describe a stand-in for it.
    const thumbnail = copyObjects.find((o) => o.name === "THUMBNAIL_COPY");
    expect(thumbnail).toBeDefined();
    expect(thumbnail!.keys.map((k) => k.name)).not.toContain("imageNotShownLabel");
    expect(thumbnail!.keys.map((k) => k.name)).toContain("imageNotSubstitutedLabel");
    for (const object of copyObjects) {
      const text = sourceText.get(object.file)!;
      expect(text).not.toContain("What is standing in for an image here");
    }
  });
});
