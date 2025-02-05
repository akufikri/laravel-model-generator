import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Engine, Parser } from 'php-parser';

let parser = new Engine({
    parser: {
        extractDoc: true,
        php7: true
    },
    ast: {
        withPositions: true
    }
});

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('laravelModelGenerator.importToModel', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        try {
            const fields = parseFields(selectedText);
            if (!fields.length) {
                vscode.window.showErrorMessage('No valid fields found in selection');
                return;
            }

            // Get corresponding model name from migration
            const modelName = await getModelNameFromMigration(selectedText);
            if (!modelName) {
                const inputModelName = await vscode.window.showInputBox({
                    prompt: 'Enter model name',
                    placeHolder: 'User'
                });
                if (!inputModelName) return;
                await updateModel(inputModelName, fields);
            } else {
                await updateModel(modelName, fields);
            }

        } catch (error) {
            console.error('Error processing selection:', error);
            vscode.window.showErrorMessage('Error processing migration fields');
        }
    });

    context.subscriptions.push(disposable);
}

function parseFields(migrationCode: string): string[] {
    const fields: string[] = [];
    const fieldRegex = /\$table->(\w+)\('([^']+)'/g;
    let match;

    while ((match = fieldRegex.exec(migrationCode)) !== null) {
        const fieldName = match[2];
        if (!['id', 'created_at', 'updated_at'].includes(fieldName)) {
            fields.push(fieldName);
        }
    }

    return fields;
}

async function getModelNameFromMigration(migrationCode: string): Promise<string | null> {
    const tableMatch = migrationCode.match(/Schema::create\('([^']+)'/);
    if (tableMatch) {
        return tableMatch[1]
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join('');
    }
    return null;
}

async function updateModel(modelName: string, fields: string[]) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const modelPath = path.join(
        workspaceFolder.uri.fsPath,
        'app',
        'Models',
        `${modelName}.php`
    );

    try {
        if (!fs.existsSync(modelPath)) {
            vscode.window.showErrorMessage(`Model ${modelName}.php not found`);
            return;
        }

        let modelContent = fs.readFileSync(modelPath, 'utf8');

        
        const fillableStr = `protected $fillable = ['${fields.join("', '")}'];`;
        
        if (modelContent.includes('protected $fillable')) {
            
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

        fs.writeFileSync(modelPath, modelContent);
        vscode.window.showInformationMessage(`Model ${modelName} updated successfully!`);

    } catch (error) {
        console.error('Error updating model:', error);
        vscode.window.showErrorMessage('Error updating model file');
    }
}

export function deactivate() {}