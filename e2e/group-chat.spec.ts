import { devices, expect, test, type Page } from '@playwright/test';

async function addModel(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add model' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a model' });
  await dialog.getByPlaceholder(/Search models/).fill(name);
  await dialog.getByRole('button', { name }).first().click();
  await expect(dialog).toBeHidden();
}

test('three models chat together and a second device follows live', async ({ page, browser }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/#\/c\//);

  // Set the user's name via Settings (the round initial button).
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Your name').fill('Sam');
  await page.getByRole('button', { name: 'Save & Close' }).click();
  await expect(page.getByRole('button', { name: 'Settings' })).toHaveText('S');

  await addModel(page, 'Mock Echo');
  await addModel(page, 'Mock Chatty');
  await addModel(page, 'Mock Slow');
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(3);

  // A phone on the same network opens the same chat.
  const phone = await browser.newContext({ ...devices['Pixel 7'] });
  const phonePage = await phone.newPage();
  await phonePage.goto(page.url());
  await expect(phonePage.getByRole('button', { name: /^Remove / })).toHaveCount(3);

  await page.getByLabel('Message').fill('Hello council');
  await page.keyboard.press('Enter');

  // The phone sees the reply while it is still streaming…
  await expect(phonePage.locator('[data-testid=model-message][data-status=streaming]').first()).toBeVisible();
  // …and both devices end with the same three finished answers.
  for (const p of [page, phonePage]) {
    await expect(p.getByTestId('user-message')).toHaveText('Hello council');
    const replies = p.getByTestId('model-message');
    await expect(replies).toHaveCount(3);
    await expect(p.locator('[data-testid=model-message][data-status=done]')).toHaveCount(3, {
      timeout: 15_000,
    });
    await expect(replies.nth(0)).toContainText("I'm Mock Echo");
    await expect(replies.nth(0)).toContainText('[Sam]: Hello council');
  }

  // The title came from the first message, and the chat is listed on the phone too.
  await expect(page.getByRole('button', { name: /Hello council/ }).first()).toBeVisible();
  await phonePage
    .getByRole('button', { name: /Hello council/ })
    .first()
    .click();
  await expect(phonePage.getByRole('menu')).toContainText('Hello council');
  await phone.close();
});

test('stop ends a running round and errors stay per model', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('model-message')).toHaveCount(3); // the previous test's chat
  await page
    .getByRole('button', { name: /Hello council/ })
    .first()
    .click();
  await page.getByRole('menu').getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByTestId('model-message')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /New chat/ }).first()).toBeVisible();

  // New chats inherit the previous council; replace it with a slow model and a failing one.
  const removeButtons = page.getByRole('button', { name: /^Remove / });
  await expect(removeButtons).toHaveCount(3);
  while ((await removeButtons.count()) > 0) await removeButtons.first().click();
  await addModel(page, 'Mock Slow');
  await addModel(page, 'Mock Error');

  await page.getByLabel('Message').fill('Long question');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('[data-status=error]')).toContainText('Mock provider error');
  await expect(page.locator('[data-status=streaming]')).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('[data-status=stopped]')).toContainText('Stopped');
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('a model the provider does not list can be added by ID and used', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add model' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose a model' });
  await dialog.getByPlaceholder(/Search models/).fill('brand-new-model');
  await expect(dialog).toContainText('No models match');

  await dialog.getByRole('button', { name: /Use “brand-new-model” as a model ID/ }).click();
  await expect(dialog.getByLabel('Model ID')).toHaveValue('brand-new-model');
  await expect(dialog.getByLabel('Provider')).toHaveValue('mock');
  await dialog.getByLabel('Display name').fill('Brand New');
  await dialog.getByRole('button', { name: 'Add & use' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Remove Brand New' })).toBeVisible();

  await page.getByLabel('Message').fill('Are you there?');
  await page.keyboard.press('Enter');
  await expect(
    page.locator('[data-testid=model-message][data-status=done]').filter({ hasText: "I'm Brand New" }),
  ).toBeVisible();

  // It is listed (marked custom) on later visits and can be removed from the list.
  await page.getByRole('button', { name: 'Add model' }).click();
  await dialog.getByPlaceholder(/Search models/).fill('brand');
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Brand New' })).toContainText('custom');
  await dialog.getByRole('button', { name: 'Remove custom model Brand New' }).click();
  await expect(dialog).toContainText('No models match');
});

