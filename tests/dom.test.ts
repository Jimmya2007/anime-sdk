import { describe, it, expect } from 'vitest';
import { DomRegistry, BrowserDomParser } from '../src/transport/dom.js';
import { IDomParser, IDomElement } from '../src/types/index.js';

class MockElement implements IDomElement {
  constructor(public text: string) {}
  querySelector(selector: string): IDomElement | null {
    if (selector === 'span') return new MockElement('inner');
    return null;
  }
  querySelectorAll(selector: string): IDomElement[] {
    if (selector === 'div') return [new MockElement('div1'), new MockElement('div2')];
    return [];
  }
  getAttribute(name: string): string | null {
    return `mock-${name}`;
  }
  get textContent() {
    return this.text;
  }
  get outerHTML() {
    return `<div>${this.text}</div>`;
  }
  get innerHTML() {
    return this.text;
  }
}

class MockParser implements IDomParser {
  parse(html: string): IDomElement {
    return new MockElement(html);
  }
}

describe('DOM Registry and Parsers', () => {
  it('should throw an error in Node.js environment when using default BrowserDomParser', () => {
    const parser = new BrowserDomParser();
    expect(() => parser.parse('<div>hello</div>')).toThrow(
      /DOMParser is not available/
    );
  });

  it('should successfully register and use a custom DOM parser', () => {
    DomRegistry.register(new MockParser());
    
    const root = DomRegistry.parse('my-html-content');
    expect(root.textContent).toBe('my-html-content');
    expect(root.getAttribute('class')).toBe('mock-class');
    
    const child = root.querySelector('span');
    expect(child).not.toBeNull();
    expect(child?.textContent).toBe('inner');
    
    const divs = root.querySelectorAll('div');
    expect(divs).toHaveLength(2);
    expect(divs[0].textContent).toBe('div1');
    expect(divs[1].textContent).toBe('div2');
  });
});
