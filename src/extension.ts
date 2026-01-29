import * as vscode from 'vscode';

/**
 * Per-document settings for Complementry
 */
interface DocumentSettings {
	promptTemplate?: string;
	contextFiles: string[];
}

/**
 * Manages per-document settings for completions
 */
class DocumentSettingsManager {
	private settings: Map<string, DocumentSettings> = new Map();

	getSettings(documentUri: string): DocumentSettings {
		if (!this.settings.has(documentUri)) {
			this.settings.set(documentUri, { contextFiles: [] });
		}
		return this.settings.get(documentUri)!;
	}

	setPromptTemplate(documentUri: string, template: string): void {
		const settings = this.getSettings(documentUri);
		settings.promptTemplate = template;
	}

	addContextFile(documentUri: string, filePath: string): void {
		const settings = this.getSettings(documentUri);
		if (!settings.contextFiles.includes(filePath)) {
			settings.contextFiles.push(filePath);
		}
	}

	removeContextFile(documentUri: string, filePath: string): void {
		const settings = this.getSettings(documentUri);
		const index = settings.contextFiles.indexOf(filePath);
		if (index > -1) {
			settings.contextFiles.splice(index, 1);
		}
	}

	getContextFiles(documentUri: string): string[] {
		return this.getSettings(documentUri).contextFiles;
	}
}

/**
 * Manages the completion state - we only provide completions when triggered manually
 */
class CompletionTriggerManager {
	private pendingCompletion: {
		documentUri: string;
		position: vscode.Position;
		resolve: (items: vscode.InlineCompletionItem[]) => void;
	} | null = null;

	private completionResult: vscode.InlineCompletionItem[] | null = null;
	private completionDocUri: string | null = null;

	setPendingCompletion(
		documentUri: string,
		position: vscode.Position,
		resolve: (items: vscode.InlineCompletionItem[]) => void
	): void {
		this.pendingCompletion = { documentUri, position, resolve };
	}

	setCompletionResult(documentUri: string, items: vscode.InlineCompletionItem[]): void {
		this.completionResult = items;
		this.completionDocUri = documentUri;
	}

	getCompletionResult(documentUri: string): vscode.InlineCompletionItem[] | null {
		if (this.completionDocUri === documentUri) {
			const result = this.completionResult;
			this.completionResult = null;
			this.completionDocUri = null;
			return result;
		}
		return null;
	}

	consumePending(): typeof this.pendingCompletion {
		const pending = this.pendingCompletion;
		this.pendingCompletion = null;
		return pending;
	}
}

/**
 * Service for calling LLM APIs
 */
class LLMService {
	async getCompletion(
		prompt: string,
		config: vscode.WorkspaceConfiguration
	): Promise<string | null> {
		const apiEndpoint = config.get<string>('apiEndpoint');
		const apiKey = config.get<string>('apiKey');
		const model = config.get<string>('model', 'gpt-4');
		const maxTokens = config.get<number>('maxTokens', 150);

		if (!apiEndpoint || !apiKey) {
			vscode.window.showWarningMessage(
				'Complementry: Please configure API endpoint and key in settings'
			);
			return null;
		}

		try {
			const response = await fetch(apiEndpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model,
					messages: [{ role: 'user', content: prompt }],
					max_tokens: maxTokens,
					temperature: 0.7
				})
			});

			if (!response.ok) {
				throw new Error(`API request failed: ${response.statusText}`);
			}

			const data = await response.json() as {
				choices?: Array<{ message?: { content?: string } }>;
			};
			return data.choices?.[0]?.message?.content || null;
		} catch (error) {
			vscode.window.showErrorMessage(`Complementry: ${error}`);
			return null;
		}
	}
}

/**
 * Builds the prompt from template and document content
 */
class PromptBuilder {
	constructor(private settingsManager: DocumentSettingsManager) {}

	async buildPrompt(
		document: vscode.TextDocument,
		position: vscode.Position,
		defaultTemplate: string
	): Promise<string> {
		const documentUri = document.uri.toString();
		const settings = this.settingsManager.getSettings(documentUri);
		const template = settings.promptTemplate || defaultTemplate;

		// Get document content up to cursor
		const textBeforeCursor = document.getText(
			new vscode.Range(new vscode.Position(0, 0), position)
		);
		const textAfterCursor = document.getText(
			new vscode.Range(position, document.positionAt(document.getText().length))
		);
		const fullDocument = document.getText();

		// Load context files
		let contextContent = '';
		for (const filePath of settings.contextFiles) {
			try {
				const uri = vscode.Uri.file(filePath);
				const contextDoc = await vscode.workspace.openTextDocument(uri);
				contextContent += `\n--- Context from ${filePath} ---\n${contextDoc.getText()}\n`;
			} catch {
				// File not found, skip
			}
		}

		// Replace template variables
		let prompt = template
			.replace(/{document}/g, fullDocument)
			.replace(/{before_cursor}/g, textBeforeCursor)
			.replace(/{after_cursor}/g, textAfterCursor)
			.replace(/{context_files}/g, contextContent)
			.replace(/{cursor}/g, `[CURSOR HERE]`);

		return prompt;
	}
}

/**
 * Inline completion provider that only provides completions when manually triggered
 */
