import { IDomElement, IDomParser } from '../types/index.js';

export class BrowserDomElement implements IDomElement {
  constructor(private element: Element) {}

  public querySelector(selector: string): IDomElement | null {
    const el = this.element.querySelector(selector);
    return el ? new BrowserDomElement(el) : null;
  }

  public querySelectorAll(selector: string): IDomElement[] {
    const els = this.element.querySelectorAll(selector);
    return Array.from(els).map((el) => new BrowserDomElement(el));
  }

  public getAttribute(name: string): string | null {
    return this.element.getAttribute(name);
  }

  public get textContent(): string | null {
    return this.element.textContent;
  }

  public get outerHTML(): string {
    return this.element.outerHTML;
  }

  public get innerHTML(): string {
    return this.element.innerHTML;
  }
}

export class BrowserDomParser implements IDomParser {
  public parse(html: string): IDomElement {
    if (typeof globalThis.DOMParser === 'undefined') {
      throw new Error(
        'DOMParser is not available in this environment. Please register a custom DOM Parser via DomRegistry.register().'
      );
    }
    const parser = new globalThis.DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    // Ensure we start from documentElement or body if needed
    return new BrowserDomElement(doc.documentElement || doc.body);
  }
}

export class DomRegistry {
  private static parser: IDomParser = new BrowserDomParser();

  public static register(customParser: IDomParser): void {
    this.parser = customParser;
  }

  public static getParser(): IDomParser {
    return this.parser;
  }

  public static parse(html: string): IDomElement {
    return this.parser.parse(html);
  }
}
