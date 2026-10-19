import { describe, expect, it } from 'vitest'
import {
  ANONYMOUS,
  canModifyTestimonial,
  canReadTestimonial,
  isAuthenticated,
  ownsBusiness,
  userActor,
  visibleTestimonials,
} from '../server/policies.js'

const businessA = { id: 'biz_a', ownerId: 'usr_a' }
const businessB = { id: 'biz_b', ownerId: 'usr_b' }

const pendingA = { id: 't1', businessId: 'biz_a', status: 'pending' }
const approvedA = { id: 't2', businessId: 'biz_a', status: 'approved' }
const rejectedA = { id: 't3', businessId: 'biz_a', status: 'rejected' }
const approvedB = { id: 't4', businessId: 'biz_b', status: 'approved' }

const ownerA = userActor({ id: 'usr_a' })
const ownerB = userActor({ id: 'usr_b' })

describe('actor helpers', () => {
  it('treats only a real user actor as authenticated', () => {
    expect(isAuthenticated(ANONYMOUS)).toBe(false)
    expect(isAuthenticated(ownerA)).toBe(true)
    expect(isAuthenticated(null)).toBe(false)
  })

  it('matches ownership by owner id', () => {
    expect(ownsBusiness(ownerA, businessA)).toBe(true)
    expect(ownsBusiness(ownerB, businessA)).toBe(false)
    expect(ownsBusiness(ANONYMOUS, businessA)).toBe(false)
    expect(ownsBusiness(ownerA, null)).toBe(false)
  })
})

describe('testimonial read policy', () => {
  it('lets anyone read approved testimonials', () => {
    expect(canReadTestimonial(ANONYMOUS, approvedA, businessA)).toBe(true)
    expect(canReadTestimonial(ANONYMOUS, approvedB, businessB)).toBe(true)
  })

  it('hides unpublished testimonials from visitors', () => {
    expect(canReadTestimonial(ANONYMOUS, pendingA, businessA)).toBe(false)
    expect(canReadTestimonial(ANONYMOUS, rejectedA, businessA)).toBe(false)
  })

  it('lets the owner read their own queue but not another tenant’s', () => {
    expect(canReadTestimonial(ownerA, pendingA, businessA)).toBe(true)
    expect(canReadTestimonial(ownerA, rejectedA, businessA)).toBe(true)
    expect(canReadTestimonial(ownerB, pendingA, businessA)).toBe(false)
  })

  it('filters a mixed list down to the permitted rows', () => {
    const all = [pendingA, approvedA, rejectedA, approvedB]
    // A visitor sees every approved row, whichever business it belongs to.
    expect(visibleTestimonials(ANONYMOUS, all, businessA).map((row) => row.id)).toEqual(['t2', 't4'])
    expect(visibleTestimonials(ownerA, all, businessA).map((row) => row.id)).toEqual([
      't1',
      't2',
      't3',
      't4',
    ])
  })
})

describe('testimonial write policy', () => {
  it('allows the owner and blocks everyone else', () => {
    expect(canModifyTestimonial(ownerA, pendingA, businessA)).toBe(true)
    expect(canModifyTestimonial(ownerB, pendingA, businessA)).toBe(false)
    expect(canModifyTestimonial(ANONYMOUS, pendingA, businessA)).toBe(false)
  })

  it('refuses a row that claims a business it does not belong to', () => {
    const spoofed = { id: 't5', businessId: 'biz_b', status: 'pending' }
    expect(canModifyTestimonial(ownerA, spoofed, businessA)).toBe(false)
  })

  it('refuses when the business row is gone', () => {
    expect(canModifyTestimonial(ownerA, pendingA, null)).toBe(false)
  })
})
