import * as vscode from 'vscode';
import { generateText } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

// Output channel for debugging
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;

function log(message: string, data?: unknown) {
	const timestamp = new Date().toISOString();
	outputChannel.appendLine(`[${timestamp}] ${message}`);
	if (data !== undefined) {
		outputChannel.appendLine(JSON.stringify(data, null, 2));
	}
}

function setStatus(text: string, icon?: string, timeout?: number) {
	const iconStr = icon ? `$(${icon}) ` : '';
	statusBarItem.text = `${iconStr}${text}`;
	statusBarItem.show();

	if (timeout) {
		setTimeout(() => {
			statusBarItem.text = '$(sparkle) Complementry';
		}, timeout);
	}
}

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
	private lastCompletionText: string | null = null;
	private resultCallCount = 0;

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
		this.resultCallCount = 0;
		// Store the text for fallback insertion
		if (items.length > 0 && items[0].insertText) {
			this.lastCompletionText = typeof items[0].insertText === 'string'
				? items[0].insertText
				: items[0].insertText.value;
		}
		log(`CompletionTriggerManager: stored result for ${documentUri}`);
	}

	getCompletionResult(documentUri: string): vscode.InlineCompletionItem[] | null {
		log(`CompletionTriggerManager: getCompletionResult called`);
		log(`  - requested: ${documentUri}`);
		log(`  - stored: ${this.completionDocUri}`);
		log(`  - has result: ${!!this.completionResult}`);
		log(`  - call count: ${this.resultCallCount}`);

		if (this.completionDocUri === documentUri && this.completionResult) {
			this.resultCallCount++;
			// Keep result available for a few calls (VS Code may call multiple times)
			if (this.resultCallCount > 3) {
				log('Clearing result after multiple calls');
				const result = this.completionResult;
				this.completionResult = null;
				this.completionDocUri = null;
				return result;
			}
			return this.completionResult;
		}
		return null;
	}

	getLastCompletionText(): string | null {
		return this.lastCompletionText;
	}

	clearResult(): void {
		this.completionResult = null;
		this.completionDocUri = null;
	}

	consumePending(): typeof this.pendingCompletion {
		const pending = this.pendingCompletion;
		this.pendingCompletion = null;
		return pending;
	}
}

/**
 * Service for calling LLM APIs via Vercel AI SDK
 */
class LLMService {
	async getCompletion(
		prompt: string,
		config: vscode.WorkspaceConfiguration
	): Promise<string | null> {
		const modelId = config.get<string>('model', 'us.anthropic.claude-3-5-haiku-20241022-v1:0');
		const maxOutputTokens = config.get<number>('maxTokens', 150);
		const region = config.get<string>('awsRegion', 'us-east-1');

		log('=== LLM Request ===');
		log(`Model: ${modelId}`);
		log(`Region: ${region}`);
		log(`Max tokens: ${maxOutputTokens}`);
		log(`Prompt length: ${prompt.length} chars`);
		log('Prompt:', prompt);

		try {
			// Create Bedrock provider with region config and AWS credential chain (~/.aws)
			const bedrock = createAmazonBedrock({
				region,
				credentialProvider: defaultProvider(),
			});

			const result = await generateText({
				model: bedrock(modelId),
				prompt,
				maxOutputTokens,
				temperature: 0.7,
			});

			log('=== LLM Response ===');
			log(`Text length: ${result.text?.length ?? 0} chars`);
			log(`Finish reason: ${result.finishReason}`);
			log(`Usage:`, result.usage);
			log('Response text:', result.text);

			if (!result.text) {
				log('WARNING: Empty response from LLM');
			}

			return result.text || null;
		} catch (error) {
			log('=== LLM Error ===');
			log(`Error: ${error}`);
			setStatus('Error - see output', 'error', 5000);
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
		log(`=== Provider Called ===`);
		log(`Document: ${document.uri.toString()}`);
		log(`Position: ${position.line}:${position.character}`);
		log(`Trigger kind: ${context.triggerKind}`);

		// Only provide completions for markdown files
		if (document.languageId !== 'markdown') {
			log('Not markdown, returning null');
			return null;
		}

		// Check if we have a pre-computed completion result
		const precomputed = this.triggerManager.getCompletionResult(document.uri.toString());
		log(`Precomputed result: ${precomputed ? `${precomputed.length} items` : 'null'}`);

		if (precomputed) {
			log('Returning precomputed completion');
			return precomputed;
		}

		// We don't provide automatic completions - only manual triggers
		log('No precomputed result, returning null');
		return null;
	}
}

export function activate(context: vscode.ExtensionContext) {
	// Create output channel for debugging
	outputChannel = vscode.window.createOutputChannel('Complementry');
	context.subscriptions.push(outputChannel);

	// Create status bar item
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.text = '$(sparkle) Complementry';
	statusBarItem.tooltip = 'Complementry - Cmd+Shift+Space to trigger completion';
	statusBarItem.command = 'complementry.triggerCompletion';
	context.subscriptions.push(statusBarItem);
	statusBarItem.show();

	log('Complementry extension activating...');

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
			log('=== Trigger Completion Command ===');

			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== 'markdown') {
				log('No markdown editor active');
				setStatus('Open a markdown file', 'warning', 3000);
				return;
			}

			const document = editor.document;
			const position = editor.selection.active;
			const config = vscode.workspace.getConfiguration('complementry');

			log(`Document: ${document.uri.fsPath}`);
			log(`Cursor position: line ${position.line}, char ${position.character}`);

			setStatus('Fetching...', 'loading~spin');

			const defaultTemplate = config.get<string>(
				'defaultPromptTemplate',
				'Continue writing the following markdown document naturally. Only provide the continuation text, no explanations:\n\n{document}\n\nContinuation:'
			);

			const prompt = await promptBuilder.buildPrompt(document, position, defaultTemplate);
			const completion = await llmService.getCompletion(prompt, config);

			log(`Completion received: ${completion ? `${completion.length} chars` : 'NULL'}`);

			if (completion) {
				const item = new vscode.InlineCompletionItem(completion);
				item.range = new vscode.Range(position, position);

				triggerManager.setCompletionResult(document.uri.toString(), [item]);
				log('Triggering inline suggest...');

				// Trigger VS Code to request inline completions
				await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
				log('Inline suggest triggered');
				setStatus('Ready - Tab to accept', 'check', 5000);
			} else {
				log('WARNING: No completion returned from LLM');
				setStatus('No completion', 'warning', 3000);
			}
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
					? settings.contextFiles.join(', ')
					: 'None';
				const template = settings.promptTemplate ? 'Custom' : 'Default';

				setStatus(`Template: ${template} | Context: ${contextFiles}`, 'info', 5000);
				log(`Settings - Template: ${template}, Context files: ${contextFiles}`);
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
				setStatus(`Added ${files.length} context file(s)`, 'check', 3000);
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
				setStatus('No context files configured', 'info', 3000);
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
				setStatus(`Removed ${selected.length} context file(s)`, 'check', 3000);
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
				setStatus('Prompt template updated', 'check', 3000);
			}
		})
	);

	log('Complementry extension activated successfully');
}

export function deactivate() {}
