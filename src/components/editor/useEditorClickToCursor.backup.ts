import { useCallback } from "react";
import type { Editor } from "@tiptap/react";

/**
 * Calculates the target document position for a click at (clientX, clientY),
 * mimicking Google Docs line-aware positioning:
 * - If above the first line: start of document.
 * - If below the last line: end of document.
 * - If to the left of a line: start of that line.
 * - If to the right of a line: end of that line.
 * - If on an empty line: that empty line.
 * - If directly on text: the exact character position.
 */
export function getTargetPosFromCoords(
    editor: Editor,
    clientX: number,
    clientY: number
): number | null {
    const { view } = editor;
    if (!view) return null;
    const doc = view.state.doc;

    if (doc.content.size <= 2) {
        return 1;
    }

    const firstPos = 1;
    const lastPos = Math.max(1, doc.content.size - 1);
    const firstCoords = view.coordsAtPos(firstPos);
    const lastCoords = view.coordsAtPos(lastPos);

    // Click above the first line (e.g. in top margin/padding)
    if (clientY < firstCoords.top) {
        return firstPos;
    }

    // Click below the last line (e.g. in empty page area below content)
    if (clientY > lastCoords.bottom) {
        return lastPos;
    }

    const domRect = view.dom.getBoundingClientRect();
    const leftQueryX = Math.min(Math.max(domRect.left + 4, domRect.left + 1), domRect.right - 1);
    const rightQueryX = Math.max(Math.min(domRect.right - 4, domRect.right - 1), domRect.left + 1);
    const clampedY = Math.min(Math.max(clientY, domRect.top + 1), domRect.bottom - 1);

    const lineStart = view.posAtCoords({ left: leftQueryX, top: clampedY });
    const lineEnd = view.posAtCoords({ left: rightQueryX, top: clampedY });

    if (!lineStart || !lineEnd) {
        const fallback = view.posAtCoords({ left: clientX, top: clampedY });
        return fallback ? fallback.pos : lastPos;
    }

    const lineStartCoords = view.coordsAtPos(lineStart.pos);
    const lineEndCoords = view.coordsAtPos(lineEnd.pos);

    // Empty line
    if (lineStart.pos === lineEnd.pos) {
        return lineStart.pos;
    }

    // Click to the left of the line text
    if (clientX < lineStartCoords.left) {
        return lineStart.pos;
    }

    // Click to the right of the line text
    if (clientX > lineEndCoords.left) {
        return lineEnd.pos;
    }

    // Direct click on text
    if (clientY >= lineStartCoords.top && clientY <= lineStartCoords.bottom) {
        const exact = view.posAtCoords({ left: clientX, top: clampedY });
        return exact ? exact.pos : lineEnd.pos;
    }

    // In-between line gaps: choose start or end based on midpoint
    return clientX < (lineStartCoords.left + lineEndCoords.left) / 2
        ? lineStart.pos
        : lineEnd.pos;
}

/**
 * Hook to provide Google Docs-style cursor placement on mousedown,
 * preventing unneeded unfocus/refocus flicker while preserving native text selection.
 */
export function useEditorClickToCursor(editor: Editor | null) {
    const handleMouseDown = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (!editor || e.button !== 0) return;
            const { view } = editor;
            const clientX = e.clientX;
            const clientY = e.clientY;

            // If clicked directly on text inside view.dom, let native ProseMirror handle it
            // so native double-click, triple-click, and text drag-selection work seamlessly.
            if (view.dom.contains(e.target as Node)) {
                const doc = view.state.doc;
                if (doc.content.size > 2) {
                    const firstCoords = view.coordsAtPos(1);
                    const lastCoords = view.coordsAtPos(Math.max(1, doc.content.size - 1));

                    if (clientY >= firstCoords.top && clientY <= lastCoords.bottom) {
                        const domRect = view.dom.getBoundingClientRect();
                        const leftQueryX = Math.min(Math.max(domRect.left + 4, domRect.left + 1), domRect.right - 1);
                        const rightQueryX = Math.max(Math.min(domRect.right - 4, domRect.right - 1), domRect.left + 1);
                        const clampedY = Math.min(Math.max(clientY, domRect.top + 1), domRect.bottom - 1);
                        const lineStart = view.posAtCoords({ left: leftQueryX, top: clampedY });
                        const lineEnd = view.posAtCoords({ left: rightQueryX, top: clampedY });

                        if (lineStart && lineEnd && lineStart.pos !== lineEnd.pos) {
                            const lineStartCoords = view.coordsAtPos(lineStart.pos);
                            const lineEndCoords = view.coordsAtPos(lineEnd.pos);

                            const isVerticallyOnLine = clientY >= lineStartCoords.top && clientY <= lineStartCoords.bottom;
                            const isHorizontallyWithinText = clientX >= lineStartCoords.left && clientX <= lineEndCoords.left;

                            if (isVerticallyOnLine && isHorizontallyWithinText) {
                                return;
                            }
                        }
                    }
                }
            }

            // Not a click on text: prevent blur to avoid unfocus/refocus flicker
            e.preventDefault();

            const targetPos = getTargetPosFromCoords(editor, clientX, clientY);
            if (targetPos === null) return;

            editor.chain().focus().setTextSelection(targetPos).run();

            // Support drag selection originating from whitespace or margins
            const onMouseMove = (moveEvent: MouseEvent) => {
                const currentPos = getTargetPosFromCoords(editor, moveEvent.clientX, moveEvent.clientY);
                if (currentPos !== null && currentPos !== targetPos) {
                    editor.commands.setTextSelection({ from: targetPos, to: currentPos });
                }
            };

            const onMouseUp = () => {
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);
            };

            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        },
        [editor]
    );

    return handleMouseDown;
}

