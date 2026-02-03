# Test: Middle Insertion

## Purpose
Test completion when cursor is in the middle of an existing document, between sections.

## Expected Behavior
- Should understand document structure from content before AND after cursor
- Should fill in the "Key Principles" section appropriately
- Should maintain consistent style with surrounding content
- Should NOT repeat content that appears later in the document

## Cursor Position
After "## Key Principles" heading, before "## Implementation Patterns"

## Notes
The [CURSOR_HERE] marker indicates where the cursor should be placed for testing.
