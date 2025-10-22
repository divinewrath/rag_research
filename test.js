import fs from "node:fs";
import Parser from "tree-sitter";
import PHP from "tree-sitter-php";

const parser = new Parser();
parser.setLanguage(PHP);

const parseFile = async (filePath) => {
    const code = fs.readFileSync(filePath, "utf8");
    const tree = parser.parse(code);

    const chunks = [];

    const walk = (node) => {
        if (node.type === "method_declaration" || node.type === "function_definition") {
            chunks.push({
                file: filePath,
                startLine: node.startPosition.row,
                endLine: node.endPosition.row,
                language: "php",
                content: code.slice(node.startIndex, node.endIndex),
            });
        }
        for (const child of node.children) walk(child);
    };
    walk(tree.rootNode);

    if (chunks.length === 0) {
        chunks.push({
            file: filePath,
            startLine: 0,
            endLine: tree.rootNode.endPosition.row,
            language: "php",
            content: code,
        });
    }

    return chunks;
};

let data = await parseFile("/home/div/temp/xxx/winezja/src/winezja/module-sales-rule/Model/RulesApplier.php");

fs.writeFileSync('data.json', JSON.stringify(data, null, 2), 'utf8');
