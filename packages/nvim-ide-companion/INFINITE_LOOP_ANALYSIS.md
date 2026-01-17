# Infinite Loop React State Management Bug Analysis

**Date**: 2026-01-17 **Error Message**: "5 frames rendered while the app was
idle in the past second. This likely indicates severe infinite loop React state
management bugs."

## Root Cause

The Neovim IDE companion is triggering excessive React re-renders in Gemini CLI
due to cursor movement tracking, which the Debug Profiler interprets as an
infinite rendering loop.

## Technical Details

### The Problem Flow

1. **Neovim Cursor Movement** (`lua/gemini/buffers.lua:76-84`)

   ```lua
   vim.api.nvim_create_autocmd('CursorMoved', {
     group = group,
     callback = notify_cursor_moved,
   })

   vim.api.nvim_create_autocmd('CursorMovedI', {
     group = group,
     callback = notify_cursor_moved,
   })
   ```

2. **RPC Notification** (`lua/gemini/buffers.lua:29`)

   ```lua
   vim.rpcnotify(0, 'gemini:cursor_moved', {
     line = pos[1],
     col = pos[2] + 1,
   })
   ```

3. **Context Manager** (`src/context-manager.ts:81-92`)
   - Receives cursor position updates
   - Has 50ms debounce (`fireWithDebounce()` at line 117-124)
   - Fires listener callbacks after debounce

4. **IDE Server** (`src/ide-server.ts:209-212`)
   - Broadcasts context update to all connected clients
   - Sends `ide/contextUpdate` notification

5. **Gemini CLI** (`packages/cli/src/ui/AppContainer.tsx:1149-1153`)

   ```typescript
   useEffect(() => {
     const unsubscribe = ideContextStore.subscribe(setIdeContextState);
     setIdeContextState(ideContextStore.get());
     return unsubscribe;
   }, []);
   ```
   - Subscribes to IDE context changes
   - Calls `setIdeContextState()` on every update
   - **Triggers React re-render**

6. **Debug Profiler Detection**
   (`packages/cli/src/ui/components/DebugProfiler.tsx:108-118`)
   ```typescript
   if (idleInPastSecond >= 5) {
     debugLogger.error(
       `${idleInPastSecond} frames rendered while the app was ` +
         `idle in the past second. This likely indicates severe infinite loop ` +
         `React state management bugs.`,
     );
   }
   ```
   - Detects frames rendered without user actions (keyboard/mouse input)
   - Considers frames "idle" if they occur >500ms away from any action
   - Cursor movements in Neovim are NOT tracked as "actions" by the profiler
   - Therefore: cursor movement → re-render → counted as "idle frame"

### Why This is a Problem

**Scenario**: User scrolls through code in Neovim

- Cursor moves trigger constant RPC notifications
- Even with 50ms debounce, rapid scrolling creates updates every 50ms
- Each update triggers React re-render
- Profiler sees: app idle (no CLI input) + 20 renders/second = infinite loop
  warning

## Comparison with VS Code Companion

VS Code companion has the **exact same pattern**:

```typescript
// packages/vscode-ide-companion/src/open-files-manager.ts:35-42
const selectionWatcher = vscode.window.onDidChangeTextEditorSelection(
  (event) => {
    if (this.isFileUri(event.textEditor.document.uri)) {
      this.updateActiveContext(event.textEditor);
      this.fireWithDebounce(); // Same 50ms debounce
    }
  },
);
```

**Why VS Code doesn't trigger this error:**

- VS Code runs in a different process/window
- User is typing in VS Code terminal (where Gemini CLI runs)
- Terminal keystrokes ARE tracked as actions by the profiler
- Cursor movements in VS Code editor don't affect the profiler's action
  detection

## Why Neovim is Different

**Critical difference**: When running Gemini CLI in a Neovim terminal:

- User is in the SAME editor as Gemini CLI
- Scrolling/navigating Neovim = no stdin input to CLI = no "actions" detected
- Creates the illusion of idle rendering

## Solutions

### Option 1: Increase Debounce Delay (Quick Fix)

**File**: `packages/nvim-ide-companion/src/context-manager.ts:121`

Change from:

```typescript
this.debounceTimer = setTimeout(() => {
  this.listeners.forEach((cb) => cb());
}, 50); // 50ms debounce
```

To:

```typescript
this.debounceTimer = setTimeout(() => {
  this.listeners.forEach((cb) => cb());
}, 300); // 300ms debounce - reduces update frequency
```

