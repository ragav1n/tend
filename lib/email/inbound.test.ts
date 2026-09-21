import { describe, expect, it } from 'vitest';
import {
  MAX_NOTES,
  addressOf,
  capturePayload,
  messageIdOf,
  notesFrom,
  senderOf,
  stripHtml,
  toCapture,
} from './inbound';

const NOW = new Date('2026-09-21T09:00:00Z');

const mail = (over: Record<string, unknown> = {}) => ({
  type: 'email.received',
  data: {
    email_id: 'msg_abc123',
    from: 'Ragav <ragav@example.com>',
    to: ['tasks@abc.resend.app'],
    subject: 'Read chapter 4',
    ...over,
  },
});

describe('reading an address', () => {
  it('takes the address out of a display name', () => {
    expect(addressOf('Ragav <ragav@example.com>')).toBe('ragav@example.com');
  });

  it('takes a bare address', () => {
    expect(addressOf('ragav@example.com')).toBe('ragav@example.com');
  });

  it('folds the case, since a From header is not consistent about it', () => {
    expect(addressOf('Ragav@Example.COM')).toBe('ragav@example.com');
  });

  it('refuses anything that is not an address', () => {
    expect(addressOf('Ragav')).toBeNull();
    expect(addressOf('')).toBeNull();
    expect(addressOf(undefined)).toBeNull();
    expect(addressOf(42)).toBeNull();
  });

  it('reads the sender and the message id off an event', () => {
    expect(senderOf(mail())).toBe('ragav@example.com');
    expect(messageIdOf(mail())).toBe('msg_abc123');
    expect(messageIdOf(mail({ email_id: '   ' }))).toBeNull();
  });
});

describe('a mail as a task', () => {
  it('takes the subject as the title', () => {
    expect(toCapture(mail(), '', NOW)).toMatchObject({ title: 'Read chapter 4' });
  });

  it('reads the subject as a quick-add line', () => {
    // The same grammar the field uses. Two grammars for one idea is how one of
    // them rots.
    const out = toCapture(mail({ subject: 'Read chapter 4 tomorrow 9am !p1 +cs6035' }), '', NOW);
    expect(out).toMatchObject({
      title: 'Read chapter 4',
      dueDate: '2026-09-22',
      dueTime: '09:00',
      priority: 3,
      courseCode: 'cs6035',
    });
  });

  it('strips the prefixes a mail client adds', () => {
    expect(toCapture(mail({ subject: 'Re: Fwd: Read chapter 4' }), '', NOW)!.title).toBe(
      'Read chapter 4',
    );
  });

  it('refuses a mail with nothing in the subject', () => {
    expect(toCapture(mail({ subject: '' }), 'body', NOW)).toBeNull();
    expect(toCapture(mail({ subject: '   ' }), 'body', NOW)).toBeNull();
    // A subject that is only a date leaves no title behind.
    expect(toCapture(mail({ subject: 'tomorrow' }), '', NOW)).toBeNull();
  });

  it('puts the body in the notes', () => {
    expect(toCapture(mail(), 'Pages 90 to 140.', NOW)!.notes).toBe('Pages 90 to 140.');
  });
});

describe('the body as notes', () => {
  it('cuts a quoted reply chain', () => {
    // Forwarding a thread is the common case, and the history is not the task.
    const body = 'Do this bit.\n\nOn Mon, 21 Sep 2026, someone wrote:\n> the whole thread';
    expect(notesFrom(body, mail())).toBe('Do this bit.');
  });

  it('cuts an Outlook original-message marker', () => {
    const body = 'Do this bit.\n\n-----Original Message-----\nFrom: someone';
    expect(notesFrom(body, mail())).toBe('Do this bit.');
  });

  it('trims a newsletter rather than storing it whole', () => {
    const long = 'x'.repeat(MAX_NOTES + 500);
    const out = notesFrom(long, mail());
    expect(out.length).toBeLessThan(MAX_NOTES + 20);
    expect(out.endsWith('…')).toBe(true);
  });

  it('names attachments rather than linking them', () => {
    // Resend hands back a temporary download URL, and a link that expires in an
    // hour looks like it works until the day you need it.
    const out = notesFrom('See attached.', {
      ...mail(),
      data: { ...mail().data, attachments: [{ filename: 'syllabus.pdf' }, { filename: 'rubric.docx' }] },
    });
    expect(out).toContain('syllabus.pdf');
    expect(out).toContain('rubric.docx');
    expect(out).not.toContain('http');
  });

  it('survives an attachment list of the wrong shape', () => {
    const out = notesFrom('Body', {
      ...mail(),
      data: { ...mail().data, attachments: 'nope' },
    });
    expect(out).toBe('Body');
  });

  it('handles a mail with no body at all', () => {
    expect(notesFrom('', mail())).toBe('');
  });
});

describe('the payload handed to SQL', () => {
  const capture = toCapture(mail({ subject: 'Read chapter 4 tomorrow !p2' }), 'Notes here', NOW)!;

  it('prefixes the identity so a mail cannot collide with a feed import', () => {
    // Two things ride on the prefix: the unique index is shared with calendar
    // imports, and the daily cap counts `mail:%` so an import never eats it.
    expect(capturePayload(capture, 'msg_abc123', null).feed_uid).toBe('mail:msg_abc123');
  });

  it('carries every field the subject parsed', () => {
    // A missing priority files everything as none, silently.
    expect(capturePayload(capture, 'msg_abc123', null)).toMatchObject({
      title: 'Read chapter 4',
      due_date: '2026-09-22',
      priority: 2,
      notes: 'Notes here',
    });
  });

  it('sends an empty course rather than null, which the sentinel expects', () => {
    expect(capturePayload(capture, 'm', null).course_id).toBe('');
    expect(capturePayload(capture, 'm', 'course-1').course_id).toBe('course-1');
  });
});

describe('a mail body written in HTML', () => {
  it('reads as text rather than as markup', () => {
    expect(stripHtml('<p>Read <b>chapter 4</b></p><p>By Friday</p>')).toBe(
      'Read chapter 4\n\nBy Friday',
    );
  });

  it('turns a line break into one', () => {
    expect(stripHtml('one<br>two')).toBe('one\ntwo');
  });

  it('throws away script and style wholesale', () => {
    // Otherwise the note is a stylesheet.
    expect(stripHtml('<style>.a{color:red}</style><p>Real</p>')).toBe('Real');
    expect(stripHtml('<script>alert(1)</script>Real')).toBe('Real');
  });

  it('turns the entities that actually appear back into characters', () => {
    expect(stripHtml('Tom &amp; Jerry &lt;3 &quot;quotes&quot; &#39;and&#39;&nbsp;more')).toBe(
      'Tom & Jerry <3 "quotes" \'and\' more',
    );
  });

  it('collapses the blank lines a template leaves behind', () => {
    expect(stripHtml('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
  });

  it('answers nothing for markup with no words in it', () => {
    expect(stripHtml('<div><span></span></div>')).toBe('');
  });
});
