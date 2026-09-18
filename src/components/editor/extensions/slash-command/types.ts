import { MenuOption } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import type { LexicalEditor } from 'lexical'
import type { ComponentType } from 'react'

export type SlashCommandIcon = ComponentType<{ className?: string }>

export interface SlashCommandConfig {
  title: string
  description?: string
  Icon?: SlashCommandIcon
  category?: string
  keywords?: string[]
  onSelect: (editor: LexicalEditor) => void
}

export class SlashCommandOption extends MenuOption {
  declare title: string
  Icon?: SlashCommandIcon
  description?: string
  category: string
  keywords: string[]
  run: (editor: LexicalEditor) => void

  constructor(key: string, config: SlashCommandConfig) {
    super(key)
    this.title = config.title
    this.description = config.description
    this.Icon = config.Icon
    this.category = config.category ?? 'Basic'
    this.keywords = config.keywords ?? []
    this.run = config.onSelect
  }
}
