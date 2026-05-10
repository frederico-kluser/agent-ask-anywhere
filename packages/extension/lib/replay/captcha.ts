/**
 * Self-contained captcha detector — inject via scripting.executeScript.
 * Returns vendor name when a known challenge is mounted on the page.
 */
export function detectCaptcha(): { detected: boolean; vendor?: string } {
  const probes: Array<{ sel: string; vendor: string }> = [
    {
      sel: 'iframe[src*="recaptcha/api2"], iframe[src*="recaptcha/enterprise"]',
      vendor: 'reCAPTCHA',
    },
    { sel: 'iframe[src*="hcaptcha.com"]', vendor: 'hCaptcha' },
    { sel: 'iframe[src*="challenges.cloudflare.com/turnstile"]', vendor: 'Turnstile' },
    { sel: '[id^="cf-chl-"], #cf-challenge-running', vendor: 'Cloudflare' },
    { sel: 'div.g-recaptcha[data-sitekey]', vendor: 'reCAPTCHA' },
  ];
  for (const p of probes) {
    if (document.querySelector(p.sel)) return { detected: true, vendor: p.vendor };
  }
  return { detected: false };
}
