/* eslint-disable no-restricted-syntax */
import type { Request } from 'express'

export type MaybeString = string | string[] | undefined

export function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const first = value[0]
    return typeof first === 'string' ? first : undefined
  }
  return undefined
}

export function firstHeader(value: MaybeString): string | undefined {
  return firstString(value)
}

export function firstQuery(value: unknown): string | undefined {
  return firstString(value)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getQuery(req: Request, key: string): string | undefined {
  return firstQuery((req.query as any)?.[key])
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getParam(req: Request, key: string): string | undefined {
  return firstQuery((req.params as any)?.[key])
}
