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
            timeout: 60000,
        },
    );

    /*
     * If we're already authenticated,
     * Revel may take us straight to Order History.
     */
    if (
        page.url().includes('/reports/orders')
    ) {
        console.log('Existing authenticated session detected.');
        return;
    }

    console.log('Logging into Revel...');

    /*
     * Username
     *
     * We can tighten these selectors after testing
     * against your actual login page.
     */
    const usernameInput = page.locator(
        'input[name="username"], input[type="email"], input#id_username',
    ).first();

    await usernameInput.waitFor({
        state: 'visible',
        timeout: 30000,
    });

    await usernameInput.fill(username);

    /*
     * Some Revel login flows have a separate
     * username step.
     */
    const continueButton = page.getByRole(
        'button',
        {
            name: /continue|next|sign in|login/i,
        },
    ).first();

    if (
        await continueButton
            .isVisible()
            .catch(() => false)
    ) {
        await continueButton.click();

        await page.waitForTimeout(1000);
    }

    const passwordInput = page.locator(
        'input[name="password"], input[type="password"], input#id_password',
    ).first();

    await passwordInput.waitFor({
        state: 'visible',
        timeout: 30000,
    });

    await passwordInput.fill(password);

    const loginButton = page.getByRole(
        'button',
        {
            name: /login|log in|sign in/i,
        },
    ).first();

    await loginButton.click();

    await page.waitForLoadState(
        'domcontentloaded',
    );

    await page.waitForTimeout(2000);

    /*
     * Go explicitly to Order History after authentication.
     */
    await page.goto(
        ORDER_HISTORY_URL,
        {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        },
    );

    console.log('Login complete.');
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

    /*
     * You may already have a known selector for this
     * establishment header from the other Revel Actor.
     *
     * This intentionally uses text / generic selectors
     * until we merge your existing known-good selection logic.
     */
    const establishmentTrigger = page.locator(
        '[class*="establishment"], [class*="estab"]',
    ).filter({
        hasText: /Lampasas|Leander/i,
    }).first();

    const currentText = clean(
        await establishmentTrigger
            .textContent()
            .catch(() => null),
    );

    console.log(
        `Current establishment header: ${currentText}`,
    );

    if (
        currentText
            ?.toLowerCase()
            .includes(targetStore.toLowerCase())
    ) {
        console.log(
            `Correct establishment already selected: ${targetStore}`,
        );

        return;
    }

    console.log(
        'Opening establishment selector...',
    );

    await establishmentTrigger.click();

    /*
     * Sort by establishment number.
     */
    const estabNumberButton = page.locator(
        'div.btn.by-id',
    ).filter({
        hasText: 'Estab. No.',
    });

    if (
        await estabNumberButton
            .isVisible()
            .catch(() => false)
    ) {
        console.log(
            'Sorting establishment list by Estab. No.',
        );

        await estabNumberButton.click();
    }

    /*
     * Expand every folder.
     */
    const expandAll = page.locator(
        'span.expand-all',
    );

    if (
        await expandAll
            .isVisible()
            .catch(() => false)
    ) {
        console.log(
            'Expanding all establishment folders...',
        );

        await expandAll.click();

        await page.waitForTimeout(1000);
    }

    /*
     * Locate target store by visible text.
     */
    const target = page
        .getByText(
            new RegExp(
                `\\b${targetStore}\\b`,
                'i',
            ),
        )
        .last();

    await target.waitFor({
        state: 'visible',
        timeout: 30000,
    });

    console.log(
        `Selecting establishment: ${targetStore}`,
    );

    await target.click();

    await page.waitForTimeout(1500);

    /*
     * Critical verification.
     */
    const verifiedText = clean(
        await establishmentTrigger
            .textContent()
            .catch(() => null),
    );

    console.log(
        `Establishment after selection: ${verifiedText}`,
    );

    if (
        !verifiedText
            ?.toLowerCase()
            .includes(targetStore.toLowerCase())
    ) {
        throw new Error(
            `ESTABLISHMENT VALIDATION FAILED. `
            + `Expected "${targetStore}", `
            + `but Revel shows "${verifiedText}". `
            + `Actor stopped to prevent incorrect data attribution.`,
        );
    }

    console.log(
        `Establishment verified successfully: ${targetStore}`,
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
     * Common Revel daterangepicker fields.
     *
     * This is similar to the fields from your
     * Sales Summary actor.
     */
    const startDate = page.locator(
        'input[name="daterangepicker_start"]',
    );

    const endDate = page.locator(
        'input[name="daterangepicker_end"]',
    );

    if (
        await startDate
            .count()
    ) {
        await startDate.fill(
            reportDate,
        );
    }

    if (
        await endDate
            .count()
    ) {
        await endDate.fill(
            reportDate,
        );
    }

    /*
     * Look for the report refresh / apply button.
     */
    const refreshButton = page.getByRole(
        'button',
        {
            name: /apply|refresh|update|run/i,
        },
    ).first();

    if (
        await refreshButton
            .isVisible()
            .catch(() => false)
    ) {
        await refreshButton.click();
    }

    /*
     * Give Revel time to reload the order list.
     */
    await page.waitForTimeout(2000);

    await page.waitForLoadState(
        'networkidle',
        {
            timeout: 30000,
        },
    ).catch(() => {});

    console.log(
        'Order History date applied.',
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