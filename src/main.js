import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();

const input = await Actor.getInput();

const {
    username,
    password,
    store = 'Leander',
    report_date,
    max_concurrency = 5,
} = input ?? {};

if (!username) {
    throw new Error('Missing required input: username');
}

if (!password) {
    throw new Error('Missing required input: password');
}

if (!report_date) {
    throw new Error('Missing required input: report_date');
}

const BASE_URL = 'https://laynes.revelup.com';

const ORDER_HISTORY_URL =
    `${BASE_URL}/reports/orders/`;

console.log('========================================');
console.log('REVEL ORDER HISTORY ACTOR');
console.log('========================================');
console.log(`Store: ${store}`);
console.log(`Report date: ${report_date}`);
console.log(`Maximum concurrency: ${max_concurrency}`);
console.log('========================================');


/**
 * Small helper to clean text.
 */
function clean(value) {
    if (value == null) {
        return null;
    }

    const cleaned = String(value)
        .replace(/\s+/g, ' ')
        .trim();

    if (
        !cleaned ||
        cleaned.toUpperCase() === 'N/A'
    ) {
        return null;
    }

    return cleaned;
}


/**
 * Login to Revel.
 *
 * We may need to adjust these selectors slightly
 * depending on what the Revel login page currently uses.
 */
async function loginToRevel(page) {
    console.log('Navigating to Revel...');

    await page.goto(
        ORDER_HISTORY_URL,
        {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
        },
    );

    /*
     * Check whether we're already authenticated.
     */
    const establishmentHeader = page.locator(
        '[data-cy="header-establishment-text"]',
    );

    const alreadyLoggedIn =
        await establishmentHeader
            .isVisible({
                timeout: 5000,
            })
            .catch(() => false);

    if (alreadyLoggedIn) {
        console.log(
            'Existing authenticated Revel session detected.',
        );

        return;
    }

    console.log('Logging into Revel...');

    /*
     * ==========================================
     * USERNAME
     * ==========================================
     */

    const usernameField =
        page.locator('#username');

    await usernameField.waitFor({
        state: 'visible',
        timeout: 15_000,
    });

    await usernameField.fill(username);

    console.log(
        'Username entered. Clicking Continue.',
    );

    const continueButton =
        page.getByRole(
            'button',
            {
                name: 'Continue',
                exact: true,
            },
        );

    await continueButton.waitFor({
        state: 'visible',
        timeout: 15_000,
    });

    await continueButton.click();


    /*
     * ==========================================
     * PASSWORD
     * ==========================================
     */

    const passwordField =
        page.locator(
            'input[type="password"]',
        );

    await passwordField.waitFor({
        state: 'visible',
        timeout: 20_000,
    });

    console.log(
        'Password field appeared.',
    );

    await passwordField.fill(password);


    /*
     * ==========================================
     * FINAL LOGIN BUTTON
     * ==========================================
     *
     * Revel does not consistently expose this
     * button with accessible text like "Login".
     *
     * This is the selector already proven to work
     * in your other Revel actors.
     */

    const loginButton =
        page.locator(
            'button[type="submit"]:visible, '
            + 'input[type="submit"]:visible',
        ).last();

    await loginButton.waitFor({
        state: 'visible',
        timeout: 15_000,
    });

    const buttonText =
        (await loginButton.textContent())?.trim()
        || (await loginButton.getAttribute('value'))
        || 'Submit';

    console.log(
        `Clicking final login button: ${buttonText}`,
    );

    await loginButton.click();


    /*
     * Wait for password form to disappear.
     */
    await passwordField.waitFor({
        state: 'hidden',
        timeout: 30_000,
    });

    await page.waitForLoadState(
        'domcontentloaded',
    );

    console.log(
        `Login completed. Current URL: ${page.url()}`,
    );


    /*
     * ==========================================
     * NAVIGATE BACK TO ORDER HISTORY
     * ==========================================
     *
     * Revel may redirect somewhere else after login.
     */

    if (
        !page.url().includes('/reports/orders')
    ) {
        console.log(
            `Navigating to Order History: `
            + `${ORDER_HISTORY_URL}`,
        );

        await page.goto(
            ORDER_HISTORY_URL,
            {
                waitUntil: 'domcontentloaded',
                timeout: 60_000,
            },
        );
    }


    /*
     * ==========================================
     * FINAL LOGIN VALIDATION
     * ==========================================
     */

    await establishmentHeader.waitFor({
        state: 'visible',
        timeout: 30_000,
    });

    const loggedInEstablishment =
        clean(
            await establishmentHeader
                .textContent(),
        );

    console.log(
        `Revel login verified. `
        + `Current establishment: `
        + `${loggedInEstablishment}`,
    );
}


