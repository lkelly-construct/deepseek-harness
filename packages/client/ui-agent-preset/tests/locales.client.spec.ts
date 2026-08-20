/** Web-localized copy for the one shipped preset, and file copy for every other row. */

import { describe, expect, it } from 'vitest'
import { en, presetDisplayText, zh } from '../src/client/locales.ts'

const translate = (bundle: typeof en) => (key: keyof typeof en): string => bundle[key]

describe('preset display copy', () => {
  it('localizes the shipped standard preset in English and Chinese', () => {
    const preset = { id: 'standard', trust: 'system' as const, name: 'file name', description: 'file description' }

    expect(presetDisplayText(preset, translate(en)))
      .toEqual({ name: en.presetStandardName, description: en.presetStandardDescription })
    expect(presetDisplayText(preset, translate(zh)))
      .toEqual({ name: zh.presetStandardName, description: zh.presetStandardDescription })
  })

  it('keeps file metadata for user and unknown system presets', () => {
    const fileCopy = { name: '我的标准', description: '团队自己的 preset。' }

    expect(presetDisplayText({ id: 'standard', trust: 'user', ...fileCopy }, translate(en)))
      .toEqual(fileCopy)
    expect(presetDisplayText({ id: 'deployment-extra', trust: 'system', ...fileCopy }, translate(en)))
      .toEqual(fileCopy)
    expect(presetDisplayText({ id: 'bare', trust: 'user' }, translate(en)))
      .toEqual({ name: 'bare' })
  })
})
