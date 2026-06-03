#!/usr/bin/env node
// PreToolUse hook: denies Edit/Write/MultiEdit when the content being written
// contains multi-line comments, enforcing the project rule
// "Use comments sparingly... keep them brief and single line."
//
// Heuristics (lenient, to avoid noise):
//  - runs of 2+ consecutive `//`/`///` comment lines are flagged...
//  - ...unless the run starts with a lowercase letter (hand-written) or a lint directive
//  - block comments (`/* */`, `/** */`) spanning 3+ lines are flagged
// Scans only the new content, so pre-existing comments are never flagged.
// Soft block: exits 0 with permissionDecision "deny" so Claude rewrites and retries.

import { readFileSync } from 'node:fs'

const EXTS = new Set(['.ts', '.tsx', '.rs', '.js', '.jsx', '.mjs'])
const MIN_RUN = 2
const MIN_BLOCK_LINES = 3
const MAX_FINDINGS = 20

const directiveRe =
  /^(eslint|oxlint|biome-ignore|prettier-ignore|stylelint|@ts-|ts-|tslint|deno-lint|istanbul|c8|v8|jshint|jscs|global|noinspection|spdx|copyright|@license)/i

const readStdin = () => {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

const ext = (p) => {
  const i = p.lastIndexOf('.')
  return i < 0 ? '' : p.slice(i).toLowerCase()
}

const truncate = (s, n = 64) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const stripSlashes = (line) => line.replace(/^\s*\/\/\/?!?/, '').trim()

// Pull the text about to be written from any of Write/Edit/MultiEdit.
function newContent(input) {
  if (typeof input?.content === 'string') return input.content
  if (typeof input?.new_string === 'string') return input.new_string
  if (Array.isArray(input?.edits)) {
    return input.edits.map((e) => e?.new_string ?? '').join('\n')
  }
  return ''
}

function findViolations(content) {
  const lines = content.split('\n')
  const findings = []

  let i = 0
  while (i < lines.length) {
    const isComment = (l) => /^\s*\/\//.test(l)
    if (!isComment(lines[i])) {
      i++
      continue
    }
    const start = i
    while (i < lines.length && isComment(lines[i])) i++
    const run = lines.slice(start, i)
    const firstText = run.map(stripSlashes).find((t) => t.length > 0) ?? ''
    if (run.length >= MIN_RUN && firstText && /^[A-Z]/.test(firstText) && !directiveRe.test(firstText)) {
      findings.push(`${run.length} stacked comment lines — "${truncate(firstText)}"`)
    }
  }

  let j = 0
  while (j < lines.length) {
    const opensBlock = /^\s*\/\*/.test(lines[j])
    const closesSameLine = /\/\*[\s\S]*\*\//.test(lines[j])
    if (opensBlock && !closesSameLine) {
      const openIdx = j
      let k = j
      while (k < lines.length && !lines[k].includes('*/')) k++
      const span = k - openIdx + 1
      const inner = lines.slice(openIdx, k + 1).join('\n')
      if (span >= MIN_BLOCK_LINES && !/SPDX|Copyright|@license/i.test(inner)) {
        const preview =
          lines[openIdx].replace(/^\s*\/\*\*?/, '').trim() ||
          (lines[openIdx + 1] ?? '').replace(/^\s*\*/, '').trim()
        findings.push(`${span}-line block comment — "${truncate(preview)}"`)
      }
      j = k + 1
      continue
    }
    j++
  }

  return findings
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  )
  process.exit(0)
}

function main() {
  let payload
  try {
    payload = JSON.parse(readStdin())
  } catch {
    process.exit(0)
  }

  const filePath = payload?.tool_input?.file_path
  if (!filePath || !EXTS.has(ext(filePath))) process.exit(0)
  if (filePath.includes('/.claude/') || filePath.includes('/node_modules/')) process.exit(0)

  const findings = findViolations(newContent(payload.tool_input))
  if (findings.length === 0) process.exit(0)

  const shown = findings.slice(0, MAX_FINDINGS)
  const extra = findings.length - shown.length
  const rel = filePath.replace(`${process.env.CLAUDE_PROJECT_DIR ?? ''}/`, '')

  deny(
    [
      `Blocked: the content for ${rel} has multi-line comments, which violate the project rule`,
      `"Use comments sparingly, let the code speak for itself. Keep them brief and single line."`,
      ``,
      ...shown.map((f) => `  - ${f}`),
      extra > 0 ? `  - …and ${extra} more` : null,
      ``,
      `Rewrite each as a single brief line, or drop it where the code is self-evident, then retry.`,
      `Leave alone: comments that start lowercase (hand-written) and "potential improvement" notes.`,
    ]
      .filter((l) => l !== null)
      .join('\n')
  )
}

main()