/**
 * Select the correct Revel establishment.
 *
 * IMPORTANT:
 *
 * This follows the safer process we discussed:
 *
 * 1. Open establishment selector
 * 2. Click "Estab. No."
 * 3. Click "expand all"
 * 4. Find requested store
 * 5. Click it
 * 6. Verify the header changed
 *
 * The verification is intentionally strict because
 * we do NOT want Leander data being stored while
 * Revel is actually still on Lampasas.
 */
async function selectEstablishment(
    page,
    targetStore,
) {
    console.log(
        `Checking establishment: ${targetStore}`,
    );

    const establishmentText = page.locator(
        '[data-cy="header-establishment-text"]',
    );

    await establishmentText.waitFor({
        state: 'visible',
        timeout: 30_000,
    });

    const currentEstablishment =
        clean(
            await establishmentText.textContent(),
        );

    console.log(
        `Current establishment before selection: `
        + `${currentEstablishment}`,
    );

    /*
     * Already on correct establishment.
     */
    if (
        currentEstablishment
            ?.toLowerCase()
        === targetStore
            .toLowerCase()
    ) {
        console.log(
            `Correct establishment already selected: `
            + `${currentEstablishment}`,
        );

        return;
    }

    /*
     * Open the establishment selector.
     */
    console.log(
        'Opening establishment selector...',
    );

    await establishmentText.click();


    /*
     * IMPORTANT:
     *
     * Revel can have multiple FancyTree structures
     * in the DOM, including hidden ones.
     *
     * Only work inside the currently visible tree.
     */
    const establishmentTree =
        page.locator(
            'ul.fancytree-container:visible',
        ).first();

    await establishmentTree.waitFor({
        state: 'visible',
        timeout: 30_000,
    });

    console.log(
        'Establishment panel opened.',
    );


    /*
     * ==========================================
     * SORT BY ESTABLISHMENT NUMBER
     * ==========================================
     */

    const estabNumberButton =
        page.locator(
            'div.btn.by-id:visible',
        ).filter({
            hasText: 'Estab. No.',
        }).first();

    if (
        await estabNumberButton
            .isVisible()
            .catch(() => false)
    ) {
        console.log(
            'Clicking "Estab. No." sort.',
        );

        await estabNumberButton.click();

        await page.waitForTimeout(500);
    } else {
        console.warn(
            '"Estab. No." button was not visible.',
        );
    }


    /*
     * ==========================================
     * EXPAND ALL
     * ==========================================
     */

    const expandAll =
        page.locator(
            'span.expand-all:visible',
        ).first();

    if (
        await expandAll
            .isVisible()
            .catch(() => false)
    ) {
        console.log(
            'Clicking "expand all"...',
        );

        await expandAll.click();

        /*
         * Allow FancyTree to finish rendering
         * all child establishments.
         */
        await page.waitForTimeout(1500);
    } else {
        console.warn(
            '"expand all" was not visible.',
        );
    }


    /*
     * ==========================================
     * SELECT TARGET STORE
     * ==========================================
     *
     * Restrict search to:
     *
     * 1. visible FancyTree
     * 2. visible titles
     * 3. store name at end of title
     *
     * Matches:
     *
     * Leander
     * 42 | Leander
     *
     * But avoids hidden duplicate nodes.
     */

    const escapedStore =
        targetStore.replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&',
        );

    const storePattern =
        new RegExp(
            `(?:^|\\|\\s*)${escapedStore}\\s*$`,
            'i',
        );

    const targetOptions =
        establishmentTree
            .locator(
                'span.fancytree-title:visible',
            )
            .filter({
                hasText: storePattern,
            });

    const visibleMatchCount =
        await targetOptions.count();

    console.log(
        `Visible matching establishment options found: `
        + `${visibleMatchCount}`,
    );

    if (visibleMatchCount === 0) {
        throw new Error(
            `Could not find visible establishment `
            + `"${targetStore}" after expanding `
            + `the establishment tree.`,
        );
    }

    const targetOption =
        targetOptions.first();

    await targetOption.waitFor({
        state: 'visible',
        timeout: 20_000,
    });

    const optionText =
        clean(
            await targetOption.textContent(),
        );

    console.log(
        `Selecting visible establishment option: `
        + `${optionText}`,
    );


    /*
     * Scroll it into view in case it is inside
     * a scrollable FancyTree panel.
     */
    await targetOption.scrollIntoViewIfNeeded();

    await targetOption.click();


    /*
     * ==========================================
     * WAIT FOR HEADER TO CHANGE
     * ==========================================
     *
     * Use Playwright's locator expectation style
     * instead of document.querySelector().
     *
     * This is safer because the header itself may
     * be re-rendered by Revel after selection.
     */

    const selectedHeader =
        page.locator(
            '[data-cy="header-establishment-text"]',
        ).filter({
            hasText: new RegExp(
                `^\\s*${escapedStore}\\s*$`,
                'i',
            ),
        });

    await selectedHeader.waitFor({
        state: 'visible',
        timeout: 30_000,
    });


    /*
     * ==========================================
     * FINAL VALIDATION
     * ==========================================
     */

    const selectedEstablishment =
        clean(
            await page
                .locator(
                    '[data-cy="header-establishment-text"]',
                )
                .textContent(),
        );

    console.log(
        `Establishment after selection: `
        + `${selectedEstablishment}`,
    );

    if (
        selectedEstablishment
            ?.toLowerCase()
        !== targetStore
            .toLowerCase()
    ) {
        throw new Error(
            `ESTABLISHMENT VALIDATION FAILED. `
            + `Expected "${targetStore}", `
            + `but Revel shows `
            + `"${selectedEstablishment}".`,
        );
    }

    console.log(
        `Establishment verified successfully: `
        + `${selectedEstablishment}`,
    );
}


