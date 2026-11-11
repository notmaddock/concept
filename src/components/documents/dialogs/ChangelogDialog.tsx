import { Fragment } from 'react'
import changelog from 'virtual:changelog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import type { ChangelogEntry, ChangelogInline } from '#/lib/changelog'
import { APP_VERSION } from '#/version'

export function ChangelogDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>What's new</DialogTitle>
          <DialogDescription>
            Release notes for Concept v{APP_VERSION}.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {changelog.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No release notes yet.
            </p>
          ) : (
            <div className="space-y-6">
              {changelog.map((entry) => (
                <ChangelogEntryView key={entry.version} entry={entry} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ChangelogEntryView({ entry }: { entry: ChangelogEntry }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-base font-medium">v{entry.version}</h3>
        {entry.date && (
          <span className="text-xs text-muted-foreground">{entry.date}</span>
        )}
      </div>
      {entry.sections.map((section, sectionIndex) => (
        <div key={`${section.title}-${sectionIndex}`} className="space-y-1.5">
          <h4 className="text-sm font-medium">{section.title}</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {section.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <InlineNodes nodes={item} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function InlineNodes({ nodes }: { nodes: ChangelogInline[] }) {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={index}>{node.value}</Fragment>
      case 'strong':
        return (
          <strong key={index} className="font-medium text-foreground">
            <InlineNodes nodes={node.children} />
          </strong>
        )
      case 'emphasis':
        return (
          <em key={index}>
            <InlineNodes nodes={node.children} />
          </em>
        )
      case 'code':
        return (
          <code
            key={index}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
          >
            {node.value}
          </code>
        )
      case 'link':
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            <InlineNodes nodes={node.children} />
          </a>
        )
      default:
        return null
    }
  })
}
