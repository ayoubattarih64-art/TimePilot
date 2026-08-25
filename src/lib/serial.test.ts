import { describe, expect, it } from 'vitest'
import { createSerialQueue } from './serial'

/**
 * The queue exists to stop two read-modify-write pairs from interleaving, so
 * these tests are about ordering and isolation rather than results: does a
 * second operation wait, does a rejection let the queue continue, and does each
 * caller still get its own outcome.
 */

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

describe('createSerialQueue', () => {
  it('runs one operation at a time, in call order', async () => {
    const serialize = createSerialQueue()
    const events: string[] = []

    const slow = serialize(async () => {
      events.push('a:start')
      await tick(20)
      events.push('a:end')
    })
    const fast = serialize(async () => {
      events.push('b:start')
      events.push('b:end')
    })

    await Promise.all([slow, fast])
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  it('keeps a read-modify-write pair atomic', async () => {
    const serialize = createSerialQueue()
    let store = [0]

    // The exact shape of every storage mutation in the worker.
    const append = (value: number) =>
      serialize(async () => {
        const read = store
        await tick(5)
        store = [...read, value]
      })

    await Promise.all([append(1), append(2), append(3)])
    expect(store).toEqual([0, 1, 2, 3])
  })

  it('returns each caller its own value', async () => {
    const serialize = createSerialQueue()
    const results = await Promise.all([
      serialize(async () => {
        await tick(5)
        return 'first'
      }),
      serialize(() => Promise.resolve('second')),
    ])
    expect(results).toEqual(['first', 'second'])
  })

  it('surfaces a rejection to its own caller only', async () => {
    const serialize = createSerialQueue()
    const failing = serialize(() => Promise.reject(new Error('boom')))
    const following = serialize(() => Promise.resolve('ok'))

    await expect(failing).rejects.toThrow('boom')
    await expect(following).resolves.toBe('ok')
  })

  it('does not stall after a rejection', async () => {
    const serialize = createSerialQueue()
    const order: string[] = []

    const failing = serialize(async () => {
      order.push('fail')
      await tick(5)
      throw new Error('boom')
    })
    const after = serialize(() => {
      order.push('after')
      return Promise.resolve()
    })

    await failing.catch(() => undefined)
    await after
    expect(order).toEqual(['fail', 'after'])
  })

  it('isolates separate queues from each other', async () => {
    const a = createSerialQueue()
    const b = createSerialQueue()
    const events: string[] = []

    const first = a(async () => {
      events.push('a:start')
      await tick(20)
      events.push('a:end')
    })
    const second = b(() => {
      events.push('b')
      return Promise.resolve()
    })

    await Promise.all([first, second])
    // b did not wait for a: its event lands inside a's window.
    expect(events).toEqual(['a:start', 'b', 'a:end'])
  })
})