**Pros**: Simple one-line change **Cons**: Slower context updates, less
responsive

### Option 2: Throttle Instead of Debounce (Recommended)

**File**: `packages/nvim-ide-companion/src/context-manager.ts`

Replace debounce with throttle:

```typescript
private lastFireTime = 0;
private readonly THROTTLE_MS = 250;

private fireWithThrottle() {
  const now = Date.now();
  if (now - this.lastFireTime < this.THROTTLE_MS) {
    // Schedule a delayed fire if we haven't already
    if (!this.debounceTimer) {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = undefined;
        this.lastFireTime = Date.now();
        this.listeners.forEach((cb) => cb());
      }, this.THROTTLE_MS - (now - this.lastFireTime));
    }
    return;
  }

  this.lastFireTime = now;
  this.listeners.forEach((cb) => cb());
}
```

**Pros**: Guarantees maximum update rate, more predictable **Cons**: More
complex implementation

### Option 3: Only Track Cursor on Active Buffer Changes

**File**: `packages/nvim-ide-companion/lua/gemini/buffers.lua:76-84`

Remove or comment out the `CursorMoved` autocmds:

```lua
-- Don't track every cursor movement, only when changing buffers
-- vim.api.nvim_create_autocmd('CursorMoved', {
--   group = group,
--   callback = notify_cursor_moved,
-- })

-- vim.api.nvim_create_autocmd('CursorMovedI', {
--   group = group,
--   callback = notify_cursor_moved,
-- })
```

Keep only `BufEnter` for cursor position tracking.

**Pros**: Eliminates the problem entirely **Cons**: Less accurate cursor
tracking (only updates on buffer switch)

### Option 4: Disable Cursor Tracking Entirely

**File**: `packages/nvim-ide-companion/src/context-manager.ts`

Comment out cursor tracking:

```typescript
// case 'gemini:cursor_moved':
//   this.handleCursorMoved(args[0]);
//   break;
```

**Pros**: Complete elimination of the issue **Cons**: Gemini won't know cursor
position (may affect some features)

### Option 5: Make Debug Profiler IDE-Aware (Best Long-Term)

**File**: `packages/cli/src/ui/components/DebugProfiler.tsx`

Detect IDE mode and adjust profiler behavior:

```typescript
// Around line 40
reportAction() {
  const now = Date.now();
  if (now - this.lastActionTimestamp > 16) {
    this.actionTimestamps.push(now);
    this.lastActionTimestamp = now;
  }
}

// Add new method
reportIdeActivity() {
  // IDE context updates should be treated as actions
  this.reportAction();
}
```

Then in `AppContainer.tsx:1149-1153`:

```typescript
useEffect(() => {
  const unsubscribe = ideContextStore.subscribe((ctx) => {
    profiler.reportIdeActivity(); // Mark as activity
    setIdeContextState(ctx);
  });
  setIdeContextState(ideContextStore.get());
  return unsubscribe;
}, []);
```

**Pros**: Fixes the root cause, IDE updates count as actions **Cons**: Requires
changes to both profiler and AppContainer

## Recommended Immediate Fix

**Combination of Option 1 + Option 3**:

1. **Increase debounce to 250-300ms** (reduce update frequency)
2. **Remove CursorMoved autocmds** (only track on BufEnter)

This provides accurate file/selection tracking without the cursor movement spam.

### Visual Selection Timing

The visual selection tracking already uses a 500ms timer:

```lua
-- buffers.lua:87-92
local visual_timer = vim.loop.new_timer()
visual_timer:start(500, 500, vim.schedule_wrap(function()
  if vim.fn.mode():match('[vV\22]') then
    notify_visual_changed()
  end
end))
```

This is appropriate and shouldn't cause issues.

## Files to Modify

1. `packages/nvim-ide-companion/src/context-manager.ts` - Increase debounce
   delay
2. `packages/nvim-ide-companion/lua/gemini/buffers.lua` - Remove CursorMoved
   autocmds
3. Optional: `packages/cli/src/ui/components/DebugProfiler.tsx` - Make IDE-aware

## Testing

After implementing fixes:

1. Run `gemini` in Neovim terminal
2. Scroll through a file rapidly
3. Check for infinite loop warning
4. Verify context updates still work (open different files)
5. Test with visual selections

## Additional Notes

- The 50ms debounce matches VS Code companion
- The issue is specific to Neovim because CLI runs in same editor
- This is not a bug in the code, but an interaction between IDE detection and
  profiler logic
- The warning is overly aggressive for IDE integration scenarios
