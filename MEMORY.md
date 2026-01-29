# Complementry Memory

Project-specific insights and learnings.

## Architecture Decisions

### Manual Trigger Pattern
**Decision**: Completions are manual-only, no automatic triggering.
**Rationale**: LLM calls are expensive. Users need full control over when to invoke them. This also allows thoughtful prompt customization before each call.

### Per-Document Settings (In-Memory)
**Decision**: Settings are stored per-document in memory, not persisted.
**Rationale**: Start simple. Persistence can be added later via YAML frontmatter in the document itself or a sidecar file.

## Technical Notes

### VS Code Inline Completion API
- Use `InlineCompletionItemProvider` interface
- Register with `vscode.languages.registerInlineCompletionItemProvider`
- Can provide completions programmatically via `editor.action.inlineSuggest.trigger`

### Triggering Completions Programmatically
Pattern: Store completion result, then trigger VS Code's inline suggest:
```typescript
triggerManager.setCompletionResult(documentUri, [item]);
await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
```

## Insights

(Add learnings as the project develops)
