// SuggestionMenu.tsx
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import type { SuggestionProps } from "@tiptap/suggestion";

export const SuggestionMenu = forwardRef((props: SuggestionProps<any>, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => setSelectedIndex(0), [props.items]);

  const select = (i: number) => props.items[i] && props.command(props.items[i]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === "ArrowDown") { setSelectedIndex(i => (i + 1) % props.items.length); return true; }
      if (event.key === "ArrowUp")   { setSelectedIndex(i => (i - 1 + props.items.length) % props.items.length); return true; }
      if (event.key === "Enter")     { select(selectedIndex); return true; }
      return false;
    },
  }));

  const activeValue = props.items[selectedIndex]?.title;

  return (
    <Command
      className="w-[200px] rounded-md border shadow-md animate-in fade-in-0 zoom-in-95"
      value={activeValue}
      onValueChange={(value) => {
        const i = props.items.findIndex((item: any) => item.title === value);
        if (i !== -1) setSelectedIndex(i);
      }}
    >
      <CommandList>
        <CommandGroup>
          {props.items.map((item: any, i: number) => (
            <CommandItem key={item.title} value={item.title} onSelect={() => select(i)}>
              {item.title}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
});