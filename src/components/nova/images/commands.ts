import { createCommand } from 'lexical'
import type { LexicalCommand, NodeKey } from 'lexical'

export const INSERT_IMAGE_COMMAND: LexicalCommand<void> =
  createCommand('INSERT_IMAGE')
export const INSERT_IMAGE_FILES_COMMAND: LexicalCommand<File[]> =
  createCommand('INSERT_IMAGE_FILES')
export const REPLACE_IMAGE_COMMAND: LexicalCommand<NodeKey> =
  createCommand('REPLACE_IMAGE')
