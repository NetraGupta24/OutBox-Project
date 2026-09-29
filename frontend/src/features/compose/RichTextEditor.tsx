'use client';

import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Placeholder } from '@tiptap/extensions';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react';
import type { ReactNode } from 'react';

export type EditorValue = { html: string; text: string };

type Props = {
  onChange: (value: EditorValue) => void;
  placeholder?: string;
  invalid?: boolean;
};

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep the editor's selection
      onClick={onClick}
      className={`inline-flex size-7 items-center justify-center rounded text-ink/70 transition-colors hover:bg-border/70 hover:text-ink disabled:opacity-30 ${
        active ? 'bg-border text-ink' : ''
      }`}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />;

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      align: (['center', 'right'] as const).find((a) => e.isActive({ textAlign: a })) ?? 'left',
      size: e.isActive('heading', { level: 2 })
        ? 'large'
        : e.isActive('heading', { level: 3 })
          ? 'medium'
          : 'normal',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      canIndent: e.can().sinkListItem('listItem'),
      canOutdent: e.can().liftListItem('listItem'),
    }),
  });
  const run = () => editor.chain().focus();
  const nextAlign = s.align === 'left' ? 'center' : s.align === 'center' ? 'right' : 'left';
  const AlignIcon =
    s.align === 'center' ? AlignCenter : s.align === 'right' ? AlignRight : AlignLeft;

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 rounded-lg bg-surface px-2 py-1 shadow-xs"
    >
      <ToolButton label="Undo" disabled={!s.canUndo} onClick={() => run().undo().run()}>
        <Undo2 className="size-3.5" />
      </ToolButton>
      <ToolButton label="Redo" disabled={!s.canRedo} onClick={() => run().redo().run()}>
        <Redo2 className="size-3.5" />
      </ToolButton>
      <Divider />
      <select
        aria-label="Text size"
        value={s.size}
        onChange={(e) => {
          const size = e.target.value;
          if (size === 'normal') run().setParagraph().run();
          else
            run()
              .setHeading({ level: size === 'large' ? 2 : 3 })
              .run();
        }}
        className="h-7 rounded bg-transparent px-1 text-xs text-ink/80 outline-none hover:bg-border/70"
      >
        <option value="normal">Normal</option>
        <option value="medium">Medium</option>
        <option value="large">Large</option>
      </select>
      <Divider />
      <ToolButton label="Bold (Ctrl+B)" active={s.bold} onClick={() => run().toggleBold().run()}>
        <Bold className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Italic (Ctrl+I)"
        active={s.italic}
        onClick={() => run().toggleItalic().run()}
      >
        <Italic className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Underline (Ctrl+U)"
        active={s.underline}
        onClick={() => run().toggleUnderline().run()}
      >
        <Underline className="size-3.5" />
      </ToolButton>
      <Divider />
      <ToolButton
        label={`Align ${nextAlign}`}
        active={s.align !== 'left'}
        onClick={() => run().setTextAlign(nextAlign).run()}
      >
        <AlignIcon className="size-3.5" />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Numbered list"
        active={s.ordered}
        onClick={() => run().toggleOrderedList().run()}
      >
        <ListOrdered className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Bulleted list"
        active={s.bullet}
        onClick={() => run().toggleBulletList().run()}
      >
        <List className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Indent"
        disabled={!s.canIndent}
        onClick={() => run().sinkListItem('listItem').run()}
      >
        <IndentIncrease className="size-3.5" />
      </ToolButton>
      <ToolButton
        label="Outdent"
        disabled={!s.canOutdent}
        onClick={() => run().liftListItem('listItem').run()}
      >
        <IndentDecrease className="size-3.5" />
      </ToolButton>
      <ToolButton label="Quote" active={s.quote} onClick={() => run().toggleBlockquote().run()}>
        <Quote className="size-3.5" />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Strikethrough"
        active={s.strike}
        onClick={() => run().toggleStrike().run()}
      >
        <Strikethrough className="size-3.5" />
      </ToolButton>
    </div>
  );
}

export function RichTextEditor({ onChange, placeholder = 'Type your message…', invalid }: Props) {
  const editor = useEditor({
    immediatelyRender: false, // avoid a server/client mismatch in Next.js
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder }),
    ],
    editorProps: {
      attributes: {
        class: 'email-editor min-h-72 px-4 py-3 text-sm leading-relaxed text-ink outline-none',
        'aria-label': 'Message',
      },
    },
    onUpdate: ({ editor: e }) =>
      onChange({ html: e.isEmpty ? '' : e.getHTML(), text: e.getText().trim() }),
  });

  return (
    <div
      className={`rounded-xl bg-muted p-2 ring-1 transition-shadow focus-within:ring-2 focus-within:ring-brand-500/40 ${invalid ? 'ring-red-400' : 'ring-transparent'}`}
    >
      {editor ? <Toolbar editor={editor} /> : <div className="h-9" />}
      <EditorContent editor={editor} />
    </div>
  );
}
