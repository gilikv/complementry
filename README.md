# Complementry

A VS Code extension for enhanced markdown inline completions with LLM support.

## Features

- **Manual Trigger**: Completions only run when you explicitly request them (Cmd+Shift+Space / Ctrl+Shift+Space), giving you full control over costs
- **Custom Prompts**: Define per-document prompt templates to control how the LLM generates completions
- **Context Files**: Add other markdown files as context for more informed completions
- **Per-Document Settings**: Each document can have its own prompt template and context files

## Installation

1. Clone this repository
2. Run `npm install`
3. Press F5 to launch the extension in development mode

## Configuration

Configure in VS Code settings (`Cmd+,`):

- `complementry.apiEndpoint`: Your LLM API endpoint (e.g., OpenAI-compatible API)
- `complementry.apiKey`: API key for authentication
- `complementry.model`: Model to use (default: `gpt-4`)
- `complementry.maxTokens`: Maximum tokens for completion (default: `150`)
- `complementry.defaultPromptTemplate`: Default template for prompts

## Prompt Template Variables

Use these variables in your prompt templates:

- `{document}` - Full document content
- `{before_cursor}` - Text before cursor position
- `{after_cursor}` - Text after cursor position
- `{context_files}` - Content from added context files
- `{cursor}` - Marker for cursor position

## Commands

- `Complementry: Trigger Completion` - Manually trigger a completion (Cmd+Shift+Space)
- `Complementry: Configure Document Settings` - View and modify settings for current document
- `Complementry: Add Context File` - Add markdown files as context
- `Complementry: Remove Context File` - Remove context files
- `Complementry: Set Prompt Template` - Set a custom prompt template for the current document

## Development

```bash
npm install
npm run watch
# Press F5 to launch extension host
```

## License

MIT
