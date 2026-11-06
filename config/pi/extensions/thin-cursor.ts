/**
 * Thin cursor
 *
 * Pi draws the editor cursor as an inverse-video block (`ESC[7m <char> ESC[0m`)
 * on top of the hardware cursor it positions via CURSOR_MARKER. Terminals
 * therefore render both, and the block wins visually.
 *
 * This extension strips only the "set inverse" attribute from the editor's
 * rendered lines, so the cursor cell shows its plain character and the visible
 * cursor comes from the terminal itself (e.g. Ghostty `cursor-style = bar`).
 *
 * Requires the hardware cursor: `"showHardwareCursor": true` in
 * ~/.pi/agent/settings.json, or `PI_HARDWARE_CURSOR=1`. Without it the editor
 * shows no visible cursor at all.
 *
 * Disable by removing this file or renaming it to a non-`.ts` extension.
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";

const INVERSE = "\x1b[7m";

/**
 * Remove the inverse-video prefix of the cursor cell, keeping the character and
 * the trailing reset untouched (visible width stays identical).
 */
function stripCursorBlock(line: string): string {
  const marker = line.indexOf(CURSOR_MARKER);
  const at = line.indexOf(INVERSE, marker >= 0 ? marker : 0);
  if (at < 0) {
    return line;
  }
  return line.slice(0, at) + line.slice(at + INVERSE.length);
}

class ThinCursorEditor extends CustomEditor {
  render(width: number): string[] {
    return super.render(width).map(stripCursorBlock);
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((tui, theme, kb) => new ThinCursorEditor(tui, theme, kb));
  });
}
