// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { TextFileChip } from '../src/TextFileChip.tsx'

afterEach(cleanup)

describe('TextFileChip', () => {
  it('renders the file name, media type, and resolved size', () => {
    const view = render(<TextFileChip name="notes.txt" mediaType="text/plain" size="12KB" />)
    expect(view.getByText('notes.txt')).toBeTruthy()
    expect(view.getByText('text/plain · 12KB')).toBeTruthy()
    expect(view.queryByRole('button')).toBeNull()
  })

  it('omits the size separator when no size is resolved', () => {
    const view = render(<TextFileChip name="notes.txt" mediaType="text/plain" size="" />)
    expect(view.getByText('text/plain')).toBeTruthy()
    expect(view.queryByRole('button')).toBeNull()
  })

  it('renders a remove control wired to onRemove with the resolved label', () => {
    const onRemove = vi.fn()
    const view = render(
      <TextFileChip name="notes.txt" mediaType="text/plain" size="12KB" removeLabel="移除文件 notes.txt" onRemove={onRemove} />,
    )
    const button = view.getByRole('button', { name: '移除文件 notes.txt' })
    button.click()
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('omits the remove control without an onRemove callback', () => {
    const view = render(
      <TextFileChip name="notes.txt" mediaType="text/plain" size="12KB" removeLabel="移除文件 notes.txt" />,
    )
    expect(view.queryByRole('button')).toBeNull()
  })
})
