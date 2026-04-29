import { Project, SyntaxKind, JsxOpeningElement, JsxSelfClosingElement } from 'ts-morph';

const project = new Project({
  tsConfigFilePath: "tsconfig.json",
});

const files = project.getSourceFiles("src/components/**/*.tsx");
let filesModified = 0;

const ALLOWED_TAGS = new Set([
  'span', 'div', 'button', 'a', 'code', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'i', 'b', 'time',
  'Badge', 'Button', 'IconButton', 'LucideIcon' // Common custom components that we want to wrap
]);

for (const file of files) {
  let hasChanges = false;
  let hasTooltipImport = file.getImportDeclaration(decl => decl.getModuleSpecifierValue() === "@/components/ui/tooltip") !== undefined;
  
  const jsxElements = file.getDescendantsOfKind(SyntaxKind.JsxElement);
  const jsxSelfClosingElements = file.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);
  
  const replacements: { node: any, replacement: string, isSelfClosing: boolean }[] = [];

  for (const element of jsxElements) {
    const openingElement = element.getOpeningElement();
    const tagName = openingElement.getTagNameNode().getText();
    
    // Check if tag is allowed (lowercase or in allowlist or looks like an icon e.g., ending with Icon or starts with Chevron etc)
    const isAllowed = /^[a-z]/.test(tagName) || ALLOWED_TAGS.has(tagName) || ['Chevron', 'Arrow', 'Minus', 'Plus', 'Check', 'X', 'File', 'Folder', 'Info', 'Alert', 'Play', 'Stop'].some(prefix => tagName.startsWith(prefix));
    
    if (!isAllowed) continue;

    const titleAttr = openingElement.getAttribute("title");
    if (titleAttr && titleAttr.getKind() === SyntaxKind.JsxAttribute) {
      const titleValue = titleAttr.getInitializer()?.getText();
      if (titleValue) {
        replacements.push({ node: element, replacement: titleValue, isSelfClosing: false });
      }
    }
  }

  for (const element of jsxSelfClosingElements) {
    const tagName = element.getTagNameNode().getText();
    
    const isAllowed = /^[a-z]/.test(tagName) || ALLOWED_TAGS.has(tagName) || ['Chevron', 'Arrow', 'Minus', 'Plus', 'Check', 'X', 'File', 'Folder', 'Info', 'Alert', 'Play', 'Stop'].some(prefix => tagName.startsWith(prefix));
    
    if (!isAllowed) continue;

    const titleAttr = element.getAttribute("title");
    if (titleAttr && titleAttr.getKind() === SyntaxKind.JsxAttribute) {
      const titleValue = titleAttr.getInitializer()?.getText();
      if (titleValue) {
        replacements.push({ node: element, replacement: titleValue, isSelfClosing: true });
      }
    }
  }

  if (replacements.length > 0) {
    replacements.sort((a, b) => b.node.getPos() - a.node.getPos());

    for (const { node, replacement, isSelfClosing } of replacements) {
      const titleAttr = isSelfClosing 
        ? node.getAttribute("title") 
        : node.getOpeningElement().getAttribute("title");
      
      if (titleAttr) {
        titleAttr.remove();
      }

      const nodeText = node.getText();
      const content = replacement.startsWith('{') ? replacement : replacement.slice(1, -1);

      const newText = `
<Tooltip>
  <TooltipTrigger asChild>
    ${nodeText}
  </TooltipTrigger>
  <TooltipContent className="max-w-xs text-center text-balance">${content}</TooltipContent>
</Tooltip>
      `.trim();

      node.replaceWithText(newText);
      hasChanges = true;
    }
  }

  if (hasChanges) {
    if (!hasTooltipImport) {
      file.addImportDeclaration({
        namedImports: ["Tooltip", "TooltipTrigger", "TooltipContent"],
        moduleSpecifier: "@/components/ui/tooltip",
      });
    } else {
      const tooltipImport = file.getImportDeclaration(decl => decl.getModuleSpecifierValue() === "@/components/ui/tooltip");
      if (tooltipImport) {
        const namedImports = tooltipImport.getNamedImports().map(i => i.getName());
        const requiredImports = ["Tooltip", "TooltipTrigger", "TooltipContent"];
        for (const req of requiredImports) {
          if (!namedImports.includes(req)) {
            tooltipImport.addNamedImport(req);
          }
        }
      }
    }
    file.saveSync();
    filesModified++;
    console.log(`Modified ${file.getFilePath()}`);
  }
}

console.log(`Finished modifying ${filesModified} files.`);
