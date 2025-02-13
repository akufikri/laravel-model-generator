/**
 * @license
 * Copyright (c) 2024 [akufikri]
 * Licensed under the MIT License.
 */
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Engine } from "php-parser";

let parser = new Engine({
  parser: { extractDoc: true, php7: true },
  ast: { withPositions: true },
});

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
    "laravelModelGenerator.importToModel",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);

      try {
        const fields = parseFields(selectedText);
        const relations = parseRelations(selectedText);

        if (!fields.length && !relations.length) {
          vscode.window.showErrorMessage(
            "No valid fields or relations found in selection"
          );
          return;
        }

        let modelName: string | null = await getModelNameFromMigration(
          selectedText
        );

        if (!modelName) {
          modelName =
            (await vscode.window.showInputBox({
              prompt: "Enter model name",
              placeHolder: "User",
            })) ?? null;
          if (!modelName) return;
        }

        let tableName = modelName.toLowerCase() + "s";
        if (selectedText.includes(`Schema::create('${tableName}'`)) {
          tableName = modelName.toLowerCase();
        }

        await updateModel(modelName, tableName, fields, relations);
      } catch (error) {
        console.error("Error processing selection:", error);
        vscode.window.showErrorMessage(
          "Error processing migration fields and relations"
        );
      }
    }
  );

  context.subscriptions.push(disposable);
}

function parseFields(migrationCode: string): string[] {
  const fields: string[] = [];
  const fieldRegex = /\$table->(\w+)\('([^']+)'/g;
  let match;

  while ((match = fieldRegex.exec(migrationCode)) !== null) {
    const fieldName = match[2];
    if (!["id", "created_at", "updated_at"].includes(fieldName)) {
      fields.push(fieldName);
    }
  }

  return fields;
}

function parseRelations(
  migrationCode: string
): {
  type: string;
  method: string;
  relatedModel: string;
  foreignKey: string;
}[] {
  const relations: {
    type: string;
    method: string;
    relatedModel: string;
    foreignKey: string;
  }[] = [];

  const relationRegex =
    /\$table->(foreignId|unsignedBigInteger)\('([^']+)'\)(?:->constrained\('([^']+)'\))?/g;
  let match;

  while ((match = relationRegex.exec(migrationCode)) !== null) {
    const columnName = match[2];
    let relatedTable = match[3];

    if (!relatedTable) {
      relatedTable = columnName.replace(/_id$/, "");
    }

    const relatedModel = relatedTable
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("");

    relations.push({
      type: "belongsTo",
      method: `belongsTo(${relatedModel}::class, '${columnName}')`,
      relatedModel,
      foreignKey: columnName,
    });
  }

  return relations;
}

async function getModelNameFromMigration(
  migrationCode: string
): Promise<string | null> {
  const tableMatch = migrationCode.match(/Schema::create\('([^']+)'/);
  if (tableMatch) {
    return tableMatch[1]
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("");
  }
  return null;
}

async function updateModel(
  modelName: string,
  tableName: string,
  fields: string[],
  relations: {
    type: string;
    method: string;
    relatedModel: string;
    foreignKey: string;
  }[]
) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage("No workspace folder found");
    return;
  }
  const modelPath = path.join(
    workspaceFolder.uri.fsPath,
    "app",
    "Models",
    `${modelName}.php`
  );
  try {
    if (!fs.existsSync(modelPath)) {
      vscode.window.showErrorMessage(`Model ${modelName}.php not found`);
      return;
    }

    let modelContent = fs.readFileSync(modelPath, "utf8");

    const tableStr = `protected $table = '${tableName}';`;
    if (!modelContent.includes("protected $table")) {
      modelContent = modelContent.replace(
        /class\s+\w+\s+extends\s+Model\s*{/,
        (match) => `${match}\n    ${tableStr}`
      );
    }

    const fillableStr = `protected $fillable = [\n    '${fields.join(
      "',\n    '"
    )}',\n];`;
    if (modelContent.includes("protected $fillable")) {
      modelContent = modelContent.replace(
        /protected \$fillable = \[[\s\S]*?\];/,
        fillableStr
      );
    } else {
      modelContent = modelContent.replace(
        /}(?=[^}]*$)/,
        `    ${fillableStr}\n}`
      );
    }

    for (const relation of relations) {
      const relationMethod = `
    public function ${relation.relatedModel.toLowerCase()}() {
        return $this->${relation.method};
    }
`;

      if (
        !modelContent.includes(
          `function ${relation.relatedModel.toLowerCase()}()`
        )
      ) {
        modelContent = modelContent.replace(
          /}(?=[^}]*$)/,
          `    ${relationMethod}\n}`
        );
      }
    }

    fs.writeFileSync(modelPath, modelContent);
    vscode.window.showInformationMessage(
      `Model ${modelName} updated successfully!`
    );
  } catch (error) {
    console.error("Error updating model:", error);
    vscode.window.showErrorMessage("Error updating model file");
  }
}

export function deactivate() {}
