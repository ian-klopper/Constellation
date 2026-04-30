/**
 * Maps an exported declaration to a SymbolKind by looking at the file path,
 * the declaration shape, and naming conventions (e.g. `useFoo` → hook,
 * PascalCase in a .tsx file → component, GET in app/api/.../route.ts → route).
 * Used by the scanner to label each export so the visualizer can pick a glyph.
 */
import { Node, type SourceFile } from "ts-morph";
import type { SymbolKind } from "./types";

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
]);

export function classify(
  name: string,
  declaration: Node,
  sourceFile: SourceFile,
): SymbolKind {
  const filePath = sourceFile.getFilePath();

  if (
    /\/app\/api\/.*\/route\.tsx?$/.test(filePath) &&
    HTTP_METHODS.has(name)
  ) {
    return "route";
  }

  if (
    Node.isTypeAliasDeclaration(declaration) ||
    Node.isInterfaceDeclaration(declaration)
  ) {
    return "type";
  }

  if (hasUseServerDirective(sourceFile) && isFunctionLike(declaration)) {
    return "action";
  }

  if (/^use[A-Z]/.test(name) && isFunctionLike(declaration)) {
    return "hook";
  }

  if (
    filePath.endsWith(".tsx") &&
    /^[A-Z]/.test(name) &&
    isFunctionLike(declaration)
  ) {
    return "component";
  }

  if (isFunctionLike(declaration)) {
    return "function";
  }

  return "const";
}

function isFunctionLike(node: Node): boolean {
  if (Node.isFunctionDeclaration(node)) return true;
  if (Node.isVariableDeclaration(node)) {
    const init = node.getInitializer();
    return (
      !!init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))
    );
  }
  return false;
}

function hasUseServerDirective(sourceFile: SourceFile): boolean {
  const first = sourceFile.getStatements()[0];
  if (!first || !Node.isExpressionStatement(first)) return false;
  const expr = first.getExpression();
  return Node.isStringLiteral(expr) && expr.getLiteralText() === "use server";
}

export function nameFromDeclaration(decl: Node): string | undefined {
  if (
    Node.isFunctionDeclaration(decl) ||
    Node.isClassDeclaration(decl) ||
    Node.isVariableDeclaration(decl) ||
    Node.isTypeAliasDeclaration(decl) ||
    Node.isInterfaceDeclaration(decl)
  ) {
    return decl.getName();
  }
  return undefined;
}