/**
 * Set the report date.
 *
 * We will replace these generic selectors with
 * the exact Revel selectors after we confirm them
 * from your Order History page.
 */
async function setReportDate(
    page,
    reportDate,
) {
    console.log(
        `Setting Order History date: ${reportDate}`,
    );

    /*
     * Order History exposes dedicated report-filter
     * fields with IDs date-from and date-to.
     *
     * Do NOT use:
     *
     * input[name="daterangepicker_start"]
     *
     * because Revel also creates another internal
     * daterangepicker input with the same name.
     */

    const startDate =
        page.locator('#date-from');

    const endDate =
        page.locator('#date-to');

    await startDate.waitFor({
        state: 'visible',
        timeout: 20_000,
    });

    await endDate.waitFor({
        state: 'visible',
        timeout: 20_000,
    });


    /*
     * Clear and enter requested date.
     */
    await startDate.fill(reportDate);

    await endDate.fill(reportDate);


    console.log(
        `Order History date fields entered: `
        + `${reportDate} through ${reportDate}`,
    );


    /*
     * Read them back before running the report.
     */
    const startValue =
        await startDate.inputValue();

    const endValue =
        await endDate.inputValue();

    console.log(
        `Date field validation: `
        + `start=${startValue}, `
        + `end=${endValue}`,
    );

    if (
        startValue !== reportDate
        || endValue !== reportDate
    ) {
        throw new Error(
            `ORDER HISTORY DATE VALIDATION FAILED. `
            + `Expected ${reportDate} through ${reportDate}, `
            + `but found ${startValue} through ${endValue}.`,
        );
    }


    /*
     * Revel may require change events for its
     * report-filter logic to notice the new values.
     */
    await startDate.evaluate((element) => {
        element.dispatchEvent(
            new Event(
                'change',
                {
                    bubbles: true,
                },
            ),
        );
    });

    await endDate.evaluate((element) => {
        element.dispatchEvent(
            new Event(
                'change',
                {
                    bubbles: true,
                },
            ),
        );
    });


    /*
     * Find the Order History refresh/search/apply
     * control.
     *
     * We can tighten this selector after seeing
     * what the page exposes, but unlike the date
     * fields this is intentionally flexible.
     */
    const reportButton =
        page.locator(
            'button:visible, input[type="submit"]:visible',
        ).filter({
            hasText: /search|apply|refresh|update|run/i,
        }).first();


    /*
     * Buttons implemented as input[type=submit]
     * don't expose textContent, so check both
     * button text and value.
     */
    let clickedReportButton = false;

    const visibleButtons =
        page.locator(
            'button:visible, input[type="submit"]:visible',
        );

    const buttonCount =
        await visibleButtons.count();

    for (
        let i = 0;
        i < buttonCount;
        i++
    ) {
        const button =
            visibleButtons.nth(i);

        const text =
            (
                await button.textContent()
                    .catch(() => '')
            )?.trim()
            || '';

        const value =
            (
                await button.getAttribute('value')
                    .catch(() => '')
            )?.trim()
            || '';

        const label =
            `${text} ${value}`.trim();

        if (
            /search|apply|refresh|update|run/i
                .test(label)
        ) {
            console.log(
                `Running Order History report `
                + `using button: "${label}"`,
            );

            await button.click();

            clickedReportButton = true;

            break;
        }
    }


    if (!clickedReportButton) {
        /*
         * Sometimes changing the date itself causes
         * Revel to refresh, so don't immediately fail.
         */
        console.warn(
            'No Search/Apply/Refresh button was found. '
            + 'Checking whether Revel refreshed automatically.',
        );
    }


    /*
     * Allow Revel's AJAX request / table refresh
     * to begin and settle.
     */
    await page.waitForTimeout(1500);

    await page.waitForLoadState(
        'networkidle',
        {
            timeout: 30_000,
        },
    ).catch(() => {});


    /*
     * Final date validation after the refresh.
     */
    const finalStartValue =
        await startDate.inputValue();

    const finalEndValue =
        await endDate.inputValue();

    console.log(
        `Final Order History date range: `
        + `${finalStartValue} through ${finalEndValue}`,
    );

    if (
        finalStartValue !== reportDate
        || finalEndValue !== reportDate
    ) {
        throw new Error(
            `ORDER HISTORY DATE CHANGED UNEXPECTEDLY. `
            + `Expected ${reportDate}, `
            + `but Revel shows `
            + `${finalStartValue} through ${finalEndValue}.`,
        );
    }

    console.log(
        'Order History date applied successfully.',
    );
}

