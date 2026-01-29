# Complementry Project Protocol

**Type**: VS Code Extension
**Theme**: AI Tools
**Parent**: [HQ Workspace](../../AGENTS.md)

## Project Overview

Complementry is a VS Code extension that provides enhanced markdown inline completions with LLM support. Key differentiators:

- Manual trigger only (cost control)
- Customizable prompts per document
- Context file support for multi-file awareness

## Architecture

```
src/
├── extension.ts          # Main entry point, command registration
└── (future modules)
    ├── settings.ts       # DocumentSettingsManager
    ├── llm.ts            # LLM API service
    ├── prompt.ts         # PromptBuilder
    └── provider.ts       # InlineCompletionProvider
```

## Development

```bash
npm install
npm run watch
# F5 to launch extension host
```

## Key Concepts

### Per-Document Settings
Each markdown document can have:
- Custom prompt template
- List of context files (other markdown docs)
- Settings are stored in memory (not persisted yet)

### Prompt Templates
Variables available:
- `{document}` - Full document
- `{before_cursor}` - Text before cursor
- `{after_cursor}` - Text after cursor
- `{context_files}` - Content from context files

### Manual Trigger Pattern
Completions are triggered via command, not automatic. This:
1. Saves API costs
2. Gives user control over when to call LLM
3. Allows review before accepting

## Roadmap

- [ ] Persist settings (YAML frontmatter or .complementry.json)
- [ ] Multiple LLM provider support (Anthropic, local)
- [ ] Streaming completions
- [ ] Completion history/caching
- [ ] Better prompt editor UI

## Context

For HQ-level patterns and conventions, see [HQ AGENTS.md](../../AGENTS.md).
