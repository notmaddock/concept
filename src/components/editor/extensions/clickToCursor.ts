import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export interface ClickToCursorOptions {
    /**
     * Additional CSS classes applied to the contenteditable DOM element.
     */
    className: string;
}

/**
 * Fast, high-performance coordinate-to-position resolver:
 * - Uses O(1) DOM bounding rects for first/last elements instead of expensive coordsAtPos scans.
 * - Leverages the browser's native C++ caretPositionFromPoint via posAtCoords.
 * - Completely avoids forcing document-wide layout reflows on large documents.
 */
export function getFastPosFromCoords(
    view: EditorView,
    clientX: number,
    clientY: number
): number | null {
    const doc = view.state.doc;
    if (doc.content.size <= 2) {
        return 1;
    }

    // 1. Above first element: instantaneous DOM check
    const firstChild = view.dom.firstElementChild;
    if (firstChild) {
        const firstRect = firstChild.getBoundingClientRect();
        if (clientY < firstRect.top) {
            return 1;
        }
    }

    // 2. Below last element: instantaneous DOM check
    const lastChild = view.dom.lastElementChild;
    if (lastChild) {
        const lastRect = lastChild.getBoundingClientRect();
        if (clientY > lastRect.bottom) {
            return Math.max(1, doc.content.size - 1);
        }
    }

    // 3. Margin checks vs content area
    const domRect = view.dom.getBoundingClientRect();
    if (clientX < domRect.left) {
        const clampedY = Math.min(Math.max(clientY, domRect.top + 2), domRect.bottom - 2);
        const lineStart = view.posAtCoords({ left: domRect.left + 2, top: clampedY });
        return lineStart ? lineStart.pos : 1;
    }

    if (clientX > domRect.right) {
        const clampedY = Math.min(Math.max(clientY, domRect.top + 2), domRect.bottom - 2);
        const lineEnd = view.posAtCoords({ left: domRect.right - 2, top: clampedY });
        return lineEnd ? lineEnd.pos : Math.max(1, doc.content.size - 1);
    }

    // 4. Within bounds: query native caret point
    const clampedY = Math.min(Math.max(clientY, domRect.top + 2), domRect.bottom - 2);
    const hit = view.posAtCoords({ left: clientX, top: clampedY });
    return hit ? hit.pos : Math.max(1, doc.content.size - 1);
}

export function syncDOMSelection(view: EditorView, from: number, to: number): void {
    try {
        const sel = window.getSelection();
        if (!sel) return;
        const anchor = view.domAtPos(from);
        const head = view.domAtPos(to);
        if (anchor?.node && head?.node) {
            sel.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
        }
    } catch {
        // Ignore if DOM positions are transiently unmapped
    }
}