/**
 * Collect every unique order ID currently displayed
 * on the Order History page.
 */
async function collectOrderIds(page) {

    console.log(
        'Collecting Order IDs...',
    );

    await page.waitForSelector(
        'a[href*="/reports/orders/"]',
        {
            timeout: 60000,
        },
    );

    const orders = await page.evaluate(() => {

        const links = [
            ...document.querySelectorAll(
                'a[href*="/reports/orders/"]',
            ),
        ];

        const discovered = links
            .map((a) => {

                const match =
                    a.href.match(
                        /\/reports\/orders\/(\d+)\/?/,
                    );

                if (!match) {
                    return null;
                }

                return {
                    order_id: match[1],
                    url: a.href,
                    link_text:
                        a.innerText
                            ?.replace(/\s+/g, ' ')
                            .trim()
                            ?? null,
                };
            })
            .filter(Boolean);

        return [
            ...new Map(
                discovered.map(
                    (order) => [
                        order.order_id,
                        order,
                    ],
                ),
            ).values(),
        ];
    });

    console.log(
        `Unique Order IDs found: ${orders.length}`,
    );

    if (!orders.length) {
        throw new Error(
            'No Order IDs were found on the Order History page.',
        );
    }

    return orders;
}


/**
 * Parse one individual Revel order detail page.
 */
