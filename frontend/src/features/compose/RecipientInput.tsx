'use client';

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { plural } from '@/lib/format';
import { findEmails, findInvalid, isEmail, mergeRecipients, MAX_RECIPIENTS } from './leads';

const COLLAPSED_CHIPS = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

type Upload = { name: string; found: number; added: number; duplicates: number; invalid: number };

type Props = {
  recipients: string[];
  onChange: (recipients: string[]) => void;
  error?: string;
};

export function RecipientInput({ recipients, onChange, error }: Props) {
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [upload, setUpload] = useState<Upload | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLInputElement>(null);

  function add(emails: string[]) {
    const result = mergeRecipients(recipients, emails);
    onChange(result.list);
    if (result.overLimit)
      toast({
        tone: 'error',
        title: `Only ${MAX_RECIPIENTS.toLocaleString()} recipients per email`,
      });
    return result;
  }

  function commitDraft() {
    const value = draft.trim().replace(/[,;]$/, '');
    if (!value) return;
    if (!isEmail(value)) {
      setDraftError(`"${value}" isn't a valid email address`);
      return;
    }
    add([value.toLowerCase()]);
    setDraft('');
    setDraftError(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (['Enter', ',', ';', ' '].includes(e.key) || (e.key === 'Tab' && draft.trim())) {
      if (draft.trim()) {
        e.preventDefault();
        commitDraft();
      } else if (e.key === 'Enter') {
        e.preventDefault();
      }
    } else if (e.key === 'Backspace' && !draft && recipients.length) {
      onChange(recipients.slice(0, -1));
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    const found = findEmails(text);
    if (found.length > 1 || (found.length === 1 && text.trim() !== found[0])) {
      e.preventDefault();
      const result = add(found);
      toast({ tone: 'success', title: `Added ${plural(result.added, 'address', 'addresses')}` });
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast({
        tone: 'error',
        title: 'File too large',
        description: 'Upload a CSV or text file under 5 MB.',
      });
      return;
    }
    const text = await file.text();
    const found = findEmails(text);
    if (found.length === 0) {
      toast({ tone: 'error', title: `No email addresses found in ${file.name}` });
      return;
    }
    const result = add(found);
    setUpload({
      name: file.name,
      found: found.length,
      added: result.added,
      duplicates: result.duplicates,
      invalid: findInvalid(text).length,
    });
  }

  const visible = expanded ? recipients : recipients.slice(0, COLLAPSED_CHIPS);
  const hidden = recipients.length - visible.length;

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-start gap-2">
        <div
          className={`flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-1.5 py-1 ${expanded ? 'max-h-48 overflow-y-auto' : ''}`}
          onClick={() => textInput.current?.focus()}
        >
          {visible.map((email) => (
            <span
              key={email}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-brand-500/60 bg-brand-50/60 py-0.5 pr-1 pl-2.5 text-xs text-ink"
            >
              <span className="truncate">{email}</span>
              <button
                type="button"
                aria-label={`Remove ${email}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(recipients.filter((r) => r !== email));
                }}
                className="rounded-full p-0.5 text-ink-muted hover:bg-brand-100 hover:text-ink"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {hidden > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
              className="rounded-full border border-brand-500/60 px-2 py-0.5 text-xs font-medium text-brand-600 hover:bg-brand-50"
            >
              +{hidden.toLocaleString()}
            </button>
          )}
          {expanded && recipients.length > COLLAPSED_CHIPS && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="px-1 text-xs text-ink-muted hover:text-ink"
            >
              Show less
            </button>
          )}
          <input
            ref={textInput}
            type="email"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDraftError(null);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={commitDraft}
            placeholder={recipients.length ? '' : 'recipient@example.com'}
            aria-label="Add recipient"
            aria-invalid={!!(draftError || error)}
            className="h-7 min-w-40 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-muted"
          />
        </div>

        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-brand-600 hover:bg-brand-50"
        >
          <Upload className="size-3.5" />
          Upload List
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {(draftError || error) && <p className="mt-1 text-xs text-red-600">{draftError ?? error}</p>}

      {(recipients.length > 0 || upload) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <span className="font-medium text-ink">{plural(recipients.length, 'recipient')}</span>
          {upload && (
            <span className="inline-flex items-center gap-1">
              <FileText className="size-3.5" />
              {upload.name}: {plural(upload.found, 'email address', 'email addresses')} detected
              {upload.duplicates > 0 && ` · ${plural(upload.duplicates, 'duplicate')} skipped`}
              {upload.invalid > 0 && ` · ${upload.invalid} invalid ignored`}
            </span>
          )}
          {recipients.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onChange([]);
                setUpload(null);
                setExpanded(false);
              }}
              className="hover:text-ink hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
