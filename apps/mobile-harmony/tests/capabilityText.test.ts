import { describe, expect, it } from 'vitest';
import {
  capabilityDisplayOffset,
  capabilityText,
  capabilityWireOffset,
  editCapabilityText,
} from '../entry/src/main/ets/common/capabilityText.ets';

const skill = '/skill:web-clipper-09c38990db7a.web-clipper';
const labels = new Map([['web-clipper-09c38990db7a.web-clipper', '网页剪藏']]);

describe('capability names in chat', () => {
  it('uses a localized name when available and strips install namespaces otherwise', () => {
    expect(capabilityText(skill + ' 总结网页', labels).text).toBe('【网页剪藏】 总结网页');
    expect(capabilityText(skill).text).toBe('【Web Clipper】');
    expect(capabilityText('/skill:re', labels, true).text).toBe('/skill:re');
  });

  it('round-trips edits around inline skills and maps the palette cursor to the wire text', () => {
    const wire = skill + ' 总结网页 /';
    const presentation = capabilityText(wire, labels);
    expect(editCapabilityText(wire, presentation, '【网页剪藏】 翻译网页 /')).toBe(skill + ' 翻译网页 /');
    expect(editCapabilityText(wire, presentation, '总结网页 /', 0, '【网页剪藏】 '.length)).toBe('总结网页 /');
    expect(editCapabilityText(wire, presentation, '【网页剪藏】translate 总结网页 /', '【网页剪藏】'.length, '【网页剪藏】'.length))
      .toBe(skill + ' translate 总结网页 /');
    expect(capabilityWireOffset(presentation, presentation.text.length)).toBe(wire.length);
    expect(capabilityDisplayOffset(presentation, skill.length + 1)).toBe('【网页剪藏】 '.length);
  });

  it.each([
    ['Use “My Calendar (calendar-prod)” to help me with:', 'Use “My Calendar” to help me with:'],
    ['请使用「网页工具 (marketplace:web-plugin)」帮我：', '请使用「网页工具」帮我：'],
  ])('hides the internal ID in capability handoff %s', (wire, visible) => {
    const presentation = capabilityText(wire);
    expect(presentation.text).toBe(visible);
    expect(editCapabilityText(wire, presentation, visible + ' Plan next week')).toBe(wire + ' Plan next week');
    expect(editCapabilityText(wire, presentation, 'New prompt')).toBe('New prompt');
    const renamed = visible.replace(/My Calendar|网页工具/, 'Other');
    expect(editCapabilityText(wire, presentation, renamed)).toBe(renamed);
  });

  it('keeps the correct underlying reference when matching labels are adjacent', () => {
    const first = '/skill:first';
    const wire = first + ' /skill:second';
    const shared = new Map([['first', 'Review'], ['second', 'Review']]);
    const presentation = capabilityText(wire, shared);
    expect(editCapabilityText(wire, presentation, '【Review】', '【Review】'.length, presentation.text.length)).toBe(first);
  });
});
