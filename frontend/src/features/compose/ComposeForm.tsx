'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronDown, Clock } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useApi } from '@/hooks/useApi';
import { api, ApiError } from '@/lib/api';
import { formatShort, plural, windowName } from '@/lib/format';
import type { CampaignInput, CampaignPreview, CreateCampaignResult, Sender } from '@/types/api';
import { RecipientInput } from './RecipientInput';
import { RichTextEditor, type EditorValue } from './RichTextEditor';
import { SendLaterPopover } from './SendLaterPopover';

type Errors = Partial<
  Record<'sender' | 'recipients' | 'subject' | 'body' | 'delay' | 'hourly', string>
>;

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-2.5 sm:flex-row sm:items-start sm:gap-4">
      <label htmlFor={htmlFor} className="pt-2 text-[13px] text-ink/80 sm:w-16 sm:shrink-0">
        {label}
      </label>
      <div className="min-w-0 flex-1">
        {children}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}

export function ComposeForm() {
  const router = useRouter();
  const toast = useToast();
  const { data: senders, loading: sendersLoading } = useApi<{ items: Sender[] }>('/api/senders');

  const [chosenSenderId, setSenderId] = useState<number | null>(null);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState<EditorValue>({ html: '', text: '' });
  const [delaySec, setDelaySec] = useState('');
  const [hourlyLimit, setHourlyLimit] = useState('');
  const [startAt, setStartAt] = useState<Date | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const submitted = useRef(false);
  // One key per email being composed: a retried or double-clicked Schedule
  // returns the same campaign instead of creating a second one.
  const idempotencyKey = useRef(newKey());

  // Until the user picks one, the first sender is selected.
  const senderId = chosenSenderId ?? senders?.items[0]?.id ?? null;
  const sender = senders?.items.find((s) => s.id === senderId) ?? null;
  const windowOf = (s: Sender) =>
    s.usage
      ? windowName(new Date(s.usage.windowEnd).getTime() - new Date(s.usage.windowStart).getTime())
      : 'hour';

  const dirty = recipients.length > 0 || subject.trim() !== '' || body.text !== '';
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (!submitted.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const delayMs = Math.round((Number(delaySec) || 0) * 1000);
  const limit = Number(hourlyLimit) || sender?.hourlyLimit || 1;

  function validate(): Errors {
    const next: Errors = {};
    if (!senderId) next.sender = 'Choose who the email is from.';
    if (recipients.length === 0) next.recipients = 'Add at least one recipient, or upload a list.';
    if (!subject.trim()) next.subject = 'Add a subject.';
    if (!body.text) next.body = 'Write a message.';
    if (delaySec && (!Number.isFinite(Number(delaySec)) || Number(delaySec) < 0))
      next.delay = 'Use 0 or more seconds.';
    if (hourlyLimit && (!Number.isInteger(Number(hourlyLimit)) || Number(hourlyLimit) < 1))
      next.hourly = 'Use a whole number, 1 or more.';
    return next;
  }

  function openSendLater() {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length) {
      toast({ tone: 'error', title: 'Almost there', description: Object.values(next)[0] });
      return;
    }
    setPopoverOpen(true);
  }

  // Live estimate of when the emails will go out, while the popover is open.
  useEffect(() => {
    if (!popoverOpen || !senderId || recipients.length === 0) return;
    const timer = setTimeout(() => {
      setPreviewLoading(true);
      api<CampaignPreview>('/api/campaigns/preview', {
        method: 'POST',
        body: JSON.stringify({
          senderId,
          count: recipients.length,
          startAt: startAt?.toISOString(),
          delayMs,
          hourlyLimit: limit,
        }),
      })
        .then(setPreview, () => setPreview(null))
        .finally(() => setPreviewLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [popoverOpen, senderId, recipients.length, startAt, delayMs, limit]);

  async function schedule() {
    if (!senderId || submitting) return;
    if (startAt && startAt.getTime() < Date.now() - 60_000) {
      toast({
        tone: 'error',
        title: 'That time has passed',
        description: 'Pick a time in the future, or Send now.',
      });
      return;
    }
    const input: CampaignInput = {
      senderId,
      subject: subject.trim(),
      bodyHtml: body.html,
      bodyText: body.text,
      recipients,
      startAt: startAt?.toISOString(),
      delayMs,
      hourlyLimit: limit,
    };
    setSubmitting(true);
    try {
      const result = await api<CreateCampaignResult>('/api/campaigns', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey.current },
        body: JSON.stringify(input),
      });
      submitted.current = true;
      toast({
        tone: 'success',
        title: `Scheduled ${plural(result.campaign.total, 'email')}`,
        description: `First one ${startAt ? formatShort(result.campaign.startAt) : 'goes out now'}.${
          result.duplicatesRemoved
            ? ` ${plural(result.duplicatesRemoved, 'duplicate')} skipped.`
            : ''
        }`,
      });
      router.push('/scheduled');
    } catch (err) {
      const e = err as ApiError;
      toast({
        tone: 'error',
        title: e.status === 503 ? 'Saved, but not queued yet' : "Couldn't schedule",
        description:
          e.status === 503
            ? 'Press Schedule again in a moment. Nothing will be sent twice.'
            : e.message,
      });
    } finally {
      setSubmitting(false);
    }
  }

  // Ctrl/Cmd + Enter: open Send Later, or schedule if it's already open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (popoverOpen) void schedule();
        else openSendLater();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function leave() {
    if (dirty && !window.confirm('Discard this email?')) return;
    submitted.current = true;
    router.push('/scheduled');
  }

  return (
    <>
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-surface/95 px-3 py-3 backdrop-blur sm:px-5">
        <IconButton label="Back" onClick={leave}>
          <ArrowLeft className="size-4.5" />
        </IconButton>
        <h1 className="flex-1 text-lg text-ink">Compose New Email</h1>
        <div className="relative flex items-center gap-1">
          <IconButton label="Pick a send time" onClick={openSendLater} data-send-later-trigger="">
            <Clock className="size-4 text-brand-600" />
          </IconButton>
          <Button
            variant="outline"
            pill
            size="sm"
            onClick={openSendLater}
            data-send-later-trigger=""
          >
            {startAt ? `Send ${formatShort(startAt.toISOString())}` : 'Send Later'}
          </Button>
          {popoverOpen && (
            <SendLaterPopover
              startAt={startAt}
              onStartAtChange={setStartAt}
              onClose={() => setPopoverOpen(false)}
              onSchedule={() => void schedule()}
              submitting={submitting}
              recipients={recipients.length}
              preview={preview}
              previewLoading={previewLoading || (!preview && recipients.length > 0)}
            />
          )}
        </div>
      </header>

      <form
        className="mx-auto w-full max-w-3xl flex-1 px-4 py-4 sm:px-8"
        onSubmit={(e) => {
          e.preventDefault();
          openSendLater();
        }}
      >
        <Field label="From" htmlFor="compose-from" error={errors.sender}>
          {sendersLoading ? (
            <Skeleton className="h-8 w-60" />
          ) : senders?.items.length ? (
            <div className="relative inline-flex max-w-full">
              <select
                id="compose-from"
                value={senderId ?? ''}
                onChange={(e) => setSenderId(Number(e.target.value))}
                className="h-8 max-w-full appearance-none truncate rounded-md bg-muted pr-8 pl-3 text-[13px] text-ink outline-none focus:ring-2 focus:ring-brand-500/40"
              >
                {senders.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.email}
                    {s.usage ? ` (${s.usage.used}/${s.hourlyLimit} this ${windowOf(s)})` : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-2 right-2.5 size-4 text-ink-muted" />
            </div>
          ) : (
            <p className="pt-1.5 text-[13px] text-red-600">
              No senders yet. Run{' '}
              <code className="rounded bg-muted px-1">npm run seed:senders -w backend</code>.
            </p>
          )}
        </Field>

        <Field label="To" error={errors.recipients}>
          <RecipientInput
            recipients={recipients}
            onChange={(r) => {
              setRecipients(r);
              setErrors((e) => ({ ...e, recipients: undefined }));
            }}
          />
        </Field>

        <Field label="Subject" htmlFor="compose-subject" error={errors.subject}>
          <input
            id="compose-subject"
            value={subject}
            maxLength={255}
            onChange={(e) => {
              setSubject(e.target.value);
              setErrors((x) => ({ ...x, subject: undefined }));
            }}
            placeholder="Subject"
            className="h-9 w-full bg-transparent text-[13px] outline-none placeholder:text-ink-muted"
          />
        </Field>

        <div className="flex flex-wrap items-start gap-x-8 gap-y-3 py-3">
          <label className="flex items-center gap-2 text-[13px] text-ink/80">
            Delay between 2 emails
            <span className="relative">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={delaySec}
                onChange={(e) => setDelaySec(e.target.value)}
                placeholder="00"
                aria-describedby="delay-help"
                className="h-8 w-20 rounded-md border border-border px-2 pr-6 text-[13px] outline-none focus:border-brand-500"
              />
              <span className="pointer-events-none absolute top-1.5 right-2 text-xs text-ink-muted">
                s
              </span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink/80">
            Hourly Limit
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(e.target.value)}
              placeholder={sender ? String(sender.hourlyLimit) : '00'}
              aria-describedby="delay-help"
              className="h-8 w-20 rounded-md border border-border px-2 text-[13px] outline-none focus:border-brand-500"
            />
          </label>
          <p id="delay-help" className="w-full text-xs text-ink-muted">
            {errors.delay ?? errors.hourly ?? (
              <>
                At least 2 s between emails from the same sender
                {sender &&
                  `, and at most ${sender.hourlyLimit.toLocaleString()} per ${windowOf(sender)} from ${sender.email}`}
                .
              </>
            )}
          </p>
        </div>

        <RichTextEditor
          invalid={!!errors.body}
          onChange={(value) => {
            setBody(value);
            setErrors((e) => ({ ...e, body: undefined }));
          }}
        />
        {errors.body && <p className="mt-1 text-xs text-red-600">{errors.body}</p>}

        <p className="mt-3 text-xs text-ink-muted">
          <kbd className="rounded border border-border px-1">Ctrl</kbd> +{' '}
          <kbd className="rounded border border-border px-1">Enter</kbd> to schedule
        </p>
      </form>
    </>
  );
}
