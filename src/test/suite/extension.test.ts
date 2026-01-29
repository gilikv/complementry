import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Complementry Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Extension should be present', () => {
		assert.ok(vscode.extensions.getExtension('gilikv.complementry'));
	});

	test('Extension should activate on markdown files', async () => {
		const doc = await vscode.workspace.openTextDocument({
			language: 'markdown',
			content: '# Test Document\n\nSome content here.'
		});
		await vscode.window.showTextDocument(doc);

		// Give extension time to activate
		await new Promise(resolve => setTimeout(resolve, 1000));

		const ext = vscode.extensions.getExtension('gilikv.complementry');
		assert.ok(ext?.isActive, 'Extension should be active for markdown files');
	});

	test('Commands should be registered', async () => {
		const commands = await vscode.commands.getCommands(true);

		assert.ok(
			commands.includes('complementry.triggerCompletion'),
			'triggerCompletion command should be registered'
		);
		assert.ok(
			commands.includes('complementry.configure'),
			'configure command should be registered'
		);
		assert.ok(
			commands.includes('complementry.addContextFile'),
			'addContextFile command should be registered'
		);
		assert.ok(
			commands.includes('complementry.removeContextFile'),
			'removeContextFile command should be registered'
		);
		assert.ok(
			commands.includes('complementry.setPromptTemplate'),
			'setPromptTemplate command should be registered'
		);
	});

	test('Configuration should have default values', () => {
		const config = vscode.workspace.getConfiguration('complementry');

		assert.ok(
			config.get('defaultPromptTemplate'),
			'defaultPromptTemplate should have a default value'
		);
		assert.strictEqual(
			config.get('maxTokens'),
			150,
			'maxTokens should default to 150'
		);
		assert.strictEqual(
			config.get('model'),
			'gpt-4',
			'model should default to gpt-4'
		);
	});
});