async function parseOrderPage(
    page,
    orderId,
) {

    /*
     * Helper runs inside the browser.
     */
    return page.evaluate(
        ({ expectedOrderId }) => {

            const cleanValue = (value) => {

                if (value == null) {
                    return null;
                }

                const v = String(value)
                    .replace(/\s+/g, ' ')
                    .trim();

                if (
                    !v ||
                    v.toUpperCase() === 'N/A'
                ) {
                    return null;
                }

                return v;
            };


            const getDetail = (
                container,
                label,
            ) => {

                const labels = [
                    ...container.querySelectorAll(
                        '.horizontal_details .label',
                    ),
                ];

                const labelElement =
                    labels.find(
                        (el) =>
                            el.textContent
                                .trim()
                                .toLowerCase()
                            === label.toLowerCase(),
                    );

                if (!labelElement) {
                    return null;
                }

                const li =
                    labelElement.closest('li');

                if (!li) {
                    return null;
                }

                const clone =
                    li.cloneNode(true);

                clone
                    .querySelector('.label')
                    ?.remove();

                return cleanValue(
                    clone.textContent,
                );
            };


            const getNumberTable = (
                container,
            ) => {

                const table =
                    container.querySelector(
                        'table.order_item_numbers',
                    );

                if (!table) {
                    return {};
                }

                const rows = [
                    ...table.querySelectorAll(
                        'tr',
                    ),
                ];

                if (rows.length < 2) {
                    return {};
                }

                const headers = [
                    ...rows[0]
                        .querySelectorAll('th'),
                ].map(
                    (th) =>
                        cleanValue(
                            th.textContent,
                        ),
                );

                const values = [
                    ...rows[1]
                        .querySelectorAll('td'),
                ].map(
                    (td) =>
                        cleanValue(
                            td.textContent,
                        ),
                );

                return Object.fromEntries(
                    headers.map(
                        (
                            header,
                            index,
                        ) => [
                            header,
                            values[index]
                                ?? null,
                        ],
                    ),
                );
            };


            const getModifiers = (
                container,
            ) => {

                return [
                    ...container
                        .querySelectorAll(
                            'tr[id="order_item_parent_modifiers"]',
                        ),
                ].map(
                    (row) => {

                        const cells = [
                            ...row
                                .querySelectorAll(
                                    'td',
                                ),
                        ].map(
                            (td) =>
                                cleanValue(
                                    td.textContent,
                                ),
                        );

                        return {
                            modifier_name:
                                cells[2]
                                ?? null,

                            modifier_cost:
                                cells[5]
                                ?? null,

                            modifier_price:
                                cells[6]
                                ?? null,
                        };
                    },
                );
            };


            /*
             * ====================================
             * ORDER HEADER
             * ====================================
             */

            const bodyText =
                document.body.innerText;

            const heading =
                document.querySelector('h1, h2');

            const headingText =
                cleanValue(
                    heading?.textContent,
                );

            /*
             * Example:
             *
             * Order 17274446 (98258c67)
             * Reporting No: 93558
             */
            const reportingMatch =
                bodyText.match(
                    /Reporting\s+No:\s*(\d+)/i,
                );

            const reportingNo =
                reportingMatch
                    ? reportingMatch[1]
                    : null;


            /*
             * ====================================
             * ITEMS
             * ====================================
             */

            const itemContainers = [
                ...document.querySelectorAll(
                    'div.order_item.item',
                ),
            ];

            const items =
                itemContainers.map(
                    (
                        container,
                        index,
                    ) => {

                        const itemHeading =
                            container
                                .querySelector(
                                    '.order_history_item',
                                );

                        const itemName =
                            cleanValue(
                                itemHeading
                                    ?.textContent
                                    .replace(
                                        /^\s*Added\s+Item\s*-\s*/i,
                                        '',
                                    ),
                            );

                        const numbers =
                            getNumberTable(
                                container,
                            );

                        const modifiers =
                            getModifiers(
                                container,
                            );

                        const price =
                            numbers.Price
                            ?? null;

                        const quantity =
                            numbers.Quantity
                            ?? null;

                        const extendedPrice =
                            price !== null
                            && quantity !== null
                                ? Number(price)
                                    * Number(
                                        quantity,
                                    )
                                : null;

                        return {
                            order_id:
                                expectedOrderId,

                            item_index:
                                index + 1,

                            item_name:
                                itemName,

                            created_by:
                                getDetail(
                                    container,
                                    'Created by:',
                                ),

                            created_date:
                                getDetail(
                                    container,
                                    'Created date:',
                                ),

                            dining_option:
                                getDetail(
                                    container,
                                    'Dining Option:',
                                ),

                            station:
                                getDetail(
                                    container,
                                    'Station:',
                                ),

                            establishment_no:
                                getDetail(
                                    container,
                                    'Establishment #:',
                                ),

                            printed:
                                getDetail(
                                    container,
                                    'Printed:',
                                ),

                            updated_by:
                                getDetail(
                                    container,
                                    'Updated by:',
                                ),

                            updated_date:
                                getDetail(
                                    container,
                                    'Updated date:',
                                ),

                            voided_by:
                                getDetail(
                                    container,
                                    'Voided By:',
                                ),

                            voided_date:
                                getDetail(
                                    container,
                                    'Voided date:',
                                ),

                            price,

                            cost:
                                numbers.Cost
                                ?? null,

                            quantity,

                            extended_price:
                                extendedPrice,

                            weight:
                                numbers.Weight
                                ?? null,

                            tax_rate:
                                numbers[
                                    'Tax Rate'
                                ]
                                ?? null,

                            tax_amount:
                                numbers[
                                    'Tax Amount'
                                ]
                                ?? null,

                            crv_value:
                                numbers[
                                    'CRV value'
                                ]
                                ?? null,

                            modifier_cost:
                                numbers[
                                    'Modifier Cost'
                                ]
                                ?? null,

                            modifier_price:
                                numbers[
                                    'Modifier Price'
                                ]
                                ?? null,

                            discount_total:
                                numbers[
                                    'Discount Total'
                                ]
                                ?? null,

                            modifiers,
                        };
                    },
                );


            return {
                order_id:
                    expectedOrderId,

                reporting_no:
                    reportingNo,

                heading:
                    headingText,

                items,
            };
        },
        {
            expectedOrderId:
                orderId,
        },
    );
}