test('roles: system prompt, custom names and slot prompts reach the models', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('session-menu').click();
  await page.getByRole('menu').getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByTestId('session-menu')).toHaveText('New chat');
  const removeButtons = page.getByRole('button', { name: /^Remove / });
  while ((await removeButtons.count()) > 0) await removeButtons.first().click();
  await addModel(page, 'Mock Echo');
  await addModel(page, 'Mock Chatty');

  await page.getByRole('button', { name: 'Roles' }).click();
  const roles = page.getByRole('dialog', { name: 'Roles' });
  await roles.getByLabel('System prompt for all models').fill('Speak like a courtroom drama.');

  await roles.getByRole('tab', { name: 'Custom Names' }).click();
  await roles.getByPlaceholder('Custom name for Mock Echo…').fill('Judge');
  await roles.getByPlaceholder('Custom name for Mock Chatty…').fill('Defense');
  await roles.getByLabel('Show model names underneath').check();

  await roles.getByRole('tab', { name: 'Slot Prompts' }).click();
  await expect(roles).toContainText('Slot 1: Judge');
  await roles.getByPlaceholder('System prompt for slot 1…').fill('You preside over the trial.');

  // Cancel with unsaved edits asks first; dismissing keeps the panel open.
  page.once('dialog', (d) => void d.dismiss());
  await roles.getByRole('button', { name: 'Cancel' }).click();
  await expect(roles).toBeVisible();

  await roles.getByRole('button', { name: 'Save & Close' }).click();
  await expect(roles).toBeHidden();
  await expect(page.getByRole('button', { name: 'Remove Judge' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Defense' })).toBeVisible();

  await page.getByLabel('Message').fill('Order in the court');
  await page.keyboard.press('Enter');
  const replies = page.locator('[data-testid=model-message][data-status=done]');
  await expect(replies).toHaveCount(2);
  await expect(replies.nth(0)).toContainText("I'm Judge");
  await expect(replies.nth(0)).toContainText(
    'Instructions: "Speak like a courtroom drama. / You preside over the trial."',
  );
  await expect(replies.nth(1)).toContainText("I'm Defense");
  await expect(replies.nth(1)).toContainText('Instructions: "Speak like a courtroom drama."');
  // Judge sees Defense under its custom name next round; model names are shown under custom names.
  await expect(replies.nth(0).locator('header')).toContainText('Mock Echo');

  // Clear All resets everything after saving.
  await page.getByRole('button', { name: 'Roles' }).click();
  await roles.getByRole('button', { name: 'Clear All' }).click();
  await roles.getByRole('button', { name: 'Save & Close' }).click();
  await expect(page.getByRole('button', { name: 'Remove Mock Echo' })).toBeVisible();
});

test('clear and restore, save and load, and past chats search', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('session-menu').click();
  await page.getByRole('menu').getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByTestId('session-menu')).toHaveText('New chat');
  const removeButtons = page.getByRole('button', { name: /^Remove / });
  while ((await removeButtons.count()) > 0) await removeButtons.first().click();
  await addModel(page, 'Mock Echo');

  await page.getByLabel('Message').fill('Quarterly zebra migration report');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid=model-message][data-status=done]')).toHaveCount(1);

  // Clear hides the conversation; Restore brings it back.
  await expect(page.getByRole('button', { name: 'Restore' })).toBeHidden();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByTestId('user-message')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByTestId('user-message')).toHaveText('Quarterly zebra migration report');
  await expect(page.getByRole('button', { name: 'Restore' })).toBeHidden();

  // Save downloads the chat; Load turns the file into a new chat.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Save' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^agora-Quarterly-zebra-migration-report-.*\.json$/);
  const savedUrl = page.url();
  await page.getByTestId('load-file').setInputFiles(await download.path());
  await expect(page).not.toHaveURL(savedUrl);
  await expect(page.getByTestId('user-message')).toHaveText('Quarterly zebra migration report');
  await expect(page.locator('[data-testid=model-message]')).toContainText("I'm Mock Echo");

  // A file that isn't an Agora export is rejected with a message.
  await page.getByTestId('load-file').setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello": "world"}'),
  });
  await expect(page.getByRole('status')).toContainText('not a chat saved from Agora');

  // Past chats finds both copies by message text and opens one.
  await page.getByRole('button', { name: 'Past chats' }).click();
  const dialog = page.getByRole('dialog', { name: 'Past chats' });
  await dialog.getByLabel('Search chats').fill('zebra');
  await expect(dialog.getByRole('listitem')).toHaveCount(2);
  await dialog.getByLabel('Search chats').fill('no such words anywhere');
  await expect(dialog).toContainText('No chats mention');
  await dialog.getByLabel('Search chats').fill('');
  await expect(dialog.getByRole('listitem').first()).toBeVisible();
  await dialog.getByRole('listitem').filter({ hasText: 'Hello council' }).getByRole('button').first().click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('user-message').first()).toHaveText('Hello council');
});

