import { ClientOnly } from "@tanstack/react-router";
import { Loader } from "@cloudflare/kumo"
import { Tiptap, useEditor } from "@tiptap/react"
import { StarterKit } from "@tiptap/starter-kit"
import { EditorHeader } from "./sub/EditorHeader";
import { EditorToolbar } from "./sub/EditorToolbar";
import { ClickToCursor } from "./extensions/clickToCursor";
import { Placeholder} from "@tiptap/extension-placeholder";

export function Editor() {
    return <ClientOnly fallback={<EditorSSRFallback />}>
        <CSREditor />
    </ClientOnly>
}

function CSREditor() {
    const editor = useEditor({
        extensions: [
            StarterKit,
            ClickToCursor,
            Placeholder.configure({
                placeholder: 'Begin typing or use / for commands...'
            })
        ],
        editorProps: {
            scrollThreshold: { top: 0, bottom: 100, left: 0, right: 0 },
            scrollMargin: { top: 0, bottom: 100, left: 0, right: 0 },
        },
        content: '',
        
    });

    if (!editor) return null;

    return <Tiptap editor={editor}>
        <div className="flex flex-col h-full">
            <EditorHeader />
            <EditorToolbar />
            <main className="flex-1 min-h-0 px-4 pt-4 pb-32 overflow-auto">
                <Tiptap.Content
                    className="bg-popover max-w-5xl mx-auto p-[.6in] rounded-sm shadow-xs min-h-[297mm] min-w-[210mm] cursor-text flex flex-col focus:outline-none outline-none"
                />
            </main>
        </div>
    </Tiptap>
}

function EditorSSRFallback() {
    return <main className="size-full flex justify-center items-center">
        <div className="flex items-center gap-4">
            <Loader className="text-primary" />
            <span>Loading Concept Editor...</span>
        </div>
    </main>
}