export const ClickToCursor = Extension.create<ClickToCursorOptions>({
    name: "clickToCursor",

    addOptions() {
        return {
            className: "focus:outline-none outline-none min-h-full flex-1",
        };
    },

    addProseMirrorPlugins() {
        const editor = this.editor;
        const className = this.options.className;

        return [
            new Plugin({
                key: new PluginKey("clickToCursor"),
                props: {
                    attributes: {
                        class: className,
                    },
                },
                view(editorView) {
                    let currentContainer: HTMLElement | null = null;
                    let rafId: number | null = null;

                    const setupDrag = (startPos: number, startX: number, startY: number) => {
                        let lastPos = startPos;
                        let latestX = startX;
                        let latestY = startY;
                        let hasDragged = false;

                        // Clear ProseMirror's LeftMouseDown so it doesn't suppress DOM selection sync during drag
                        const inputState = (editorView as any).input;
                        if (inputState?.mouseDown) {
                            try {
                                inputState.mouseDown.done();
                            } catch {
                                // Ignore
                            }
                        }

                        const updateSelection = (currentPos: number) => {
                            if (currentPos === lastPos) return;
                            lastPos = currentPos;
                            editor.commands.setTextSelection({ from: startPos, to: currentPos });
                            syncDOMSelection(editorView, startPos, currentPos);
                        };

                        const onMouseMove = (moveEvent: MouseEvent) => {
                            if (moveEvent.buttons === 0) {
                                onMouseUp(moveEvent);
                                return;
                            }

                            latestX = moveEvent.clientX;
                            latestY = moveEvent.clientY;

                            if (!hasDragged) {
                                if (Math.hypot(latestX - startX, latestY - startY) < 4) {
                                    return;
                                }
                                hasDragged = true;
                            }

                            if (rafId !== null) return;
                            rafId = requestAnimationFrame(() => {
                                rafId = null;
                                const currentPos = getFastPosFromCoords(editorView, latestX, latestY);
                                if (currentPos !== null) {
                                    updateSelection(currentPos);
                                }
                            });
                        };

                        const onMouseUp = (upEvent: MouseEvent) => {
                            if (rafId !== null) {
                                cancelAnimationFrame(rafId);
                                rafId = null;
                            }
                            window.removeEventListener("mousemove", onMouseMove);
                            window.removeEventListener("mouseup", onMouseUp);

                            if (hasDragged) {
                                const finalPos = getFastPosFromCoords(editorView, upEvent.clientX, upEvent.clientY);
                                if (finalPos !== null) {
                                    updateSelection(finalPos);
                                }
                            }
                        };

                        window.addEventListener("mousemove", onMouseMove);
                        window.addEventListener("mouseup", onMouseUp);
                    };

                    const handleMouseDown = (e: MouseEvent) => {
                        if (e.button !== 0) return;
                        const view = editorView;
                        const doc = view.state.doc;
                        if (doc.content.size <= 2) {
                            e.preventDefault();
                            editor.chain().focus().setTextSelection(1).run();
                            syncDOMSelection(view, 1, 1);
                            return;
                        }

                        const clientX = e.clientX;
                        const clientY = e.clientY;

                        // 1. Check if clicked above first element (top margin of sheet)
                        const firstChild = view.dom.firstElementChild;
                        if (firstChild) {
                            const firstRect = firstChild.getBoundingClientRect();
                            if (clientY < firstRect.top) {
                                e.preventDefault();
                                editor.chain().focus().setTextSelection(1).run();
                                syncDOMSelection(view, 1, 1);
                                setupDrag(1, clientX, clientY);
                                return;
                            }
                        }

                        // 2. Check if clicked below last element (empty sheet area below document)
                        const lastChild = view.dom.lastElementChild;
                        if (lastChild) {
                            const lastRect = lastChild.getBoundingClientRect();
                            if (clientY > lastRect.bottom) {
                                const endPos = Math.max(1, doc.content.size - 1);
                                e.preventDefault();
                                editor.chain().focus().setTextSelection(endPos).run();
                                syncDOMSelection(view, endPos, endPos);
                                setupDrag(endPos, clientX, clientY);
                                return;
                            }
                        }

                        // 3. Margin clicks (left/right of content area)
                        const domRect = view.dom.getBoundingClientRect();
                        if (clientX < domRect.left) {
                            const clampedY = Math.min(Math.max(clientY, domRect.top + 2), domRect.bottom - 2);
                            const lineStart = view.posAtCoords({ left: domRect.left + 2, top: clampedY });
                            const targetPos = lineStart ? lineStart.pos : 1;
                            e.preventDefault();
                            editor.chain().focus().setTextSelection(targetPos).run();
                            syncDOMSelection(view, targetPos, targetPos);
                            setupDrag(targetPos, clientX, clientY);
                            return;
                        }

                        if (clientX > domRect.right) {
                            const clampedY = Math.min(Math.max(clientY, domRect.top + 2), domRect.bottom - 2);
                            const lineEnd = view.posAtCoords({ left: domRect.right - 2, top: clampedY });
                            const targetPos = lineEnd ? lineEnd.pos : Math.max(1, doc.content.size - 1);
                            e.preventDefault();
                            editor.chain().focus().setTextSelection(targetPos).run();
                            syncDOMSelection(view, targetPos, targetPos);
                            setupDrag(targetPos, clientX, clientY);
                            return;
                        }

                        // 4. Click is inside the active content bounds (between firstRect.top and lastRect.bottom,
                        // and horizontally inside view.dom).
                        // Let ProseMirror and the browser natively handle clicking, dragging,
                        // double-clicking to select words, and triple-clicking to select paragraphs.
                        return;
                    };

                    const attach = () => {
                        const container = editorView.dom.parentElement || editorView.dom;
                        if (container && container !== currentContainer) {
                            if (currentContainer) {
                                currentContainer.removeEventListener("mousedown", handleMouseDown);
                            }
                            currentContainer = container;
                            currentContainer.addEventListener("mousedown", handleMouseDown);
                        }
                    };

                    attach();

                    // Efficient one-time poll for container attachment after React mounts Tiptap.Content
                    let attempts = 0;
                    const intervalId = setInterval(() => {
                        attach();
                        attempts++;
                        if (currentContainer !== editorView.dom || attempts > 10) {
                            clearInterval(intervalId);
                        }
                    }, 50);

                    return {
                        destroy() {
                            clearInterval(intervalId);
                            if (rafId !== null) {
                                cancelAnimationFrame(rafId);
                            }
                            if (currentContainer) {
                                currentContainer.removeEventListener("mousedown", handleMouseDown);
                            }
                        },
                    };
                },
            }),
        ];
    },
});
