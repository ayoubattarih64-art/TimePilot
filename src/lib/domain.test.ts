import { describe, expect, it } from 'vitest'
import {
  isNormalizedDomain,
  normalizeDomain,
  normalizeDomains,
} from './domain'

/**
 * Unit tests for domain normalisation.
 *
 * What the user types is untrusted input that becomes part of a network rule,
 * so the tests below are the contract: everything a person would paste reduces
 * to the same bare host, and everything that is not a plain website domain is
 * refused rather than guessed at.
 */

describe('normalizeDomain', () => {
  it('reduces the shapes a person pastes to the bare host', () => {
    expect(normalizeDomain('youtube.com')).toEqual({ ok: true, domain: 'youtube.com' })
    expect(normalizeDomain('  YouTube.COM  ')).toEqual({ ok: true, domain: 'youtube.com' })
    expect(normalizeDomain('www.youtube.com')).toEqual({ ok: true, domain: 'youtube.com' })
    expect(normalizeDomain('m.youtube.com')).toEqual({ ok: true, domain: 'm.youtube.com' })
    expect(normalizeDomain('https://youtube.com')).toEqual({ ok: true, domain: 'youtube.com' })
    expect(normalizeDomain('http://www.youtube.com/watch?v=abc')).toEqual({
      ok: true,
      domain: 'youtube.com',
    })
    expect(normalizeDomain('https://user:pass@youtube.com:8080/path?q=1')).toEqual({
      ok: true,
      domain: 'youtube.com',
    })
    expect(normalizeDomain('youtube.com.')).toEqual({ ok: true, domain: 'youtube.com' })
  })

  it('refuses schemes that are not web requests', () => {
    expect(normalizeDomain('javascript:alert(1)')).toEqual({ ok: false, reason: 'scheme' })
    expect(normalizeDomain('data:text/html,hello')).toEqual({ ok: false, reason: 'scheme' })
    expect(normalizeDomain('chrome://settings')).toEqual({ ok: false, reason: 'scheme' })
    expect(normalizeDomain('file:///etc/hosts')).toEqual({ ok: false, reason: 'scheme' })
  })

  it('refuses things that are not hostnames', () => {
    expect(normalizeDomain('')).toEqual({ ok: false, reason: 'empty' })
    expect(normalizeDomain('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(normalizeDomain('*.youtube.com')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeDomain('not a domain')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeDomain('localhost')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeDomain('192.168.0.1')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeDomain('[::1]')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeDomain('-bad.youtube.com')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeDomain('bad..youtube.com')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeDomain('a'.repeat(300) + '.com')).toEqual({ ok: false, reason: 'too-long' })
  })

  it('recognises its own output', () => {
    expect(isNormalizedDomain('youtube.com')).toBe(true)
    expect(isNormalizedDomain('https://youtube.com')).toBe(false)
    expect(isNormalizedDomain('WWW.youtube.com')).toBe(false)
  })

  it('deduplicates through normalisation when repairing stored lists', () => {
    expect(
      normalizeDomains([
        'youtube.com',
        'https://www.youtube.com',
        'YOUTUBE.COM',
        'instagram.com',
        'not a domain',
        42,
        null,
      ]),
    ).toEqual(['youtube.com', 'instagram.com'])
  })
})
