/**
 * Looks at a thing a file shares with the rest of the app and decides what
 * kind of thing it is — a React component, a page route, a hook, a type,
 * and so on — based on where the file lives and how the thing is named.
 * The little shape next to each name in the hover panel comes from this.
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