/**
 * Process one order.
 */
async function processOrder(
    browserContext,
    order,
) {

    const page =
        await browserContext.newPage();

    try {

        console.log(
            `Processing order ${order.order_id}`,
        );

        await page.goto(
            order.url,
            {
                waitUntil:
                    'domcontentloaded',

                timeout:
                    60000,
            },
        );

        await page.waitForSelector(
            'div.order_item.item',
            {
                timeout: 30000,
            },
        );

        const result =
            await parseOrderPage(
                page,
                order.order_id,
            );

        console.log(
            `Order ${order.order_id}: `
            + `${result.items.length} item(s)`,
        );

        return {
            success: true,
            ...result,
        };

    } catch (error) {

        console.error(
            `Order ${order.order_id} failed:`,
            error.message,
        );

        return {
            success: false,
            order_id:
                order.order_id,

            error:
                error.message,
        };

    } finally {

        await page.close();

    }
}


/**
 * Simple concurrency worker pool.
 */
async function processOrders(
    browserContext,
    orders,
    concurrency,
) {

    const results = [];

    let nextIndex = 0;


    async function worker(
        workerNumber,
    ) {

        while (true) {

            const index =
                nextIndex++;

            if (
                index >= orders.length
            ) {
                break;
            }

            const order =
                orders[index];

            console.log(
                `[Worker ${workerNumber}] `
                + `${index + 1}/${orders.length}`,
            );

            const result =
                await processOrder(
                    browserContext,
                    order,
                );

            results.push(
                result,
            );
        }
    }


    const workerCount =
        Math.min(
            concurrency,
            orders.length,
        );


    await Promise.all(
        Array.from(
            {
                length:
                    workerCount,
            },

            (_, index) =>
                worker(
                    index + 1,
                ),
        ),
    );


    return results;
}


