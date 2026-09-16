import { Extension, ReactRenderer } from "@tiptap/react";
import { Suggestion, type SuggestionOptions } from "@tiptap/suggestion";
import { SuggestionMenu } from "../sub/SuggestionMenu";

export interface SlashCommandItem {
    title: string;
    command: (opts: { editor: any; range: any }) => void;
}

export interface SlashCommandOptions {
    suggestion: Partial<Omit<SuggestionOptions<SlashCommandItem>, "editor">>;
}

const ALL_ITEMS: SlashCommandItem[] = [
    {
        title: "Heading 1",
        command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
    },
    {
        title: "Bullet List",
        command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
];

export const SlashCommand = Extension.create<SlashCommandOptions>({
    name: "slashCommand",

    addOptions() {
        return {
            suggestion: {
                char: "/",
                command: ({ editor, range, props }) => {
                    props.command({ editor, range });
                },
                items: ({ query }) =>
                    ALL_ITEMS.filter((i) => i.title.toLowerCase().includes(query.toLowerCase())),
                render: () => {
                    let component: ReactRenderer<any> | null = null;
                    let unmount: (() => void) | null = null;

                    return {
                        onStart: (props) => {
                            component = new ReactRenderer(SuggestionMenu, {
                                props,
                                editor: props.editor,
                            });

                            unmount = props.mount(component.element);
                        },

                        onUpdate: (props) => {
                            component?.updateProps(props);
                        },

                        onKeyDown: (props) => {
                            if (props.event.key === "Escape") return false;
                            return component?.ref?.onKeyDown(props) ?? false;
                        },

                        onExit: () => {
                            unmount?.();
                            component?.destroy();
                        },
                    };
                },
            },
        };
    },

    addProseMirrorPlugins() {
        return [
            Suggestion({
                editor: this.editor,
                ...this.options.suggestion,
            }),
        ];
    },
});
