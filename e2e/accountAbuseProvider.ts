import { expect, type BrowserContext, type Page } from '@playwright/test'

export const CHALLENGE_ORIGIN = 'http://localhost:5190'

export async function installChallengeProvider(context: BrowserContext): Promise<void> {
  await context.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async route => {
    expect(new URL(route.request().frame().url()).origin === CHALLENGE_ORIGIN).toBe(true)
    await route.fulfill({ contentType: 'application/javascript', body: `window.turnstile = {
      render: function (target, options) {
        var button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Complete test security check';
        button.style.minHeight = '44px'; button.style.minWidth = '150px';
        button.onclick = function () { button.disabled = true; options.callback('fixture.' + options.cData); };
        document.querySelector(target).appendChild(button);
        return 'owned-widget';
      },
      remove: function () { document.getElementById('widget').replaceChildren(); }
    };` })
  })
}

export async function completeChallenge(page: Page): Promise<void> {
  await page.frameLocator('iframe[data-account-challenge]').getByRole('button', { name: 'Complete test security check' }).click({ timeout: 10000 })
}
