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
     * Open Revel's visible date-range picker.
     *
     * This is the same pattern already used
     * successfully in your Sales Summary actor.
     */
    const dateRangeDropdown =
        page.locator(
            '.report-date-row .ico-f-to-down',
        );

    await dateRangeDropdown.waitFor({
        state: 'visible',
        timeout: 20_000,
    });

    console.log(
        'Opening Order History date-range picker...',
    );

    await dateRangeDropdown.click();


    /*
     * Confirm that the actual interactive picker
     * is now visible.
     */
    const visibleDatePicker =
        page.locator(
            '.daterangepicker:visible',
        );

    await visibleDatePicker.waitFor({
        state: 'visible',
        timeout: 20_000,
    });

    console.log(
        'Order History date-range picker opened.',
    );


    /*
     * Set the date directly through Revel's
     * daterangepicker instance.
     *
     * For this Actor we only need one business date,
     * so start and end are the same date.
     *
     * We intentionally preserve whatever time values
     * Revel already has configured instead of making
     * assumptions about the business-day start/end.
     */
    const pickerResult =
        await page.evaluate(
            ({
                requestedDate,
            }) => {

                const $ =
                    window.jQuery;

                const moment =
                    window.moment;

                if (!$) {
                    throw new Error(
                        'jQuery is not available on the Revel page.',
                    );
                }

                if (!moment) {
                    throw new Error(
                        'Moment.js is not available on the Revel page.',
                    );
                }

                /*
                 * Find every element that owns a
                 * daterangepicker instance.
                 */
                const candidates =
                    $('*').filter(
                        function findPicker() {
                            return Boolean(
                                $(this)
                                    .data(
                                        'daterangepicker',
                                    ),
                            );
                        },
                    );

                if (
                    candidates.length === 0
                ) {
                    throw new Error(
                        'Unable to locate Revel '
                        + 'daterangepicker instance.',
                    );
                }


                /*
                 * Prefer the picker whose container
                 * is currently visible.
                 */
                let picker = null;

                candidates.each(
                    function selectVisiblePicker() {

                        const candidate =
                            $(this)
                                .data(
                                    'daterangepicker',
                                );

                        if (
                            !picker
                            && candidate?.container
                            && candidate
                                .container
                                .is(':visible')
                        ) {
                            picker =
                                candidate;
                        }
                    },
                );


                /*
                 * Fall back only if necessary.
                 */
                if (!picker) {
                    picker =
                        $(candidates[0])
                            .data(
                                'daterangepicker',
                            );
                }


                if (
                    !picker?.startDate
                    || !picker?.endDate
                ) {
                    throw new Error(
                        'Revel daterangepicker '
                        + 'does not expose start/end dates.',
                    );
                }


                /*
                 * Preserve Revel's existing times.
                 *
                 * Example:
                 *
                 * if Revel currently has:
                 *
                 * start = 06:00
                 * end   = 23:59
                 *
                 * we keep those times and only change
                 * the calendar date.
                 */
                const originalStart =
                    picker.startDate.clone();

                const originalEnd =
                    picker.endDate.clone();


                const requestedStart =
                    moment(
                        requestedDate,
                        'MM/DD/YYYY',
                        true,
                    );

                const requestedEnd =
                    moment(
                        requestedDate,
                        'MM/DD/YYYY',
                        true,
                    );


                if (
                    !requestedStart.isValid()
                ) {
                    throw new Error(
                        `Invalid requested date: `
                        + `${requestedDate}`,
                    );
                }


                /*
                 * Copy the existing time components.
                 */
                requestedStart
                    .hour(
                        originalStart.hour(),
                    )
                    .minute(
                        originalStart.minute(),
                    )
                    .second(
                        originalStart.second(),
                    );

                requestedEnd
                    .hour(
                        originalEnd.hour(),
                    )
                    .minute(
                        originalEnd.minute(),
                    )
                    .second(
                        originalEnd.second(),
                    );


                if (
                    typeof picker
                        .setStartDate
                    !== 'function'
                    ||
                    typeof picker
                        .setEndDate
                    !== 'function'
                ) {
                    throw new Error(
                        'Revel daterangepicker does not '
                        + 'expose date-setting methods.',
                    );
                }


                picker.setStartDate(
                    requestedStart,
                );

                picker.setEndDate(
                    requestedEnd,
                );


                /*
                 * Force Revel's UI controls to update.
                 */
                if (
                    typeof picker.updateView
                    === 'function'
                ) {
                    picker.updateView();
                }

                if (
                    typeof picker
                        .updateCalendars
                    === 'function'
                ) {
                    picker.updateCalendars();
                }

                if (
                    typeof picker
                        .updateFormInputs
                    === 'function'
                ) {
                    picker.updateFormInputs();
                }


                return {
                    startDate:
                        picker
                            .startDate
                            .format(
                                'MM/DD/YYYY hh:mm A',
                            ),

                    endDate:
                        picker
                            .endDate
                            .format(
                                'MM/DD/YYYY hh:mm A',
                            ),

                    hasClickApply:
                        typeof picker
                            .clickApply
                        === 'function',
                };
            },
            {
                requestedDate:
                    reportDate,
            },
        );


    console.log(
        `Internal Order History range: `
        + `${pickerResult.startDate} through `
        + `${pickerResult.endDate}`,
    );


    if (
        !pickerResult.hasClickApply
    ) {
        throw new Error(
            'The Revel daterangepicker does not '
            + 'expose clickApply().',
        );
    }


    /*
     * Apply the date through the picker API.
     */
    console.log(
        'Applying Order History date range...',
    );

    await page.evaluate(() => {

        const $ =
            window.jQuery;

        if (!$) {
            throw new Error(
                'jQuery is not available during Apply.',
            );
        }

        const candidates =
            $('*').filter(
                function findPicker() {
                    return Boolean(
                        $(this)
                            .data(
                                'daterangepicker',
                            ),
                    );
                },
            );

        let picker = null;

        candidates.each(
            function selectVisiblePicker() {

                const candidate =
                    $(this)
                        .data(
                            'daterangepicker',
                        );

                if (
                    !picker
                    && candidate?.container
                    && candidate
                        .container
                        .is(':visible')
                ) {
                    picker =
                        candidate;
                }
            },
        );

        if (
            !picker
            && candidates.length > 0
        ) {
            picker =
                $(candidates[0])
                    .data(
                        'daterangepicker',
                    );
        }

        if (!picker) {
            throw new Error(
                'Unable to locate the Revel '
                + 'daterangepicker during Apply.',
            );
        }

        if (
            typeof picker.clickApply
            !== 'function'
        ) {
            throw new Error(
                'The Revel daterangepicker does not '
                + 'expose clickApply().',
            );
        }

        picker.clickApply();
    });


    /*
     * The picker should disappear once Apply runs.
     */
    await visibleDatePicker.waitFor({
        state: 'hidden',
        timeout: 30_000,
    });

    console.log(
        'Date picker closed. Waiting for '
        + 'Order History to refresh...',
    );


    /*
     * Wait until the visible report-date row
     * shows the requested date.
     *
     * This is better than an arbitrary sleep.
     */
    await page.waitForFunction(
        ({
            expectedDate,
        }) => {

            const normalizeDate =
                (value) => {

                    const match =
                        String(value)
                            .match(
                                /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
                            );

                    if (!match) {
                        return null;
                    }

                    const [
                        ,
                        month,
                        day,
                        year,
                    ] = match;

                    return (
                        `${month.padStart(2, '0')}/`
                        + `${day.padStart(2, '0')}/`
                        + `${year}`
                    );
                };


            const reportDateRow =
                document.querySelector(
                    '.report-date-row',
                );

            if (!reportDateRow) {
                return false;
            }

            const displayedDates =
                (
                    reportDateRow
                        .textContent
                    ?? ''
                )
                    .match(
                        /\d{1,2}\/\d{1,2}\/\d{4}/g,
                    )
                    ?.map(
                        normalizeDate,
                    );

            if (
                !displayedDates
                || displayedDates.length < 1
            ) {
                return false;
            }

            const expected =
                normalizeDate(
                    expectedDate,
                );

            /*
             * For a single-day report, every
             * visible report date should equal
             * the requested date.
             */
            return displayedDates
                .every(
                    (date) =>
                        date === expected,
                );
        },
        {
            expectedDate:
                reportDate,
        },
        {
            timeout: 90_000,
            polling: 500,
        },
    );


    console.log(
        `Order History date applied successfully: `
        + `${reportDate}`,
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