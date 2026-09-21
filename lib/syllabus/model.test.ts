import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL, extractSyllabus, probeModel, SCHEMA } from './model';

/**
 * The model layer, with no network anywhere.
 *
 * `fetch` is an argument so every case here is a pure function of a canned
 * reply. What is under test is the part that can be wrong on a good day: an
 * unreachable server has to read as ordinary, and a model that satisfies the
 * schema and still talks nonsense has to be caught rather than passed into the
 * grid.
 */

const FALL = { today: '2026-09-21', termStart: '2026-08-17', termEnd: '2026-12-11' };

const reply = (content: unknown) =>
  vi.fn(async () =>
    new Response(JSON.stringify({ message: { content: JSON.stringify(content) } }), {
      status: 200,
    }),
  ) as unknown as typeof fetch;

const options = { endpoint: 'http://localhost:11434', model: DEFAULT_MODEL, window: FALL };

describe('probing for a model', () => {
  it('reports what the server has', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ models: [{ name: 'qwen3.5:4b' }, { name: 'llama3:8b' }] })),
    ) as unknown as typeof fetch;

    expect(await probeModel('http://localhost:11434', fetcher)).toEqual({
      reachable: true,
      models: ['qwen3.5:4b', 'llama3:8b'],
    });
  });

  it('reads a server that is off as ordinary, not as an error', async () => {
    // The normal case. Ollama is supposed to be off most of the time, so this
    // returns quietly rather than throwing and the button simply does not
    // appear.
    const dead = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    expect(await probeModel('http://localhost:11434', dead)).toEqual({
      reachable: false,
      models: [],
    });
  });

  it('reads a non-200 as unreachable', async () => {
    const refused = vi.fn(async () => new Response('', { status: 403 })) as unknown as typeof fetch;
    expect(await probeModel('http://localhost:11434', refused)).toMatchObject({ reachable: false });
  });

  it('tolerates a reply with no model list', async () => {
    const empty = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    expect(await probeModel('http://localhost:11434', empty)).toEqual({
      reachable: true,
      models: [],
    });
  });

  it('does not mind a trailing slash on the endpoint', async () => {
    const fetcher = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    await probeModel('http://localhost:11434/', fetcher);
    expect(vi.mocked(fetcher).mock.calls[0]![0]).toBe('http://localhost:11434/api/tags');
  });
});

describe('extracting a syllabus', () => {
  it('reads items into grid rows', async () => {
    const fetcher = reply({
      items: [
        { title: 'Project 1', due: 'Sep 14', points: 100 },
        { title: 'Midterm Exam', due: 'Oct 20', points: 150 },
      ],
    });

    const out = await extractSyllabus('anything', options, fetcher);
    expect(out).toEqual({
      rows: [
        { title: 'Project 1', due: '2026-09-14', points: 100, dueText: 'Sep 14' },
        { title: 'Midterm Exam', due: '2026-10-20', points: 150, dueText: 'Oct 20' },
      ],
    });
  });

  it('resolves the model dates rather than trusting them', async () => {
    // Same resolver a typed date takes, so a bare month and day lands in the
    // term rather than a year out. The model is not trusted with a year.
    const out = await extractSyllabus('x', options, reply({ items: [{ title: 'A', due: 'Sep 14' }] }));
    expect('rows' in out && out.rows[0]!.due).toBe('2026-09-14');
  });

  it('keeps a row whose date it could not read, and shows what was said', async () => {
    const out = await extractSyllabus(
      'x',
      options,
      reply({ items: [{ title: 'Term paper', due: 'sometime in October' }] }),
    );
    // A schema is satisfied by nonsense. The row survives with an empty date so
    // the grid can ask, rather than being dropped or given a made-up day.
    expect('rows' in out && out.rows[0]).toEqual({
      title: 'Term paper',
      due: null,
      points: null,
      dueText: 'sometime in October',
    });
  });

  it('drops an item with no usable title', async () => {
    const out = await extractSyllabus(
      'x',
      options,
      reply({ items: [{ title: '   ' }, { title: 'Real one' }, { due: 'Oct 2' }] }),
    );
    expect('rows' in out && out.rows.map((row) => row.title)).toEqual(['Real one']);
  });

  it('says so when the model is not installed', async () => {
    const missing = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    expect(await extractSyllabus('x', options, missing)).toEqual({
      reason: `${DEFAULT_MODEL} is not installed`,
    });
  });

  it('says so when the server cannot be reached', async () => {
    const dead = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await extractSyllabus('x', options, dead)).toEqual({
      reason: 'could not reach the model',
    });
  });

  it('says so when the reply is not JSON', async () => {
    const chatty = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: 'Sure! Here you go:' } })),
    ) as unknown as typeof fetch;
    expect(await extractSyllabus('x', options, chatty)).toEqual({
      reason: 'the model did not send JSON',
    });
  });

  it('says so when the JSON is the wrong shape', async () => {
    expect(await extractSyllabus('x', options, reply({ assignments: [] }))).toEqual({
      reason: 'the model did not send a list of work',
    });
  });

  it('says so when the envelope is unreadable', async () => {
    const odd = vi.fn(async () => new Response('{"nope":1}')) as unknown as typeof fetch;
    expect(await extractSyllabus('x', options, odd)).toEqual({
      reason: 'the model sent something unreadable',
    });
  });

  it('asks for nothing when there is nothing to read', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(await extractSyllabus('   ', options, fetcher)).toEqual({ rows: [] });
    expect(vi.mocked(fetcher)).not.toHaveBeenCalled();
  });

  it('constrains the reply and does not stream it', async () => {
    const fetcher = reply({ items: [] });
    await extractSyllabus('x', options, fetcher);

    const body = JSON.parse(String(vi.mocked(fetcher).mock.calls[0]![1]!.body));
    expect(body.stream).toBe(false);
    expect(body.format).toEqual(SCHEMA);
    expect(body.model).toBe(DEFAULT_MODEL);
  });
});

describe('what the request asks for', () => {
  it('asks the model to leave memory as soon as it answers', async () => {
    // His standing constraint: run only when needed. Per request rather than
    // through OLLAMA_KEEP_ALIVE, so it holds without anybody configuring a
    // daemon. Verified against a real server: `ollama ps` is empty right after.
    const fetcher = reply({ items: [] });
    await extractSyllabus('x', options, fetcher);

    const body = JSON.parse(String(vi.mocked(fetcher).mock.calls[0]![1]!.body));
    expect(body.keep_alive).toBe(0);
  });

  it('asks for points, which feed the grade projection', async () => {
    const fetcher = reply({ items: [] });
    await extractSyllabus('x', options, fetcher);

    const body = JSON.parse(String(vi.mocked(fetcher).mock.calls[0]![1]!.body));
    expect(body.messages[0].content).toContain('points');
  });
});