/**
 * ============================================
 * MAIN CRAWLER
 * ============================================
 */

const crawler =
    new PlaywrightCrawler({

        maxRequestsPerCrawl: 1,

        maxRequestRetries: 0,

        maxConcurrency: 1,

        requestHandlerTimeoutSecs:
            3600,

        async requestHandler({
            page,
        }) {

            /*
             * ====================================
             * 1. LOGIN
             * ====================================
             */

            await loginToRevel(
                page,
            );


            /*
             * ====================================
             * 2. STORE
             * ====================================
             */

            await selectEstablishment(
                page,
                store,
            );


            /*
             * ====================================
             * 3. DATE
             * ====================================
             */

            await setReportDate(
                page,
                report_date,
            );


            /*
             * ====================================
             * 4. ORDER IDS
             * ====================================
             */

            const orders =
                await collectOrderIds(
                    page,
                );


            console.log(
                `Beginning extraction of ${orders.length} orders...`,
            );


            /*
             * ====================================
             * 5. PROCESS DETAIL PAGES
             * ====================================
             */

            const browserContext =
                page.context();

            const results =
                await processOrders(
                    browserContext,
                    orders,
                    max_concurrency,
                );


            /*
             * ====================================
             * 6. OUTPUT
             * ====================================
             */

            const successful =
                results.filter(
                    (result) =>
                        result.success,
                );

            const failed =
                results.filter(
                    (result) =>
                        !result.success,
                );


            console.log('');
            console.log('========================================');
            console.log('EXTRACTION SUMMARY');
            console.log('========================================');
            console.log(
                `Orders discovered: ${orders.length}`,
            );
            console.log(
                `Orders successful: ${successful.length}`,
            );
            console.log(
                `Orders failed: ${failed.length}`,
            );


            const totalItems =
                successful.reduce(
                    (
                        total,
                        order,
                    ) =>
                        total
                        + order
                            .items
                            .length,

                    0,
                );


            console.log(
                `Items extracted: ${totalItems}`,
            );

            console.log('========================================');


            /*
             * For now, store one record per order
             * in the Apify Dataset.
             *
             * Later we can replace / supplement
             * this with Supabase upserts.
             */

            for (
                const result
                of successful
            ) {

                await Actor.pushData({
                    store,
                    report_date,
                    extracted_at:
                        new Date()
                            .toISOString(),

                    ...result,
                });
            }


            /*
             * Save failures as well so they are
             * easy to inspect.
             */

            if (
                failed.length
            ) {

                await Actor.setValue(
                    'FAILED_ORDERS',
                    failed,
                );

                console.warn(
                    `${failed.length} order(s) failed. `
                    + 'See FAILED_ORDERS in Key-Value Store.',
                );
            }
        },
    });


await crawler.run([
    ORDER_HISTORY_URL,
]);


console.log(
    'Revel Order History Actor completed.',
);

await Actor.exit();