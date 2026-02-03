#!/usr/bin/env node
/**
 * Test runner for Complementry
 *
 * Runs completion tests from the test folders.
 * Each test folder contains:
 *   - test.md: The document to complete
 *   - .complementry/context.md: Optional context to inject
 *   - README.md: Test description and expected behavior
 *
 * Usage:
 *   node tests/run-tests.js                    # Run all tests
 *   node tests/run-tests.js blank-with-context # Run specific test
 */

const fs = require('fs');
const path = require('path');
const { createAmazonBedrock } = require('@ai-sdk/amazon-bedrock');
const { generateText } = require('ai');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');

const TESTS_DIR = __dirname;

const CONFIG = {
	model: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
	region: 'us-east-1',
	maxOutputTokens: 200,
	temperature: 0.7,
};

// Template that includes context files support
const TEMPLATE_WITH_CONTEXT = `Continue writing the following markdown document naturally. Only provide the continuation text, no explanations.

{context_files}

Document to continue:
{document}

Continuation:`;

const TEMPLATE_SIMPLE = `Continue writing the following markdown document naturally. Only provide the continuation text, no explanations:

{document}

Continuation:`;

function findCursorPosition(content) {
	// Look for [CURSOR_HERE] marker
	const marker = '[CURSOR_HERE]';
	const index = content.indexOf(marker);

	if (index !== -1) {
		// Return content before cursor and after cursor
		return {
			before: content.substring(0, index),
			after: content.substring(index + marker.length),
			hasMarker: true,
		};
	}

	// Default: cursor at end
	return {
		before: content,
		after: '',
		hasMarker: false,
	};
}

function loadTestCase(testDir) {
	const testPath = path.join(TESTS_DIR, testDir);

	if (!fs.existsSync(testPath) || !fs.statSync(testPath).isDirectory()) {
		return null;
	}

	const testMdPath = path.join(testPath, 'test.md');
	if (!fs.existsSync(testMdPath)) {
		return null;
	}

	const testContent = fs.readFileSync(testMdPath, 'utf-8');
	const cursorInfo = findCursorPosition(testContent);

	// Load context files from .complementry folder
	let contextContent = '';
	const complementryDir = path.join(testPath, '.complementry');
	if (fs.existsSync(complementryDir)) {
		const contextFiles = fs.readdirSync(complementryDir).filter(f => f.endsWith('.md'));
		for (const file of contextFiles) {
			const filePath = path.join(complementryDir, file);
			const content = fs.readFileSync(filePath, 'utf-8');
			contextContent += `\n--- Context from ${file} ---\n${content}\n`;
		}
	}

	// Load README for description
	let description = testDir;
	const readmePath = path.join(testPath, 'README.md');
	if (fs.existsSync(readmePath)) {
		const readme = fs.readFileSync(readmePath, 'utf-8');
		const purposeMatch = readme.match(/## Purpose\n+([\s\S]*?)(?=\n##|$)/);
		if (purposeMatch) {
			description = purposeMatch[1].trim();
		}
	}

	return {
		name: testDir,
		description,
		document: cursorInfo.before,
		afterCursor: cursorInfo.after,
		hasMarker: cursorInfo.hasMarker,
		context: contextContent,
	};
}

async function runTest(testCase) {
	console.log(`\n${'='.repeat(70)}`);
	console.log(`TEST: ${testCase.name}`);
	console.log(`${'='.repeat(70)}`);
	console.log(`\nDescription: ${testCase.description}`);

	// Build prompt
	let prompt;
	if (testCase.context) {
		prompt = TEMPLATE_WITH_CONTEXT
			.replace('{context_files}', testCase.context)
			.replace('{document}', testCase.document);
	} else {
		prompt = TEMPLATE_SIMPLE.replace('{document}', testCase.document);
	}

	console.log('\n--- Document (before cursor) ---');
	console.log(testCase.document.length > 500
		? testCase.document.substring(0, 500) + '\n...[truncated]...'
		: testCase.document || '(empty)');

	if (testCase.afterCursor) {
		console.log('\n--- Document (after cursor) ---');
		console.log(testCase.afterCursor.length > 300
			? testCase.afterCursor.substring(0, 300) + '\n...[truncated]...'
			: testCase.afterCursor);
	}

	if (testCase.context) {
		console.log('\n--- Context Injected ---');
		console.log(testCase.context.length > 400
			? testCase.context.substring(0, 400) + '\n...[truncated]...'
			: testCase.context);
	}

	try {
		const bedrock = createAmazonBedrock({
			region: CONFIG.region,
			credentialProvider: defaultProvider(),
		});

		console.log('\n--- Calling Bedrock... ---');
		const startTime = Date.now();

		const result = await generateText({
			model: bedrock(CONFIG.model),
			prompt,
			maxOutputTokens: CONFIG.maxOutputTokens,
			temperature: CONFIG.temperature,
		});

		const duration = Date.now() - startTime;

		console.log('\n--- Response ---');
		console.log(`Duration: ${duration}ms`);
		console.log(`Finish reason: ${result.finishReason}`);
		console.log(`Tokens: in=${result.usage?.inputTokens}, out=${result.usage?.outputTokens}`);
		console.log(`\nCompletion:\n${result.text || '(EMPTY)'}`);

		if (!result.text) {
			console.log('\n⚠️  WARNING: Empty response!');
			return { name: testCase.name, success: false, error: 'Empty response' };
		}

		console.log('\n✓ Test passed');
		return { name: testCase.name, success: true, text: result.text, duration };
	} catch (error) {
		console.log('\n--- Error ---');
		console.log(error.message);
		console.log('\n✗ Test failed');
		return { name: testCase.name, success: false, error: error.message };
	}
}

async function main() {
	console.log('Complementry Test Runner');
	console.log(`Model: ${CONFIG.model}`);
	console.log(`Region: ${CONFIG.region}`);
	console.log(`Max tokens: ${CONFIG.maxOutputTokens}`);

	// Get test directories
	const specificTest = process.argv[2];
	let testDirs;

	if (specificTest) {
		testDirs = [specificTest];
	} else {
		testDirs = fs.readdirSync(TESTS_DIR)
			.filter(f => {
				const fullPath = path.join(TESTS_DIR, f);
				return fs.statSync(fullPath).isDirectory() &&
					   fs.existsSync(path.join(fullPath, 'test.md'));
			});
	}

	console.log(`\nFound ${testDirs.length} test(s): ${testDirs.join(', ')}`);

	const results = [];

	for (const testDir of testDirs) {
		const testCase = loadTestCase(testDir);
		if (testCase) {
			const result = await runTest(testCase);
			results.push(result);
		} else {
			console.log(`\nSkipping ${testDir}: No test.md found`);
		}
	}

	// Summary
	console.log('\n' + '='.repeat(70));
	console.log('SUMMARY');
	console.log('='.repeat(70));

	for (const r of results) {
		const status = r.success ? '✓' : '✗';
		const info = r.success
			? `${r.duration}ms, ${r.text?.length} chars`
			: r.error;
		console.log(`${status} ${r.name}: ${info}`);
	}

	const passed = results.filter(r => r.success).length;
	console.log(`\n${passed}/${results.length} tests passed`);

	process.exit(passed === results.length ? 0 : 1);
}

main();
