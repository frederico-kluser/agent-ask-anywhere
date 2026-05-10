export const HOST_ID = 'aaa-recorder-host';

export class Overlay {
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private highlight: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement | null = null;

  mount(): void {
    if (this.host) return;
    this.host = document.createElement('div');
    this.host.id = HOST_ID;
    this.host.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;';
    document.documentElement.appendChild(this.host);
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <style>
        :host { all: initial; }
        .highlight {
          position: fixed; pointer-events: none;
          border: 2px solid #ff3e00;
          background: rgba(255, 62, 0, 0.1);
          box-sizing: border-box;
          transition: top 60ms ease-out, left 60ms ease-out, width 60ms ease-out, height 60ms ease-out;
          display: none;
        }
        .tooltip {
          position: fixed; pointer-events: none;
          background: #1e1e1e; color: #fff;
          padding: 6px 10px; border-radius: 4px;
          font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
          max-width: 600px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          display: none;
        }
        .tooltip b { color: #ff8a4f; font-weight: 600; }
        .badge {
          position: fixed; top: 12px; right: 12px;
          background: #ff3e00; color: #fff;
          padding: 4px 10px; border-radius: 999px;
          font: 600 11px/1 ui-sans-serif, system-ui, -apple-system, sans-serif;
          box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          animation: aaa-pulse 1.6s ease-in-out infinite;
        }
        @keyframes aaa-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.06); opacity: 0.85; }
        }
      </style>
      <div class="badge">● REC</div>
      <div class="highlight"></div>
      <div class="tooltip"></div>
    `;
    while (wrapper.firstChild) this.shadow.appendChild(wrapper.firstChild);
    this.highlight = this.shadow.querySelector('.highlight');
    this.tooltip = this.shadow.querySelector('.tooltip');
  }

  unmount(): void {
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.highlight = null;
    this.tooltip = null;
  }

  update(rect: DOMRect, html: string): void {
    if (!this.highlight || !this.tooltip) return;
    this.highlight.style.display = 'block';
    this.highlight.style.top = `${rect.top}px`;
    this.highlight.style.left = `${rect.left}px`;
    this.highlight.style.width = `${rect.width}px`;
    this.highlight.style.height = `${rect.height}px`;
    this.tooltip.style.display = 'block';
    this.tooltip.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 50)}px`;
    this.tooltip.style.left = `${Math.max(0, rect.left)}px`;
    this.tooltip.innerHTML = html;
  }

  hide(): void {
    if (this.highlight) this.highlight.style.display = 'none';
    if (this.tooltip) this.tooltip.style.display = 'none';
  }
}
