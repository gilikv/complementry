# Test: List Completion

## Purpose
Test completion when cursor is in the middle of a numbered list.

## Expected Behavior
- Should continue the numbered list (starting with item 4)
- Should maintain the established format: `N. **Name**: Question?`
- Should add relevant code review items
- Should not break the list structure

## Cursor Position
End of line 4, after "4. "

## Notes
This tests list continuation which is a common completion scenario.
The completion should understand both the numbering and the formatting pattern.