class ComplementryCompletionProvider implements vscode.InlineCompletionItemProvider {
	constructor(
		private triggerManager: CompletionTriggerManager,
		private settingsManager: DocumentSettingsManager,
		private llmService: LLMService,
		private promptBuilder: PromptBuilder
	) {}

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {
		// Only provide completions for markdown files
		if (document.languageId !== 'markdown') {
			return null;
		}

		// Check if we have a pre-computed completion result
		const precomputed = this.triggerManager.getCompletionResult(document.uri.toString());
		if (precomputed) {
			return precomputed;
		}

		// We don't provide automatic completions - only manual triggers
		return null;
	}
}

export function activate(context: vscode.ExtensionContext) {
	const settingsManager = new DocumentSettingsManager();
	const triggerManager = new CompletionTriggerManager();
	const llmService = new LLMService();
	const promptBuilder = new PromptBuilder(settingsManager);

	// Register the inline completion provider
	const provider = new ComplementryCompletionProvider(
		triggerManager,
		settingsManager,
		llmService,
		promptBuilder
	);

	context.subscriptions.push(
		vscode.languages.registerInlineCompletionItemProvider(
			{ language: 'markdown' },
			provider
		)
	);

	// Command: Trigger completion manually
	context.subscriptions.push(
		vscode.commands.registerCommand('complementry.triggerCompletion', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== 'markdown') {
				vscode.window.showWarningMessage('Complementry: Please open a markdown file');
				return;
			}

			const document = editor.document;
			const position = editor.selection.active;
			const config = vscode.workspace.getConfiguration('complementry');

			// Show progress while fetching completion
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Complementry: Fetching completion...',
					cancellable: true
				},
				async (progress, token) => {
					const defaultTemplate = config.get<string>(
						'defaultPromptTemplate',
						'Continue writing the following markdown document naturally. Only provide the continuation text, no explanations:\n\n{document}\n\nContinuation:'
					);

					const prompt = await promptBuilder.buildPrompt(document, position, defaultTemplate);
					const completion = await llmService.getCompletion(prompt, config);

					if (completion && !token.isCancellationRequested) {
						const item = new vscode.InlineCompletionItem(completion);
						item.range = new vscode.Range(position, position);

						triggerManager.setCompletionResult(document.uri.toString(), [item]);

						// Trigger VS Code to request inline completions
						await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
					}
				}
			);
		})
	);

	// Command: Configure document settings
	context.subscriptions.push(
		vscode.commands.registerCommand('complementry.configure', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			const documentUri = editor.document.uri.toString();
			const settings = settingsManager.getSettings(documentUri);

			const options = [
				'Set Prompt Template',
				'Add Context File',
				'Remove Context File',
				'View Current Settings'
			];

			const choice = await vscode.window.showQuickPick(options, {
				placeHolder: 'Configure Complementry for this document'
			});

			if (choice === 'View Current Settings') {
				const contextFiles = settings.contextFiles.length > 0
					? settings.contextFiles.join('\n  - ')
					: 'None';
				const template = settings.promptTemplate || 'Using default';

				vscode.window.showInformationMessage(
					`Prompt: ${template}\n\nContext Files:\n  - ${contextFiles}`,
					{ modal: true }
				);
			}
		})
	);

	// Command: Add context file
	context.subscriptions.push(
		vscode.commands.registerCommand('complementry.addContextFile', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			const files = await vscode.window.showOpenDialog({
				canSelectMany: true,
				filters: { 'Markdown': ['md'], 'All Files': ['*'] },
				title: 'Select context files for completion'
			});

			if (files) {
				const documentUri = editor.document.uri.toString();
				for (const file of files) {
					settingsManager.addContextFile(documentUri, file.fsPath);
				}
				vscode.window.showInformationMessage(
					`Added ${files.length} context file(s)`
				);
			}
		})
	);

	// Command: Remove context file
	context.subscriptions.push(
		vscode.commands.registerCommand('complementry.removeContextFile', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			const documentUri = editor.document.uri.toString();
			const contextFiles = settingsManager.getContextFiles(documentUri);

			if (contextFiles.length === 0) {
				vscode.window.showInformationMessage('No context files configured');
				return;
			}

			const selected = await vscode.window.showQuickPick(contextFiles, {
				placeHolder: 'Select file to remove',
				canPickMany: true
			});

			if (selected) {
				for (const file of selected) {
					settingsManager.removeContextFile(documentUri, file);
				}
				vscode.window.showInformationMessage(
					`Removed ${selected.length} context file(s)`
				);
			}
		})
	);

	// Command: Set prompt template
	context.subscriptions.push(
		vscode.commands.registerCommand('complementry.setPromptTemplate', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			const documentUri = editor.document.uri.toString();
			const config = vscode.workspace.getConfiguration('complementry');
			const defaultTemplate = config.get<string>('defaultPromptTemplate', '');
			const currentSettings = settingsManager.getSettings(documentUri);

			const template = await vscode.window.showInputBox({
				prompt: 'Enter prompt template (use {document}, {before_cursor}, {after_cursor}, {context_files})',
				value: currentSettings.promptTemplate || defaultTemplate,
				placeHolder: 'Continue writing: {document}'
			});

			if (template !== undefined) {
				settingsManager.setPromptTemplate(documentUri, template);
				vscode.window.showInformationMessage('Prompt template updated');
			}
		})
	);

	console.log('Complementry extension activated');
}

export function deactivate() {}
