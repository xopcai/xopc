# Browser automations

Browser automations let xopc repeat a web task that you have already completed successfully with the assistant. You describe the result in everyday language; xopc handles the browser steps and saves the reusable version.

You do not need to write YAML, selectors, or automation code.

## Browser automation or Automation?

These two features work together, but solve different problems:

| Feature | What it controls | Example |
| --- | --- | --- |
| Browser automation | What the browser does | Open an order page, enter an order number, and return its status |
| [Automation](./automations.md) | When the task starts | Run that order lookup every weekday at 09:00 |

Create a browser automation first when you want to reuse a sequence of actions on a website. Add it to an Automation only when it also needs a schedule or another trigger.

## Create one with the assistant

1. In the Gateway console, open **More apps → Browser automations**.
2. Select **Create with assistant**.
3. Tell the assistant what result you want and which website to use.
4. Complete the task together once. Sign in or confirm sensitive steps yourself when needed.
5. After the task succeeds, the assistant saves the working steps and any values that should be entered on future runs.

For example:

> Open my order management page, look up an order number, and return its current status. After it works, save it as a browser automation and make the order number an input.

The first successful run matters: it gives the assistant a real page and a verified path to save. If the website or the desired result is unclear, the assistant may ask a short follow-up question.

## Run it again

Open **More apps → Browser automations**, select an enabled automation, complete the fields under **Before running**, and select **Run now**.

The page shows the current status, result, and recent activity. You can stop a run that is still in progress.

You can also ask in chat:

> Run my order status lookup for order 12345.

The assistant finds the matching enabled browser automation, supplies the inputs, waits for it to finish, and returns the result.

## Edit, pause, or delete

- Select **Edit with assistant** to explain what should change. The assistant tests the new steps before saving them. Earlier run records retain the exact version used for those runs.
- Select **Pause** to prevent new runs without deleting the automation. Paused items cannot be selected by scheduled Automations.
- Select **Enable** when it is ready to use again.
- Select **Delete automation** when you no longer need it. Deletion is permanent and is unavailable while the automation is running.

## Run it on a schedule

1. Make sure the browser automation is enabled.
2. Open **Automations** and create a new automation.
3. Choose a manual, scheduled, or webhook trigger.
4. Choose **Browser automation** as the action.
5. Select the saved browser automation and complete its input fields.

The xopc Gateway and its configured browser must be available when a scheduled run starts. A login session may expire between runs, so account-based tasks can occasionally require you to sign in again.

## Login and sensitive actions

- Sign in through the browser yourself. Do not save passwords, one-time codes, recovery codes, or payment details as automation inputs.
- Complete CAPTCHA, two-factor authentication, consent, and other human verification yourself. Browser automations do not bypass these controls.
- Check the risk label before running. xopc identifies automations that only read information, change account data, or perform a sensitive action.
- Review website changes carefully. A redesigned page can make previously saved steps fail or behave differently.

## Responsible use

Only automate websites, accounts, and data that you are authorized to use. Follow the website's terms, robots and access policies, and reasonable request limits.

xopc restricts each saved browser automation to its declared websites, including redirects. It also blocks unsafe URL patterns. Do not use browser automations to bypass access controls, CAPTCHA, rate limits, paywalls, or anti-bot protections. If a website rejects automation, stop the task and use its official API, export, or manual flow instead.

xopc does not currently ship a catalog of third-party browser automations. This keeps the saved behavior tied to a task you performed and verified in your own environment.

## Common problems

| Problem | What to do |
| --- | --- |
| I cannot find the page | Open **More apps → Browser automations**, or go to `#/browser-workflows`. |
| The assistant says browser access is unavailable | Ask the owner of this xopc instance to enable browser access for the selected Agent and install the browser runtime. |
| The automation asks me to sign in | Open the browser, sign in yourself, then run it again. Never place the password in a reusable input. |
| A saved automation is missing from Automations | Enable it on the Browser automations page first. |
| A field is rejected | Complete every required field using the type and format shown on the page. |
| It used to work but now fails | The website may have changed. Select **Edit with assistant** and test the task again. |
| A scheduled run did not start | Check that the Gateway and browser were running, the automation was enabled, and its login session had not expired. |

For installation diagnostics, the instance owner can run `xopc browser doctor`.

## Related guides

- [Automations](./automations.md) — run work manually, on a schedule, or from a webhook
- [Tools](./tools.md) — configure browser access for an Agent
