import { ClientOnly } from "@tanstack/react-router";
import { Loader } from "@cloudflare/kumo"

export function Editor() {
    return <ClientOnly fallback={<EditorSSRFallback />}>
        <CSREditor />
    </ClientOnly>
}

function CSREditor() {
  return <span>editor</span>
}

function EditorSSRFallback() {
    return <main className="size-full flex justify-center items-center">
        <div className="flex items-center gap-4">
            <Loader className="text-primary" />
            <span>Loading Concept Editor...</span>
        </div>
    </main>
}