test('modes: leader, fusion, self-chat, regenerate, messages to one model, collapse', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('session-menu').click();
  await page.getByRole('menu').getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByTestId('session-menu')).toHaveText('New chat');
  const removeButtons = page.getByRole('button', { name: /^Remove / });
  while ((await removeButtons.count()) > 0) await removeButtons.first().click();
  await addModel(page, 'Mock Echo');
  await addModel(page, 'Mock Chatty');
  const replies = page.getByTestId('model-message');
  const done = page.locator('[data-testid=model-message][data-status=done]');
  const send = async (text: string) => {
    await page.getByLabel('Message').fill(text);
    await page.keyboard.press('Enter');
  };

  // Leader: pick Mock Chatty with the ↑ button; it answers last, marked as leader.
  await page.getByRole('button', { name: 'Choose the leader' }).click();
  await page.getByRole('dialog', { name: 'Choose the leader' }).getByLabel('Mock Chatty').click();
  await expect(page.getByRole('button', { name: 'Leader', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Leader', { exact: true })).toBeVisible(); // crown on the slot card
  await send('Who leads?');
  await expect(done).toHaveCount(2);
  await expect(replies.nth(1)).toHaveAttribute('data-kind', 'leader');
  await expect(replies.nth(1)).toContainText('Mode: leader.');

  // Fusion turns Leader off; slot 1 merges after both answer.
  await page.getByRole('button', { name: 'Fusion' }).click();
  await expect(page.getByRole('button', { name: 'Leader', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await send('Merge please');
  await expect(done).toHaveCount(5);
  await expect(replies.nth(4)).toHaveAttribute('data-kind', 'fusion');
  await expect(replies.nth(4)).toContainText("I'm Mock Echo");

  // Regenerate redoes the last round with the same plan.
  await page.getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.locator('[data-testid=model-message][data-status=streaming]').first()).toBeVisible();
  await expect(done).toHaveCount(5);
  await expect(replies.nth(4)).toHaveAttribute('data-kind', 'fusion');
  await page.getByRole('button', { name: 'Fusion' }).click();

  // A visible message to one model: only it answers.
  await page.getByLabel('Send to').selectOption({ label: 'Mock Chatty' });
  await expect(page.getByLabel('Message')).toHaveAttribute('placeholder', 'Message to Mock Chatty…');
  await send('Just you');
  await expect(done).toHaveCount(6);
  await expect(page.getByTestId('user-message').last()).toContainText('To Mock Chatty');
  await expect(replies.last()).toContainText("I'm Mock Chatty");

  // A private one: marked private on both sides.
  await page.getByRole('button', { name: 'Private' }).click();
  await send('Our secret');
  await expect(done).toHaveCount(7);
  await expect(page.getByTestId('user-message').last()).toHaveAttribute('data-private', 'true');
  await expect(page.getByTestId('user-message').last()).toContainText('Private to Mock Chatty');
  await expect(replies.last()).toHaveAttribute('data-private', 'true');
  await expect(replies.last()).toContainText(/Private message from \w+/);
  await page.getByLabel('Send to').selectOption({ label: 'Everyone' });

  // Self-Chat with a topic from the message box, two rounds of two models.
  await page.getByLabel('Message').fill('Debate tabs versus spaces');
  await page.getByRole('button', { name: 'Self-Chat!' }).click();
  const selfChat = page.getByRole('dialog', { name: 'Self-Chat' });
  await selfChat.getByLabel('Rounds').fill('2');
  await selfChat.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByLabel('Message')).toHaveValue('');
  await expect(page.getByTestId('user-message').last()).toHaveText('Debate tabs versus spaces');
  await expect(page.locator('[data-kind=self-chat][data-status=done]')).toHaveCount(4);

  // The - button collapses the mode buttons into a +, and back.
  await page.getByRole('button', { name: 'Hide mode buttons' }).click();
  await expect(page.getByRole('button', { name: 'Fusion' })).toBeHidden();
  await page.getByRole('button', { name: 'Show mode buttons' }).click();
  await expect(page.getByRole('button', { name: 'Fusion' })).toBeVisible();
});
